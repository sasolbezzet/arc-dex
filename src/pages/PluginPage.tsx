import React, { useState, useCallback } from 'react';
import { useI18n } from '../i18n';
import { useAgentManager } from '../hooks/useAgentManager';
import { useAuthStore } from '../stores/authStore';
import { useWalletStore } from '../stores/walletStore';
import { useAgentStore } from '../stores/agentStore';

import { AgentDashboardCard } from '../features/plugin/AgentDashboardCard';
import { OnboardingStepper } from '../features/plugin/OnboardingStepper';
import { ApprovalsList } from '../features/plugin/ApprovalsList';
import { RevokeModal } from '../features/plugin/RevokeModal';
import { ConnectionTokenDialog } from '../features/plugin/ConnectionTokenDialog';
import { AgentActivityList } from '../features/plugin/AgentActivityList';
import { AgentStatusBadge } from '../features/plugin/AgentStatusBadge';
import { AgentWalletSummary } from '../features/plugin/AgentWalletSummary';

import { type AgentType, type AgentState, MCP_URL, AGENT_CONFIGS } from '../types/agent';

const AGENT_TYPES = ['hermes', 'claude', 'chatgpt'] as const;

export default function PluginPage() {
  const { t } = useI18n();
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
    approveRequest,
    rejectRequest,
    error
  } = useAgentManager();

  const [expandedAgent, setExpandedAgent] = useState<AgentType | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<AgentState | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);

  // Stores
  const vaultToken = useAuthStore(state => state.vaultToken);
  const hermesWalletAddress = useAuthStore(state => state.hermesWalletAddress);
  const jwtAddress = useAuthStore(state => state.jwtAddress);
  const logout = useAuthStore(state => state.logout);
  const disconnectWallet = useWalletStore(state => state.disconnect);

  const activeAgentsCount = agents.filter(a => a.status === 'connected').length;
  const isAnyWalletReady = !!vaultToken || !!hermesWalletAddress || !!jwtAddress || activeAgentsCount > 0;

  const handleCopyMCPUrl = useCallback(() => {
    navigator.clipboard.writeText(MCP_URL);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  }, []);

  const handleReset = () => {
    logout();
    disconnectWallet();
  };

  return (
    <div className="container mx-auto p-6 space-y-8 min-h-screen text-slate-100">
      {/* Error Banner */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-4 rounded-xl flex items-center justify-between backdrop-blur-md">
          <span>{error}</span>
        </div>
      )}

      {/* Top Section */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-emerald-400">
            {t('plugin.title', 'Agent & Plugin Dashboard')}
          </h1>
          <p className="text-slate-400 mt-1">{t('plugin.subtitle', 'Manage your AI assistants and their permissions')}</p>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-slate-800/50 border border-slate-700 rounded-full px-4 py-2 backdrop-blur-sm">
            <span className="relative flex h-3 w-3">
              {activeAgentsCount > 0 ? (
                <>
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                </>
              ) : (
                <span className="relative inline-flex rounded-full h-3 w-3 bg-slate-500"></span>
              )}
            </span>
            <span className="text-sm font-medium text-slate-300">
              {activeAgentsCount} {t('plugin.activeAgents', 'Active Agents')}
            </span>
          </div>
          
          {isAnyWalletReady && (
            <button 
              onClick={handleReset}
              className="flex items-center gap-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-lg transition-colors text-sm font-medium"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
              {t('plugin.disconnect', 'Disconnect All')}
            </button>
          )}
        </div>
      </div>

      {/* Connection Status Bar */}
      <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-4 backdrop-blur-md flex flex-wrap items-center gap-6">
        <span className="text-sm font-medium text-slate-400 uppercase tracking-wider">{t('plugin.systemStatus', 'System Status')}</span>
        <div className="flex flex-wrap gap-4">
          {AGENT_TYPES.map(type => {
            const agent = agents.find(a => a.agentType === type);
            return (
              <div key={type} className="flex items-center gap-2">
                <span className="text-sm text-slate-300 capitalize">{type}</span>
                <AgentStatusBadge status={agent?.status || 'disconnected'} />
              </div>
            );
          })}
        </div>
      </div>

      {/* MCP Server Configuration */}
      <div className="bg-gradient-to-br from-slate-800/80 to-slate-900/80 border border-slate-700 rounded-2xl p-6 backdrop-blur-md shadow-xl">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold text-white mb-2 flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" className="text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
              {t('plugin.mcpConfig', 'MCP Server Configuration')}
            </h2>
            <p className="text-sm text-slate-400 max-w-2xl">
              {t('plugin.mcpDescription', 'Connect your local or cloud MCP clients to this URL to enable AI agents to interact with your Arc DEX account securely.')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4 bg-black/40 border border-slate-700/50 p-2 rounded-xl">
          <code className="flex-1 px-4 py-2 text-emerald-400 font-mono text-sm overflow-x-auto whitespace-nowrap">
            {MCP_URL}
          </code>
          <button 
            onClick={handleCopyMCPUrl}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-lg font-medium transition-all ${
              copySuccess 
                ? 'bg-emerald-500 text-white' 
                : 'bg-blue-600 hover:bg-blue-500 text-white'
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            {copySuccess ? t('plugin.copied', 'Copied!') : t('plugin.copyUrl', 'Copy URL')}
          </button>
        </div>
      </div>

      {/* Instructions / Guidance Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-6 backdrop-blur-md hover:bg-slate-800/60 transition-colors">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" className="text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>
            </div>
            <h3 className="text-lg font-semibold text-slate-200">{t('plugin.cliFlow', 'Hermes CLI Flow')}</h3>
          </div>
          <p className="text-slate-400 text-sm leading-relaxed">
            {t('plugin.cliFlowDesc', 'The Hermes agent runs locally via CLI. Generate a connection token here, then run the Hermes CLI with the token to establish a secure WebSocket connection. Your private keys never leave your machine.')}
          </p>
        </div>

        <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-6 backdrop-blur-md hover:bg-slate-800/60 transition-colors">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-purple-500/20 rounded-lg">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" className="text-purple-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
            </div>
            <h3 className="text-lg font-semibold text-slate-200">{t('plugin.oauthFlow', 'Cloud OAuth Flow')}</h3>
          </div>
          <p className="text-slate-400 text-sm leading-relaxed">
            {t('plugin.oauthFlowDesc', 'Claude and ChatGPT use standard OAuth flows. Click connect to authorize them, which creates a secure delegated token. You can review and approve individual transactions they propose.')}
          </p>
        </div>
      </div>

      {/* Agent Grid */}
      <div className="space-y-4">
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          {t('plugin.agents', 'Available Agents')}
        </h2>
        
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

      {/* Bottom Sections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 pt-4">
        {/* Approvals & Activity */}
        <div className="space-y-8">
          {approvals && approvals.length > 0 && (
            <div className="bg-slate-800/30 border border-amber-500/20 rounded-2xl p-6 backdrop-blur-md">
              <h3 className="text-xl font-semibold text-amber-400 mb-4 flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                {t('plugin.pendingApprovals', 'Pending Approvals')}
              </h3>
              <ApprovalsList 
                approvals={approvals} 
                onApprove={(id) => approveRequest ? approveRequest(id) : console.log('approve', id)} 
                onReject={(id) => rejectRequest ? rejectRequest(id) : console.log('reject', id)} 
              />
            </div>
          )}

          <div className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-6 backdrop-blur-md">
            <h3 className="text-xl font-semibold text-slate-200 mb-4 flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" className="text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
              {t('plugin.activityFeed', 'Live MCP Sessions & Activity')}
            </h3>
            <AgentActivityList activities={activity} />
          </div>
        </div>

        {/* Credentials & API Keys */}
        <div className="space-y-8">
          <div className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-6 backdrop-blur-md">
            <h3 className="text-xl font-semibold text-slate-200 mb-4 flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" className="text-purple-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path></svg>
              {t('plugin.credentials', 'Credentials & Summaries')}
            </h3>
            <div className="space-y-4">
              {agents.filter(a => a.walletAddress).map(agent => (
                <div key={agent.agentKey} className="p-4 bg-black/20 rounded-lg border border-slate-700">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs uppercase tracking-wider text-slate-400 font-semibold">{agent.agentType} Agent</span>
                  </div>
                  <AgentWalletSummary walletAddress={agent.walletAddress} />
                </div>
              ))}
              {agents.filter(a => a.walletAddress).length === 0 && (
                <div className="text-slate-500 text-sm italic p-4 text-center border border-dashed border-slate-700 rounded-lg">
                  {t('plugin.noCredentials', 'No active credentials. Connect an agent to see their summary.')}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
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
