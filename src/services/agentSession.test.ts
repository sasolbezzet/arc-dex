import { describe, expect, it } from 'vitest'
import { normalizeArbitrumUserOperationFees } from './modularWallet'

describe('multichain wallet activation invariants', () => {
  it('keeps Arbitrum fee envelope valid when the provider returns zero fees', () => {
    const fees = normalizeArbitrumUserOperationFees(0n, 0n)
    expect(fees.maxPriorityFeePerGas).toBeGreaterThanOrEqual(1_000_000_000n)
    expect(fees.maxFeePerGas).toBeGreaterThanOrEqual(fees.maxPriorityFeePerGas)
  })

  it('keeps headroom above a live Arbitrum max fee', () => {
    const fees = normalizeArbitrumUserOperationFees(2_000_000_000n, 1_000_000_000n)
    expect(fees.maxPriorityFeePerGas).toBe(1_000_000_000n)
    expect(fees.maxFeePerGas).toBe(3_000_000_000n)
  })
})
