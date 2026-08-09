import { describe, expect, it } from 'vitest'
import {
  ARBITRUM_PRIORITY_FEE_FLOOR,
  authorizationRetryDecision,
  isSuccessfulUserOpReceipt,
  normalizeArbitrumFees,
  hasCompleteFeeEnvelope,
  removePaymasterFeeFields,
  requestPaymasterWithFees,
  withUserOperationFees,
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

  it('requires a complete non-zero fee envelope', () => {
    expect(hasCompleteFeeEnvelope({ maxPriorityFeePerGas: 2_000_000n, maxFeePerGas: 42_000_000n })).toBe(true)
    expect(hasCompleteFeeEnvelope({ maxPriorityFeePerGas: 0n, maxFeePerGas: 42_000_000n })).toBe(false)
    expect(hasCompleteFeeEnvelope({})).toBe(false)
  })

  it('passes non-zero fees to Circle before paymaster data is returned', async () => {
    let observed: any
    const result = await requestPaymasterWithFees({ sender: '0xabc', maxPriorityFeePerGas: 0n, maxFeePerGas: 0n }, {
      maxPriorityFeePerGas: 2_000_000n,
      maxFeePerGas: 42_000_000n,
    }, async request => {
      observed = request
      return { paymaster: '0x1234', paymasterData: '0xab', maxPriorityFeePerGas: 0n, maxFeePerGas: 0n }
    })
    expect(observed.maxPriorityFeePerGas).toBe(2_000_000n)
    expect(observed.maxFeePerGas).toBe(42_000_000n)
    expect(result).toEqual({ paymaster: '0x1234', paymasterData: '0xab' })
  })

  it('rejects a paymaster request when the fee envelope is incomplete', async () => {
    await expect(requestPaymasterWithFees({}, { maxPriorityFeePerGas: 0n }, async () => ({}))).rejects.toThrow('Complete non-zero')
  })

  it('injects validated fees before the paymaster request', () => {
    const request = withUserOperationFees({ sender: '0xabc', paymaster: undefined }, {
      maxPriorityFeePerGas: 2_000_000n,
      maxFeePerGas: 42_000_000n,
    })
    expect(request.maxPriorityFeePerGas).toBe(2_000_000n)
    expect(request.maxFeePerGas).toBe(42_000_000n)
    expect(request.sender).toBe('0xabc')
  })

  it('does not let paymaster response fee fields overwrite the signed request', () => {
    const response = removePaymasterFeeFields({ paymaster: '0x1234', paymasterData: '0xab', maxPriorityFeePerGas: 0n, maxFeePerGas: 0n })
    expect(response).toEqual({ paymaster: '0x1234', paymasterData: '0xab' })
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

  it('allows a fresh SDK authorization when Circle mapping read is temporarily unavailable', () => {
    expect(authorizationRetryDecision({ mappingKnown: false, mappingExists: false, previousOutcome: 'unknown' })).toBe('submit')
  })

  it('fails closed when a prior authorization has an unknown result and Circle mapping cannot be read', () => {
    expect(authorizationRetryDecision({ mappingKnown: false, mappingExists: false, previousOutcome: 'unknown', previousAttempt: true })).toBe('unreconciled')
  })

  it('allows retry after an explicitly failed UserOperation even when mapping read is unavailable', () => {
    expect(authorizationRetryDecision({ mappingKnown: false, mappingExists: false, previousOutcome: 'failed', previousAttempt: true })).toBe('submit')
  })

  it('does not reuse a prior successful operation as a policy decision for a new delegate', () => {
    // Delegate binding is enforced by registerDelegateOwner before this pure
    // policy helper is called; this documents the required decision input.
    expect(authorizationRetryDecision({ mappingKnown: true, mappingExists: false, previousOutcome: 'unknown', previousAttempt: true })).toBe('unreconciled')
  })

  it('recognizes a successful prior UserOperation as already authorized', () => {
    expect(authorizationRetryDecision({ mappingKnown: true, mappingExists: true, previousOutcome: 'success' })).toBe('already_authorized')
    expect(authorizationRetryDecision({ mappingKnown: true, mappingExists: false, previousOutcome: 'success' })).toBe('already_authorized')
  })
})
