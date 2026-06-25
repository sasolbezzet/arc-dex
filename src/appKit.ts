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
  return await kit.swap({
    from: { adapter, chain: SwapChain.Arc_Testnet },
    tokenIn: swapTokenParam(args.tokenIn),
    tokenOut: swapTokenParam(args.tokenOut),
    amountIn: args.amountIn,
    config: {
      kitKey: args.kitKey,
      allowanceStrategy: 'approve',
      slippageBps: 300,
      ...(args.customFeeBps && args.feeRecipient ? {
        customFee: {
          percentageBps: args.customFeeBps,
          recipientAddress: args.feeRecipient,
        },
      } : {}),
    },
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
  return await kit.estimateSwap({
    from: { adapter, chain: SwapChain.Arc_Testnet },
    tokenIn: swapTokenParam(args.tokenIn),
    tokenOut: swapTokenParam(args.tokenOut),
    amountIn: args.amountIn,
    config: {
      kitKey: args.kitKey,
      allowanceStrategy: 'approve',
      slippageBps: 300,
      ...(args.customFeeBps && args.feeRecipient ? {
        customFee: {
          percentageBps: args.customFeeBps,
          recipientAddress: args.feeRecipient,
        },
      } : {}),
    },
  } as any)
}

export async function getUnifiedBalanceWithAppKit() {
  const kit = getKit()
  const evmAdapter = await buildEvmAdapter()
  return await kit.unifiedBalance.getBalances({
    token: 'USDC',
    sources: {
      adapter: evmAdapter,
      chains: ['Arc_Testnet', 'Base_Sepolia', 'Ethereum_Sepolia', 'Arbitrum_Sepolia'],
    },
    networkType: 'testnet',
    includePending: true,
  } as any)
}

export type UnifiedBalanceSourceChain = 'auto' | 'Arc_Testnet' | 'Base_Sepolia' | 'Ethereum_Sepolia' | 'Arbitrum_Sepolia'

function unifiedBalanceFrom(adapter: any, amount: string, sourceChain: UnifiedBalanceSourceChain = 'auto') {
  if (sourceChain === 'auto') return { adapter }
  return { adapter, allocations: [{ amount, chain: sourceChain }] }
}

async function ensureUnifiedEvmChain(adapter: any, chain: Exclude<UnifiedBalanceSourceChain, 'auto'>) {
  const resolved = resolveChainIdentifier(chain)
  if (resolved.type !== 'evm') throw new Error(`${resolved.name} bukan chain EVM.`)
  await adapter.ensureChain(resolved)
}

export async function depositUnifiedBalanceWithAppKit(args: {
  amount: string
  chain: Exclude<UnifiedBalanceSourceChain, 'auto'>
}) {
  const kit = getKit()
  const adapter = await buildEvmAdapter()
  await ensureUnifiedEvmChain(adapter, args.chain)
  return await kit.unifiedBalance.deposit({
    from: { adapter, chain: args.chain },
    amount: args.amount,
    token: 'USDC',
  } as any)
}

export async function initiateUnifiedBalanceWithdrawWithAppKit(args: {
  amount: string
  chain: Exclude<UnifiedBalanceSourceChain, 'auto'>
}) {
  const kit = getKit()
  const adapter = await buildEvmAdapter()
  await ensureUnifiedEvmChain(adapter, args.chain)
  return await kit.unifiedBalance.initiateRemoveFund({
    from: { adapter, chain: args.chain },
    amount: args.amount,
    token: 'USDC',
  } as any)
}

export async function completeUnifiedBalanceWithdrawWithAppKit(args: {
  chain: Exclude<UnifiedBalanceSourceChain, 'auto'>
}) {
  const kit = getKit()
  const adapter = await buildEvmAdapter()
  await ensureUnifiedEvmChain(adapter, args.chain)
  return await kit.unifiedBalance.removeFund({
    from: { adapter, chain: args.chain },
    token: 'USDC',
  } as any)
}

export async function estimateUnifiedBalanceSpendWithAppKit(args: {
  amount: string
  recipient: string
  sourceChain?: UnifiedBalanceSourceChain
}) {
  const kit = getKit()
  const adapter = await buildEvmAdapter()
  if (args.sourceChain && args.sourceChain !== 'auto') await ensureUnifiedEvmChain(adapter, args.sourceChain)
  return await kit.unifiedBalance.estimateSpend({
    from: unifiedBalanceFrom(adapter, args.amount, args.sourceChain),
    to: { adapter, chain: 'Arc_Testnet', recipientAddress: args.recipient, useForwarder: true },
    amount: args.amount,
    token: 'USDC',
  } as any)
}

export async function spendUnifiedBalanceWithAppKit(args: {
  amount: string
  recipient: string
  sourceChain?: UnifiedBalanceSourceChain
}) {
  const kit = getKit()
  const adapter = await buildEvmAdapter()
  if (args.sourceChain && args.sourceChain !== 'auto') await ensureUnifiedEvmChain(adapter, args.sourceChain)
  return await kit.unifiedBalance.spend({
    from: unifiedBalanceFrom(adapter, args.amount, args.sourceChain),
    to: { adapter, chain: 'Arc_Testnet', recipientAddress: args.recipient, useForwarder: true },
    amount: args.amount,
    token: 'USDC',
  } as any)
}

export { ARC_TESTNET_ADD_PARAMS, ARC_TESTNET_CHAIN_ID, switchToArcTestnet }

function swapTokenParam(symbol: string) {
  const token = getArcToken(symbol)
  if (symbol === 'cirBTC' || symbol === 'USYC') return token?.address || symbol
  return symbol
}
