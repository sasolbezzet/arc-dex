import { safePost } from '../api'

export type AgentIdentity = {
  agentId: string
  ownerWallet: string
  metadataUri: string
  registry: string
  network: string
}

export async function listAgentIdentities(ownerAddress: string, refresh = false) {
  const response = await fetch(`/api/ai-router/agent-identities?ownerAddress=${encodeURIComponent(ownerAddress)}&refresh=${refresh}`)
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`)
  return data as { identities: AgentIdentity[]; activeAgentIdentity: AgentIdentity | null }
}

export async function selectAgentIdentity(ownerAddress: string, agentId: string) {
  return safePost('', '/api/ai-router/agent-identities/select', { ownerAddress, agentId }) as Promise<{ activeAgentIdentity: AgentIdentity }>
}
