// App Kit SDK helpers untuk integrasi bridge Solana ↔ Arc.
// Mengikuti dokumentasi resmi: https://docs.arc.io/app-kit/bridge
//
// Kita pakai mode "Browser wallet" sesuai docs adapter-setups:
//   - EVM  : createViemAdapterFromProvider(window.ethereum)
//   - Solana: createSolanaKitAdapterFromProvider(window.solana)  (Phantom, dll.)
//
// Lalu kit.bridge({ from, to, amount }) menangani burn → attestation → mint
// di kedua sisi tanpa kita harus orchestrate flow CCTP low-level.

import { AppKit } from '@circle-fin/app-kit'
import { createViemAdapterFromProvider } from '@circle-fin/adapter-viem-v2'
import { createSolanaKitAdapterFromProvider } from '@circle-fin/adapter-solana-kit'

// Browser wallet typings are inherently loose — Phantom, Solflare, etc. each
// expose their own provider. We use `any` here and keep type-safety at the
// adapter boundary (createSolanaKitAdapterFromProvider does internal validation).
declare global {
  interface Window {
    ethereum?: any
    solana?: any
  }
}

// Singleton kit instance — App Kit SDK tidak butuh API key untuk testnet bridges.
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

export interface BridgeAdapters {
  evmAdapter: Awaited<ReturnType<typeof createViemAdapterFromProvider>> | null
  solanaAdapter: Awaited<ReturnType<typeof createSolanaKitAdapterFromProvider>> | null
}

export async function buildEvmAdapter() {
  if (!window.ethereum) throw new Error('Tidak ada wallet EVM (MetaMask) terdeteksi.')
  return await createViemAdapterFromProvider({ provider: window.ethereum })
}

export async function buildSolanaAdapter() {
  if (!window.solana) {
    throw new Error('Wallet Solana tidak terdeteksi. Install Phantom (https://phantom.com) lalu refresh halaman.')
  }
  // Pastikan terkoneksi terlebih dulu (Phantom butuh user approval).
  if (window.solana.connect && !window.solana.isConnected) {
    await window.solana.connect()
  }
  return await createSolanaKitAdapterFromProvider({ provider: window.solana })
}

/**
 * Connect ke Phantom / wallet Solana di browser.
 * Mengembalikan public key (base58) jika sukses.
 */
export async function connectSolanaWallet(): Promise<string> {
  if (!window.solana) {
    throw new Error('Phantom belum ter-install. Pasang dari https://phantom.com lalu refresh.')
  }
  if (!window.solana.connect) {
    throw new Error('Wallet Solana tidak mendukung metode connect()')
  }
  const resp = await window.solana.connect()
  const pk = resp?.publicKey?.toString?.() || window.solana.publicKey?.toString?.()
  if (!pk) throw new Error('Gagal mendapat public key Solana.')
  return pk
}

export async function disconnectSolanaWallet(): Promise<void> {
  try {
    await window.solana?.disconnect?.()
  } catch {
    /* ignore */
  }
}

/**
 * Bridge USDC menggunakan App Kit SDK kit.bridge() resmi.
 * Direkomendasikan untuk pasangan yang melibatkan Solana — SDK akan
 * menangani burn/attestation/mint di kedua sisi otomatis.
 */
export interface BridgeArgs {
  from: AppKitChain
  to: AppKitChain
  amount: string // contoh: "1.00"
}

export async function bridgeWithAppKit(args: BridgeArgs): Promise<unknown> {
  const kit = getKit()
  const fromIsSolana = args.from === 'Solana_Devnet'
  const toIsSolana = args.to === 'Solana_Devnet'

  // Build adapters yang dibutuhkan saja — kalau salah satu sisi Solana,
  // kita perlu kedua adapter (kecuali kasus Solana ↔ Solana yang tidak ada).
  const evmAdapter = (!fromIsSolana || !toIsSolana) ? await buildEvmAdapter() : null
  const solanaAdapter = (fromIsSolana || toIsSolana) ? await buildSolanaAdapter() : null

  if ((fromIsSolana || toIsSolana) && !solanaAdapter) {
    throw new Error('Adapter Solana gagal dibuat.')
  }
  if ((!fromIsSolana || !toIsSolana) && !evmAdapter) {
    throw new Error('Adapter EVM gagal dibuat.')
  }

  return await kit.bridge({
    from: {
      adapter: fromIsSolana ? solanaAdapter! : evmAdapter!,
      chain: args.from,
    },
    to: {
      adapter: toIsSolana ? solanaAdapter! : evmAdapter!,
      chain: args.to,
    },
    amount: args.amount,
  })
}
