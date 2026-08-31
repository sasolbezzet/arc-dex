import React, { useEffect } from 'react';
import { type AgentState, AGENT_CONFIGS } from '../../types/agent';
import { AlertTriangle, ShieldAlert } from 'lucide-react';

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
      className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={() => !loading && onCancel()}
    >
      <div 
        role="dialog"
        aria-modal="true"
        className="bg-[#0a0a0f] rounded-xl max-w-md w-full border border-red-500/50 p-6 flex flex-col gap-5 shadow-[0_0_40px_rgba(239,68,68,0.25)] relative overflow-hidden font-sans"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Warning glow background */}
        <div className="absolute -top-20 -right-20 w-48 h-48 bg-red-600/20 rounded-full blur-[60px] pointer-events-none" />
        <div className="absolute -bottom-20 -left-20 w-48 h-48 bg-red-600/10 rounded-full blur-[60px] pointer-events-none" />

        <div className="flex flex-col items-center text-center gap-3 relative z-10">
          <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-full">
            <AlertTriangle className="w-10 h-10 text-red-500 drop-shadow-[0_0_10px_rgba(239,68,68,0.8)]" />
          </div>
          <h2 className="text-xl font-black uppercase tracking-widest text-red-500 drop-shadow-[0_0_5px_rgba(239,68,68,0.5)]">
            Terminate {agentName}?
          </h2>
        </div>

        <div className="bg-[#12121a] border border-red-500/20 rounded-lg p-4 flex flex-col gap-3 text-sm text-gray-300 relative z-10">
          <p className="font-bold text-red-400 uppercase tracking-wider text-xs">This action will immediately revoke:</p>
          <ul className="list-none flex flex-col gap-2 font-mono text-xs">
            <li className="flex items-start gap-2">
              <span className="text-red-500 mt-0.5">►</span>
              <span>Session token invalidated</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-red-500 mt-0.5">►</span>
              <span>Passkey credential unlinked</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-red-500 mt-0.5">►</span>
              <span>MCP access terminated</span>
            </li>
          </ul>
        </div>

        <div className="bg-[#00ff9d]/5 border border-[#00ff9d]/20 rounded-lg p-3 text-xs text-[#00ff9d] flex items-start gap-3 relative z-10">
          <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" />
          <p className="font-mono leading-relaxed">
            Other agents remain unaffected.<br/>Smart account funds remain safe.
          </p>
        </div>

        {agent.walletAddress && (
          <div className="flex flex-col gap-1 relative z-10">
            <span className="text-[10px] text-gray-500 uppercase tracking-widest px-1 font-bold">Target Wallet:</span>
            <div className="bg-[#050508] border border-gray-800 rounded p-2 text-xs font-mono text-gray-400 break-all text-center">
              {agent.walletAddress.slice(0, 8)}...{agent.walletAddress.slice(-6)}
            </div>
          </div>
        )}

        <div className="flex gap-4 mt-2 relative z-10">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 px-4 py-3 rounded border border-gray-600 text-gray-400 text-xs font-bold uppercase tracking-widest hover:text-white hover:border-gray-400 hover:bg-gray-800 transition-all disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 px-4 py-3 rounded bg-gradient-to-r from-red-600 to-red-500 text-white text-xs font-black uppercase tracking-widest hover:from-red-500 hover:to-red-400 shadow-[0_0_15px_rgba(239,68,68,0.4)] hover:shadow-[0_0_25px_rgba(239,68,68,0.6)] transition-all disabled:opacity-50 flex items-center justify-center gap-2 border border-red-400/50"
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
              'Revoke Access'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
