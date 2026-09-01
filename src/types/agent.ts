/**
 * Shared type definitions for the Arc DEX Agent (Plugin) system.
 * All stores, hooks, and components import from this single file.
 *
 * The shapes here mirror what the backend actually returns:
 *   GET  /api/vault/agents      -> { agents: VaultAgent[] }
 *   GET  /api/vault/sessions    -> { sessions: McpSession[] }
 *   GET  /api/vault/approvals   -> { approvals: Approval[] }
 *   GET  /api/vault/activity    -> { activity: Activity[] }
 * Every envelope is unwrapped in src/api/vaultApi.ts, never in components.
 */

// ── Agent identity ──

export type AgentType = 'hermes' | 'claude' | 'chatgpt' | 'custom'

/**
 * Connection state of one agent, derived from the backend binding list plus
 * the live MCP session list. There is exactly one source of truth for this
 * (deriveAgentStatus in src/hooks/useAgentManager.ts) so two components can
 * never disagree about whether an agent is online.
 */
export type AgentStatus =
  | 'connected'      // binding exists AND an MCP session is live
  | 'idle'           // binding exists, no live MCP traffic
  | 'not_connected'  // no binding for this agent yet
  | 'connecting'     // passkey/session ceremony in flight
  | 'revoked'

export type ChainDeployStatus = 'pending' | 'deploying' | 'deployed' | 'failed' | 'unsupported'
export type ChainAuthStatus = 'pending' | 'authorized' | 'failed'

/** One agent row as rendered by the Plugin dashboard. */
export interface AgentState {
  /** Stable identity. Every action, policy, token, and revoke uses this key. */
  agentKey: string
  agentType: AgentType
  clientName: string
  walletAddress: string
  status: AgentStatus
  /** Composite key prefix (OAuth clientId) used to match MCP sessions. */
  clientId: string
  boundAt: number | null
  lastUsedAt: number | null
  spentToday: string
  connectedAt: number | null
  lastActivity: number | null
  /** True once the backend has seen a passkey for this exact agent binding. */
  passkeyBound?: boolean
  /** Connection-token agents can rotate a token; OAuth agents use browser approval. */
  connectionMode?: 'token' | 'oauth' | 'unknown'
  /** Public Arc balance for this Agent Wallet; null means the read was unavailable. */
  balance?: Record<string, string> | null
  balanceUpdatedAt?: number | null
}

// ── Backend payloads ──

/** GET /api/vault/agents item. */
export interface VaultAgent {
  agentKey: string
  walletAddress: string
  boundAt?: string | number
  lastUsedAt?: string | number
  clientName?: string
  spentToday?: string | number
  active?: boolean
  revokedAt?: string | number
  revokeReason?: string
}

/** GET /api/vault/sessions item. */
export interface McpSession {
  clientId: string
  agent: string
  connectedAt: number
  lastActivity: number
  active: boolean
}

/** GET /api/vault/approvals item. The backend field is `action`, not `type`. */
export interface Approval {
  id: string
  agent: string
  action: string
  amount: string
  token: string
  source?: string
  to?: string
  status: 'pending' | 'approved' | 'rejected' | string
  createdAt: number
  approvedAt?: number
  txHash?: string
  explorerUrl?: string
  details?: string
}

/** GET /api/vault/activity item. */
export interface Activity {
  id: string
  type: string
  data?: Record<string, unknown>
  ts: number
}

export interface Credential {
  id: string
  type: 'eoa' | 'circle' | 'solana' | 'api_key' | string
  label: string
  value?: string
}

export interface Limits {
  maxPerTx: number | string
  dailyLimit: number | string
  autoApprove: boolean
  whitelist: string[]
}

// ── Connection token ──

/** POST .../connection-token and .../bootstrap-connection-token response. */
export interface AgentConnectionToken {
  token: string
  agentKey?: string
  agentName?: string
  walletAddress?: string
  expiresAt?: string
  mcpUrl?: string
  message?: string
}

// ── MSCA / session key ──

export interface MscaState {
  walletAddress: string
  delegateAddress: string
  sessionActive: boolean
  deployed: boolean
  deploymentStatus: Record<string, ChainDeployStatus>
  chainAuthorizationStatus: Record<string, ChainAuthStatus>
}

// ── UI config ──

export interface AgentConfig {
  /** Short monogram shown in the card avatar (no emoji: matches app nav style). */
  mark: string
  name: string
  description: string
  connectionType: string
  /** CSS custom-property accent used by the card border/glow. */
  accent: string
}

export const AGENT_CONFIGS: Record<AgentType, AgentConfig> = {
  hermes: {
    mark: 'HM',
    name: 'Hermes',
    description: 'Agent CLI di terminal Anda',
    connectionType: 'Token koneksi',
    accent: '#a855f7',
  },
  claude: {
    mark: 'CL',
    name: 'Claude',
    description: 'Asisten AI dari Anthropic',
    connectionType: 'Izin lewat browser',
    accent: '#f59e0b',
  },
  chatgpt: {
    mark: 'GP',
    name: 'ChatGPT',
    description: 'Asisten AI dari OpenAI',
    connectionType: 'Izin lewat browser',
    accent: '#22c55e',
  },
  custom: {
    mark: 'CU',
    name: 'Agent lain',
    description: 'Koneksi MCP kustom',
    connectionType: 'Token koneksi',
    accent: '#38bdf8',
  },
}

/** Agent types the dashboard always shows, in display order. */
export const AGENT_TYPES: AgentType[] = ['hermes', 'claude', 'chatgpt']

/**
 * Stable agentKey prefixes. Hermes uses a bootstrap connection token, so its
 * real agentKey is issued by the backend (arcox_conn_…|owner) — 'hermes-mcp'
 * is only the passkey/MSCA namespace for the browser wallet state.
 */
export const AGENT_KEYS = {
  hermes: 'hermes-mcp',
  claude: 'oauth:claude',
  chatgpt: 'oauth:chatgpt',
} as const

export const SUPPORTED_CHAINS = ['arc-testnet', 'base-sepolia', 'arbitrum-sepolia'] as const
export type SupportedChain = (typeof SUPPORTED_CHAINS)[number]

export const MCP_URL = import.meta.env.VITE_MCP_URL || 'https://arcoxdex.vercel.app/mcp'

/** Map an agentKey / clientName coming from the backend to a UI agent type. */
export function agentTypeFromKey(agentKey: string, clientName = ''): AgentType {
  const haystack = `${agentKey} ${clientName}`.toLowerCase()
  if (haystack.includes('claude')) return 'claude'
  if (haystack.includes('chatgpt') || haystack.includes('gpt')) return 'chatgpt'
  if (haystack.includes('hermes')) return 'hermes'
  return 'custom'
}

/** OAuth clientId part of a composite agentKey (`clientId|ownerAddress`). */
export function clientIdFromAgentKey(agentKey: string): string {
  return String(agentKey || '').split('|')[0] || ''
}
