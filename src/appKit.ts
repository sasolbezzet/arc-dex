// App Kit SDK helpers for Arc swap only.
// Bridge flows are implemented manually in BridgePanel with wallet-signed
// approve/burn/mint transactions, without AppKit bridge delegation.

import { AppKit, SwapChain } from '@circle-fin/app-kit'
import { ArcTestnet } from '@circle-fin/bridge-kit'
import { createViemAdapterFromProvider } from '@circle-fin/adapter-viem-v2'
import { createSolanaRpc } from '@solana/kit'
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

// ── EVM adapter ─────────────────────────────────────────────────
export async function buildEvmAdapter() {
  if (!window.ethereum) throw new Error('MetaMask tidak terdeteksi.')
  return await createViemAdapterFromProvider({
    provider: window.ethereum,
    capabilities: { addressContext: 'user-controlled', supportedChains: [ArcTestnet] },
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

export async function swapEoaWithAppKit(args: { tokenIn: string; tokenOut: string; amountIn: string; kitKey: string }): Promise<any> {
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
    config: { kitKey: args.kitKey, allowanceStrategy: 'approve' },
  } as any)
}

export async function estimateEoaSwapWithAppKit(args: { tokenIn: string; tokenOut: string; amountIn: string; kitKey: string }): Promise<any> {
  await switchToArcTestnet()
  const kit = getKit()
  const adapter = await buildEvmAdapter()
  if (!args.kitKey) throw new Error('Kit key belum tersedia dari API.')
  const accounts = await window.ethereum?.request?.({ method: 'eth_requestAccounts' })
  const address = accounts?.[0]
  if (!address) throw new Error('Wallet EOA belum terhubung.')
  return await kit.estimateSwap({
    from: { adapter, chain: SwapChain.Arc_Testnet },
    tokenIn: swapTokenParam(args.tokenIn),
    tokenOut: swapTokenParam(args.tokenOut),
    amountIn: args.amountIn,
    config: { kitKey: args.kitKey, allowanceStrategy: 'approve' },
  } as any)
}

export { ARC_TESTNET_ADD_PARAMS, ARC_TESTNET_CHAIN_ID, switchToArcTestnet }

function swapTokenParam(symbol: string) {
  const token = getArcToken(symbol)
  if (symbol === 'cirBTC' || symbol === 'USYC') return token?.address || symbol
  return symbol
}
