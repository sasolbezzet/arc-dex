import { useState, useCallback, useEffect, useRef } from 'react';
import { useAgentStore } from '../stores/agentStore';
import { useAuthStore } from '../stores/authStore';
import {
  listVaultAgents,
  createConnectionToken,
  revokeVaultAgent,
  getVaultSessions,
  getVaultApprovals,
  getVaultActivity
} from '../api/vaultApi';
import { registerPasskey, loginPasskey, deployAllSmartAccounts } from '../services/modularWallet';
import { type AgentState, type AgentType, type AgentConnectionToken, AGENT_KEYS } from '../types/agent';

export function useAgentManager() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    return () => {
      mounted.current = false;
    };
  }, []);

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
  } = useAgentStore();

  const { vaultToken, hermesToken } = useAuthStore();

  const refreshAll = useCallback(async () => {
    if (!vaultToken) return;

    try {
      const results = await Promise.allSettled([
        listVaultAgents(vaultToken),
        getVaultSessions(vaultToken),
        getVaultApprovals(vaultToken),
        getVaultActivity(vaultToken),
      ]);

      if (results[0].status === 'fulfilled') {
        const vaultAgents = results[0].value;
        const mappedAgents: AgentState[] = vaultAgents.map((agent: any) => {
          let agentType: AgentType = 'custom';
          if (agent.agentKey === AGENT_KEYS.claude) agentType = 'claude';
          else if (agent.agentKey === AGENT_KEYS.chatgpt) agentType = 'chatgpt';
          else if (agent.agentKey === AGENT_KEYS.hermes) agentType = 'hermes';
          
          return {
            ...agent,
            agentType,
          };
        });
        setAgents(mappedAgents);
      }
      
      if (results[1].status === 'fulfilled') {
        setMcpSessions(results[1].value);
      }
      
      if (results[2].status === 'fulfilled') {
        setApprovals(results[2].value);
      }
      
      if (results[3].status === 'fulfilled') {
        setActivity(results[3].value);
      }
    } catch (err: any) {
      console.error('Failed to refresh agent manager data', err);
    }
  }, [vaultToken, setAgents, setMcpSessions, setApprovals, setActivity]);

  const quickConnect = useCallback(async (agentType: AgentType, agentName?: string) => {
    setLoading(true);
    setError(null);
    try {
      const agentKey = AGENT_KEYS[agentType as keyof typeof AGENT_KEYS] || agentType;
      await registerPasskey(agentKey);
      await deployAllSmartAccounts(agentKey);
      await refreshAll();
    } catch (err: any) {
      if (mounted.current) setError(err.message || 'Failed to quick connect agent');
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [refreshAll]);

  const loginAgent = useCallback(async (agentKeyOrType: string) => {
    setLoading(true);
    setError(null);
    try {
      const agentKey = AGENT_KEYS[agentKeyOrType as keyof typeof AGENT_KEYS] || agentKeyOrType;
      await loginPasskey(agentKey);
      await deployAllSmartAccounts(agentKey);
      await refreshAll();
    } catch (err: any) {
      if (mounted.current) setError(err.message || 'Failed to login agent');
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [refreshAll]);

  const revokeAgent = useCallback(async (agentKey: string) => {
    if (!vaultToken) {
      if (mounted.current) setError('No vault token available');
      return;
    }
    
    setLoading(true);
    setError(null);
    try {
      await revokeVaultAgent(agentKey, vaultToken);
      removeAgent(agentKey);
      await refreshAll();
    } catch (err: any) {
      if (mounted.current) setError(err.message || 'Failed to revoke agent');
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [vaultToken, removeAgent, refreshAll]);

  const createToken = useCallback(async (agentKeyOrType: string, clientName?: string) => {
    const token = vaultToken || hermesToken;
    if (!token) {
      if (mounted.current) setError('No token available');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const agentKey = AGENT_KEYS[agentKeyOrType as keyof typeof AGENT_KEYS] || agentKeyOrType;
      const connToken = await createConnectionToken(agentKey, clientName, token);
      setConnectionToken(connToken);
    } catch (err: any) {
      if (mounted.current) setError(err.message || 'Failed to create connection token');
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [vaultToken, hermesToken, setConnectionToken]);

  useEffect(() => {
    if (!vaultToken) return;
    
    refreshAll();
    
    const interval = setInterval(() => {
      refreshAll();
    }, 8000);
    
    return () => clearInterval(interval);
  }, [vaultToken, refreshAll]);

  return {
    agents,
    mcpSessions,
    approvals,
    activity,
    connectionToken,
    loading,
    error,
    quickConnect,
    loginAgent,
    revokeAgent,
    createToken,
    refreshAll
  };
}
