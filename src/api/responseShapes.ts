/**
 * Backend response envelopes for the Plugin (Agent) dashboard.
 *
 * Every owner-scoped vault endpoint returns an OBJECT, never a bare array.
 * The shape is one-time defined here and unwrapped exactly once (in
 * src/api/vaultApi.ts). Two regressions this prevents:
 *
 *   1. `agents.map(...)` on a `{ agents: [...] }` envelope silently produces
 *      an empty UI (caught in this repo on 2026-08-31).
 *   2. Two components guessing the field name (`results` vs `data` vs bare
 *      array) drift apart and the dashboard contradicts itself.
 *
 * Add a new endpoint? Declare its envelope type here first, then the helper
 * in vaultApi.ts is the only place that touches raw fetch output.
 */

export interface AgentEnvelope<T> {
  agents?: T[]
  agent?: T
}

export interface SessionEnvelope<T> {
  sessions?: T[]
}

export interface ApprovalEnvelope<T> {
  approvals?: T[]
  approval?: T
  persistenceSource?: string
}

export interface ActivityEnvelope<T> {
  activity?: T[]
  persistenceSource?: string
  ownerScope?: string
}

export interface CredentialEnvelope<T> {
  credentials?: T[]
  credential?: T
}

export interface LimitsEnvelope<T> {
  limits?: T
}

export interface TokenEnvelope<T> {
  token?: T
  ok?: boolean
}

/**
 * Pull `field` out of a possibly-typed envelope. Tolerates a bare array for
 * older callers and `null`/`undefined` responses, defaulting to an empty list
 * so consumers never have to null-check.
 */
export function unwrapList<T>(payload: unknown, field: string): T[] {
  if (Array.isArray(payload)) return payload as T[]
  if (payload && typeof payload === 'object') {
    const value = (payload as Record<string, unknown>)[field]
    if (Array.isArray(value)) return value as T[]
  }
  return []
}

/** Unwrap a single-field response; returns `undefined` if missing. */
export function unwrapField<T>(payload: unknown, field: string): T | undefined {
  if (payload && typeof payload === 'object') {
    const value = (payload as Record<string, unknown>)[field]
    return value as T | undefined
  }
  return undefined
}
