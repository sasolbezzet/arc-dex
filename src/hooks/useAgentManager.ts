import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAgentStore } from '../stores/agentStore'
import { useAuthStore } from '../stores/authStore'
import { ensureConnectedOwnerSession } from '../auth'
import {
  listVaultAgents,
  listMcpSessions,
  listApprovals,
  listActivity,
  listCredentials,
  getLimits,
  updateLimits,
  createAgentConnectionToken,
  createBootstrapConnectionToken,
  revokeVaultAgent,
  deleteVaultAgent,
  approveVaultRequest,
  rejectVaultRequest,
  VaultApiError,
  SESSION_EXPIRED,
} from '../api/vaultApi'
import { registerPasskey, loginPasskey, getMscaState } from '../services/modularWallet'
import { activateAgentSession } from '../services/agentSession'
import {
  AGENT_KEYS,
  agentTypeFromKey,
  clientIdFromAgentKey,
  type AgentState,
  type AgentStatus,
  type AgentType,
  type McpSession,
  type VaultAgent,
  type Credential,
  type Limits,
  type SupportedChain,
} from '../types/agent'

const REFRESH_MS = 10_000

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Single source of truth for agent status. A binding row means the agent exists;
 * a live MCP session for the same clientId means it is actually online. Two
 * components must never derive this independently, or the dashboard and the
 * agent card end up disagreeing.
 */
function deriveAgentStatus(agent: VaultAgent, sessions: McpSession[]): AgentStatus {
  const clientId = clientIdFromAgentKey(agent.agentKey)
  const live = sessions.some(session => session.active && session.clientId === clientId)
  return live ? 'connected' : 'idle'
}

export function canonicalAgentKey(agent: Pick<VaultAgent, 'agentKey' | 'walletAddress'>): string {
  const rawKey = String(agent.agentKey || '').trim().toLowerCase()
  if (rawKey.startsWith('oauth:')) {
    const clientId = rawKey.slice('oauth:'.length).split('|')[0]
    const owner = rawKey.includes('|') ? rawKey.slice(rawKey.indexOf('|') + 1) : String(agent.walletAddress || '').toLowerCase()
    return `${clientId}|${owner}`
  }
  return rawKey
}

function isGenericAgentLabel(agent: VaultAgent): boolean {
  const label = String(agent.clientName || '').trim().toLowerCase()
  return !label || label === 'agent mcp' || label === 'mcp-agent' || label === 'mcp agent'
}

function agentIdentity(agent: Pick<VaultAgent, 'agentKey' | 'walletAddress' | 'clientName'>): string {
  const wallet = String(agent.walletAddress || '').trim().toLowerCase()
  // OAuth client registrations can rotate their generated client ID. For the
  // dashboard, the durable identity is the provider plus owner wallet; this
  // prevents Claude/GPT from gaining a second card after a fresh passkey or
  // OAuth registration while still keeping providers isolated.
  const provider = agentTypeFromKey(canonicalAgentKey(agent), agent.clientName)
  return /^0x[0-9a-f]{40}$/.test(wallet)
    ? `provider:${provider}|wallet:${wallet}`
    : `key:${canonicalAgentKey(agent)}`
}

/**
 * Collapse rows produced by the old OAuth namespace (`oauth:<clientId>`).
 * When legacy and canonical rows share a wallet, keep the named/canonical row
 * so the card says Claude or ChatGPT instead of the generic MCP label.
 */
export function mergeAgentRows(rows: VaultAgent[]): VaultAgent[] {
  const byIdentity = new Map<string, VaultAgent>()
  for (const source of rows) {
    const agent = { ...source, agentKey: canonicalAgentKey(source) }
    const identity = agentIdentity(agent)
    const previous = byIdentity.get(identity)
    if (!previous) {
      byIdentity.set(identity, agent)
      continue
    }
    if (isGenericAgentLabel(previous) && !isGenericAgentLabel(agent)) {
      byIdentity.set(identity, agent)
    }
  }
  return [...byIdentity.values()]
}

function toAgentState(agent: VaultAgent, sessions: McpSession[]): AgentState {
  const clientId = clientIdFromAgentKey(agent.agentKey)
  const session = sessions.find(item => item.clientId === clientId)
  const isConnectionToken = clientId.startsWith('arcox_conn_')
  const revoked = agent.active === false || Boolean((agent as VaultAgent & { revokedAt?: string | number }).revokedAt)
  return {
    agentKey: agent.agentKey,
    agentType: agentTypeFromKey(agent.agentKey, agent.clientName),
    clientName: agent.clientName || clientId || 'Agent',
    walletAddress: agent.walletAddress,
    status: revoked ? 'revoked' : deriveAgentStatus(agent, sessions),
    clientId,
    boundAt: toNumber(agent.boundAt),
    lastUsedAt: toNumber(agent.lastUsedAt),
    spentToday: String(agent.spentToday ?? '0'),
    connectedAt: session ? toNumber(session.connectedAt) : null,
    lastActivity: session ? toNumber(session.lastActivity) : null,
    // The binding API does not expose credential IDs by design. A wallet
    // binding is still useful to the dashboard; passkey details stay private.
    passkeyBound: Boolean(agent.walletAddress),
    connectionMode: isConnectionToken ? 'token' : clientId.startsWith('arcox_') ? 'oauth' : 'unknown',
  }
}

/**
 * OAuth approval stores one passkey session per MCP client. A single
 * `vaultToken` is not enough to render every independently-created Agent
 * Wallet, so read all locally-held owner/passkey session tokens and merge the
 * owner-scoped read results. Tokens are never sent anywhere except the same
 * origin vault endpoints.
 */
function storedVaultTokens(primary: string | null): string[] {
  const tokens: string[] = []
  const add = (value: string | null) => {
    const token = String(value || '').trim()
    if (token && !tokens.includes(token)) tokens.push(token)
  }
  if (typeof window === 'undefined') {
    add(primary)
    return tokens
  }
  try {
    // Once the owner EOA is authenticated, use only that scope for dashboard
    // reads. Per-agent OAuth/passkey tokens are intentionally not merged into
    // owner management queries, otherwise an MSCA token can reintroduce a
    // foreign legacy binding into the dashboard.
    const ownerToken = localStorage.getItem('arx_owner_vault_token')
    if (ownerToken) {
      add(ownerToken)
      return tokens
    }
    add(primary)
    add(localStorage.getItem('arx_vault_token'))
    add(localStorage.getItem('arx_passkey_vault_token'))
  } catch { /* storage can be unavailable in privacy mode */ }
  return tokens
}

interface AgentReadResult {
  token: string
  agents: PromiseSettledResult<VaultAgent[]>
  sessions: PromiseSettledResult<McpSession[]>
  approvals: PromiseSettledResult<Awaited<ReturnType<typeof listApprovals>>>
  activity: PromiseSettledResult<Awaited<ReturnType<typeof listActivity>>>
  credentials: PromiseSettledResult<Awaited<ReturnType<typeof listCredentials>>>
  limits: PromiseSettledResult<Awaited<ReturnType<typeof getLimits>>>
}

export function useAgentManager() {
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [limits, setLimits] = useState<Limits | null>(null)
  const mounted = useRef(true)

  useEffect(() => () => { mounted.current = false }, [])

  const {
    agents,
    mcpSessions,
    approvals,
    activity,
    connectionToken,
    setAgents,
    setMcpSessions,
    setApprovals,
    setActivity,
    setConnectionToken,
    updateAgent,
  } = useAgentStore()

  const vaultToken = useAuthStore(state => state.vaultToken)
  const setVaultToken = useAuthStore(state => state.setVaultToken)
  const clearVaultToken = useAuthStore(state => state.clearVaultToken)

  const tokenForAgent = useCallback((agentKey: string): string | null => {
    const clientId = clientIdFromAgentKey(agentKey)
    if (typeof window === 'undefined') return vaultToken
    try {
      if (clientId) {
        const scoped = localStorage.getItem(`arx_oauth_vault_token:${clientId}`)
        if (scoped) return scoped
      }
      return vaultToken || localStorage.getItem('arx_vault_token') || localStorage.getItem('arx_passkey_vault_token')
    } catch {
      return vaultToken
    }
  }, [vaultToken])

  const safeSet = useCallback(<T,>(setter: (value: T) => void, value: T) => {
    if (mounted.current) setter(value)
  }, [])

  const handleFailure = useCallback((err: unknown, fallback: string) => {
    if (err instanceof VaultApiError && err.code === SESSION_EXPIRED) {
      clearVaultToken()
      safeSet(setError, 'Sesi berakhir. Masuk kembali dengan passkey.')
      return
    }
    const message = err instanceof Error ? err.message : fallback
    safeSet(setError, message || fallback)
  }, [clearVaultToken, safeSet])

  const refreshAgentBalances = useCallback((nextAgents: AgentState[], chain: SupportedChain = 'arc-testnet') => {
    void Promise.all(nextAgents.map(async agent => {
      try {
        const response = await fetch(`/api/balance/${encodeURIComponent(agent.walletAddress)}?chain=${encodeURIComponent(chain)}`, {
          cache: 'no-store',
          signal: AbortSignal.timeout(12_000),
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data?.error || `Balance request failed (${response.status})`)
        if (mounted.current) updateAgent(agent.agentKey, {
          balance: data,
          balanceChain: chain,
          balances: { ...(agent.balances || {}), [chain]: data },
          balanceUpdatedAt: Date.now(),
        })
      } catch {
        // Keep the card honest: unavailable is distinct from a real zero.
        if (mounted.current) updateAgent(agent.agentKey, {
          balance: null,
          balanceChain: chain,
          balances: { ...(agent.balances || {}), [chain]: null },
          balanceUpdatedAt: Date.now(),
        })
      }
    }))
  }, [updateAgent])

  const refreshAll = useCallback(async () => {
    const tokens = storedVaultTokens(vaultToken)
    if (tokens.length === 0) return

    const reads: AgentReadResult[] = await Promise.all(tokens.map(async token => {
      const [agents, sessions, approvals, activity, credentials, limits] = await Promise.allSettled([
        listVaultAgents(token),
        listMcpSessions(token),
        listApprovals(token),
        listActivity(token, 5),
        listCredentials(token),
        getLimits(token),
      ])
      return { token, agents, sessions, approvals, activity, credentials, limits }
    }))

    if (!mounted.current) return

    const agentMap = new Map<string, VaultAgent>()
    const sessionMap = new Map<string, McpSession>()
    const approvalMap = new Map<string, Awaited<ReturnType<typeof listApprovals>>[number]>()
    const activityMap = new Map<string, Awaited<ReturnType<typeof listActivity>>[number]>()
    const credentialMap = new Map<string, Awaited<ReturnType<typeof listCredentials>>[number]>()
    let firstLimits: Awaited<ReturnType<typeof getLimits>> | null = null
    let successfulAgentRead = false
    let candidateToken = ''

    for (const read of reads) {
      if (read.agents.status === 'fulfilled') {
        successfulAgentRead = true
        candidateToken ||= read.token
        for (const agent of mergeAgentRows(read.agents.value)) {
          const identity = agentIdentity(agent)
          const canonical = canonicalAgentKey(agent)
          const previous = agentMap.get(identity)
          if (!previous || (isGenericAgentLabel(previous) && !isGenericAgentLabel(agent))) {
            agentMap.set(identity, { ...agent, agentKey: canonical })
          }
        }
      }
      if (read.sessions.status === 'fulfilled') {
        for (const session of read.sessions.value) {
          const key = `${session.clientId}:${session.agent}`
          const previous = sessionMap.get(key)
          if (!previous || previous.lastActivity < session.lastActivity) sessionMap.set(key, session)
        }
      }
      if (read.approvals.status === 'fulfilled') for (const item of read.approvals.value) approvalMap.set(item.id, item)
      if (read.activity.status === 'fulfilled') for (const item of read.activity.value) activityMap.set(item.id, item)
      if (read.credentials.status === 'fulfilled') {
        for (const item of read.credentials.value) credentialMap.set(item.id, item)
      }
      if (!firstLimits && read.limits.status === 'fulfilled') firstLimits = read.limits.value
    }

    // A dead token makes every owner read fail. If another OAuth passkey token
    // is still valid, keep it and continue rendering the connected agents.
    if (!successfulAgentRead) {
      const allExpired = reads.every(read => read.agents.status === 'rejected'
        && read.agents.reason instanceof VaultApiError
        && read.agents.reason.code === SESSION_EXPIRED)
      if (allExpired) clearVaultToken()
      return
    }
    if (!vaultToken && candidateToken) setVaultToken(candidateToken)

    const sessions = [...sessionMap.values()]
    const nextAgents = [...agentMap.values()].map(agent => toAgentState(agent, sessions))

    // The backend response is authoritative. Never retain cached cards that are
    // absent from a successful owner-scoped read: this guarantees revoke and
    // owner switching cannot resurrect a stale agent. Revoke refs remain useful
    // for suppressing delayed balance updates, but not for inventing rows.
    setMcpSessions(sessions)
    setAgents(nextAgents)
    setApprovals([...approvalMap.values()])
    setActivity([...activityMap.values()].sort((left, right) => right.ts - left.ts).slice(0, 5))
    setCredentials([...credentialMap.values()])
    if (firstLimits) setLimits(firstLimits)
    refreshAgentBalances(nextAgents)
  }, [vaultToken, clearVaultToken, setVaultToken, setAgents, setMcpSessions, setApprovals, setActivity, setCredentials, setLimits, refreshAgentBalances])

  useEffect(() => {
    // OAuth passkey sessions are intentionally stored per MCP client and do
    // not replace the active Hermes vault token. Start the dashboard refresh
    // whenever any owner-scoped token exists, not only when `vaultToken` is
    // populated in the Zustand store.
    if (storedVaultTokens(vaultToken).length === 0) return
    void refreshAll()
    const interval = setInterval(() => { void refreshAll() }, REFRESH_MS)
    return () => clearInterval(interval)
  }, [vaultToken, refreshAll])

  useEffect(() => {
    // A Claude/ChatGPT approval can finish in another tab while this dashboard
    // remains open. Refresh as soon as the token appears or the user returns
    // to this tab instead of waiting for the next ten-second poll.
    if (typeof window === 'undefined') return
    const onStorage = (event: StorageEvent) => {
      if (event.key?.startsWith('arx_oauth_vault_token:') || event.key === 'arx_vault_token' || event.key === 'arx_owner_vault_token') void refreshAll()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refreshAll()
    }
    window.addEventListener('storage', onStorage)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('storage', onStorage)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [refreshAll])

  /** Run a passkey ceremony and activate the resulting Agent Wallet session. */
  const openAgentWallet = useCallback(async (
    agentType: AgentType,
    mode: 'login' | 'register',
  ): Promise<{ walletAddress: string; sessionToken: string }> => {
    // Establish the owner boundary before the passkey ceremony. A passkey can
    // prove control of an MSCA, but it must not silently attach that MSCA to a
    // stale/foreign owner identity from localStorage or server environment.
    const owner = await ensureConnectedOwnerSession()
    const rawAgentKey = typeof agentType === 'string'
      ? (AGENT_KEYS[agentType as keyof typeof AGENT_KEYS] || agentType)
      : ''
    const agentKey = typeof rawAgentKey === 'string' ? rawAgentKey.trim() : ''
    if (!agentKey) throw new Error('Agent key tidak tersedia. Muat ulang dashboard lalu coba lagi.')
    const passkey = mode === 'register'
      ? await registerPasskey(agentKey)
      : await loginPasskey(agentKey)

    const activation = await activateAgentSession(passkey.walletAddress, passkey.sessionToken, agentKey, {
      eoaAddress: owner.address,
      ownerSessionToken: owner.token,
    })
    // Owner-scoped dashboard reads use the verified EOA session. Keep the
    // passkey token only for the exact agent operation that needed it.
    setVaultToken(owner.token)
    localStorage.setItem('arx_vault_token', owner.token)
    localStorage.setItem('arx_owner_vault_token', owner.token)
    if (activation.warnings.length > 0 && mounted.current) {
      setNotice(`Agent Wallet aktif di Arc, Base, dan Arbitrum. ${activation.warnings.join('; ')}`)
    }
    return { walletAddress: passkey.walletAddress, sessionToken: passkey.sessionToken }
  }, [setVaultToken])

  const run = useCallback(async (label: string, fn: () => Promise<void>) => {
    safeSet(setBusyAction, label)
    safeSet(setError, null)
    try {
      await fn()
    } catch (err) {
      handleFailure(err, 'Tindakan gagal')
    } finally {
      safeSet(setBusyAction, null)
    }
  }, [handleFailure, safeSet])

  /**
   * Hermes: create/open the Agent Wallet, then hand out a connection token.
   * The token is the only credential Hermes needs; it is shown exactly once.
   */
  const connectHermes = useCallback((mode: 'login' | 'register' = 'login') =>
    run(`hermes:${mode}`, async () => {
      const { walletAddress, sessionToken } = await openAgentWallet('hermes', mode)
      const issued = await createBootstrapConnectionToken(sessionToken, walletAddress, 'Hermes Agent', 90)
      safeSet(setConnectionToken, issued)
      await refreshAll()
    }), [run, openAgentWallet, refreshAll, safeSet, setConnectionToken])

  /**
   * Claude / ChatGPT are connected FROM the agent side: the agent opens this
   * page with ?auth=mcp&request_id=… and useOAuthApproval finishes the flow.
   * Here we only prepare (or re-open) the Agent Wallet those agents will use.
   */
  const prepareAgentWallet = useCallback((agentType: AgentType, mode: 'login' | 'register' = 'login') =>
    run(`${agentType}:${mode}`, async () => {
      await openAgentWallet(agentType, mode)
      safeSet(setNotice, 'Agent Wallet siap. Lanjutkan koneksi dari aplikasi agent.')
      await refreshAll()
    }), [run, openAgentWallet, refreshAll, safeSet])

  /** Re-open an existing agent's wallet with its passkey (per-agent login). */
  const loginAgent = useCallback((agentKeyOrType: string) =>
    run(`login:${agentKeyOrType}`, async () => {
      const owner = await ensureConnectedOwnerSession()
      const rawAgentKey = typeof agentKeyOrType === 'string'
        ? (AGENT_KEYS[agentKeyOrType as keyof typeof AGENT_KEYS] || agentKeyOrType)
        : ''
      const agentKey = typeof rawAgentKey === 'string' ? rawAgentKey.trim() : ''
      if (!agentKey) throw new Error('Agent key tidak tersedia. Muat ulang dashboard lalu coba lagi.')
      const passkey = await loginPasskey(agentKey)
      const activation = await activateAgentSession(passkey.walletAddress, passkey.sessionToken, agentKey, {
        eoaAddress: owner.address,
        ownerSessionToken: owner.token,
      })
      setVaultToken(owner.token)
      localStorage.setItem('arx_vault_token', owner.token)
      localStorage.setItem('arx_passkey_vault_token', owner.token)
      if (activation.warnings.length > 0) {
        safeSet(setNotice, `Aktif di Arc, Base, dan Arbitrum. ${activation.warnings.join('; ')}`)
      }
      await refreshAll()
    }), [run, refreshAll, setVaultToken, safeSet])

  /** Issue a fresh connection token for an agent that already has a binding. */
  const createToken = useCallback((agentKey: string) =>
    run(`token:${agentKey}`, async () => {
      const token = tokenForAgent(agentKey)
      if (!token) throw new Error('Masuk dengan passkey agent terlebih dahulu')
      const issued = await createAgentConnectionToken(agentKey, token, 90)
      safeSet(setConnectionToken, issued)
    }), [run, tokenForAgent, safeSet, setConnectionToken])

  const deleteAgent = useCallback((agentKey: string) =>
    run(`delete:${agentKey}`, async () => {
      const token = tokenForAgent(agentKey)
      if (!token) throw new Error('Masuk dengan passkey agent terlebih dahulu')
      await deleteVaultAgent(agentKey, token)
      safeSet(setNotice, 'Agent dihapus dari dashboard dan session dinonaktifkan.')
      await refreshAll()
    }), [run, tokenForAgent, refreshAll, safeSet])

  const revokeAgent = useCallback((agentKey: string) =>
    run(`revoke:${agentKey}`, async () => {
      const token = tokenForAgent(agentKey)
      if (!token) throw new Error('Masuk dengan passkey agent terlebih dahulu')
      await revokeVaultAgent(agentKey, token)
      // Revoke disables the active session but intentionally retains the
      // binding/card so the same wallet can be reactivated with Login passkey.
      safeSet(setNotice, 'Session agent dinonaktifkan. Wallet tetap tersimpan; gunakan Login passkey untuk mengaktifkannya kembali.')
      await refreshAll()
    }), [run, tokenForAgent, refreshAll, safeSet])

  const saveLimits = useCallback((next: Partial<Limits>) =>
    run('limits', async () => {
      if (!vaultToken) throw new Error('Masuk dengan passkey terlebih dahulu')
      const updated = await updateLimits(vaultToken, next)
      safeSet(setLimits, updated)
      safeSet(setNotice, 'Batas pengeluaran berhasil diperbarui.')
    }), [run, vaultToken, safeSet])

  const approveRequest = useCallback((id: string) =>
    run(`approve:${id}`, async () => {
      if (!vaultToken) throw new Error('Masuk dengan passkey terlebih dahulu')
      await approveVaultRequest(id, vaultToken)
      await refreshAll()
    }), [run, vaultToken, refreshAll])

  const rejectRequest = useCallback((id: string) =>
    run(`reject:${id}`, async () => {
      if (!vaultToken) throw new Error('Masuk dengan passkey terlebih dahulu')
      await rejectVaultRequest(id, vaultToken)
      await refreshAll()
    }), [run, vaultToken, refreshAll])

  /** Wallet address remembered in this browser for an agent, if any. */
  const walletForAgentType = useCallback((agentType: AgentType): string => {
    // This is only used by the onboarding cards. Existing bindings are rendered
    // by exact agentKey below, so one dynamic OAuth client can never be hidden
    // behind the first agent of the same type.
    const fromBackend = agents.find(agent => agent.agentType === agentType)?.walletAddress
    if (fromBackend) return fromBackend
    const agentKey = AGENT_KEYS[agentType as keyof typeof AGENT_KEYS]
    return agentKey ? String(getMscaState(agentKey).walletAddress || '') : ''
  }, [agents])

  const pendingApprovals = useMemo(
    () => approvals.filter(approval => approval.status === 'pending'),
    [approvals],
  )
  const connectedCount = useMemo(
    () => agents.filter(agent => agent.status === 'connected').length,
    [agents],
  )

  return {
    // data
    agents,
    mcpSessions,
    approvals,
    pendingApprovals,
    activity,
    credentials,
    limits,
    connectionToken,
    connectedCount,
    // state
    busyAction,
    error,
    notice,
    hasSession: Boolean(vaultToken),
    // actions
    connectHermes,
    prepareAgentWallet,
    loginAgent,
    createToken,
    revokeAgent,
    deleteAgent,
    approveRequest,
    rejectRequest,
    refreshAll,
    refreshAgentBalances,
    saveLimits,
    walletForAgentType,
    setConnectionToken,
    dismissError: () => safeSet(setError, null),
    dismissNotice: () => safeSet(setNotice, null),
  }
}
