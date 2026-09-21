/**
 * One shared rule for "may this stored authorization proof still be replayed?".
 *
 * Revoke and Clear are explicit policy events: the user ended access for that
 * agent, so the durable addOwners hash must never be replayed or reconciled —
 * doing so would silently re-enable a delegate the user just switched off.
 *
 * A legacy inactivity expiry is different: the on-chain owner was never
 * removed, so that proof stays recoverable and relogin must keep using it
 * instead of submitting a duplicate addOwners UserOperation.
 *
 * Keep every caller on this predicate: the same list diverging between the
 * activation guard and the session-key setup is exactly how Create, Relogin
 * after Revoke, and Login after Clear started to be confused with each other.
 */
const DEAD_PROOF_REASONS = new Set(['agent_deleted', 'clear', 'manual_revoke', 'manual', 'agent_manual'])

export function proofWasInvalidatedByPolicy(
  status: { statusReason?: string; revokeReason?: string } | null | undefined,
): boolean {
  return DEAD_PROOF_REASONS.has(String(status?.statusReason || status?.revokeReason || ''))
}
