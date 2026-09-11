import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  AgentState,
  McpSession,
  Approval,
  Activity,
  AgentConnectionToken,
  AgentType,
} from '../types/agent';

function isGenericAgentLabel(agent: AgentState): boolean {
  const label = String(agent.clientName || '').trim().toLowerCase();
  return !label || label === 'agent mcp' || label === 'mcp-agent' || label === 'mcp agent';
}

function mergeTransientAgentState(previous: AgentState, next: AgentState): AgentState {
  return {
    ...next,
    balances: next.balances ?? previous.balances,
    balanceChain: next.balanceChain ?? previous.balanceChain,
    balance: next.balance ?? previous.balance,
    balanceUpdatedAt: next.balanceUpdatedAt ?? previous.balanceUpdatedAt,
    readiness: next.readiness ?? previous.readiness,
    readinessLoading: next.readinessLoading ?? previous.readinessLoading,
  };
}

export function mergeAgentBalance(
  agent: AgentState,
  chain: AgentState['balanceChain'],
  balance: Record<string, string> | null,
  updatedAt = Date.now(),
): AgentState {
  if (!chain) return agent
  return {
    ...agent,
    balance,
    balanceChain: chain,
    balances: { ...(agent.balances || {}), [chain]: balance },
    balanceUpdatedAt: updatedAt,
  }
}

function deduplicateAgents(agents: AgentState[], previousAgents: AgentState[] = []): AgentState[] {
  const previousByKey = new Map(previousAgents.map(agent => [agent.agentKey, agent]));
  const result = new Map<string, AgentState>();
  for (const rawAgent of agents) {
    const agent = previousByKey.has(rawAgent.agentKey)
      ? mergeTransientAgentState(previousByKey.get(rawAgent.agentKey)!, rawAgent)
      : rawAgent;
    const wallet = String(agent.walletAddress || '').trim().toLowerCase();
    const clientId = String(agent.clientId || agent.agentKey || '').split('|')[0].replace(/^oauth:/, '').toLowerCase();
    const key = /^0x[0-9a-f]{40}$/.test(wallet)
      ? `client:${clientId}|wallet:${wallet}`
      : `key:${agent.agentKey}`;
    const previous = result.get(key);
    if (!previous || (isGenericAgentLabel(previous) && !isGenericAgentLabel(agent))) {
      result.set(key, agent);
    }
  }
  return [...result.values()];
}

export interface AgentStoreState {
  agents: AgentState[];
  mcpSessions: McpSession[];
  approvals: Approval[];
  activity: Activity[];
  connectionToken: AgentConnectionToken | null;
  expandedAgentKey: string | null;
  agentAction: string | null;

  setAgents: (agents: AgentState[]) => void;
  updateAgent: (agentKey: string, patch: Partial<AgentState>) => void;
  updateAgentBalance: (agentKey: string, chain: AgentState['balanceChain'], balance: Record<string, string> | null) => void;
  removeAgent: (agentKey: string) => void;
  setMcpSessions: (sessions: McpSession[]) => void;
  setApprovals: (approvals: Approval[]) => void;
  setActivity: (activity: Activity[]) => void;
  setConnectionToken: (token: AgentConnectionToken | null) => void;
  setExpandedAgentKey: (key: string | null) => void;
  setAgentAction: (action: string | null) => void;
  getAgentByType: (type: AgentType) => AgentState | undefined;
}

export const useAgentStore = create<AgentStoreState>()(
  persist(
    (set, get) => ({
      agents: [],
      mcpSessions: [],
      approvals: [],
      activity: [],
      connectionToken: null,
      expandedAgentKey: null,
      agentAction: null,

      setAgents: (agents) => set((state) => ({ agents: deduplicateAgents(agents, state.agents) })),
      updateAgent: (agentKey, patch) =>
        set((state) => ({
          agents: state.agents.map((a) =>
            a.agentKey === agentKey ? { ...a, ...patch } : a
          ),
        })),
      updateAgentBalance: (agentKey, chain, balance) =>
        set((state) => ({
          agents: state.agents.map((agent) =>
            agent.agentKey === agentKey ? mergeAgentBalance(agent, chain, balance) : agent
          ),
        })),
      removeAgent: (agentKey) =>
        set((state) => ({
          agents: state.agents.filter((a) => a.agentKey !== agentKey),
        })),
      setMcpSessions: (mcpSessions) => set({ mcpSessions }),
      setApprovals: (approvals) => set({ approvals }),
      setActivity: (activity) => set({ activity }),
      setConnectionToken: (connectionToken) => set({ connectionToken }),
      setExpandedAgentKey: (expandedAgentKey) => set({ expandedAgentKey }),
      setAgentAction: (agentAction) => set({ agentAction }),
      getAgentByType: (type) => get().agents.find((a) => a.agentType === type),
    }),
    {
      name: 'arx-agents',
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<AgentStoreState>;
        return {
          ...currentState,
          ...persisted,
          agents: deduplicateAgents(persisted.agents || [], currentState.agents || []),
        };
      },
      partialize: (state) => ({
        agents: state.agents.map((agent) => {
          // Do not persist any transient session fields.
          return agent as AgentState;
        }),
      }),
    }
  )
);
