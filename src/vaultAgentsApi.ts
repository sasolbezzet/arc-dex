import { getAuthToken } from './auth'

// Per-agent connection management for the owner's Agent Wallet. The backend
// issues a scoped token (arx_vs_…) per agent; these endpoints let the OWNER
// list those connections, read their activity, revoke them, hand out fresh
// connection tokens, and link payment cards to each agent.

export type VaultAgentTokenStatus = 'active' | 'expired' | 'revoked' | string

export type VaultAgent = {
  agentKey: string
  walletAddress: string
  boundAt?: string | number
  lastUsedAt?: string | number
  clientName?: string
  spentToday?: number | string
  tokenStatus?: VaultAgentTokenStatus
}

export type AgentActivityEntry = {
  id?: string
  at: string | number
  type: string
  amount?: number | string
  detail?: string
  data?: Record<string, unknown>
}

export type AgentConnectionToken = {
  token: string
  agentName?: string
  walletAddress?: string
  expiresAt?: string
  mcpUrl?: string
  message?: string
  setupMessage?: string
  snippets?: { message?: string } & Record<string, unknown>
}

export type LinkedAgentCard = {
  cardId: string
  label?: string
  last4?: string
  maxPerTx?: number | string
  daily?: number | string
  linkedAt?: string
}

export type OwnerAgentCard = {
  cardId: string
  label?: string
  last4?: string
  maxPerTx?: number | string
  daily?: number | string
}

function getPasskeyToken() {
  try { return localStorage.getItem('arx_passkey_vault_token') || '' } catch { return '' }
}

function getVaultAgentsAuthToken() {
  return getPasskeyToken() || getAuthToken()
}

const HEADERS = (extra?: Record<string, string>, token = getVaultAgentsAuthToken()) => ({
  'Content-Type': 'application/json',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
  ...extra,
})

async function api<T = any>(path: string, init?: RequestInit, authToken?: string): Promise<T> {
  const primaryToken = authToken || getVaultAgentsAuthToken()
  let resp = await fetch(path, {
    ...init,
    headers: HEADERS(init?.headers as Record<string, string> | undefined, primaryToken),
  })
  const fallbackToken = getAuthToken()
  if (!authToken && resp.status === 401 && fallbackToken && fallbackToken !== primaryToken) {
    resp = await fetch(path, {
      ...init,
      headers: HEADERS(init?.headers as Record<string, string> | undefined, fallbackToken),
    })
  }
  const text = await resp.text()
  let data: any = {}
  try { data = text ? JSON.parse(text) : {} } catch { data = { raw: text } }
  if (!resp.ok) throw new Error(data?.error || `HTTP ${resp.status}`)
  return data as T
}

function normalizeList<T>(data: any, field: string): T[] {
  if (Array.isArray(data)) return data as T[]
  return Array.isArray(data?.[field]) ? data[field] : []
}

/** Create the first owner-scoped connection-token agent from an active MSCA session. */
export function createBootstrapConnectionToken(clientName = 'Hermes Agent', ttlDays = 90, authToken?: string, walletAddress?: string): Promise<AgentConnectionToken & { agentKey: string }> {
  return api('/api/vault/agents/bootstrap-connection-token', {
    method: 'POST',
    body: JSON.stringify({ clientName, ttlDays, ...(walletAddress ? { walletAddress } : {}) }),
  }, authToken)
}

/** Owner-scoped list of agents connected to this Agent Wallet. */
export function listVaultAgents(authToken?: string): Promise<VaultAgent[]> {
  return api('/api/vault/agents', { method: 'GET' }, authToken).then(d => normalizeList<VaultAgent>(d, 'agents'))
}

/** Owner-visible masked cards available for manual agent linking. */
export function listVaultCards(authToken?: string): Promise<OwnerAgentCard[]> {
  return api('/api/vault/cards', { method: 'GET' }, authToken).then(d => normalizeList<OwnerAgentCard>(d, 'cards'))
}

/** Recent activity for one agent connection. */
export function getAgentActivity(agentKey: string, authToken?: string): Promise<AgentActivityEntry[]> {
  return api(`/api/vault/agents/${encodeURIComponent(agentKey)}/activity`, { method: 'GET' }, authToken)
    .then(d => normalizeList<AgentActivityEntry>(d, 'activity'))
}

/** Revoke one agent connection permanently. */
export function revokeVaultAgent(agentKey: string, authToken?: string): Promise<{ ok: boolean }> {
  return api(`/api/vault/agents/${encodeURIComponent(agentKey)}`, { method: 'DELETE' }, authToken)
}

/**
 * Issue a fresh one-time connection token. The token (and the ready-to-paste
 * setup message inside `snippets.message`) is shown exactly once by the UI.
 */
export function createAgentConnectionToken(agentKey: string, ttlDays = 90, authToken?: string): Promise<AgentConnectionToken> {
  return api(`/api/vault/agents/${encodeURIComponent(agentKey)}/connection-token`, {
    method: 'POST',
    body: JSON.stringify({ ttlDays }),
  }, authToken)
}

/** Link an owner card to an agent with per-card spending caps. */
export function linkCardToAgent(
  agentKey: string,
  input: { cardId: string; maxPerTx: number | string; daily: number | string },
  authToken?: string,
): Promise<{ ok: boolean }> {
  return api(`/api/vault/agents/${encodeURIComponent(agentKey)}/cards`, {
    method: 'POST',
    body: JSON.stringify(input),
  }, authToken)
}

/** Cards currently linked to this agent. */
export function getAgentCards(agentKey: string, authToken?: string): Promise<LinkedAgentCard[]> {
  return api(`/api/vault/agents/${encodeURIComponent(agentKey)}/cards`, { method: 'GET' }, authToken)
    .then(d => normalizeList<LinkedAgentCard>(d, 'cards'))
}

/** Remove the card↔agent link from the card side. */
export function unlinkCardFromAgent(cardId: string, authToken?: string): Promise<{ ok: boolean }> {
  return api(`/api/vault/cards/${encodeURIComponent(cardId)}/agent-link`, { method: 'DELETE' }, authToken)
}
