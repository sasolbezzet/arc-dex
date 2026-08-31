import React, { useState } from 'react';
import { type AgentState, type AgentType, AGENT_CONFIGS, SUPPORTED_CHAINS } from '../../types/agent';
import { AgentWalletSummary } from './AgentWalletSummary';

export interface AgentDashboardCardProps {
  agentType: AgentType;
  agent: AgentState | undefined;
  expanded: boolean;
  onToggle: () => void;
  onQuickConnect: () => void;
  onLogin: () => void;
  onRevoke: () => void;
  onCreateToken: () => void;
  loading?: boolean;
  actionLabel?: string;
}

const getConnectionTypeTag = (type: AgentType) => {
  if (type === 'hermes') return 'CLI / MCP Server';
  if (type === 'custom') return 'Custom / MCP';
  return 'OAuth 2.0 / MCP';
};

const getThemeClasses = (type: AgentType) => {
  switch (type) {
    case 'hermes': return 'bg-gradient-to-br from-[#161224]/90 to-[#0f0e1a]/95 border-purple-500/30 hover:border-purple-400/70 hover:shadow-[0_0_30px_rgba(88,28,135,0.4)] shadow-xl';
    case 'claude': return 'bg-gradient-to-br from-[#1f1612]/90 to-[#120e0d]/95 border-orange-500/30 hover:border-orange-400/70 hover:shadow-[0_0_30px_rgba(154,52,18,0.4)] shadow-xl';
    case 'chatgpt': return 'bg-gradient-to-br from-[#0f1f18]/90 to-[#0c1410]/95 border-emerald-500/30 hover:border-emerald-400/70 hover:shadow-[0_0_30px_rgba(2,44,34,0.4)] shadow-xl';
    case 'custom': return 'bg-gradient-to-br from-[#101623]/90 to-[#0b0f19]/95 border-blue-500/30 hover:border-blue-400/70 hover:shadow-[0_0_30px_rgba(30,58,138,0.4)] shadow-xl';
    default: return 'bg-gradient-to-br from-[#1a1a1a]/90 to-[#0a0a0a]/95 border-gray-500/30 hover:border-gray-400/70 shadow-xl';
  }
};

const getGlowColor = (type: AgentType) => {
  switch (type) {
    case 'hermes': return 'rgba(168, 85, 247, 0.4)';
    case 'claude': return 'rgba(249, 115, 22, 0.4)';
    case 'chatgpt': return 'rgba(34, 197, 94, 0.4)';
    case 'custom': return 'rgba(59, 130, 246, 0.4)';
    default: return 'rgba(156, 163, 175, 0.4)';
  }
};

const getStatusDisplay = (status: string) => {
  switch(status.toLowerCase()) {
    case 'connected': return { label: 'Connected', icon: '🟢', color: 'text-green-400 border-green-500/30 bg-green-500/10' };
    case 'deploying': return { label: 'Deploying', icon: '🔵', color: 'text-blue-400 border-blue-500/30 bg-blue-500/10 animate-pulse' };
    case 'setup_required': return { label: 'Setup Required', icon: '🟡', color: 'text-yellow-400 border-yellow-500/30 bg-yellow-500/10' };
    default: return { label: 'Idle', icon: '⚪', color: 'text-gray-400 border-gray-500/30 bg-gray-500/10' };
  }
};

export const AgentDashboardCard: React.FC<AgentDashboardCardProps> = ({
  agentType,
  agent,
  expanded,
  onToggle,
  onQuickConnect,
  onLogin,
  onRevoke,
  onCreateToken,
  loading = false,
  actionLabel
}) => {
  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);
  
  const config = AGENT_CONFIGS[agentType];
  const themeClasses = getThemeClasses(agentType);
  const glowColor = getGlowColor(agentType);
  const connectionType = getConnectionTypeTag(agentType);
  const statusDisplay = getStatusDisplay(agent?.status || 'idle');

  const handleCopyCommand = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText('arcox-agent connect "<token>"').then(() => {
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 2000);
    });
  };

  const handleCopyAddress = (e: React.MouseEvent, address: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(address).then(() => {
      setCopiedAddress(true);
      setTimeout(() => setCopiedAddress(false), 2000);
    });
  };

  const handleRevokeClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowRevokeConfirm(true);
  };

  const confirmRevoke = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowRevokeConfirm(false);
    onRevoke();
  };

  const cancelRevoke = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowRevokeConfirm(false);
  };

  return (
    <div
      className={`rounded-3xl border border-solid p-6 flex flex-col gap-6 transition-all duration-500 backdrop-blur-2xl ${themeClasses}`}
    >
      {/* Header */}
      <div 
        className="flex justify-between items-start cursor-pointer select-none group"
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <div className="flex items-center gap-5">
          <div className="relative">
            <div 
              className="absolute inset-0 blur-xl opacity-60 rounded-full transition-opacity duration-300 group-hover:opacity-100"
              style={{ backgroundColor: glowColor }}
            />
            <div 
              className="relative w-16 h-16 flex items-center justify-center text-4xl bg-black/40 border border-white/10 rounded-full backdrop-blur-md transition-transform duration-500 group-hover:scale-110 group-hover:rotate-6 z-10"
              style={{ boxShadow: `inset 0 0 20px ${glowColor}` }}
            >
              {config.icon}
            </div>
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h3 className="text-2xl font-black text-white m-0 tracking-tight">{config.name}</h3>
              <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-md bg-white/5 text-gray-300 border border-white/10 backdrop-blur-md">
                {connectionType}
              </span>
            </div>
            <p className="text-sm text-gray-400 m-0 mt-1 font-medium">{config.description}</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-3">
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-bold shadow-lg backdrop-blur-md transition-all ${statusDisplay.color}`}>
            <span>{statusDisplay.icon}</span>
            <span>{statusDisplay.label}</span>
          </div>
          {expanded ? (
            <span className="text-gray-500 text-xs font-semibold bg-black/20 px-2 py-1 rounded border border-white/5">▲ Collapse</span>
          ) : (
            <span className="text-gray-500 text-xs font-semibold bg-black/20 px-2 py-1 rounded border border-white/5">▼ Expand</span>
          )}
        </div>
      </div>

      {/* Body */}
      {agent ? (
        <div className="bg-black/40 rounded-2xl p-5 border border-white/10 shadow-inner backdrop-blur-md">
          <div className="flex flex-col gap-5">
            <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
              <div className="flex flex-col gap-2">
                <span className="text-xs text-gray-400 uppercase font-bold tracking-wider">MSCA Smart Account</span>
                <button 
                  onClick={(e) => handleCopyAddress(e, agent.walletAddress || '')}
                  className="group flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg px-3 py-1.5 transition-all w-fit"
                >
                  <span className="font-mono text-sm text-gray-200">
                    {agent.walletAddress?.slice(0, 6)}...{agent.walletAddress?.slice(-4)}
                  </span>
                  <span className="text-xs text-gray-500 group-hover:text-white transition-colors">
                    {copiedAddress ? '✅ Copied' : '📋 Copy'}
                  </span>
                </button>
              </div>
              <div className="flex flex-col sm:items-end gap-2">
                <span className="text-xs text-gray-400 uppercase font-bold tracking-wider">Available Balance</span>
                <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 px-4 py-1.5 rounded-full">
                  <span className="text-emerald-500 font-bold">$USDC</span>
                  <span className="text-white font-black text-lg">1,250.00</span>
                </div>
              </div>
            </div>
            
            <div className="h-px bg-white/10 w-full" />
            
            <div className="flex flex-col gap-2">
              <span className="text-xs text-gray-400 uppercase font-bold tracking-wider">Multi-Chain Deployment</span>
              <div className="flex flex-wrap gap-2 items-center">
                <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold bg-white/5 text-gray-300 border border-white/10">
                  <span className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.8)] animate-pulse"></span>
                  Arc Testnet
                </span>
                <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold bg-white/5 text-gray-300 border border-white/10">
                  <span className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.8)]"></span>
                  Base Sepolia
                </span>
                <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold bg-white/5 text-gray-300 border border-white/10">
                  <span className="w-2 h-2 rounded-full bg-purple-500 shadow-[0_0_10px_rgba(168,85,247,0.8)]"></span>
                  Arbitrum Sepolia
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-black/30 rounded-2xl p-5 border border-white/5">
          <p className="text-sm text-gray-300 m-0 mb-4 leading-relaxed font-medium">
            {agentType === 'hermes' 
              ? 'Connect the Hermes CLI to instantly provision your AI with secure, deterministic transaction execution and seamless smart account management from any terminal.'
              : `Connect ${config.name} to grant secure, scoped transaction capabilities. Authorize multi-chain actions through robust OAuth and passkey authentication.`}
          </p>
          {agentType === 'hermes' && (
            <div className="flex flex-col gap-2">
              <span className="text-xs text-gray-500 font-bold uppercase tracking-wider">Quick Start CLI</span>
              <div className="flex items-center justify-between bg-black/60 p-3 rounded-xl border border-gray-800 font-mono text-sm shadow-inner">
                <span className="text-emerald-400">arcox-agent connect <span className="text-white">"&lt;token&gt;"</span></span>
                <button 
                  onClick={handleCopyCommand}
                  className="bg-white/10 hover:bg-white/20 text-white rounded-md px-3 py-1 text-xs transition-colors font-bold flex items-center gap-1"
                >
                  {copiedToken ? '✅ Copied' : '📋 Copy'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {loading && actionLabel && (
        <div className="text-sm text-white font-bold text-center animate-pulse py-1 bg-white/5 rounded-lg border border-white/10 backdrop-blur-sm">
          {actionLabel}...
        </div>
      )}

      {/* Action Bar */}
      <div className="flex gap-3">
        {!agent ? (
          <button
            className="flex-1 relative overflow-hidden rounded-xl px-5 py-4 font-black text-white transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none group"
            style={{ 
              background: `linear-gradient(135deg, ${config.color}dd, ${config.color})`,
              boxShadow: `0 8px 25px -5px ${glowColor}`
            }}
            onClick={(e) => { e.stopPropagation(); onQuickConnect(); }}
            disabled={loading}
          >
            <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
            <span className="relative flex items-center justify-center gap-2 text-lg">
              {loading && actionLabel ? 'Connecting...' : '⚡ Quick Connect'}
            </span>
          </button>
        ) : showRevokeConfirm ? (
          <div className="flex-1 flex gap-3 animate-in fade-in zoom-in duration-200">
            <button
              className="flex-1 rounded-xl px-4 py-3 bg-red-500/20 text-red-500 border border-red-500/50 hover:bg-red-500 hover:text-white transition-all font-black shadow-[0_0_15px_rgba(239,68,68,0.2)] hover:shadow-[0_0_25px_rgba(239,68,68,0.5)]"
              onClick={confirmRevoke}
              disabled={loading}
            >
              Confirm Revoke
            </button>
            <button
              className="flex-1 rounded-xl px-4 py-3 bg-white/5 text-gray-300 border border-white/10 hover:bg-white/10 hover:text-white transition-all font-bold"
              onClick={cancelRevoke}
              disabled={loading}
            >
              Cancel
            </button>
          </div>
        ) : (
          <>
            <button
              className="flex-1 rounded-xl px-4 py-3 border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20 hover:border-indigo-400 hover:text-indigo-100 hover:shadow-[0_0_15px_rgba(99,102,241,0.3)] transition-all font-bold disabled:opacity-50 flex items-center justify-center gap-2"
              onClick={(e) => { e.stopPropagation(); onCreateToken(); }}
              disabled={loading}
            >
              🔑 <span className="hidden sm:inline">Issue Token</span>
            </button>
            <button
              className="flex-1 rounded-xl px-4 py-3 border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 hover:border-emerald-400 hover:text-emerald-100 hover:shadow-[0_0_15px_rgba(16,185,129,0.3)] transition-all font-bold disabled:opacity-50 flex items-center justify-center gap-2"
              onClick={(e) => { e.stopPropagation(); onLogin(); }}
              disabled={loading}
            >
              🔐 <span className="hidden sm:inline">Passkey Auth</span>
            </button>
            <button
              className="flex-1 rounded-xl px-4 py-3 border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:border-red-400 hover:text-red-100 hover:shadow-[0_0_15px_rgba(239,68,68,0.3)] transition-all font-bold disabled:opacity-50 flex items-center justify-center gap-2"
              onClick={handleRevokeClick}
              disabled={loading}
            >
              ⛔ <span className="hidden sm:inline">Revoke</span>
            </button>
          </>
        )}
      </div>

      {/* Expandable Accordion */}
      {expanded && agent && (
        <div className="mt-2 pt-6 border-t border-white/10 flex flex-col gap-6 animate-in slide-in-from-top-4 fade-in duration-500 ease-out">
          
          <div className="flex flex-col gap-4">
            <h4 className="text-xs font-black text-gray-400 m-0 uppercase tracking-widest flex items-center gap-2">
              <span className="w-5 h-5 bg-white/10 rounded flex items-center justify-center text-[10px] shadow-inner">⛓️</span>
              Per-Chain UserOp Deployment
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {SUPPORTED_CHAINS.map((chain) => {
                const status = agent.deploymentStatus?.[chain] || 'pending';
                return (
                  <div key={chain} className="flex justify-between items-center text-sm p-3.5 bg-black/40 rounded-xl border border-white/5 backdrop-blur-md hover:bg-black/60 transition-colors">
                    <span className="capitalize text-gray-200 font-bold">{chain.replace('-', ' ')}</span>
                    <span className={`px-3 py-1 rounded-lg text-xs font-black uppercase tracking-wider ${
                      status === 'deployed' ? 'bg-green-500/20 text-green-400 border border-green-500/30 shadow-[0_0_10px_rgba(34,197,94,0.2)]' :
                      status === 'failed' ? 'bg-red-500/20 text-red-400 border border-red-500/30 shadow-[0_0_10px_rgba(239,68,68,0.2)]' :
                      status === 'deploying' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30 animate-pulse shadow-[0_0_10px_rgba(59,130,246,0.2)]' :
                      'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 shadow-[0_0_10px_rgba(234,179,8,0.2)]'
                    }`}>
                      {status}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <h4 className="text-xs font-black text-gray-400 m-0 uppercase tracking-widest flex items-center gap-2">
              <span className="w-5 h-5 bg-white/10 rounded flex items-center justify-center text-[10px] shadow-inner">💳</span>
              Linked Smart Card Settings
            </h4>
            <div className="bg-black/40 rounded-xl border border-white/5 p-5 flex flex-col gap-4 backdrop-blur-md relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-indigo-500/50 to-transparent opacity-50" />
              
              <div className="flex justify-between items-end">
                <span className="text-sm font-bold text-gray-400">Daily Spending Limit</span>
                <span className="text-lg font-black text-white">$500.00</span>
              </div>
              
              <div className="relative w-full bg-white/5 rounded-full h-3 shadow-inner border border-white/5 overflow-hidden">
                <div 
                  className="absolute top-0 left-0 h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full shadow-[0_0_10px_rgba(99,102,241,0.5)] transition-all duration-1000 ease-out" 
                  style={{ width: '45%' }}
                />
              </div>
              
              <div className="flex justify-between items-center text-xs font-bold">
                <span className="text-indigo-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                  $225.00 Spent
                </span>
                <span className="text-gray-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-500" />
                  $275.00 Remaining
                </span>
              </div>
            </div>
          </div>
          
        </div>
      )}
    </div>
  );
};
