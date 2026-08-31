import React, { useEffect } from 'react';
import { type AgentState, AGENT_CONFIGS } from '../../types/agent';

export interface RevokeModalProps {
  agent: AgentState;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

export const RevokeModal: React.FC<RevokeModalProps> = ({
  agent,
  onConfirm,
  onCancel,
  loading = false,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) {
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel, loading]);

  const agentConfig = AGENT_CONFIGS[agent.agentType];
  const agentName = agentConfig?.name || agent.agentType;

  return (
    <div 
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
      onClick={() => !loading && onCancel()}
    >
      <div 
        role="dialog"
        aria-modal="true"
        className="bg-[#1e1e2e] rounded-2xl max-w-md w-full border border-red-500/30 p-6 flex flex-col gap-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col items-center text-center gap-3">
          <div className="text-5xl">⚠️</div>
          <h2 className="text-xl font-bold text-white">
            Revoke {agentName}?
          </h2>
        </div>

        <div className="bg-[#12121a] rounded-xl p-4 flex flex-col gap-2 text-sm text-gray-300">
          <p className="font-semibold text-white mb-1">Aksi ini akan mencabut:</p>
          <ul className="list-disc pl-5 flex flex-col gap-1">
            <li>Session aktif & connection token</li>
            <li>Credential binding (passkey)</li>
            <li>Akses MCP ke Agent Wallet</li>
          </ul>
        </div>

        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3 text-sm text-yellow-200/90 text-center">
          Agent lain <strong>TIDAK terpengaruh</strong>. Dana di wallet tetap aman.
        </div>

        {agent.walletAddress && (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-gray-400 font-medium px-1">Agent Wallet:</span>
            <div className="bg-[#12121a] rounded-lg p-3 text-xs font-mono text-gray-300 break-all text-center">
              {agent.walletAddress.slice(0, 8)}...{agent.walletAddress.slice(-6)}
            </div>
          </div>
        )}

        <div className="flex gap-3 mt-2">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 px-4 py-2.5 rounded-xl border border-gray-600 text-gray-300 font-medium hover:bg-gray-800 transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-gray-500"
          >
            Batal
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 px-4 py-2.5 rounded-xl bg-red-500 text-white font-medium hover:bg-red-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            {loading ? (
              <>
                <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Revoking...
              </>
            ) : (
              'Revoke'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
