import { describe, expect, it } from 'vitest'
import { EVM_ADAPTER_CHAINS, EVM_ADAPTER_CHAIN_IDS, evmAdapterCapabilities } from './appKitCapabilities'

// Regresi: produksi pernah gagal dengan
//   Invalid AdapterCapabilities: supportedChains.0.type: Invalid literal value,
//   expected "evm"; supportedChains.0.chainId: Required
// karena adapter mengirim chain viem mentah (`id`, tanpa `type`). Test ini
// menjaga bentuk payload yang divalidasi zod oleh `new ViemAdapter(...)`.
describe('capabilities adapter EVM Circle App Kit', () => {
  it('memakai addressContext user-controlled', () => {
    expect(evmAdapterCapabilities().addressContext).toBe('user-controlled')
  })

  it('memberi ChainDefinition EVM, bukan chain viem mentah', () => {
    for (const chain of evmAdapterCapabilities().supportedChains) {
      expect(chain.type).toBe('evm')
      expect(Number.isInteger(chain.chainId)).toBe(true)
    }
  })

  it('mencakup Arc mainnet beserta chain Unified Balance lainnya', () => {
    expect(evmAdapterCapabilities().supportedChains.map(chain => chain.chainId)).toEqual([...EVM_ADAPTER_CHAIN_IDS])
    expect(EVM_ADAPTER_CHAIN_IDS).toEqual([5042, 8453, 1, 42161])
    expect(EVM_ADAPTER_CHAINS.map(chain => chain.name)).toEqual(['Arc', 'Base', 'Ethereum', 'Arbitrum'])
  })

  it('membawa konfigurasi Gateway Arc yang dibutuhkan jalur Unified Balance', () => {
    const arc = EVM_ADAPTER_CHAINS[0]
    expect(arc.chainId).toBe(5042)
    expect(arc.gateway.domain).toBe(26)
    expect(arc.usdcAddress).toBe('0x3600000000000000000000000000000000000000')
  })
})
