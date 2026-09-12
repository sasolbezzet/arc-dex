import { describe, expect, it } from 'vitest'
import { formatCircleUserOperationError, getPasskeyRpId, normalizeArbitrumUserOperationFees } from './modularWallet'
import { shouldAuthorizeDestinationChainsAfterActivation } from './agentSession'

describe('multichain wallet activation invariants', () => {
  it('uses the production RP ID for every passkey UserOperation ceremony', () => {
    expect(getPasskeyRpId()).toBe('arcoxdex.vercel.app')
  })

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

  it('keeps ordinary re-login Arc-only when the delegate is unchanged', () => {
    expect(shouldAuthorizeDestinationChainsAfterActivation(true, '0x' + '11'.repeat(20), '0x' + '11'.repeat(20))).toBe(false)
    expect(shouldAuthorizeDestinationChainsAfterActivation(false, '0x' + '11'.repeat(20), '0x' + '11'.repeat(20))).toBe(true)
  })

  it('repairs destination authorization when revoke rotated the delegate', () => {
    expect(shouldAuthorizeDestinationChainsAfterActivation(true, '0x' + '11'.repeat(20), '0x' + '22'.repeat(20))).toBe(true)
    expect(shouldAuthorizeDestinationChainsAfterActivation(true, undefined, '0x' + '22'.repeat(20))).toBe(false)
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
