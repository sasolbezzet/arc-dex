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

function deduplicateAgents(agents: AgentState[]): AgentState[] {
  const result = new Map<string, AgentState>();
  for (const agent of agents) {
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

      setAgents: (agents) => set({ agents: deduplicateAgents(agents) }),
      updateAgent: (agentKey, patch) =>
        set((state) => ({
          agents: state.agents.map((a) =>
            a.agentKey === agentKey ? { ...a, ...patch } : a
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
          agents: deduplicateAgents(persisted.agents || []),
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
