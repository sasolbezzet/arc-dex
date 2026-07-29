// App Kit SDK helpers — integrasi bridge Arc ↔ Solana (Devnet).
// Dokumentasi: https://docs.arc.io/app-kit/bridge
// Mode "Browser wallet": MetaMask (EVM) + Solflare/Phantom (Solana).
//
// CCTP v2 flow: approve → burn → fetchAttestation → mint
//   - Burn   : popup MetaMask / Solflare (user tanda-tangan)
//   - Attestation: polling Iris API Circle
//   - Mint   : "permissionless relay" — tidak perlu popup wallet
//              (Circle Orbit Forwarder relay attestation ke on-chain)

import { AppKit, SwapChain, TransferSpeed } from '@circle-fin/app-kit'
import { ArbitrumSepolia, ArcTestnet, BaseSepolia, EthereumSepolia, SolanaDevnet, resolveChainIdentifier } from '@circle-fin/bridge-kit'
import { ViemAdapter } from '@circle-fin/adapter-viem-v2'
import { SolanaKitAdapter } from '@circle-fin/adapter-solana-kit'
import { address as solanaAddress, compileTransaction, createSolanaRpc, getBase58Decoder, getBase64EncodedWireTransaction } from '@solana/kit'
import { getAssociatedTokenAddressSync } from '@solana/spl-token'
import { PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js'
import { createPublicClient, createWalletClient, custom, defineChain, fallback, http } from 'viem'
import { solanaFeePayerSignature, wrapSolflare, wrapPhantom } from './solflareWrapper'
import { ARC_TESTNET_ADD_PARAMS, ARC_TESTNET_CHAIN_ID, ARC_TESTNET_RPC_URLS, switchToArcTestnet } from './domain/arcNetwork'
import { getArcToken } from './domain/tokens'
import { findChain } from './chains'
import { findConnectedWalletProvider, getWalletProvider, normalizeWalletProvider } from './walletProvider'

declare global {
  interface Window {
    ethereum?: any
    solflare?: any
    phantom?: { solana?: any }
    solana?: any   // Generic fallback (bisa Phantom atau wallet lain)
  }
}

const SOLANA_DEVNET_RPC = 'https://api.devnet.solana.com'
// USDC Devnet mint di Solana
const USDC_DEVNET_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'

type SolanaSimulationDiagnostic = { err: unknown; logs: string[] }
let lastSolanaSimulationDiagnostic: SolanaSimulationDiagnostic | null = null

function createDiagnosticSolanaRpc() {
  const rpc: any = createSolanaRpc(SOLANA_DEVNET_RPC)
  return new Proxy(rpc, {
    get(target, property, receiver) {
      if (property !== 'simulateTransaction') return Reflect.get(target, property, receiver)
      return (...args: any[]) => {
        const request = target.simulateTransaction(...args)
        return new Proxy(request, {
          get(requestTarget, requestProperty, requestReceiver) {
            if (requestProperty !== 'send') return Reflect.get(requestTarget, requestProperty, requestReceiver)
            return async () => {
              try {
                const response = await requestTarget.send()
                lastSolanaSimulationDiagnostic = response?.value?.err
                  ? { err: response.value.err, logs: parseSolanaLogs(response.value.logs) }
                  : null
                return response
              } catch (error) {
                captureSolanaRpcError(error)
                throw error
              }
            }
          },
        })
      }
    },
  })
}

// ── Wallet kind tracking ──────────────────────────────────────────
let _solanaKind: 'solflare' | 'phantom' | null = null
export function getSolanaKind(): 'solflare' | 'phantom' | null {
  return _solanaKind
}

// ── Provider getters ────────────────────────────────────────────
function getSolflareProvider(): any | null {
  const w = window as any
  if (w.solflare && (w.solflare.isSolflare || typeof w.solflare.connect === 'function')) {
    return w.solflare
  }
  return null
}

function getPhantomProvider(): any | null {
  const w = window as any
  // window.phantom.solana atau window.solana dengan isPhantom flag
  const p = w.phantom?.solana ?? w.solana
  if (p && (p.isPhantom || p._isPhantom)) return p
  return null
}

function autoDetectSolanaProvider(): { raw: any; kind: 'solflare' | 'phantom' } | null {
  if (_solanaKind === 'phantom') {
    const selected = getPhantomProvider()
    if (selected) return { raw: selected, kind: 'phantom' }
  }
  if (_solanaKind === 'solflare') {
    const selected = getSolflareProvider()
    if (selected) return { raw: selected, kind: 'solflare' }
  }
  const sf = getSolflareProvider()
  if (sf) { _solanaKind = 'solflare'; return { raw: sf, kind: 'solflare' } }
  const ph = getPhantomProvider()
  if (ph) { _solanaKind = 'phantom'; return { raw: ph, kind: 'phantom' } }
  return null
}

// Panggil segera di awal halaman untuk set _solanaKind
export function detectSolanaKind(): 'solflare' | 'phantom' | null {
  const result = autoDetectSolanaProvider()
  if (result) _solanaKind = result.kind
  return _solanaKind
}

// Circle AppKit v1.8.1 hard-codes Arc's rate-limited public endpoint.
const ARC_RPC_PROXY = new URL('/api/rpc/arc', window.location.origin).href
const ARC_TESTNET_APPKIT = { ...ArcTestnet, rpcEndpoints: [ARC_RPC_PROXY] } as unknown as typeof ArcTestnet

function unifiedBalanceChain(chain: Exclude<UnifiedBalanceSourceChain, 'auto'>) {
  return chain === 'Arc_Testnet' ? ARC_TESTNET_APPKIT : chain
}

// ── AppKit singleton ─────────────────────────────────────────────
let kitInstance: AppKit | null = null
function getKit(): AppKit {
  if (!kitInstance) {
    kitInstance = new AppKit()
    try {
      ;(kitInstance as any).on?.('*', (payload: any) => {
        console.log('[AppKit event]', payload?.name ?? '?', payload)
      })
    } catch (err) {
      console.warn('[AppKit] event subscribe gagal:', err)
    }
  }
  return kitInstance
}

async function withGatewayProxy<T>(operation: () => Promise<T>): Promise<T> {
  const originalFetch = window.fetch
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url
    if (!url.startsWith('https://gateway-api-testnet.circle.com/')) {
      return originalFetch.call(window, input, init)
    }
    const target = new URL(url)
    const proxyPreferred = /^\/v1\/(?:info|balances|deposits|estimate|transfer(?:\/[0-9a-f-]+)?)(?:\?.*)?$/i.test(target.pathname + target.search)
    if (!proxyPreferred) return originalFetch.call(window, input, init)
    const stored = localStorage.getItem('arc-dex-auth')
    let authToken = ''
    try { authToken = stored ? JSON.parse(stored)?.token || '' : '' } catch {}
    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined))
    if (authToken) headers.set('Authorization', `Bearer ${authToken}`)
    const method = init?.method || (input instanceof Request ? input.method : 'GET')
    const body = init?.body || (input instanceof Request && method !== 'GET' ? await input.clone().text() : undefined)
    return originalFetch.call(window, `/api/unified-balance/gateway-proxy?path=${encodeURIComponent(`${target.pathname}${target.search}`)}`, {
      ...init,
      method,
      headers,
      body,
      signal: AbortSignal.timeout(90_000),
    })
  }
  try {
    return await operation()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const cause = error instanceof Error ? error.cause : undefined
    console.error('[gateway-proxy] operation failed:', message, cause ? String(cause) : '')
    if (/Maximum retry attempts|Service temporarily unavailable|Failed to fetch|Gateway API error|NetworkError|timeout|aborted/i.test(message)) {
      throw new Error('Deposit/withdrawal berhasil on-chain, tetapi Circle Gateway testnet belum mengkonfirmasi transfer. Unified Balance Anda akan ter-update dalam beberapa menit. Jika tidak update, coba refresh halaman dan cek Unified Balance.', { cause: error })
    }
    throw error
  } finally {
    window.fetch = originalFetch
  }
}

export type AppKitChain =
  | 'Arc_Testnet'
  | 'Ethereum_Sepolia'
  | 'Base_Sepolia'
  | 'Arbitrum_Sepolia'
  | 'Solana_Devnet'

// ── EVM adapter ─────────────────────────────────────────────────
export async function buildEvmAdapter() {
  const provider = await findConnectedWalletProvider()
  if (!provider) throw new Error('Wallet EVM tidak terdeteksi.')
  const normalizedProvider = normalizeWalletProvider(provider)
  const capabilities = { addressContext: 'user-controlled' as const, supportedChains: [ArcTestnet, BaseSepolia, EthereumSepolia, ArbitrumSepolia] }
  return new ViemAdapter({
    getWalletClient: async ({ chain }: any) => {
      const safeChain = normalizeViemChain(chain)
      const accounts = await normalizedProvider.request({ method: 'eth_accounts' })
      const walletAddress = accounts?.[0]
      if (!/^0x[a-fA-F0-9]{40}$/.test(String(walletAddress || ''))) throw new Error('Connect EVM wallet first.')
      return createWalletClient({
        account: { address: walletAddress, type: 'json-rpc' },
        chain: safeChain,
        transport: custom(normalizedProvider as any),
      }) as any
    },
    getPublicClient: ({ chain }: any) => {
      const safeChain = normalizeViemChain(chain)
      const chainId = safeChain.id
      const rpcUrls = publicRpcUrls(chainId)
      const viemChain = defineChain({
        id: chainId,
        name: String(chain?.name || chain?.chain || `Chain ${chainId}`),
        nativeCurrency: chainId === Number(ARC_TESTNET_CHAIN_ID)
          ? { name: 'USDC', symbol: 'USDC', decimals: 18 }
          : { name: 'Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: { default: { http: rpcUrls } },
      })
      return createPublicClient({
        chain: viemChain,
        transport: fallback(rpcUrls.map(url => http(url, { timeout: 10_000, retryCount: 1 }))),
      })
    },
  }, capabilities as any)
}

function normalizeViemChain(chain: any) {
  let chainId = Number(chain?.id ?? chain?.chainId)
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    const name = String(chain?.name || '').toLowerCase().replace(/[^a-z0-9]/g, '')
    chainId = ({
      arctestnet: 5042002,
      basesepolia: 84532,
      ethereumsepolia: 11155111,
      sepolia: 11155111,
      arbitrumsepolia: 421614,
    } as Record<string, number>)[name]
  }
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error(`Circle returned an invalid EVM chain ID for ${String(chain?.name || 'unknown chain')}.`)
  return { ...chain, id: chainId }
}

function publicRpcUrls(chainId: number): string[] {
  const urls: Record<number, string[]> = {
    5042002: [ARC_RPC_PROXY, ...ARC_TESTNET_RPC_URLS],
    11155111: ['https://ethereum-sepolia-rpc.publicnode.com', 'https://rpc.sepolia.org'],
    84532: ['https://sepolia.base.org', 'https://base-sepolia-rpc.publicnode.com'],
    421614: ['https://sepolia-rollup.arbitrum.io/rpc', 'https://arbitrum-sepolia-rpc.publicnode.com'],
  }
  return urls[Number(chainId)] || [ARC_RPC_PROXY]
}

// ── Solana adapter ──────────────────────────────────────────────
export async function buildSolanaAdapter() {
  const auto = autoDetectSolanaProvider()
  if (!auto) {
    throw new Error('Wallet Solana tidak terdeteksi. Install Solflare atau Phantom.')
  }

  const raw = auto.kind === 'phantom' ? getPhantomProvider()! : getSolflareProvider()!
  if (!raw) throw new Error(`Wallet ${auto.kind} tidak ditemukan.`)

  if (!raw.isConnected) {
    await raw.connect()
  }

  // Bungkus provider — expose .address (string base58) yang adapter butuhkan.
  const provider = auto.kind === 'phantom' ? wrapPhantom(raw) : wrapSolflare(raw)

  const walletAddress = provider.address
  if (!walletAddress) throw new Error(`Wallet ${auto.kind} tidak mengembalikan public key.`)
  // App Kit 1.7.0 + adapter-solana-kit 1.5.1 loses the fee-payer signature
  // through createSolanaKitAdapterFromProvider (Solana error 5663012). Keep
  // the Wallet Standard provider, but expose the signature-preserving Kit API.
  const signerAddress = solanaAddress(walletAddress)
  const signer: any = {
    address: signerAddress,
    signTransactions: async (transactions: readonly any[]) => Promise.all(transactions.map(async transaction => {
      const encoded = getBase64EncodedWireTransaction(transaction)
      const signed = await provider.signTransaction(encoded)
      return { [signerAddress]: solanaFeePayerSignature(signed) }
    })),
    signMessages: async (messages: readonly { content: Uint8Array }[]) => Promise.all(messages.map(async message => {
      const result = await provider.signMessage(message.content)
      const signature = result?.signature ?? result
      if (!(signature instanceof Uint8Array) || signature.length !== 64) {
        throw new Error('Wallet returned an invalid Solana message signature.')
      }
      return { [signerAddress]: signature }
    })),
    signVersionedTransaction: async (transaction: any) => provider.signTransaction(transaction),
  }
  lastSolanaSimulationDiagnostic = null
  const adapter: any = new SolanaKitAdapter({
    getRpc: () => createDiagnosticSolanaRpc() as any,
    getSigner: async () => signer,
  }, {
    addressContext: 'user-controlled',
    supportedChains: [SolanaDevnet],
  } as any)
  installBrowserWalletTransactionExecutor(adapter, provider)
  return adapter
}

function installBrowserWalletTransactionExecutor(adapter: any, provider: any) {
  const sdkExecuteTransaction = adapter.executeTransaction.bind(adapter)
  adapter.executeTransaction = async (
    rpc: any,
    signer: any,
    instructions: readonly any[],
    additionalSigners: readonly any[] = [],
    computeUnitLimit?: number,
    addressesByLookupTable?: any,
  ) => {
    // Preserve the SDK path for operations that require program-side
    // co-signers. Gateway deposit and receive do not use this branch.
    if (additionalSigners.length) {
      return sdkExecuteTransaction(rpc, signer, instructions, additionalSigners, computeUnitLimit, addressesByLookupTable)
    }

    try {
      await adapter.simulateTransaction(rpc, signer, instructions, [], computeUnitLimit, addressesByLookupTable)
      const message = await adapter.buildTransactionMessage(rpc, signer, instructions, computeUnitLimit, addressesByLookupTable)
      const unsigned = compileTransaction(message)
      const signed = await provider.signTransaction(getBase64EncodedWireTransaction(unsigned))
      const signatureBytes = solanaFeePayerSignature(signed)
      const wireTransaction = encodeBrowserSignedTransaction(signed)
      const signature = getBase58Decoder().decode(signatureBytes)
      await rpc.sendTransaction(wireTransaction, {
        encoding: 'base64',
        preflightCommitment: 'confirmed',
        maxRetries: 3n,
      }).send()
      const confirmation = await adapter.waitForTransaction(signature, { timeout: 60_000, confirmations: 1 })
      if (confirmation?.status === 'reverted') throw new Error(`Transaction failed on-chain: ${signature}`)
      return signature
    } catch (error) {
      captureSolanaRpcError(error)
      throw error
    }
  }
}

function encodeBrowserSignedTransaction(transaction: any) {
  let bytes: Uint8Array
  if (transaction instanceof VersionedTransaction) {
    bytes = transaction.serialize()
  } else if (transaction instanceof Transaction) {
    bytes = transaction.serialize({ requireAllSignatures: true, verifySignatures: true })
  } else if (transaction instanceof Uint8Array) {
    bytes = transaction
  } else if (typeof transaction === 'string') {
    return transaction
  } else if (typeof transaction?.serialize === 'function') {
    bytes = transaction.serialize()
  } else {
    throw new Error('Wallet returned an unsupported signed Solana transaction format.')
  }
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

function captureSolanaRpcError(error: unknown) {
  const context = collectSolanaErrorContext(error)
  lastSolanaSimulationDiagnostic = {
    err: context.err || (error instanceof Error ? error.message : String(error)),
    logs: context.logs,
  }
}

// ── Wallet connect / disconnect ─────────────────────────────────
export async function connectSolanaWallet(kind: 'solflare' | 'phantom' = 'solflare'): Promise<string> {
  const raw = kind === 'solflare' ? getSolflareProvider() : getPhantomProvider()
  if (!raw) {
    throw new Error(`${kind === 'solflare' ? 'Solflare' : 'Phantom'} belum ter-install.`)
  }
  await raw.connect()
  const pk = raw.publicKey?.toString?.() ?? null
  if (!pk) throw new Error(`Gagal dapat public key dari ${kind}.`)
  _solanaKind = kind
  return pk
}

export async function disconnectSolanaWallet(): Promise<void> {
  try {
    const raw = _solanaKind === 'solflare' ? getSolflareProvider() : getPhantomProvider()
    await raw?.disconnect?.()
  } catch { /* ignore */ }
  _solanaKind = null
}

export function getConnectedSolanaPubkey(): string | null {
  const auto = autoDetectSolanaProvider()
  if (!auto) return null
  const raw = auto.kind === 'solflare' ? getSolflareProvider() : getPhantomProvider()
  if (raw?.isConnected && raw.publicKey) {
    try { return raw.publicKey.toString() } catch { return null }
  }
  return null
}

// ── Balance checking ─────────────────────────────────────────────
const _solanaRpc = createSolanaRpc(SOLANA_DEVNET_RPC)

/** Cek saldo SOL (dalam SOL, bukan lamports) */
export async function getSolBalance(pubkey: string): Promise<number> {
  try {
    const resp = await (_solanaRpc.getBalance as any)(solanaAddress(pubkey)).send()
    return Number(resp.value) / 1e9
  } catch {
    return 0
  }
}

/** Cek saldo USDC Devnet di associated token account (ATA) */
export async function getUsdcBalance(pubkey: string): Promise<number> {
  return (await getSolanaWalletDiagnostics(pubkey)).usdcBalance
}

export async function getSolanaWalletDiagnostics(pubkey: string) {
  const owner = new PublicKey(pubkey)
  const mint = new PublicKey(USDC_DEVNET_MINT)
  const ata = getAssociatedTokenAddressSync(mint, owner).toBase58()
  try {
    const [solBalance, tokenBalance] = await Promise.all([
      getSolBalance(pubkey),
      (_solanaRpc.getTokenAccountBalance as any)(solanaAddress(ata)).send().catch(() => null),
    ])
    return {
      walletAddress: pubkey,
      ataAddress: ata,
      ataExists: Boolean(tokenBalance?.value),
      solBalance,
      usdcBalance: Number(tokenBalance?.value?.uiAmountString || '0'),
      mintAddress: USDC_DEVNET_MINT,
      network: 'Solana Devnet',
    }
  } catch {
    return { walletAddress: pubkey, ataAddress: ata, ataExists: false, solBalance: 0, usdcBalance: 0, mintAddress: USDC_DEVNET_MINT, network: 'Solana Devnet' }
  }
}

// ── Bridge ──────────────────────────────────────────────────────
export interface BridgeArgs {
  from: AppKitChain
  to: AppKitChain
  amount: string
  speed?: 'FAST' | 'SLOW'
  recipient?: string
}

export async function bridgeWithAppKit(args: BridgeArgs): Promise<unknown> {
  const kit = getKit()
  const fromIsSolana = args.from === 'Solana_Devnet'
  const toIsSolana   = args.to   === 'Solana_Devnet'

  if (fromIsSolana && toIsSolana) {
    throw new Error('Bridge Solana ke Solana tidak didukung.')
  }

  const evmAdapter   = await buildEvmAdapter()
  const solanaAdapter = await buildSolanaAdapter()

  const speed: TransferSpeed = args.speed === 'SLOW' ? TransferSpeed.SLOW : TransferSpeed.FAST

  const fromCtx: any = {
    adapter: fromIsSolana ? solanaAdapter : evmAdapter,
    chain:   args.from,
  }
  const toCtx: any = {
    adapter: toIsSolana ? solanaAdapter : evmAdapter,
    chain:   args.to,
  }
  if (args.recipient) toCtx.recipientAddress = args.recipient

  return await kit.bridge({
    from: fromCtx,
    to:   toCtx,
    amount: args.amount,
    token:  'USDC',
    config: { transferSpeed: speed },
  } as any)
}

export async function swapEoaWithAppKit(args: {
  tokenIn: string
  tokenOut: string
  amountIn: string
  kitKey: string
  customFeeBps?: number
  feeRecipient?: string
}): Promise<any> {
  await switchToArcTestnet()
  const kit = getKit()
  const adapter = await buildEvmAdapter()
  if (!args.kitKey) throw new Error('Kit key belum tersedia dari API.')
  const accounts = await getWalletProvider()?.request({ method: 'eth_requestAccounts' })
  const address = accounts?.[0]
  if (!address) throw new Error('Wallet EOA belum terhubung.')
  const from = { adapter, chain: SwapChain.Arc_Testnet }
  const config = swapConfig(args)
  if (isEurcToCirBtc(args.tokenIn, args.tokenOut)) {
    const first = await kit.swap({
      from,
      tokenIn: 'EURC',
      tokenOut: 'USDC',
      amountIn: args.amountIn,
      config,
    } as any)
    const intermediateAmount = first?.amountOut
    if (!intermediateAmount || Number(intermediateAmount) <= 0) throw new Error('Swap EURC → USDC tidak menghasilkan output untuk route cirBTC.')
    const second = await kit.swap({
      from,
      tokenIn: 'USDC',
      tokenOut: swapTokenParam('cirBTC'),
      amountIn: intermediateAmount,
      config: swapConfig({ ...args, customFeeBps: 0 }),
    } as any)
    return {
      ...second,
      tokenIn: 'EURC',
      tokenOut: 'cirBTC',
      amountIn: args.amountIn,
      route: 'EURC → USDC → cirBTC',
      steps: [swapStep('EURC → USDC', first), swapStep('USDC → cirBTC', second)],
    }
  }
  return await kit.swap({
    from,
    tokenIn: swapTokenParam(args.tokenIn),
    tokenOut: swapTokenParam(args.tokenOut),
    amountIn: args.amountIn,
    config,
  } as any)
}

export async function estimateEoaSwapWithAppKit(args: {
  tokenIn: string
  tokenOut: string
  amountIn: string
  kitKey: string
  customFeeBps?: number
  feeRecipient?: string
}): Promise<any> {
  await switchToArcTestnet()
  const kit = getKit()
  const adapter = await buildEvmAdapter()
  if (!args.kitKey) throw new Error('Kit key belum tersedia dari API.')
  const accounts = await getWalletProvider()?.request({ method: 'eth_accounts' })
  const address = accounts?.[0]
  if (!address) throw new Error('Wallet EOA belum terhubung.')
  const from = { adapter, chain: SwapChain.Arc_Testnet }
  const config = swapConfig(args)
  if (isEurcToCirBtc(args.tokenIn, args.tokenOut)) {
    const first = await kit.estimateSwap({
      from,
      tokenIn: 'EURC',
      tokenOut: 'USDC',
      amountIn: args.amountIn,
      config,
    } as any)
    const intermediateAmount = first?.estimatedOutput?.amount
    if (!intermediateAmount || Number(intermediateAmount) <= 0) throw new Error('Route EURC → USDC tidak menghasilkan estimasi.')
    const second = await kit.estimateSwap({
      from,
      tokenIn: 'USDC',
      tokenOut: swapTokenParam('cirBTC'),
      amountIn: intermediateAmount,
      config: swapConfig({ ...args, customFeeBps: 0 }),
    } as any)
    return {
      ...second,
      tokenIn: 'EURC',
      tokenOut: 'cirBTC',
      amountIn: args.amountIn,
      fees: [...(first?.fees || []), ...(second?.fees || [])],
      route: 'EURC → USDC → cirBTC',
      legs: [first, second],
    }
  }
  return await kit.estimateSwap({
    from,
    tokenIn: swapTokenParam(args.tokenIn),
    tokenOut: swapTokenParam(args.tokenOut),
    amountIn: args.amountIn,
    config,
  } as any)
}

function isEurcToCirBtc(tokenIn: string, tokenOut: string) {
  return tokenIn === 'EURC' && tokenOut === 'cirBTC'
}

function swapConfig(args: { kitKey: string; customFeeBps?: number; feeRecipient?: string }) {
  return {
    kitKey: args.kitKey,
    allowanceStrategy: 'approve' as const,
    slippageBps: 300,
    ...(args.customFeeBps && args.feeRecipient ? {
      customFee: {
        percentageBps: args.customFeeBps,
        recipientAddress: args.feeRecipient,
      },
    } : {}),
  }
}

function swapStep(name: string, result: any) {
  return { name, state: 'success', txHash: result?.txHash, explorerUrl: result?.explorerUrl, amountOut: result?.amountOut }
}

export async function getUnifiedBalanceWithAppKit() {
  const address = await getConnectedEvmAddress()
  const solanaAddress = await getConnectedSolanaAddress(false)
  const response = await fetch('/api/unified-balance/balances', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, ...(solanaAddress ? { solanaAddress } : {}) }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data?.error || 'Unified Balance API temporarily unavailable')
  return data
}

export type UnifiedBalanceSourceChain = 'auto' | 'Arc_Testnet' | 'Base_Sepolia' | 'Ethereum_Sepolia' | 'Arbitrum_Sepolia' | 'Solana_Devnet'
type UnifiedBalanceEvmChain = Exclude<UnifiedBalanceSourceChain, 'auto' | 'Solana_Devnet'>
export const UNIFIED_BALANCE_EVM_CHAINS: UnifiedBalanceEvmChain[] = ['Arc_Testnet', 'Base_Sepolia', 'Ethereum_Sepolia', 'Arbitrum_Sepolia']
export const UNIFIED_BALANCE_CHAINS: Exclude<UnifiedBalanceSourceChain, 'auto'>[] = [...UNIFIED_BALANCE_EVM_CHAINS, 'Solana_Devnet']

function unifiedBalanceAllocations(amount: string, sourceChain: UnifiedBalanceSourceChain = 'auto', balance: any) {
  const requested = usdcUnits(amount)
  let remaining = requested
  const allocations: Array<{ amount: string; chain: Exclude<UnifiedBalanceSourceChain, 'auto'> }> = []
  const chains = sourceChain === 'auto' ? UNIFIED_BALANCE_CHAINS : [sourceChain]
  for (const chain of chains) {
    const available = usdcUnits(confirmedBalanceForChain(balance, chain))
    if (available <= 0n || remaining <= 0n) continue
    const allocated = available < remaining ? available : remaining
    allocations.push({ chain, amount: formatUsdcUnits(allocated) })
    remaining -= allocated
  }
  if (remaining > 0n) throw new Error(`Unified Balance insufficient. Available ${formatUsdcUnits(requested - remaining)} USDC.`)
  return allocations
}

async function unifiedBalanceSources(allocations: Array<{ amount: string; chain: Exclude<UnifiedBalanceSourceChain, 'auto'> }>, evmAdapter: any) {
  const sources: any[] = []
  const evmAllocations = allocations.filter(item => item.chain !== 'Solana_Devnet')
  const solanaAllocations = allocations.filter(item => item.chain === 'Solana_Devnet')
  if (evmAllocations.length) sources.push({ adapter: evmAdapter, allocations: evmAllocations })
  if (solanaAllocations.length) sources.push({ adapter: await buildSolanaUnifiedSpendAdapter(), allocations: solanaAllocations })
  return sources
}

async function ensureUnifiedEvmChain(_adapter: any, chain: UnifiedBalanceEvmChain) {
  const resolved = resolveChainIdentifier(chain)
  if (resolved.type !== 'evm') throw new Error(`${resolved.name} bukan chain EVM.`)
  const config = findChain(chain)?.addParams
  const rawProvider = getWalletProvider()
  if (!config || !rawProvider) throw new Error(`Connect an EVM wallet before using ${resolved.name}.`)
  const provider = normalizeWalletProvider(rawProvider)
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: config.chainId }] })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const code = Number((error as any)?.code)
    if (code !== 4902 && !/unrecognized chain|not added|rpc endpoint|failed to fetch|network/i.test(message)) throw error
    try {
      await provider.request({ method: 'wallet_addEthereumChain', params: [config] })
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: config.chainId }] })
    } catch (recoveryError) {
      const recoveryMessage = recoveryError instanceof Error ? recoveryError.message : String(recoveryError)
      if (/reject|denied|cancel/i.test(recoveryMessage)) throw recoveryError
      throw new Error(`${resolved.name} RPC endpoint is unavailable in the connected wallet. Update the chain RPC, then retry.`, { cause: recoveryError })
    }
  }
}

async function getConnectedEvmAddress() {
  const provider = await findConnectedWalletProvider()
  const accounts = await provider?.request({ method: 'eth_requestAccounts' })
  const address = accounts?.[0]
  if (!/^0x[a-fA-F0-9]{40}$/.test(String(address || ''))) throw new Error('Connect EVM wallet first.')
  return address
}

export async function getConnectedSolanaAddress(connect = false) {
  const detected = autoDetectSolanaProvider()
  if (!detected) {
    if (connect) throw new Error('Connect Solflare on Solana Devnet first.')
    return ''
  }
  if (connect && !detected.raw.isConnected) await detected.raw.connect()
  const address = detected.raw.publicKey?.toString?.() || ''
  if (!address && connect) throw new Error('Connect Solflare on Solana Devnet first.')
  return address
}

export async function depositUnifiedBalanceWithAppKit(args: {
  amount: string
  chain: Exclude<UnifiedBalanceSourceChain, 'auto'>
}) {
  const kit = getKit()
  if (args.chain === 'Solana_Devnet') {
    await assertSolanaWalletReady(args.amount, true)
    const adapter = await buildSolanaAdapter()
    try {
      return await withGatewayProxy(() => kit.unifiedBalance.deposit({
        from: { adapter, chain: unifiedBalanceChain(args.chain) },
        amount: args.amount,
        token: 'USDC',
      } as any))
    } catch (error) {
      throw normalizeSolanaTransactionError(error, 'deposit')
    }
  }
  const adapter = await buildEvmAdapter()
  await ensureUnifiedEvmChain(adapter, args.chain)
  // Arc Testnet USDC does not support EIP-3009 (receiveWithAuthorization) or EIP-2612 (permit).
  // Use 'approve' strategy (approve + deposit) instead of default 'authorize'.
  const isArc = args.chain === 'Arc_Testnet'
  return await withGatewayProxy(() => kit.unifiedBalance.deposit({
    from: { adapter, chain: unifiedBalanceChain(args.chain) },
    amount: args.amount,
    token: 'USDC',
    ...(isArc ? { allowanceStrategy: 'approve' } : {}),
  } as any))
}

export async function initiateUnifiedBalanceWithdrawWithAppKit(args: {
  amount: string
  chain: Exclude<UnifiedBalanceSourceChain, 'auto'>
}) {
  const kit = getKit()
  if (args.chain === 'Solana_Devnet') await assertSolanaWalletReady('0', false, true)
  const recipientAddress = args.chain === 'Solana_Devnet' ? await getConnectedSolanaAddress(true) : await getConnectedEvmAddress()
  try {
    return await prepareUnifiedBalanceSpend({ kit, receiveAmount: args.amount, destinationChain: args.chain, recipientAddress })
  } catch (error) {
    if (args.chain === 'Solana_Devnet') throw normalizeSolanaTransactionError(error, 'withdrawal estimate')
    throw error
  }
}

export async function completeUnifiedBalanceWithdrawWithAppKit(args: {
  amount: string
  chain: Exclude<UnifiedBalanceSourceChain, 'auto'>
  retryConfig?: { attestation: string; signature: string }
}) {
  const kit = getKit()
  if (args.chain === 'Solana_Devnet') await assertSolanaWalletReady('0', false, true)
  const recipientAddress = args.chain === 'Solana_Devnet' ? await getConnectedSolanaAddress(true) : await getConnectedEvmAddress()
  try {
    if (args.retryConfig) {
      const destinationAdapter = args.chain === 'Solana_Devnet' ? await buildSolanaAdapter() : await buildEvmAdapter()
      return await withGatewayProxy(() => kit.unifiedBalance.spend({
        to: { adapter: destinationAdapter, chain: args.chain, recipientAddress },
        amount: args.amount,
        token: 'USDC',
        config: { retry: args.retryConfig },
      } as any))
    }
    const plan = await prepareUnifiedBalanceSpend({ kit, receiveAmount: args.amount, destinationChain: args.chain, recipientAddress })
    const result = await spendUnifiedBalanceWithRetry(kit, {
      from: plan.sources,
      to: { adapter: plan.destinationAdapter, chain: args.chain, recipientAddress },
      amount: plan.spendAmount,
      token: 'USDC',
    })
    const feeUnits = totalFeeUnits((result as any)?.fees || plan.fees)
    return {
      ...(result as any),
      requestedReceiveAmount: plan.requestedReceiveAmount,
      spendAmount: plan.spendAmount,
      totalFee: formatUsdcUnits(feeUnits),
      totalDebit: formatUsdcUnits(usdcUnits(plan.spendAmount) + feeUnits),
    }
  } catch (error) {
    if (args.chain === 'Solana_Devnet') throw normalizeSolanaTransactionError(error, 'withdrawal')
    throw error
  }
}

export async function estimateUnifiedBalanceSpendWithAppKit(args: {
  amount: string
  recipient: string
  sourceChain?: UnifiedBalanceSourceChain
}) {
  const kit = getKit()
  return prepareUnifiedBalanceSpend({ kit, receiveAmount: args.amount, destinationChain: 'Arc_Testnet', recipientAddress: args.recipient, sourceChain: args.sourceChain })
}

export async function spendUnifiedBalanceWithAppKit(args: {
  amount: string
  recipient: string
  sourceChain?: UnifiedBalanceSourceChain
}) {
  const kit = getKit()
  const plan = await prepareUnifiedBalanceSpend({ kit, receiveAmount: args.amount, destinationChain: 'Arc_Testnet', recipientAddress: args.recipient, sourceChain: args.sourceChain })
  const result = await spendUnifiedBalanceWithRetry(kit, {
    from: plan.sources,
    to: { adapter: plan.destinationAdapter, chain: 'Arc_Testnet', recipientAddress: args.recipient },
    amount: plan.spendAmount,
    token: 'USDC',
  })
  const feeUnits = totalFeeUnits((result as any)?.fees || plan.fees)
  return {
    ...(result as any),
    requestedReceiveAmount: plan.requestedReceiveAmount,
    spendAmount: plan.spendAmount,
    totalFee: formatUsdcUnits(feeUnits),
    totalDebit: formatUsdcUnits(usdcUnits(plan.spendAmount) + feeUnits),
  }
}

export async function addUnifiedBalanceDelegateWithAppKit(args: {
  delegateAddress: string
  chain?: Exclude<UnifiedBalanceSourceChain, 'auto'>
}) {
  const kit = getKit()
  const chain = args.chain || 'Arc_Testnet'
  if (chain === 'Solana_Devnet') {
    await assertSolanaWalletReady('0', false)
    const adapter = await buildSolanaAdapter()
    try {
      return await withGatewayProxy(() => kit.unifiedBalance.addDelegate({ from: { adapter, chain }, delegateAddress: args.delegateAddress } as any))
    } catch (error) {
      throw normalizeSolanaTransactionError(error, 'Auto Pay enable')
    }
  }
  const adapter = await buildEvmAdapter()
  await ensureUnifiedEvmChain(adapter, chain)
  return await withGatewayProxy(() => kit.unifiedBalance.addDelegate({
    from: { adapter, chain },
    delegateAddress: args.delegateAddress,
  } as any))
}

export async function removeUnifiedBalanceDelegateWithAppKit(args: {
  delegateAddress: string
  chain?: Exclude<UnifiedBalanceSourceChain, 'auto'>
}) {
  const kit = getKit()
  const chain = args.chain || 'Arc_Testnet'
  if (chain === 'Solana_Devnet') {
    await assertSolanaWalletReady('0', false)
    const adapter = await buildSolanaAdapter()
    try {
      return await withGatewayProxy(() => kit.unifiedBalance.removeDelegate({ from: { adapter, chain }, delegateAddress: args.delegateAddress } as any))
    } catch (error) {
      throw normalizeSolanaTransactionError(error, 'Auto Pay disable')
    }
  }
  const adapter = await buildEvmAdapter()
  await ensureUnifiedEvmChain(adapter, chain)
  return await withGatewayProxy(() => kit.unifiedBalance.removeDelegate({
    from: { adapter, chain },
    delegateAddress: args.delegateAddress,
  } as any))
}

export async function getUnifiedBalanceDelegateStatusWithAppKit(args: {
  delegateAddress: string
  chain?: Exclude<UnifiedBalanceSourceChain, 'auto'>
}) {
  const kit = getKit()
  const chain = args.chain || 'Arc_Testnet'
  if (chain === 'Solana_Devnet') {
    const adapter = await buildSolanaAdapter()
    return await withGatewayProxy(() => kit.unifiedBalance.getDelegateStatus({ from: { adapter, chain }, delegateAddress: args.delegateAddress } as any))
  }
  const adapter = await buildEvmAdapter()
  await ensureUnifiedEvmChain(adapter, chain)
  return await withGatewayProxy(() => kit.unifiedBalance.getDelegateStatus({
    from: { adapter, chain },
    delegateAddress: args.delegateAddress,
  } as any))
}

export { ARC_TESTNET_ADD_PARAMS, ARC_TESTNET_CHAIN_ID, switchToArcTestnet }

export function confirmedUnifiedBalanceChains(balance: any) {
  return UNIFIED_BALANCE_CHAINS.filter(chain => Number(confirmedBalanceForChain(balance, chain)) > 0 || Number(pendingBalanceForChain(balance, chain)) > 0)
}

async function prepareUnifiedBalanceSpend(args: {
  kit: AppKit
  receiveAmount: string
  destinationChain: Exclude<UnifiedBalanceSourceChain, 'auto'>
  recipientAddress: string
  sourceChain?: UnifiedBalanceSourceChain
}) {
  const receiveUnits = usdcUnits(args.receiveAmount)
  const spendAmount = formatUsdcUnits(receiveUnits)
  let evmAdapter: any = null
  const getEvmAdapter = async () => {
    if (!evmAdapter) evmAdapter = await buildEvmAdapter()
    return evmAdapter
  }
  const destinationAdapter = args.destinationChain === 'Solana_Devnet' ? await buildSolanaAdapter() : await getEvmAdapter()
  const balance = await getUnifiedBalanceWithAppKit()
  const requestedChains = args.sourceChain && args.sourceChain !== 'auto'
    ? [args.sourceChain]
    : [...UNIFIED_BALANCE_CHAINS].sort((left, right) => sourcePriority(left, args.destinationChain) - sourcePriority(right, args.destinationChain))
  let lastError: unknown = null
  for (const chain of requestedChains) {
    const available = usdcUnits(confirmedBalanceForChain(balance, chain))
    if (available < receiveUnits) continue
    const allocations = [{ chain, amount: spendAmount }]
    try {
      const sourceAdapter = chain === 'Solana_Devnet' ? await buildSolanaUnifiedSpendAdapter() : await getEvmAdapter()
      if (chain !== 'Solana_Devnet') await ensureUnifiedEvmChain(sourceAdapter, chain)
      const estimate = await withGatewayProxy(() => args.kit.unifiedBalance.estimateSpend({
        from: { adapter: sourceAdapter, allocations },
        to: { adapter: destinationAdapter, chain: args.destinationChain, recipientAddress: args.recipientAddress },
        amount: spendAmount,
        token: 'USDC',
      } as any))
      const feeUnits = totalFeeUnits(estimate?.fees)
      if (available < receiveUnits + feeUnits) continue
      return {
        ...estimate,
        requestedReceiveAmount: spendAmount,
        spendAmount,
        totalFee: formatUsdcUnits(feeUnits),
        totalDebit: formatUsdcUnits(receiveUnits + feeUnits),
        sources: [{ adapter: sourceAdapter, allocations }],
        destinationAdapter,
      }
    } catch (error) {
      lastError = error
    }
  }
  try {
    const allocations = unifiedBalanceAllocations(spendAmount, args.sourceChain, balance)
    const sources = await unifiedBalanceSources(
      allocations,
      allocations.some(item => item.chain !== 'Solana_Devnet') ? await getEvmAdapter() : null,
    )
    const estimate = await withGatewayProxy(() => args.kit.unifiedBalance.estimateSpend({
      from: sources,
      to: { adapter: destinationAdapter, chain: args.destinationChain, recipientAddress: args.recipientAddress },
      amount: spendAmount,
      token: 'USDC',
    } as any))
    const feeUnits = totalFeeUnits(estimate?.fees)
    const selected = new Set(allocations.map((item: any) => item.chain))
    const available = UNIFIED_BALANCE_CHAINS
      .filter(chain => selected.has(chain))
      .reduce((total, chain) => total + usdcUnits(confirmedBalanceForChain(balance, chain)), 0n)
    if (available < receiveUnits + feeUnits) throw new Error('Unified Balance cannot cover amount and Gateway fee.')
    return {
      ...estimate,
      requestedReceiveAmount: spendAmount,
      spendAmount,
      totalFee: formatUsdcUnits(feeUnits),
      totalDebit: formatUsdcUnits(receiveUnits + feeUnits),
      sources,
      destinationAdapter,
    }
  } catch (error) {
    if (lastError instanceof Error) throw lastError
    throw error
  }
}

function sourcePriority(chain: Exclude<UnifiedBalanceSourceChain, 'auto'>, destinationChain: Exclude<UnifiedBalanceSourceChain, 'auto'>) {
  if (chain === destinationChain) return 0
  return ({ Base_Sepolia: 1, Arbitrum_Sepolia: 2, Arc_Testnet: 3, Ethereum_Sepolia: 4, Solana_Devnet: 5 })[chain]
}

async function spendUnifiedBalanceWithRetry(kit: AppKit, params: any) {
  try {
    return await withGatewayProxy(() => kit.unifiedBalance.spend(params))
  } catch (error) {
    const trace = (error as any)?.cause?.trace
    const attestation = trace?.attestation
    const signature = trace?.signature
    if (!isHexPayload(attestation) || !isHexPayload(signature)) throw error
    try {
      if (params.to?.chain !== 'Solana_Devnet') await refreshUnifiedEvmRpc(params.to?.chain)
      return await withGatewayProxy(() => kit.unifiedBalance.spend({
        to: params.to,
        amount: params.amount,
        token: params.token || 'USDC',
        config: { retry: { attestation, signature } },
      } as any))
    } catch (retryError) {
      const pending = new Error('Destination receive is pending. Reconnect the destination wallet network, then use Retry Receive. Do not start a new withdrawal.', { cause: retryError }) as Error & { retryConfig?: { attestation: string; signature: string } }
      pending.retryConfig = { attestation, signature }
      throw pending
    }
  }
}

async function refreshUnifiedEvmRpc(chain: UnifiedBalanceEvmChain) {
  const config = findChain(chain)?.addParams
  const rawProvider = getWalletProvider()
  if (!config || !rawProvider) return
  const provider = normalizeWalletProvider(rawProvider)
  try { await provider.request({ method: 'wallet_addEthereumChain', params: [config] }) } catch (error) {
    if (/reject|denied|cancel/i.test(error instanceof Error ? error.message : String(error))) throw error
  }
  await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: config.chainId }] })
}

function isHexPayload(value: unknown) {
  return typeof value === 'string' && /^0x[0-9a-f]+$/i.test(value) && value.length > 2
}

async function buildSolanaUnifiedSpendAdapter() {
  const detected = autoDetectSolanaProvider()
  if (!detected || detected.kind !== 'solflare') throw new Error('Solflare on Solana Devnet is required to spend deposited Solana USDC.')
  return buildSolanaAdapter()
}

async function assertSolanaWalletReady(amount: string, requireUsdc: boolean, requireAta = requireUsdc) {
  const walletAddress = await getConnectedSolanaAddress(true)
  const diagnostics = await getSolanaWalletDiagnostics(walletAddress)
  if (diagnostics.solBalance < 0.005) {
    throw new Error(`Solana Devnet needs at least 0.005 SOL for transaction fees. Available: ${diagnostics.solBalance.toFixed(6)} SOL. Wallet: ${walletAddress}.`)
  }
  if (requireAta && !diagnostics.ataExists) {
    throw new Error(`Solana Devnet USDC associated token account is missing. ATA: ${diagnostics.ataAddress}. Receive Devnet USDC in this wallet once, then retry.`)
  }
  if (requireUsdc) {
    const requested = Number(formatUsdcUnits(usdcUnits(amount)))
    if (diagnostics.usdcBalance < requested) {
      throw new Error(`Insufficient Solana Devnet USDC in ATA ${diagnostics.ataAddress}. Required: ${requested} USDC; available: ${diagnostics.usdcBalance} USDC.`)
    }
  }
}

function normalizeSolanaTransactionError(error: unknown, operation: string): Error {
  const original = error as any
  const message = original instanceof Error ? original.message : String(original)
  if (!/-32002|simulation failed/i.test(message)) return original instanceof Error ? original : new Error(message)

  const context = collectSolanaErrorContext(original)
  const diagnosticLogs = [...context.logs, ...(lastSolanaSimulationDiagnostic?.logs || [])]
    .filter((line, index, values) => values.indexOf(line) === index)
  const detail = diagnosticLogs
    .filter(line => /AnchorError|Error Code:|Error Message:|Program .* failed|insufficient|custom program error|Error:/i.test(line))
    .slice(-6)
    .map(line => line.replace(/^Program log:\s*/i, ''))
    .join(' | ')
  const sdkDetail = message.match(/(?:^|\n)(Error:\s*[^\n]+)/i)?.[1] || ''
  const capturedError = lastSolanaSimulationDiagnostic?.err == null ? '' : safeDiagnosticJson(lastSolanaSimulationDiagnostic.err)
  const reason = detail || context.errorDetails || context.err || capturedError || sdkDetail || 'the Solana program rejected the simulated transaction without RPC logs'
  const normalized = new Error(`Solana ${operation} simulation failed: ${reason}. Verify Devnet SOL, Devnet USDC, and the selected wallet account before retrying.`, { cause: error }) as Error & { retryConfig?: any }
  if (original?.retryConfig) normalized.retryConfig = original.retryConfig
  return normalized
}

function collectSolanaErrorContext(error: any): { err: string; errorDetails: string; logs: string[] } {
  const queue: Array<{ value: any; depth: number }> = [{ value: error, depth: 0 }]
  const seen = new Set<any>()
  let err = ''
  let errorDetails = ''
  const logs: string[] = []
  while (queue.length && seen.size < 40) {
    const { value, depth } = queue.shift()!
    if (!value || (typeof value !== 'object' && typeof value !== 'function') || seen.has(value)) continue
    seen.add(value)
    for (const line of parseSolanaLogs(value.logs)) if (!logs.includes(line)) logs.push(line)
    const candidateErr = value.err ?? value.error
    if (!err && candidateErr != null && candidateErr !== 'null') {
      err = typeof candidateErr === 'string' ? candidateErr : safeDiagnosticJson(candidateErr)
    }
    if (!errorDetails && typeof value.errorDetails === 'string') errorDetails = value.errorDetails
    const decoded = decodeSolanaErrorPayload(value.message)
    if (decoded) queue.push({ value: decoded, depth: depth + 1 })
    if (depth >= 6) continue
    for (const key of ['cause', 'context', 'data', 'trace', 'rawError', 'originalError']) {
      if (value[key]) queue.push({ value: value[key], depth: depth + 1 })
    }
  }
  return { err, errorDetails, logs }
}

function safeDiagnosticJson(value: unknown) {
  try { return JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item) } catch { return String(value) }
}

function decodeSolanaErrorPayload(message: unknown): Record<string, unknown> | null {
  const encoded = String(message || '').match(/decode\s+--\s+-?\d+\s+['"]([A-Za-z0-9_=-]+)['"]/i)?.[1]
  if (!encoded) return null
  try {
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - encoded.length % 4) % 4)
    const params = new URLSearchParams(atob(base64))
    return Object.fromEntries(params.entries())
  } catch {
    return null
  }
}

function parseSolanaLogs(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value !== 'string' || !value || value === 'null') return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return [value]
  }
}

function totalFeeUnits(fees: any) {
  const entries = Array.isArray(fees) ? fees : []
  const gasFeeIncludesForwarder = entries.some((fee: any) => fee?.type === 'gasFee')
  return entries.reduce((total: bigint, fee: any) => {
    if (gasFeeIncludesForwarder && fee?.type === 'forwarder') return total
    return total + usdcUnits(String(fee?.amount || '0'))
  }, 0n)
}

function confirmedBalanceForChain(balance: any, chain: Exclude<UnifiedBalanceSourceChain, 'auto'>) {
  for (const source of Array.isArray(balance?.breakdown) ? balance.breakdown : []) {
    const entry = (source?.breakdown || []).find((item: any) => item?.chain === chain)
    if (entry) return String(entry.confirmedBalance || '0')
  }
  return '0'
}

function pendingBalanceForChain(balance: any, chain: Exclude<UnifiedBalanceSourceChain, 'auto'>) {
  for (const source of Array.isArray(balance?.breakdown) ? balance.breakdown : []) {
    const entry = (source?.breakdown || []).find((item: any) => item?.chain === chain)
    if (entry) return String(entry.pendingBalance || '0')
  }
  return '0'
}

function usdcUnits(value: string) {
  const normalized = String(value || '0').trim()
  if (!/^\d+(\.\d{0,6})?$/.test(normalized)) throw new Error('Invalid USDC amount')
  const [whole, fraction = ''] = normalized.split('.')
  return BigInt(whole) * 1_000_000n + BigInt((fraction + '000000').slice(0, 6))
}

function formatUsdcUnits(value: bigint) {
  const whole = value / 1_000_000n
  const fraction = (value % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole.toString()
}

function swapTokenParam(symbol: string) {
  const token = getArcToken(symbol)
  if (symbol === 'cirBTC' || symbol === 'USYC') return token?.address || symbol
  return symbol
}
