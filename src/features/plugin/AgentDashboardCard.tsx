import React, { useState } from 'react';
import { type AgentState, type AgentType, AGENT_CONFIGS, SUPPORTED_CHAINS } from '../../types/agent';
import { AgentStatusBadge } from './AgentStatusBadge';
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
  if (type === 'hermes') return 'CLI / MCP';
  if (type === 'custom') return 'Custom / MCP';
  return 'OAuth 2.0 / MCP';
};

const getThemeClasses = (type: AgentType) => {
  switch (type) {
    case 'hermes': return 'border-purple-500/30 shadow-purple-500/20';
    case 'claude': return 'border-orange-500/30 shadow-orange-500/20';
    case 'chatgpt': return 'border-green-500/30 shadow-green-500/20';
    case 'custom': return 'border-blue-500/30 shadow-blue-500/20';
    default: return 'border-gray-500/30 shadow-gray-500/20';
  }
};

const getGlowColor = (type: AgentType) => {
  switch (type) {
    case 'hermes': return 'rgba(168, 85, 247, 0.5)';
    case 'claude': return 'rgba(249, 115, 22, 0.5)';
    case 'chatgpt': return 'rgba(34, 197, 94, 0.5)';
    case 'custom': return 'rgba(59, 130, 246, 0.5)';
    default: return 'rgba(156, 163, 175, 0.5)';
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
  const config = AGENT_CONFIGS[agentType];

  const themeClasses = getThemeClasses(agentType);
  const glowColor = getGlowColor(agentType);
  const connectionType = getConnectionTypeTag(agentType);

  const handleCopyCommand = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText('arcox-agent connect "<token>"').then(() => {
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 2000);
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
      className={`rounded-2xl border border-solid p-6 flex flex-col gap-5 transition-all duration-300 backdrop-blur-xl bg-gray-900/40 hover:bg-gray-900/60 hover:shadow-xl ${themeClasses}`}
      style={{
        boxShadow: `0 8px 32px -8px ${glowColor}`
      }}
    >
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
        <div className="flex items-center gap-4">
          <div 
            className="text-5xl transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3"
            style={{ filter: `drop-shadow(0 0 12px ${glowColor})` }}
          >
            {config.icon}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-2xl font-bold text-white m-0 tracking-tight">{config.name}</h3>
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-gray-800 text-gray-300 border border-gray-700">
                {connectionType}
              </span>
            </div>
            <p className="text-sm text-gray-400 m-0 mt-1 font-medium">{config.description}</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <AgentStatusBadge status={agent?.status || 'idle'} />
          {expanded ? (
            <span className="text-gray-500 text-xs">▲ Collapse</span>
          ) : (
            <span className="text-gray-500 text-xs">▼ Expand</span>
          )}
        </div>
      </div>

      {agent ? (
        <div className="bg-black/30 rounded-xl p-4 border border-gray-800/50">
          <div className="flex flex-col gap-4">
            <AgentWalletSummary walletAddress={agent.walletAddress} label="MSCA Account:" showBalance />
            
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-xs text-gray-400 uppercase font-bold tracking-wider mr-2">Multi-Chain Live:</span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-gray-800/80 text-gray-300 border border-gray-700/50">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.8)]"></span>
                Arc Testnet
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-gray-800/80 text-gray-300 border border-gray-700/50">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.8)]"></span>
                Base Sepolia
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-gray-800/80 text-gray-300 border border-gray-700/50">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.8)]"></span>
                Arbitrum Sepolia
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-black/20 rounded-xl p-4 border border-gray-800/50">
          <p className="text-sm text-gray-300 m-0 mb-3">
            {agentType === 'hermes' 
              ? 'Connect the Hermes CLI to manage transactions and smart accounts securely from your terminal.'
              : `Connect ${config.name} to allow AI-driven insights and automated actions on your behalf.`}
          </p>
          {agentType === 'hermes' && (
            <div className="flex items-center justify-between bg-black/50 p-2.5 rounded-lg border border-gray-800 font-mono text-xs">
              <span className="text-gray-400">arcox-agent connect "&lt;token&gt;"</span>
              <button 
                onClick={handleCopyCommand}
                className="text-gray-500 hover:text-white transition-colors p-1"
                title="Copy snippet"
              >
                {copiedToken ? '✅' : '📋'}
              </button>
            </div>
          )}
        </div>
      )}

      {loading && actionLabel && (
        <div className="text-sm text-indigo-400 font-medium text-center animate-pulse py-2">
          {actionLabel}...
        </div>
      )}

      <div className="flex gap-3 mt-1">
        {!agent ? (
          <button
            className="flex-1 rounded-xl px-4 py-3.5 font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900"
            style={{ 
              backgroundColor: config.color,
              boxShadow: `0 4px 14px ${glowColor}`
            }}
            onClick={(e) => { e.stopPropagation(); onQuickConnect(); }}
            disabled={loading}
          >
            {loading && actionLabel ? 'Connecting...' : '⚡ Quick Connect'}
          </button>
        ) : showRevokeConfirm ? (
          <div className="flex-1 flex gap-2 animate-in fade-in zoom-in duration-200">
            <button
              className="flex-1 rounded-xl px-4 py-2 bg-red-500/20 text-red-500 border border-red-500/50 hover:bg-red-500 hover:text-white transition-all font-bold"
              onClick={confirmRevoke}
              disabled={loading}
            >
              Confirm Revoke
            </button>
            <button
              className="flex-1 rounded-xl px-4 py-2 bg-gray-800 text-gray-300 border border-gray-700 hover:bg-gray-700 transition-all font-bold"
              onClick={cancelRevoke}
              disabled={loading}
            >
              Cancel
            </button>
          </div>
        ) : (
          <>
            <button
              className="flex-1 rounded-xl px-3 py-2.5 border border-indigo-500/50 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20 hover:border-indigo-500 hover:text-indigo-200 transition-all font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
              onClick={(e) => { e.stopPropagation(); onCreateToken(); }}
              disabled={loading}
            >
              🔑 <span className="hidden sm:inline">New Token</span>
            </button>
            <button
              className="flex-1 rounded-xl px-3 py-2.5 border border-green-500/50 bg-green-500/10 text-green-300 hover:bg-green-500/20 hover:border-green-500 hover:text-green-200 transition-all font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
              onClick={(e) => { e.stopPropagation(); onLogin(); }}
              disabled={loading}
            >
              🔐 <span className="hidden sm:inline">Passkey</span>
            </button>
            <button
              className="flex-1 rounded-xl px-3 py-2.5 border border-red-500/50 bg-red-500/10 text-red-300 hover:bg-red-500/20 hover:border-red-500 hover:text-red-200 transition-all font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
              onClick={handleRevokeClick}
              disabled={loading}
            >
              ⛔ <span className="hidden sm:inline">Revoke</span>
            </button>
          </>
        )}
      </div>

      {expanded && agent && (
        <div className="mt-2 pt-5 border-t border-gray-800/50 flex flex-col gap-5 animate-in slide-in-from-top-4 fade-in duration-300">
          
          {/* Advanced Setting: Deployment Status */}
          <div className="flex flex-col gap-3">
            <h4 className="text-sm font-bold text-gray-400 m-0 uppercase tracking-wider flex items-center gap-2">
              <span className="w-4 h-4 bg-gray-800 rounded flex items-center justify-center text-[10px]">⛓️</span>
              Per-Chain UserOp Deployment
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {SUPPORTED_CHAINS.map((chain) => {
                const status = agent.deploymentStatus?.[chain] || 'pending';
                return (
                  <div key={chain} className="flex justify-between items-center text-sm p-3 bg-gray-900/50 rounded-xl border border-gray-800/80 backdrop-blur-sm">
                    <span className="capitalize text-gray-300 font-medium">{chain.replace('-', ' ')}</span>
                    <span className={`px-2.5 py-1 rounded-md text-xs font-bold ${
                      status === 'deployed' ? 'bg-green-500/20 text-green-400 border border-green-500/30' :
                      status === 'failed' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
                      status === 'deploying' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30 animate-pulse' :
                      'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                    }`}>
                      {status}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Advanced Setting: Smart Card Settings */}
          <div className="flex flex-col gap-3">
            <h4 className="text-sm font-bold text-gray-400 m-0 uppercase tracking-wider flex items-center gap-2">
              <span className="w-4 h-4 bg-gray-800 rounded flex items-center justify-center text-[10px]">💳</span>
              Linked Smart Card Settings
            </h4>
            <div className="bg-gray-900/50 rounded-xl border border-gray-800/80 p-4 flex flex-col gap-3 backdrop-blur-sm">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-400">Daily Spending Limit</span>
                <span className="text-sm font-bold text-white bg-gray-800 px-2 py-1 rounded">$500.00</span>
              </div>
              <div className="w-full bg-gray-800 rounded-full h-2">
                <div className="bg-indigo-500 h-2 rounded-full" style={{ width: '45%' }}></div>
              </div>
              <div className="flex justify-between items-center text-xs text-gray-500 font-medium">
                <span>$225.00 spent</span>
                <span>$275.00 remaining</span>
              </div>
            </div>
          </div>
          
        </div>
      )}
    </div>
  );
};
