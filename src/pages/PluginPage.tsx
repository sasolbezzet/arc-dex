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
  const [addressCopySuccess, setAddressCopySuccess] = useState(false);
  const [activeTab, setActiveTab] = useState<'agents' | 'active' | 'approvals' | 'activity'>('agents');

  // Stores
  const vaultToken = useAuthStore(state => state.vaultToken);
  const hermesWalletAddress = useAuthStore(state => state.hermesWalletAddress);
  const jwtAddress = useAuthStore(state => state.jwtAddress);
  const logout = useAuthStore(state => state.logout);
  const disconnectWallet = useWalletStore(state => state.disconnect);

  const activeAgentsCount = agents.filter(a => a.status === 'connected').length;
  const isAnyWalletReady = !!vaultToken || !!hermesWalletAddress || !!jwtAddress || activeAgentsCount > 0;
  const pendingApprovalsCount = approvals?.length || 0;

  const handleCopyMCPUrl = useCallback(() => {
    navigator.clipboard.writeText(MCP_URL);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  }, []);

  const handleCopyAddress = useCallback((address: string) => {
    navigator.clipboard.writeText(address);
    setAddressCopySuccess(true);
    setTimeout(() => setAddressCopySuccess(false), 2000);
  }, []);

  const handleReset = () => {
    logout();
    disconnectWallet();
  };

  const filteredAgents = activeTab === 'active' ? agents.filter(a => a.status === 'connected') : agents;

  return (
    <div className="relative min-h-screen bg-[#0B0E14] text-slate-100 overflow-hidden font-sans">
      {/* Ambient Cyberpunk Background */}
      <div className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-gradient-to-tr from-indigo-600/20 via-purple-600/15 to-emerald-500/10 blur-[120px] rounded-full" />
      
      <div className="container mx-auto p-6 space-y-10 relative z-10 max-w-7xl">
        {/* Error Banner */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-4 rounded-xl flex items-center justify-between backdrop-blur-md shadow-lg shadow-red-500/5">
            <span className="font-medium flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
              {error}
            </span>
          </div>
        )}

        {/* Header Hero Section */}
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 pb-6 border-b border-slate-800">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-800/50 border border-slate-700/50 backdrop-blur-sm text-xs font-semibold tracking-widest text-slate-300">
              <span className="text-emerald-400">⚡</span> ARCOX AGENT MESH v2.0 &bull; CIRCLE MSCA POWERED
            </div>
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 via-purple-400 to-emerald-400 drop-shadow-sm">
              AI Agent & Plugin Terminal
            </h1>
            <p className="text-slate-400 text-lg max-w-2xl font-medium">
              Command central for orchestrating autonomous AI assistants. Manage secure multi-chain operations through your connected MSCA Hub.
            </p>
          </div>
          
          <div className="flex flex-col items-end gap-3">
            {/* Status & Live Network Counters */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2.5 bg-slate-800/60 border border-slate-700/80 rounded-lg px-4 py-2 backdrop-blur-md shadow-inner">
                <div className="relative flex h-2.5 w-2.5">
                  {activeAgentsCount > 0 ? (
                    <>
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                    </>
                  ) : (
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-slate-500"></span>
                  )}
                </div>
                <span className="text-sm font-bold text-slate-200">
                  {activeAgentsCount} <span className="text-slate-400 font-medium">Agents Online</span>
                </span>
              </div>
              
              {jwtAddress && (
                <div 
                  onClick={() => handleCopyAddress(jwtAddress)}
                  className="flex items-center gap-2 bg-slate-800/60 border border-slate-700/80 rounded-lg px-4 py-2 backdrop-blur-md cursor-pointer hover:bg-slate-700/60 transition-colors shadow-inner"
                  title="Copy MSCA Hub Address"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" className="text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
                  <span className="text-sm font-mono text-slate-300">
                    {addressCopySuccess ? 'Copied!' : `${jwtAddress.slice(0, 6)}...${jwtAddress.slice(-4)}`}
                  </span>
                </div>
              )}
            </div>

            {isAnyWalletReady && (
              <button 
                onClick={handleReset}
                className="group flex items-center gap-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg transition-all text-sm font-bold shadow-lg shadow-red-500/5 hover:shadow-red-500/10"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" className="group-hover:rotate-90 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path><line x1="12" y1="2" x2="12" y2="12"></line></svg>
                KILL SWITCH
              </button>
            )}
          </div>
        </div>

        {/* MCP RPC Terminal Box */}
        <div className="bg-gradient-to-r from-slate-900 via-slate-800/80 to-slate-900 border border-slate-700/60 rounded-2xl p-1 shadow-2xl">
          <div className="bg-black/60 rounded-xl p-5 md:p-6 backdrop-blur-xl border border-white/5 relative overflow-hidden">
            {/* Decorative background grid for terminal */}
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:14px_24px] pointer-events-none"></div>
            
            <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-xs font-bold tracking-wider">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                    ONLINE
                  </div>
                  <h2 className="text-lg font-bold text-slate-100 font-mono tracking-tight flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" className="text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect><rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect><line x1="6" y1="6" x2="6.01" y2="6"></line><line x1="6" y1="18" x2="6.01" y2="18"></line></svg>
                    MCP RPC ENDPOINT
                  </h2>
                </div>
                <p className="text-sm text-slate-400 font-medium">
                  Route your AI agent's tool calls through this endpoint to securely sign and execute transactions.
                </p>
              </div>
              
              <div className="flex items-center bg-[#0a0a0f] border border-slate-700 rounded-lg p-1.5 shadow-inner min-w-[320px] max-w-full group">
                <div className="flex-1 px-3 py-2 text-indigo-300 font-mono text-sm overflow-x-auto whitespace-nowrap scrollbar-hide">
                  {MCP_URL}
                </div>
                <button 
                  onClick={handleCopyMCPUrl}
                  className={`flex items-center justify-center gap-2 px-4 py-2 rounded-md font-bold text-xs transition-all ${
                    copySuccess 
                      ? 'bg-emerald-500 text-white shadow-[0_0_15px_rgba(16,185,129,0.4)]' 
                      : 'bg-slate-800 hover:bg-indigo-600 text-slate-300 hover:text-white border border-slate-700 hover:border-indigo-500'
                  }`}
                >
                  {copySuccess ? (
                    <><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> COPIED</>
                  ) : (
                    <><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg> COPY RPC</>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Navigation Tabs / Filter */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-hide border-b border-slate-800">
          <button 
            onClick={() => setActiveTab('agents')}
            className={`px-5 py-2.5 rounded-t-lg font-bold text-sm whitespace-nowrap transition-colors border-b-2 ${
              activeTab === 'agents' ? 'text-indigo-400 border-indigo-400 bg-indigo-500/10' : 'text-slate-400 border-transparent hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            All Agents ({AGENT_TYPES.length})
          </button>
          <button 
            onClick={() => setActiveTab('active')}
            className={`px-5 py-2.5 rounded-t-lg font-bold text-sm whitespace-nowrap transition-colors border-b-2 ${
              activeTab === 'active' ? 'text-emerald-400 border-emerald-400 bg-emerald-500/10' : 'text-slate-400 border-transparent hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            Active ({activeAgentsCount})
          </button>
          <button 
            onClick={() => setActiveTab('approvals')}
            className={`px-5 py-2.5 rounded-t-lg font-bold text-sm whitespace-nowrap transition-colors border-b-2 flex items-center gap-2 ${
              activeTab === 'approvals' ? 'text-amber-400 border-amber-400 bg-amber-500/10' : 'text-slate-400 border-transparent hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            Pending Approvals 
            {pendingApprovalsCount > 0 && (
              <span className="bg-amber-500 text-amber-950 text-xs px-2 py-0.5 rounded-full">{pendingApprovalsCount}</span>
            )}
          </button>
          <button 
            onClick={() => setActiveTab('activity')}
            className={`px-5 py-2.5 rounded-t-lg font-bold text-sm whitespace-nowrap transition-colors border-b-2 ${
              activeTab === 'activity' ? 'text-purple-400 border-purple-400 bg-purple-500/10' : 'text-slate-400 border-transparent hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            Activity Log
          </button>
        </div>

        {/* Tab Content */}
        <div className="min-h-[400px]">
          {(activeTab === 'agents' || activeTab === 'active') && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
              {AGENT_TYPES.map(type => {
                const agentState = agents.find(a => a.agentType === type);
                // In 'active' tab, only show connected agents
                if (activeTab === 'active' && agentState?.status !== 'connected') {
                  return null;
                }
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
              {activeTab === 'active' && activeAgentsCount === 0 && (
                <div className="col-span-full py-12 text-center border border-dashed border-slate-700 rounded-2xl bg-slate-800/20 flex flex-col items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" className="text-slate-500 mb-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a10 10 0 1 0 10 10H12V2z"></path><path d="M12 12 2.1 7.1"></path><path d="M12 12l9.9 4.9"></path></svg>
                  <h3 className="text-lg font-bold text-slate-300">No Active Agents</h3>
                  <p className="text-slate-500 mt-2 max-w-md">Connect an agent from the All Agents tab to monitor its activity here.</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'approvals' && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="bg-slate-800/40 border border-slate-700/60 rounded-2xl p-6 md:p-8 backdrop-blur-xl shadow-xl">
                <div className="flex items-center justify-between mb-8">
                  <h3 className="text-2xl font-bold text-slate-100 flex items-center gap-3">
                    <span className="p-2 bg-amber-500/20 text-amber-400 rounded-lg border border-amber-500/30">
                      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
                    </span>
                    Security & Approvals
                  </h3>
                </div>
                
                {pendingApprovalsCount > 0 ? (
                  <ApprovalsList 
                    approvals={approvals} 
                    onApprove={(id) => approveRequest ? approveRequest(id) : console.log('approve', id)} 
                    onReject={(id) => rejectRequest ? rejectRequest(id) : console.log('reject', id)} 
                  />
                ) : (
                  <div className="text-center py-16 border border-dashed border-slate-700 rounded-xl bg-slate-900/30">
                    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" className="mx-auto text-slate-600 mb-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                    <p className="text-slate-400 font-medium text-lg">All caught up! No pending transactions to approve.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'activity' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="lg:col-span-2 bg-slate-800/40 border border-slate-700/60 rounded-2xl p-6 backdrop-blur-xl shadow-xl">
                <h3 className="text-xl font-bold text-slate-200 mb-6 flex items-center gap-3 pb-4 border-b border-slate-700/50">
                  <span className="p-2 bg-indigo-500/20 text-indigo-400 rounded-lg border border-indigo-500/30">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
                  </span>
                  Live Feed
                </h3>
                <AgentActivityList activities={activity} />
              </div>
              
              <div className="bg-slate-800/40 border border-slate-700/60 rounded-2xl p-6 backdrop-blur-xl shadow-xl h-fit">
                <h3 className="text-xl font-bold text-slate-200 mb-6 flex items-center gap-3 pb-4 border-b border-slate-700/50">
                  <span className="p-2 bg-purple-500/20 text-purple-400 rounded-lg border border-purple-500/30">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path></svg>
                  </span>
                  Credentials
                </h3>
                <div className="space-y-4">
                  {agents.filter(a => a.walletAddress).map(agent => (
                    <div key={agent.agentKey} className="p-4 bg-slate-900/50 rounded-xl border border-slate-700/80 shadow-inner">
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-xs uppercase tracking-widest text-slate-400 font-bold bg-slate-800 px-2 py-1 rounded">{agent.agentType}</span>
                      </div>
                      <AgentWalletSummary walletAddress={agent.walletAddress} />
                    </div>
                  ))}
                  {agents.filter(a => a.walletAddress).length === 0 && (
                    <div className="text-slate-500 text-sm italic p-6 text-center border border-dashed border-slate-700 rounded-xl bg-slate-900/30">
                      {t('plugin.noCredentials', 'No active credentials. Connect an agent to see their summary.')}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
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

