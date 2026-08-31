import React from 'react';
import { type AgentState, type AgentType, type AgentConfig, AGENT_CONFIGS } from '../../types/agent';
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
  const config = AGENT_CONFIGS[agentType];

  return (
    <div
      className="rounded-xl border border-solid p-5 flex flex-col gap-4 transition-all duration-300"
      style={{
        borderColor: config.color,
        background: `linear-gradient(135deg, ${config.color}1A 0%, rgba(0,0,0,0) 100%)`
      }}
    >
      <div 
        className="flex justify-between items-start cursor-pointer select-none"
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
        <div className="flex items-center gap-3">
          <div className="text-4xl">{config.icon}</div>
          <div>
            <h3 className="text-xl font-bold text-white m-0">{config.name}</h3>
            <p className="text-sm text-gray-400 m-0 mt-1">{config.description}</p>
          </div>
        </div>
        <div>
          <AgentStatusBadge status={agent?.status || 'passkey_required'} />
        </div>
      </div>

      {agent && (
        <AgentWalletSummary walletAddress={agent.walletAddress} />
      )}

      <div className="flex gap-2 mt-2">
        {!agent ? (
          <button
            className="flex-1 rounded-lg px-4 py-2 font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            style={{ backgroundColor: config.color }}
            onClick={onQuickConnect}
            disabled={loading}
          >
            {loading && actionLabel ? 'Connecting...' : '⚡ Quick Connect'}
          </button>
        ) : (
          <>
            <button
              className="flex-1 rounded-lg px-3 py-2 border border-indigo-500 text-indigo-400 hover:bg-indigo-500/10 transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              onClick={onCreateToken}
              disabled={loading}
            >
              🔑 Create Token
            </button>
            <button
              className="flex-1 rounded-lg px-3 py-2 border border-green-500 text-green-400 hover:bg-green-500/10 transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              onClick={onLogin}
              disabled={loading}
            >
              🔐 Passkey
            </button>
            <button
              className="flex-1 rounded-lg px-3 py-2 border border-red-500 text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              onClick={onRevoke}
              disabled={loading}
            >
              ⛔ Revoke
            </button>
          </>
        )}
      </div>

      {loading && actionLabel && (
        <div className="text-sm text-gray-400 text-center animate-pulse">
          {actionLabel}...
        </div>
      )}

      {expanded && agent && (
        <div className="mt-4 pt-4 border-t border-gray-800 flex flex-col gap-3">
          <div className="text-sm text-gray-300 bg-gray-800/50 p-3 rounded-lg">
            Activity & linked cards
          </div>
          
          {agent.deploymentStatus && Object.keys(agent.deploymentStatus).length > 0 && (
            <div className="flex flex-col gap-2">
              <h4 className="text-sm font-semibold text-gray-400 m-0">Deployment Status</h4>
              {Object.entries(agent.deploymentStatus).map(([chain, status]) => (
                <div key={chain} className="flex justify-between items-center text-sm p-2 bg-gray-900/50 rounded border border-gray-800">
                  <span className="capitalize">{chain}</span>
                  <span className={`px-2 py-0.5 rounded text-xs ${
                    status === 'deployed' ? 'bg-green-500/20 text-green-400' :
                    status === 'failed' ? 'bg-red-500/20 text-red-400' :
                    'bg-yellow-500/20 text-yellow-400'
                  }`}>
                    {status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
