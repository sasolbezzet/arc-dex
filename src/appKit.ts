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
import { createViemAdapterFromProvider } from '@circle-fin/adapter-viem-v2'
import { createSolanaKitAdapterFromProvider } from '@circle-fin/adapter-solana-kit'
import { createSolanaRpc } from '@solana/kit'
import { wrapSolflare, wrapPhantom } from './solflareWrapper'
import { ARC_TESTNET_ADD_PARAMS, ARC_TESTNET_CHAIN_ID, switchToArcTestnet } from './domain/arcNetwork'
import { getArcToken } from './domain/tokens'

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
    const proxyPreferred = ['/v1/info', '/v1/balances', '/v1/deposits', '/v1/estimate'].includes(target.pathname)
    if (!proxyPreferred) {
      return originalFetch.call(window, input, { ...init, signal: AbortSignal.timeout(20_000) })
    }
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
      signal: AbortSignal.timeout(20_000),
    })
  }
  try {
    return await operation()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/Maximum retry attempts|Service temporarily unavailable|Failed to fetch|Gateway API error/i.test(message)) {
      throw new Error('Circle Gateway testnet is temporarily unavailable. No successful transfer response was received. Check Unified Balance, then retry the same action.', { cause: error })
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
  if (!window.ethereum) throw new Error('MetaMask tidak terdeteksi.')
  return await createViemAdapterFromProvider({
    provider: window.ethereum,
    capabilities: { addressContext: 'user-controlled', supportedChains: [ArcTestnet, BaseSepolia, EthereumSepolia, ArbitrumSepolia] },
  } as any)
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

  return await createSolanaKitAdapterFromProvider({
    provider,
    getRpc: () => createSolanaRpc(SOLANA_DEVNET_RPC),
    capabilities: {
      addressContext: 'user-controlled',
      supportedChains: [SolanaDevnet],
    },
  } as any)
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
    const resp = await (_solanaRpc.getBalance as any)(pubkey).send()
    return Number(resp.value) / 1e9
  } catch {
    return 0
  }
}

/** Cek saldo USDC Devnet di associated token account (ATA) */
export async function getUsdcBalance(pubkey: string): Promise<number> {
  try {
    const resp = await (_solanaRpc.getTokenAccountsByOwner as any)(pubkey, {
      programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    }).send()
    const accounts: any[] = [...(resp.value ?? [])]
    for (const acc of accounts) {
      const info = acc.account.data.parsed?.info
      if (info?.mint?.toLowerCase() === USDC_DEVNET_MINT.toLowerCase()) {
        return parseFloat(info.tokenAmount.uiAmountString ?? '0')
      }
    }
    return 0
  } catch {
    return 0
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
  const accounts = await window.ethereum?.request?.({ method: 'eth_requestAccounts' })
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
  const accounts = await window.ethereum?.request?.({ method: 'eth_accounts' })
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
  const response = await fetch('/api/unified-balance/balances', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data?.error || 'Unified Balance API temporarily unavailable')
  return data
}

export type UnifiedBalanceSourceChain = 'auto' | 'Arc_Testnet' | 'Base_Sepolia' | 'Ethereum_Sepolia' | 'Arbitrum_Sepolia'
export const UNIFIED_BALANCE_EVM_CHAINS: Exclude<UnifiedBalanceSourceChain, 'auto'>[] = ['Arc_Testnet', 'Base_Sepolia', 'Ethereum_Sepolia', 'Arbitrum_Sepolia']

async function unifiedBalanceFrom(adapter: any, amount: string, sourceChain: UnifiedBalanceSourceChain = 'auto') {
  if (sourceChain === 'auto') return { adapter }
  return { adapter, allocations: [{ amount, chain: sourceChain }] }
}

async function allocatedUnifiedBalanceFrom(adapter: any, amount: string, sourceChain: UnifiedBalanceSourceChain = 'auto', knownBalance?: any) {
  if (sourceChain !== 'auto') return unifiedBalanceFrom(adapter, amount, sourceChain)
  const balance = knownBalance || await getUnifiedBalanceWithAppKit()
  const requested = usdcUnits(amount)
  let remaining = requested
  const allocations: Array<{ amount: string; chain: Exclude<UnifiedBalanceSourceChain, 'auto'> }> = []
  for (const chain of UNIFIED_BALANCE_EVM_CHAINS) {
    const available = usdcUnits(confirmedBalanceForChain(balance, chain))
    if (available <= 0n || remaining <= 0n) continue
    const allocated = available < remaining ? available : remaining
    allocations.push({ chain, amount: formatUsdcUnits(allocated) })
    remaining -= allocated
  }
  if (remaining > 0n) throw new Error(`Unified Balance insufficient. Available ${formatUsdcUnits(requested - remaining)} USDC.`)
  return { adapter, allocations }
}

async function ensureUnifiedEvmChain(adapter: any, chain: Exclude<UnifiedBalanceSourceChain, 'auto'>) {
  const resolved = resolveChainIdentifier(chain)
  if (resolved.type !== 'evm') throw new Error(`${resolved.name} bukan chain EVM.`)
  await adapter.ensureChain(resolved)
}

async function getConnectedEvmAddress() {
  const accounts = await window.ethereum?.request?.({ method: 'eth_requestAccounts' })
  const address = accounts?.[0]
  if (!/^0x[a-fA-F0-9]{40}$/.test(String(address || ''))) throw new Error('Connect EVM wallet first.')
  return address
}

export async function depositUnifiedBalanceWithAppKit(args: {
  amount: string
  chain: Exclude<UnifiedBalanceSourceChain, 'auto'>
}) {
  const kit = getKit()
  const adapter = await buildEvmAdapter()
  await ensureUnifiedEvmChain(adapter, args.chain)
  return await withGatewayProxy(() => kit.unifiedBalance.deposit({
    from: { adapter, chain: args.chain },
    amount: args.amount,
    token: 'USDC',
  } as any))
}

export async function initiateUnifiedBalanceWithdrawWithAppKit(args: {
  amount: string
  chain: Exclude<UnifiedBalanceSourceChain, 'auto'>
}) {
  const kit = getKit()
  const adapter = await buildEvmAdapter()
  const recipientAddress = await getConnectedEvmAddress()
  return prepareUnifiedBalanceSpend({ kit, adapter, receiveAmount: args.amount, destinationChain: args.chain, recipientAddress })
}

export async function completeUnifiedBalanceWithdrawWithAppKit(args: {
  amount: string
  chain: Exclude<UnifiedBalanceSourceChain, 'auto'>
}) {
  const kit = getKit()
  const adapter = await buildEvmAdapter()
  const recipientAddress = await getConnectedEvmAddress()
  const plan = await prepareUnifiedBalanceSpend({ kit, adapter, receiveAmount: args.amount, destinationChain: args.chain, recipientAddress })
  const result = await withGatewayProxy(() => kit.unifiedBalance.spend({
    from: { adapter, allocations: plan.allocations },
    to: { adapter, chain: args.chain, recipientAddress },
    amount: plan.spendAmount,
    token: 'USDC',
  } as any))
  const feeUnits = totalFeeUnits((result as any)?.fees || plan.fees)
  return {
    ...(result as any),
    requestedReceiveAmount: plan.requestedReceiveAmount,
    spendAmount: plan.spendAmount,
    totalFee: formatUsdcUnits(feeUnits),
    totalDebit: formatUsdcUnits(usdcUnits(plan.spendAmount) + feeUnits),
  }
}

export async function estimateUnifiedBalanceSpendWithAppKit(args: {
  amount: string
  recipient: string
  sourceChain?: UnifiedBalanceSourceChain
}) {
  const kit = getKit()
  const adapter = await buildEvmAdapter()
  if (args.sourceChain && args.sourceChain !== 'auto') await ensureUnifiedEvmChain(adapter, args.sourceChain)
  return prepareUnifiedBalanceSpend({ kit, adapter, receiveAmount: args.amount, destinationChain: 'Arc_Testnet', recipientAddress: args.recipient, sourceChain: args.sourceChain })
}

export async function spendUnifiedBalanceWithAppKit(args: {
  amount: string
  recipient: string
  sourceChain?: UnifiedBalanceSourceChain
}) {
  const kit = getKit()
  const adapter = await buildEvmAdapter()
  if (args.sourceChain && args.sourceChain !== 'auto') await ensureUnifiedEvmChain(adapter, args.sourceChain)
  const plan = await prepareUnifiedBalanceSpend({ kit, adapter, receiveAmount: args.amount, destinationChain: 'Arc_Testnet', recipientAddress: args.recipient, sourceChain: args.sourceChain })
  const result = await withGatewayProxy(() => kit.unifiedBalance.spend({
    from: { adapter, allocations: plan.allocations },
    to: { adapter, chain: 'Arc_Testnet', recipientAddress: args.recipient },
    amount: plan.spendAmount,
    token: 'USDC',
  } as any))
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
  const adapter = await buildEvmAdapter()
  const chain = args.chain || 'Arc_Testnet'
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
  const adapter = await buildEvmAdapter()
  const chain = args.chain || 'Arc_Testnet'
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
  const adapter = await buildEvmAdapter()
  const chain = args.chain || 'Arc_Testnet'
  await ensureUnifiedEvmChain(adapter, chain)
  return await withGatewayProxy(() => kit.unifiedBalance.getDelegateStatus({
    from: { adapter, chain },
    delegateAddress: args.delegateAddress,
  } as any))
}

export { ARC_TESTNET_ADD_PARAMS, ARC_TESTNET_CHAIN_ID, switchToArcTestnet }

export function confirmedUnifiedBalanceChains(balance: any) {
  return UNIFIED_BALANCE_EVM_CHAINS.filter(chain => Number(confirmedBalanceForChain(balance, chain)) > 0 || Number(pendingBalanceForChain(balance, chain)) > 0)
}

async function prepareUnifiedBalanceSpend(args: {
  kit: AppKit
  adapter: any
  receiveAmount: string
  destinationChain: Exclude<UnifiedBalanceSourceChain, 'auto'>
  recipientAddress: string
  sourceChain?: UnifiedBalanceSourceChain
}) {
  const receiveUnits = usdcUnits(args.receiveAmount)
  const spendAmount = formatUsdcUnits(receiveUnits)
  const balance = await getUnifiedBalanceWithAppKit()
  const requestedChains = args.sourceChain && args.sourceChain !== 'auto'
    ? [args.sourceChain]
    : [...UNIFIED_BALANCE_EVM_CHAINS].sort((left, right) => sourcePriority(left, args.destinationChain) - sourcePriority(right, args.destinationChain))
  let lastError: unknown = null
  for (const chain of requestedChains) {
    const available = usdcUnits(confirmedBalanceForChain(balance, chain))
    if (available < receiveUnits) continue
    const allocations = [{ chain, amount: spendAmount }]
    try {
      const estimate = await withGatewayProxy(() => args.kit.unifiedBalance.estimateSpend({
        from: { adapter: args.adapter, allocations },
        to: { adapter: args.adapter, chain: args.destinationChain, recipientAddress: args.recipientAddress },
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
        allocations,
      }
    } catch (error) {
      lastError = error
    }
  }
  try {
    const from = await allocatedUnifiedBalanceFrom(args.adapter, spendAmount, args.sourceChain, balance)
    const estimate = await withGatewayProxy(() => args.kit.unifiedBalance.estimateSpend({
      from,
      to: { adapter: args.adapter, chain: args.destinationChain, recipientAddress: args.recipientAddress },
      amount: spendAmount,
      token: 'USDC',
    } as any))
    const feeUnits = totalFeeUnits(estimate?.fees)
    const selected = new Set((from.allocations || []).map((item: any) => item.chain))
    const available = UNIFIED_BALANCE_EVM_CHAINS
      .filter(chain => selected.has(chain))
      .reduce((total, chain) => total + usdcUnits(confirmedBalanceForChain(balance, chain)), 0n)
    if (available < receiveUnits + feeUnits) throw new Error('Unified Balance cannot cover amount and Gateway fee.')
    return {
      ...estimate,
      requestedReceiveAmount: spendAmount,
      spendAmount,
      totalFee: formatUsdcUnits(feeUnits),
      totalDebit: formatUsdcUnits(receiveUnits + feeUnits),
      allocations: from.allocations || [],
    }
  } catch (error) {
    if (lastError instanceof Error) throw lastError
    throw error
  }
}

function sourcePriority(chain: Exclude<UnifiedBalanceSourceChain, 'auto'>, destinationChain: Exclude<UnifiedBalanceSourceChain, 'auto'>) {
  if (chain === destinationChain) return 0
  return ({ Base_Sepolia: 1, Arbitrum_Sepolia: 2, Arc_Testnet: 3, Ethereum_Sepolia: 4 })[chain]
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
