/**
 * Capabilities adapter EVM Circle App Kit.
 *
 * Circle memvalidasi `supportedChains` dengan zod: setiap entri HARUS berupa
 * ChainDefinition (`{ type: 'evm', chainId, ... }`). Chain viem mentah hanya
 * punya `id` dan tanpa `type`, sehingga `new ViemAdapter(...)` melempar
 *
 *   Invalid AdapterCapabilities: supportedChains.0.type: Invalid literal value,
 *   expected "evm"; supportedChains.0.chainId: Required
 *
 * dan seluruh jalur Unified Balance / bridge / spend mati sebelum tx pertama.
 *
 * `Arc` dari `@circle-fin/bridge-kit` sudah membawa `chainId: 5042`, chain `Arc`,
 * domain CCTP 26, dan konfigurasi Gateway mainnet, jadi tidak perlu lagi chain
 * lokal hasil `defineChain` yang tidak punya `chainId`/`type`.
 *
 * Modul ini sengaja bebas dari `window`/wallet supaya bentuk payload-nya bisa
 * diuji di node (lihat `appKitCapabilities.test.ts`).
 */
import { Arbitrum, Arc, Base, Ethereum } from '@circle-fin/bridge-kit'

/** Chain EVM yang didukung adapter, dalam bentuk ChainDefinition App Kit. */
export const EVM_ADAPTER_CHAINS = [Arc, Base, Ethereum, Arbitrum] as const

/** Chain ID yang harus cocok dengan `EVM_ADAPTER_CHAINS`, untuk uji regresi. */
export const EVM_ADAPTER_CHAIN_IDS = [5042, 8453, 1, 42161] as const

export interface EvmAdapterCapabilities {
  addressContext: 'user-controlled'
  supportedChains: typeof EVM_ADAPTER_CHAINS
}

export function evmAdapterCapabilities(): EvmAdapterCapabilities {
  return { addressContext: 'user-controlled', supportedChains: EVM_ADAPTER_CHAINS }
}
