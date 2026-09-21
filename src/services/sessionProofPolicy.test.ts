import { describe, expect, it } from 'vitest'
import { proofWasInvalidatedByPolicy } from './sessionProofPolicy'

/**
 * Revoke and Clear kill the stored authorization proof; a legacy inactivity
 * expiry keeps it. Getting this list wrong is what made Create, Relogin after
 * Revoke, and Login after Clear disagree about whether SIWE or the old
 * addOwners UserOperation was required.
 */
describe('proofWasInvalidatedByPolicy', () => {
  it('treats Revoke and Clear as policy events', () => {
    expect(proofWasInvalidatedByPolicy({ statusReason: 'agent_deleted' })).toBe(true)
    expect(proofWasInvalidatedByPolicy({ statusReason: 'manual_revoke' })).toBe(true)
    expect(proofWasInvalidatedByPolicy({ revokeReason: 'agent_manual' })).toBe(true)
    expect(proofWasInvalidatedByPolicy({ revokeReason: 'clear' })).toBe(true)
    expect(proofWasInvalidatedByPolicy({ revokeReason: 'manual' })).toBe(true)
  })

  it('keeps the proof recoverable for a legacy inactivity expiry', () => {
    expect(proofWasInvalidatedByPolicy({ statusReason: 'inactivity_24h' })).toBe(false)
    expect(proofWasInvalidatedByPolicy({ statusReason: 'inactivity_24h', revokeReason: 'inactivity_24h' })).toBe(false)
  })

  it('prefers statusReason when both reasons are present', () => {
    expect(proofWasInvalidatedByPolicy({ statusReason: 'active', revokeReason: 'agent_deleted' })).toBe(false)
    expect(proofWasInvalidatedByPolicy({ statusReason: 'agent_deleted', revokeReason: 'inactivity_24h' })).toBe(true)
  })

  it('leaves ordinary and missing records replayable', () => {
    expect(proofWasInvalidatedByPolicy({ statusReason: 'reauthorization_required' })).toBe(false)
    expect(proofWasInvalidatedByPolicy({})).toBe(false)
    expect(proofWasInvalidatedByPolicy(null)).toBe(false)
    expect(proofWasInvalidatedByPolicy(undefined)).toBe(false)
  })
})
