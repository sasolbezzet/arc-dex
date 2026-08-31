/**
 * Shared type definitions for the Arc DEX Agent system.
 * All stores, hooks, and components import from this single file.
 */

// ── Agent Types ──

export type AgentType = 'claude' | 'chatgpt' | 'hermes' | 'custom'

export type AgentStatus =
  | 'connected'
  | 'idle'
  | 'passkey_required'
  | 'revoked'
  | 'deploying'
  | 'connecting'

export type ChainDeployStatus = 'pending' | 'deploying' | 'deployed' | 'failed' | 'unsupported'
export type ChainAuthStatus = 'pending' | 'authorized' | 'failed'

export interface AgentState {
  agentKey: string
  agentType: AgentType
  clientName: string
  walletAddress: string
  status: AgentStatus
  sessionToken: string | null
  hasPasskeyBound: boolean
  connectedAt: string | null
  lastActivity: string | null
  deploymentStatus: Record<string, ChainDeployStatus>
  chainAuthorizationStatus: Record<string, ChainAuthStatus>
}

// ── MCP Session ──

export interface McpSession {
  clientId: string
  agent: string
  connectedAt: string
  lastActivity: string
  active: boolean
}

// ── Vault Types ──

export interface VaultAgent {
  agentKey: string
  clientName: string
  walletAddress: string
  connectedAt?: string
}

export interface Approval {
  id: string
  type: 'send' | 'swap' | 'bridge'
  amount: string
  token: string
  destination?: string
  status: 'pending' | 'approved' | 'rejected'
  createdAt: string
  agentKey?: string
}

export interface Activity {
  id: string
  type: string
  amount?: string
  token?: string
  txHash?: string
  timestamp: string
  agentKey?: string
}

export interface Credential {
  id: string
  type: string
  address: string
  label?: string
}

export interface Limits {
  dailyLimit: string
  perTxLimit: string
  spent: string
}

export interface PendingTx {
  id: string
  type: string
  amount: string
  token: string
  status: string
}

// ── Connection Token ──

export interface AgentConnectionToken {
  token: string
  agentKey: string
  clientName: string
  expiresAt: string
  setupMessage?: string
}

// ── Owner Card ──

export interface OwnerAgentCard {
  id: string
  label: string
  last4: string
  agentKey: string
}

export interface AgentCardDraft {
  cardId: string
  maxPerTx: string
  daily: string
}

// ── Wallet Types ──

export interface AgentWalletEntry {
  address: string
  label: string
  live: boolean
}

// ── MSCA State ──

export interface MscaState {
  walletAddress: string
  delegateAddress: string
  sessionActive: boolean
  deployed: boolean
  deploymentStatus: Record<string, {
    status: ChainDeployStatus
    userOpHash?: string
    error?: string
    timestamp?: string
  }>
  chainAuthorizationStatus: Record<string, ChainAuthStatus>
}

// ── Agent Config (for UI) ──

export interface AgentConfig {
  icon: string
  color: string
  name: string
  description: string
}

export const AGENT_CONFIGS: Record<AgentType, AgentConfig> = {
  claude: {
    icon: '🟠',
    color: '#f97316',
    name: 'Claude',
    description: 'Anthropic AI Assistant',
  },
  chatgpt: {
    icon: '🟢',
    color: '#22c55e',
    name: 'ChatGPT',
    description: 'OpenAI Assistant',
  },
  hermes: {
    icon: '🟣',
    color: '#a855f7',
    name: 'Hermes',
    description: 'Arcox MCP Agent',
  },
  custom: {
    icon: '🔵',
    color: '#3b82f6',
    name: 'Custom Agent',
    description: 'Custom MCP Connection',
  },
}

export const AGENT_KEYS = {
  claude: 'oauth:claude',
  chatgpt: 'oauth:chatgpt',
  hermes: 'hermes-mcp',
} as const

export const SUPPORTED_CHAINS = ['arc-testnet', 'base-sepolia', 'arbitrum-sepolia'] as const
export type SupportedChain = (typeof SUPPORTED_CHAINS)[number]

export const MCP_URL = 'https://arcoxdex.vercel.app/mcp'
