import { describe, expect, it } from 'vitest'
import {
  ARBITRUM_PRIORITY_FEE_FLOOR,
  authorizationRetryDecision,
  isSuccessfulUserOpReceipt,
  normalizeArbitrumFees,
} from './mscaPolicy'

describe('MSCA policy guards', () => {
  it('replaces a zero Arbitrum priority fee with the required floor', () => {
    const fees = normalizeArbitrumFees(0n, 0n)
    expect(fees.maxPriorityFeePerGas).toBe(ARBITRUM_PRIORITY_FEE_FLOOR)
    expect(fees.maxFeePerGas).toBeGreaterThanOrEqual(fees.maxPriorityFeePerGas)
  })

  it('preserves a valid Circle quote while enforcing max >= priority', () => {
    const fees = normalizeArbitrumFees(5_000_000n, 10_000_000n)
    expect(fees).toEqual({ maxPriorityFeePerGas: 5_000_000n, maxFeePerGas: 10_000_000n })
  })

  it('raises max fee above the live network gas price when the quote is stale', () => {
    const fees = normalizeArbitrumFees(0n, 4_000_000n, 100_000_000n)
    expect(fees.maxPriorityFeePerGas).toBe(ARBITRUM_PRIORITY_FEE_FLOOR)
    expect(fees.maxFeePerGas).toBeGreaterThan(100_000_000n)
  })

  it('requires an explicit successful transaction receipt', () => {
    expect(isSuccessfulUserOpReceipt({ success: true, receipt: { status: '0x1' } })).toBe(true)
    expect(isSuccessfulUserOpReceipt({ success: true, receipt: {} })).toBe(false)
    expect(isSuccessfulUserOpReceipt({ success: true, receipt: { status: '0x0' } })).toBe(false)
  })

  it('submits a mapped recovery owner only after a prior operation is explicitly failed', () => {
    expect(authorizationRetryDecision({ mappingKnown: true, mappingExists: true, previousOutcome: 'failed' })).toBe('submit')
    expect(authorizationRetryDecision({ mappingKnown: true, mappingExists: true, previousOutcome: 'unknown' })).toBe('unreconciled')
    expect(authorizationRetryDecision({ mappingKnown: true, mappingExists: false, previousOutcome: 'unknown', previousAttempt: true })).toBe('unreconciled')
  })

  it('fails closed when Circle mapping cannot be read', () => {
    expect(authorizationRetryDecision({ mappingKnown: false, mappingExists: false, previousOutcome: 'unknown' })).toBe('unavailable')
  })

  it('recognizes a successful prior UserOperation as already authorized', () => {
    expect(authorizationRetryDecision({ mappingKnown: true, mappingExists: true, previousOutcome: 'success' })).toBe('already_authorized')
    expect(authorizationRetryDecision({ mappingKnown: true, mappingExists: false, previousOutcome: 'success' })).toBe('already_authorized')
  })
})
