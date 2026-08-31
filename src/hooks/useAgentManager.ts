import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAgentStore } from '../stores/agentStore'
import { useAuthStore } from '../stores/authStore'
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

function toAgentState(agent: VaultAgent, sessions: McpSession[]): AgentState {
  const clientId = clientIdFromAgentKey(agent.agentKey)
  const session = sessions.find(item => item.clientId === clientId)
  const isConnectionToken = clientId.startsWith('arcox_conn_')
  return {
    agentKey: agent.agentKey,
    agentType: agentTypeFromKey(agent.agentKey, agent.clientName),
    clientName: agent.clientName || clientId || 'Agent',
    walletAddress: agent.walletAddress,
    status: deriveAgentStatus(agent, sessions),
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
    removeAgent,
  } = useAgentStore()

  const vaultToken = useAuthStore(state => state.vaultToken)
  const setVaultToken = useAuthStore(state => state.setVaultToken)
  const clearVaultToken = useAuthStore(state => state.clearVaultToken)

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

  const refreshAll = useCallback(async () => {
    if (!vaultToken) return
    const [agentsResult, sessionsResult, approvalsResult, activityResult, credentialsResult, limitsResult] = await Promise.allSettled([
      listVaultAgents(vaultToken),
      listMcpSessions(vaultToken),
      listApprovals(vaultToken),
      listActivity(vaultToken, 5),
      listCredentials(vaultToken),
      getLimits(vaultToken),
    ])

    if (!mounted.current) return

    // A dead token makes every call fail the same way; clear it once.
    if (
      agentsResult.status === 'rejected'
      && agentsResult.reason instanceof VaultApiError
      && agentsResult.reason.code === SESSION_EXPIRED
    ) {
      clearVaultToken()
      return
    }

    const sessions = sessionsResult.status === 'fulfilled' ? sessionsResult.value : []
    if (sessionsResult.status === 'fulfilled') setMcpSessions(sessions)
    if (agentsResult.status === 'fulfilled') {
      setAgents(agentsResult.value.map(agent => toAgentState(agent, sessions)))
    }
    if (approvalsResult.status === 'fulfilled') setApprovals(approvalsResult.value)
    if (activityResult.status === 'fulfilled') setActivity(activityResult.value)
    if (credentialsResult.status === 'fulfilled') setCredentials(credentialsResult.value)
    if (limitsResult.status === 'fulfilled') setLimits(limitsResult.value)
  }, [vaultToken, clearVaultToken, setAgents, setMcpSessions, setApprovals, setActivity])

  useEffect(() => {
    if (!vaultToken) return
    refreshAll()
    const interval = setInterval(refreshAll, REFRESH_MS)
    return () => clearInterval(interval)
  }, [vaultToken, refreshAll])

  /** Run a passkey ceremony and activate the resulting Agent Wallet session. */
  const openAgentWallet = useCallback(async (
    agentType: AgentType,
    mode: 'login' | 'register',
  ): Promise<{ walletAddress: string; sessionToken: string }> => {
    const agentKey = AGENT_KEYS[agentType as keyof typeof AGENT_KEYS] || agentType
    const passkey = mode === 'register'
      ? await registerPasskey(agentKey)
      : await loginPasskey(agentKey)

    setVaultToken(passkey.sessionToken)
    localStorage.setItem('arx_vault_token', passkey.sessionToken)
    localStorage.setItem('arx_passkey_vault_token', passkey.sessionToken)

    const activation = await activateAgentSession(passkey.walletAddress, passkey.sessionToken, agentKey)
    if (activation.warnings.length > 0 && mounted.current) {
      setNotice(`Agent Wallet aktif di Arc. Jaringan lain belum siap: ${activation.warnings.join('; ')}`)
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
      const agentKey = AGENT_KEYS[agentKeyOrType as keyof typeof AGENT_KEYS] || agentKeyOrType
      const passkey = await loginPasskey(agentKey)
      setVaultToken(passkey.sessionToken)
      localStorage.setItem('arx_vault_token', passkey.sessionToken)
      localStorage.setItem('arx_passkey_vault_token', passkey.sessionToken)
      const activation = await activateAgentSession(passkey.walletAddress, passkey.sessionToken, agentKey)
      if (activation.warnings.length > 0) {
        safeSet(setNotice, `Aktif di Arc. Jaringan lain belum siap: ${activation.warnings.join('; ')}`)
      }
      await refreshAll()
    }), [run, refreshAll, setVaultToken, safeSet])

  /** Issue a fresh connection token for an agent that already has a binding. */
  const createToken = useCallback((agentKey: string) =>
    run(`token:${agentKey}`, async () => {
      if (!vaultToken) throw new Error('Masuk dengan passkey terlebih dahulu')
      const issued = await createAgentConnectionToken(agentKey, vaultToken, 90)
      safeSet(setConnectionToken, issued)
    }), [run, vaultToken, safeSet, setConnectionToken])

  const revokeAgent = useCallback((agentKey: string) =>
    run(`revoke:${agentKey}`, async () => {
      if (!vaultToken) throw new Error('Masuk dengan passkey terlebih dahulu')
      await revokeVaultAgent(agentKey, vaultToken)
      removeAgent(agentKey)
      safeSet(setNotice, 'Akses agent dicabut. Agent lain tidak terpengaruh.')
      await refreshAll()
    }), [run, vaultToken, removeAgent, refreshAll, safeSet])

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
    approveRequest,
    rejectRequest,
    refreshAll,
    saveLimits,
    walletForAgentType,
    setConnectionToken,
    dismissError: () => safeSet(setError, null),
    dismissNotice: () => safeSet(setNotice, null),
  }
}
