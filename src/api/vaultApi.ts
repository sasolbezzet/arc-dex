import type {
  VaultAgent,
  McpSession,
  Approval,
  Activity,
  Credential,
  Limits,
  AgentConnectionToken,
} from '../types/agent'

/**
 * Owner-scoped vault API for the Plugin dashboard.
 *
 * Every backend response is an OBJECT envelope ({ agents: [...] }, not [...]).
 * Unwrapping happens here — exactly once — so hooks and components always deal
 * with plain arrays. A previous version of this file treated the envelopes as
 * arrays, which silently produced an empty agent list on every load.
 */

const BASE = '' // same-origin: Vercel rewrites /api/* to the backend

export class VaultApiError extends Error {
  status: number
  code: string
  constructor(message: string, status: number, code = 'vault_error') {
    super(message)
    this.name = 'VaultApiError'
    this.status = status
    this.code = code
  }
}

/** Thrown as a sentinel so callers can clear a dead session without a toast. */
export const SESSION_EXPIRED = 'session_expired'

async function request<T>(
  path: string,
  { method = 'GET', token, body, timeoutMs = 20_000 }: {
    method?: string
    token: string
    body?: unknown
    timeoutMs?: number
  },
): Promise<T> {
  if (!token) throw new VaultApiError('Sesi belum aktif', 401, SESSION_EXPIRED)

  const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Koneksi gagal'
    throw new VaultApiError(message, 0, 'network_error')
  }

  const text = await response.text()
  let data: any = {}
  try { data = text ? JSON.parse(text) : {} } catch { data = { raw: text } }

  if (!response.ok) {
    const code = response.status === 401 ? SESSION_EXPIRED : (data?.error || 'vault_error')
    const message = data?.message || data?.error || `HTTP ${response.status}`
    throw new VaultApiError(message, response.status, code)
  }
  return data as T
}

/** Pull `field` out of an envelope, tolerating a bare array from older builds. */
function unwrap<T>(payload: any, field: string): T[] {
  if (Array.isArray(payload)) return payload as T[]
  const value = payload?.[field]
  return Array.isArray(value) ? (value as T[]) : []
}

// ── Reads ──

export const listVaultAgents = (token: string) =>
  request<{ agents: VaultAgent[] }>('/api/vault/agents', { token })
    .then(data => unwrap<VaultAgent>(data, 'agents'))

export const listMcpSessions = (token: string) =>
  request<{ sessions: McpSession[] }>('/api/vault/sessions', { token })
    .then(data => unwrap<McpSession>(data, 'sessions'))

export const listApprovals = (token: string) =>
  request<{ approvals: Approval[] }>('/api/vault/approvals', { token })
    .then(data => unwrap<Approval>(data, 'approvals'))

export const listActivity = (token: string, limit = 5) =>
  request<{ activity: Activity[] }>(`/api/vault/activity?limit=${limit}`, { token })
    .then(data => unwrap<Activity>(data, 'activity'))

export const listCredentials = (token: string) =>
  request<{ credentials: Credential[] }>('/api/vault/credentials', { token })
    .then(data => unwrap<Credential>(data, 'credentials'))

export const getLimits = (token: string) =>
  request<{ limits: Limits }>('/api/vault/limits', { token })
    .then(data => data.limits)

export const updateLimits = (token: string, limits: Partial<Limits>) =>
  request<{ limits: Limits }>('/api/vault/limits', {
    method: 'POST',
    token,
    body: limits,
  }).then(data => data.limits)

export const listAgentActivity = (agentKey: string, token: string, limit = 5) =>
  request<{ activity: Activity[] }>(
    `/api/vault/agents/${encodeURIComponent(agentKey)}/activity?limit=${limit}`,
    { token },
  ).then(data => unwrap<Activity>(data, 'activity'))

// ── Mutations ──

/**
 * Issue a connection token for an EXISTING agent binding (owner-only).
 * `token` is the owner's vault session token — never pass it positionally
 * into another slot; the old 3-argument call site sent it as ttlDays and
 * produced `Authorization: Bearer undefined` (always 401).
 */
export const createAgentConnectionToken = (
  agentKey: string,
  token: string,
  ttlDays = 90,
) =>
  request<AgentConnectionToken>(
    `/api/vault/agents/${encodeURIComponent(agentKey)}/connection-token`,
    { method: 'POST', token, body: { ttlDays } },
  )

/**
 * Create the FIRST connection-token agent from an active Agent Wallet session.
 * walletAddress is REQUIRED by the backend (400 wallet_address_required
 * otherwise): omitting it would let Hermes silently reuse another agent's
 * wallet, breaking the one-agent/one-wallet rule.
 */
export const createBootstrapConnectionToken = (
  token: string,
  walletAddress: string,
  clientName = 'Hermes Agent',
  ttlDays = 90,
) =>
  request<AgentConnectionToken>('/api/vault/agents/bootstrap-connection-token', {
    method: 'POST',
    token,
    body: { walletAddress, clientName, ttlDays },
  })

export const revokeVaultAgent = (agentKey: string, token: string) =>
  request<{ ok: boolean; removed: boolean; agentKey: string }>(
    `/api/vault/agents/${encodeURIComponent(agentKey)}`,
    { method: 'DELETE', token },
  )

export const approveVaultRequest = (
  id: string,
  token: string,
  result?: { txHash?: string; explorerUrl?: string },
) =>
  request<{ success: boolean; approval: Approval }>(
    `/api/vault/approvals/${encodeURIComponent(id)}/approve`,
    { method: 'POST', token, body: result || {} },
  )

export const rejectVaultRequest = (id: string, token: string) =>
  request<{ success: boolean; approval: Approval }>(
    `/api/vault/approvals/${encodeURIComponent(id)}/reject`,
    { method: 'POST', token },
  )
