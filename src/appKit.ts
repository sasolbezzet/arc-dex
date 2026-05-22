// App Kit SDK helpers untuk integrasi bridge Arc ↔ Solana (Devnet).
// Dokumentasi referensi: https://docs.arc.io/app-kit/bridge
//
// Mode "Browser wallet":
//   - EVM   : createViemAdapterFromProvider(window.ethereum)            // MetaMask
//   - Solana: createSolanaKitAdapterFromProvider(window.solflare)       // Solflare
//
// kit.bridge() menangani burn → attestation → mint di kedua sisi.

import { AppKit, TransferSpeed } from '@circle-fin/app-kit'
import { ArcTestnet, SolanaDevnet } from '@circle-fin/bridge-kit'
import { createViemAdapterFromProvider } from '@circle-fin/adapter-viem-v2'
import { createSolanaKitAdapterFromProvider } from '@circle-fin/adapter-solana-kit'
import { createSolanaRpc } from '@solana/kit'
import { wrapSolflare } from './solflareWrapper'

declare global {
  interface Window {
    ethereum?: any
    solflare?: any
  }
}

const SOLANA_DEVNET_RPC = 'https://api.devnet.solana.com'

// Pilih provider Solflare langsung (hindari window.solana yang bisa diklaim
// banyak ekstensi sekaligus dan menyebabkan ambiguitas signer).
function getSolflareProvider(): any | null {
  const w = window as any
  if (w.solflare && (w.solflare.isSolflare || typeof w.solflare.connect === 'function')) {
    return w.solflare
  }
  return null
}

// Singleton AppKit (testnet bridges tidak butuh API key).
let kitInstance: AppKit | null = null
export function getKit(): AppKit {
  if (!kitInstance) kitInstance = new AppKit()
  return kitInstance
}

export type AppKitChain =
  | 'Arc_Testnet'
  | 'Ethereum_Sepolia'
  | 'Base_Sepolia'
  | 'Arbitrum_Sepolia'
  | 'Solana_Devnet'

export async function buildEvmAdapter() {
  if (!window.ethereum) throw new Error('Tidak ada wallet EVM (MetaMask) terdeteksi.')
  return await createViemAdapterFromProvider({
    provider: window.ethereum,
    capabilities: {
      addressContext: 'user-controlled',
      supportedChains: [ArcTestnet],
    },
  } as any)
}

export async function buildSolanaAdapter() {
  const raw = getSolflareProvider()
  if (!raw) {
    throw new Error('Wallet Solflare tidak terdeteksi. Install Solflare (https://solflare.com) lalu refresh halaman.')
  }
  // Solflare butuh user approval terlebih dahulu.
  if (typeof raw.connect === 'function' && !raw.isConnected) {
    await raw.connect()
  }
  // Bungkus supaya provider punya `.address` (string base58) — adapter
  // melempar "Wallet provider must have a connected address after connection"
  // kalau properti ini tidak ada.
  const provider = wrapSolflare(raw)
  // PENTING: kunci RPC ke Solana Devnet — tanpa ini adapter default ke
  // mainnet RPC dan gagal ketika bridge ke chain Solana_Devnet.
  return await createSolanaKitAdapterFromProvider({
    provider,
    getRpc: ({ chain }: { chain: { name: string } }) => {
      // Devnet selalu pakai endpoint devnet resmi.
      if (/devnet/i.test(chain.name)) return createSolanaRpc(SOLANA_DEVNET_RPC)
      return createSolanaRpc(SOLANA_DEVNET_RPC)
    },
    capabilities: {
      addressContext: 'user-controlled',
      supportedChains: [SolanaDevnet],
    },
  } as any)
}

/**
 * Connect ke Solflare; kembalikan public key (base58).
 */
export async function connectSolanaWallet(): Promise<string> {
  const provider = getSolflareProvider()
  if (!provider) {
    throw new Error('Solflare belum ter-install. Pasang dari https://solflare.com lalu refresh.')
  }
  if (typeof provider.connect !== 'function') {
    throw new Error('Solflare tidak mendukung metode connect()')
  }
  const resp = await provider.connect()
  const pk =
    resp?.publicKey?.toString?.() ||
    provider.publicKey?.toString?.() ||
    (typeof resp === 'string' ? resp : null)
  if (!pk) throw new Error('Gagal mendapat public key dari Solflare.')
  return pk
}

export async function disconnectSolanaWallet(): Promise<void> {
  const provider = getSolflareProvider()
  try {
    await provider?.disconnect?.()
  } catch {
    /* ignore */
  }
}

export function getConnectedSolanaPubkey(): string | null {
  const provider = getSolflareProvider()
  if (provider?.isConnected && provider.publicKey) {
    try {
      return provider.publicKey.toString()
    } catch {
      return null
    }
  }
  return null
}

export interface BridgeArgs {
  from: AppKitChain
  to: AppKitChain
  amount: string // contoh: "1.00"
  /** Default 'FAST' (~8-20s pada CCTPv2 Arc/Solana Devnet). */
  speed?: 'FAST' | 'SLOW'
  /** Override penerima — default ambil dari adapter destinasi. */
  recipient?: string
}

/**
 * Bridge USDC dua arah Arc ↔ Solana lewat AppKit.bridge().
 * SDK menangani: approve → burn → attestation → mint.
 */
export async function bridgeWithAppKit(args: BridgeArgs): Promise<unknown> {
  const kit = getKit()
  const fromIsSolana = args.from === 'Solana_Devnet'
  const toIsSolana = args.to === 'Solana_Devnet'

  // Cek konsistensi route: harus ada salah satu sisi non-Solana untuk skenario kita.
  if (fromIsSolana && toIsSolana) {
    throw new Error('Bridge Solana ke Solana tidak didukung.')
  }

  const evmAdapter = (!fromIsSolana || !toIsSolana) ? await buildEvmAdapter() : null
  const solanaAdapter = (fromIsSolana || toIsSolana) ? await buildSolanaAdapter() : null

  if ((fromIsSolana || toIsSolana) && !solanaAdapter) {
    throw new Error('Adapter Solana gagal dibuat.')
  }
  if ((!fromIsSolana || !toIsSolana) && !evmAdapter) {
    throw new Error('Adapter EVM gagal dibuat.')
  }

  const speed: TransferSpeed = (args.speed === 'SLOW' ? TransferSpeed.SLOW : TransferSpeed.FAST)

  const fromCtx: any = {
    adapter: fromIsSolana ? solanaAdapter! : evmAdapter!,
    chain: args.from,
  }
  const toCtx: any = {
    adapter: toIsSolana ? solanaAdapter! : evmAdapter!,
    chain: args.to,
  }
  if (args.recipient) toCtx.recipientAddress = args.recipient

  return await kit.bridge({
    from: fromCtx,
    to: toCtx,
    amount: args.amount,
    token: 'USDC',
    config: { transferSpeed: speed },
  } as any)
}
