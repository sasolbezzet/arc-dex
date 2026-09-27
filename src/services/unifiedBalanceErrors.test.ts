import { describe, expect, it } from 'vitest'
import { formatUsdcUnits, unifiedBalanceShortfallError } from './unifiedBalanceErrors'

describe('formatUsdcUnits', () => {
  it('memakai 6 desimal USDC tanpa nol ekor', () => {
    expect(formatUsdcUnits(0n)).toBe('0')
    expect(formatUsdcUnits(500n)).toBe('0.0005')
    expect(formatUsdcUnits(20_000n)).toBe('0.02')
    expect(formatUsdcUnits(3_850n)).toBe('0.00385')
    expect(formatUsdcUnits(1_000_000n)).toBe('1')
    expect(formatUsdcUnits(23_500n)).toBe('0.0235')
  })
})

describe('unifiedBalanceShortfallError', () => {
  it('menyebut jumlah, fee Gateway, dan batas withdraw maksimum', () => {
    // Kasus nyata mainnet: saldo Gateway 0.02, withdraw 0.02, fee 0.00385.
    const message = unifiedBalanceShortfallError({ chain: 'Arc', available: 20_000n, requested: 20_000n, fee: 3_850n }).message
    expect(message).toContain('tersedia 0.02 USDC')
    expect(message).toContain('butuh 0.02385 USDC')
    expect(message).toContain('0.02 untuk withdraw + 0.00385 fee Gateway')
    expect(message).toContain('maksimum 0.01615 USDC')
  })

  it('menyarankan top-up ketika fee Gateway saja sudah melebihi saldo', () => {
    const message = unifiedBalanceShortfallError({ chain: 'Arc', available: 1_000n, requested: 1_000n, fee: 3_850n }).message
    expect(message).toContain('tersedia 0.001 USDC')
    expect(message).toContain('sudah melebihi saldo')
    expect(message).toContain('minimal 0.00385 USDC')
  })

  it('tetap masuk akal saat saldo nol', () => {
    const message = unifiedBalanceShortfallError({ chain: 'Arc', available: 0n, requested: 5_000n, fee: 3_850n }).message
    expect(message).toContain('tersedia 0 USDC')
    expect(message).toContain('minimal 0.00885 USDC')
  })
})
