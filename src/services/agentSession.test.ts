import { describe, expect, it } from 'vitest'
import { formatCircleUserOperationError, normalizeArbitrumUserOperationFees } from './modularWallet'

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

  it('explains a wrapped Gas Station daily native-token policy rejection', () => {
    const error = new Error('JSON is not a valid request object', {
      cause: new Error('Details: Exceeded max daily native token of the policy.'),
    })
    const message = formatCircleUserOperationError(error, 'arc-testnet')
    expect(message).toMatch(/Kuota Gas Station harian/i)
    expect(message).toMatch(/UserOperation ditolak sebelum masuk bundler/i)
    expect(message).toMatch(/Reset atau naikkan batas harian policy/i)
  })
})
