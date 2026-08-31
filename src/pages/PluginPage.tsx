import React, { useState, useCallback, useRef } from 'react';
import { useAgentManager } from '../hooks/useAgentManager';
import { useAuthStore } from '../stores/authStore';
import { useAgentStore } from '../stores/agentStore';
import { AgentDashboardCard } from '../features/plugin/AgentDashboardCard';
import { OnboardingStepper } from '../features/plugin/OnboardingStepper';
import { ApprovalsList } from '../features/plugin/ApprovalsList';
import { RevokeModal } from '../features/plugin/RevokeModal';
import { ConnectionTokenDialog } from '../features/plugin/ConnectionTokenDialog';
import { type AgentType, type AgentState, MCP_URL, AGENT_CONFIGS } from '../types/agent';

const AGENT_TYPES = ['hermes', 'claude', 'chatgpt'] as const;

export default function PluginPage() {
  const {
    agents,
    approvals,
    activity,
    connectionToken,
    setConnectionToken,
    quickConnect,
    loginAgent,
    revokeAgent,
    createToken,
    refreshAll,
    approveRequest,
    rejectRequest,
    loading,
    error
  } = useAgentManager();

  const [expandedAgent, setExpandedAgent] = useState<AgentType | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<AgentState | null>(null);

  // Derive wallet ready state from stores
  const vaultToken = useAuthStore(state => state.vaultToken);
  const hermesWalletAddress = useAuthStore(state => state.hermesWalletAddress);
  const jwtAddress = useAuthStore(state => state.jwtAddress);

  const activeWalletAddress = hermesWalletAddress || agents.find(a => !!a.walletAddress)?.walletAddress || jwtAddress || undefined;
  const walletReady = !!vaultToken || !!hermesWalletAddress || agents.some(a => a.status === 'connected');
  const agentsReady = agents.some(a => a.status === 'connected');

  const handleCopyMCPUrl = useCallback(() => {
    navigator.clipboard.writeText(MCP_URL);
  }, []);

  return (
    <div className="container mx-auto p-6 space-y-8">
      {error && (
        <div className="bg-red-500/10 border border-red-500 text-red-500 p-4 rounded-lg flex items-center justify-between">
          <span>{error}</span>
        </div>
      )}

      {!walletReady && (
        <OnboardingStepper 
          walletReady={walletReady}
          walletAddress={activeWalletAddress}
          agentsReady={agentsReady}
          agentCount={agents.filter(a => a.status === 'connected').length}
          onCreateWallet={() => quickConnect('dashboard:primary' as any)} 
          onLoginWallet={() => loginAgent('dashboard:primary')}
          onScrollToAgents={() => {
            const agentsSection = document.getElementById('agents-section');
            if (agentsSection) agentsSection.scrollIntoView({ behavior: 'smooth' });
          }}
        />
      )}

      {walletReady && (
        <>
          <div className="bg-white/5 border border-white/10 rounded-xl p-6 backdrop-blur-md">
            <h2 className="text-xl font-semibold text-white mb-4">MCP Server Configuration</h2>
            <div className="flex items-center gap-4">
              <code className="flex-1 bg-black/40 px-4 py-2 rounded-lg text-green-400 font-mono text-sm">
                {MCP_URL}
              </code>
              <button 
                onClick={handleCopyMCPUrl}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                Copy URL
              </button>
            </div>
            <p className="text-sm text-gray-400 mt-2">
              Add this URL to your MCP-compatible client configuration to connect.
            </p>
          </div>

          <div id="agents-section">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                Agent Connections
                <span className="bg-blue-600 text-xs py-1 px-2.5 rounded-full">
                  {agents.filter(a => a.status === 'connected').length} Active
                </span>
              </h2>
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {AGENT_TYPES.map(type => {
                const agentState = agents.find(a => a.agentType === type);
                return (
                  <AgentDashboardCard
                    key={type}
                    agentType={type as AgentType}
                    agent={agentState}
                    expanded={expandedAgent === type}
                    onToggle={() => setExpandedAgent(prev => prev === type ? null : type)}
                    onLogin={() => loginAgent(type as AgentType)}
                    onQuickConnect={() => quickConnect(type as AgentType)}
                    onRevoke={() => agentState && setRevokeTarget(agentState)}
                    onCreateToken={() => createToken(type as AgentType)}
                  />
                );
              })}
            </div>
          </div>

          <ApprovalsList 
            approvals={approvals} 
            onApprove={(id) => approveRequest ? approveRequest(id) : console.log('approve', id)} 
            onReject={(id) => rejectRequest ? rejectRequest(id) : console.log('reject', id)} 
          />
        </>
      )}

      {connectionToken && (
        <ConnectionTokenDialog token={connectionToken} onClose={() => setConnectionToken && setConnectionToken(null)} />
      )}

      {revokeTarget && (
        <RevokeModal
          agent={revokeTarget}
          onConfirm={() => {
            revokeAgent(revokeTarget.agentKey);
            setRevokeTarget(null);
          }}
          onCancel={() => setRevokeTarget(null)}
        />
      )}
    </div>
  );
}
