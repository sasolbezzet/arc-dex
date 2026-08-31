import React, { useState } from 'react';
import type { AgentConnectionToken } from '../../types/agent';
import { Copy, Terminal, CheckCircle2, Shield } from 'lucide-react';

export interface ConnectionTokenDialogProps {
  token: AgentConnectionToken;
  onClose: () => void;
}

export const ConnectionTokenDialog: React.FC<ConnectionTokenDialogProps> = ({ token, onClose }) => {
  const [copied, setCopied] = useState(false);
  const [cmdCopied, setCmdCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(token.token);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 2000);
  };

  const handleCopyCommand = () => {
    navigator.clipboard.writeText(`arcox-agent connect "${token.token}"`);
    setCmdCopied(true);
    setTimeout(() => {
      setCmdCopied(false);
    }, 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 font-sans">
      <div 
        role="dialog" 
        aria-modal="true" 
        className="w-full max-w-lg rounded-xl border border-[#00ff9d]/50 bg-[#0a0a0f] p-6 shadow-[0_0_30px_rgba(0,255,157,0.15)] relative overflow-hidden"
      >
        {/* Holographic background glow */}
        <div className="absolute -top-32 -right-32 w-64 h-64 bg-[#00ff9d]/10 rounded-full blur-[80px] pointer-events-none" />
        <div className="absolute -bottom-32 -left-32 w-64 h-64 bg-cyan-500/10 rounded-full blur-[80px] pointer-events-none" />

        <div className="relative z-10 flex items-center gap-3 mb-2">
          <Shield className="w-6 h-6 text-[#00ff9d] drop-shadow-[0_0_8px_rgba(0,255,157,0.8)]" />
          <h2 className="text-xl font-black uppercase tracking-widest text-[#00ff9d] drop-shadow-[0_0_5px_rgba(0,255,157,0.4)]">
            Connection Credential
          </h2>
        </div>
        
        <p className="mb-6 text-xs text-gray-400 uppercase tracking-wide">
          Secure MCP credential. Handle with extreme caution.
        </p>

        <div className="mb-6 relative group">
          <div className="absolute -inset-0.5 bg-gradient-to-r from-[#00ff9d] to-cyan-500 rounded opacity-20 group-hover:opacity-40 transition duration-500 blur"></div>
          <div className="relative bg-[#050508] border border-[#00ff9d]/30 rounded p-4 flex flex-col gap-3">
            <span className="text-[10px] text-[#00ff9d] font-bold uppercase tracking-widest flex justify-between items-center">
              <span>Token</span>
              {copied && <span className="text-cyan-400 flex items-center gap-1"><CheckCircle2 className="w-3 h-3"/> Copied to clipboard!</span>}
            </span>
            <code className="block w-full break-all font-mono text-sm text-cyan-100">
              {token.token}
            </code>
            <button
              onClick={handleCopy}
              className="mt-2 w-full rounded bg-[#00ff9d]/10 border border-[#00ff9d]/30 px-4 py-2 text-xs font-black uppercase tracking-widest text-[#00ff9d] transition-all hover:bg-[#00ff9d]/20 hover:shadow-[0_0_10px_rgba(0,255,157,0.3)] flex items-center justify-center gap-2"
            >
              <Copy className="w-4 h-4" />
              Copy Token
            </button>
          </div>
        </div>

        <div className="mb-6">
          <div className="bg-[#12121a] border border-gray-800 rounded p-4">
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-widest flex justify-between items-center mb-2">
              <span>CLI Integration</span>
              {cmdCopied && <span className="text-[#00ff9d]">Copied!</span>}
            </span>
            <div className="flex items-center gap-2 bg-[#050508] p-3 rounded border border-gray-800/50">
              <Terminal className="w-4 h-4 text-gray-500 shrink-0" />
              <code className="text-xs font-mono text-gray-300 flex-1 truncate">
                arcox-agent connect "{token.token.slice(0,8)}..."
              </code>
              <button 
                onClick={handleCopyCommand}
                className="text-gray-500 hover:text-[#00ff9d] transition-colors p-1"
                title="Copy Command"
              >
                <Copy className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {token.setupMessage && (
          <details className="mb-6 group border border-gray-800 rounded bg-[#12121a]">
            <summary className="cursor-pointer text-xs font-bold uppercase tracking-widest text-cyan-400 hover:text-cyan-300 p-3 flex items-center gap-2">
              <span className="flex-1">System Instructions</span>
            </summary>
            <div className="border-t border-gray-800 bg-[#050508] p-4 text-xs font-mono text-gray-400 whitespace-pre-wrap leading-relaxed">
              {token.setupMessage}
            </div>
          </details>
        )}

        <div className="flex items-center justify-between mt-8 border-t border-gray-800 pt-4">
          <div className="text-[10px] text-gray-500 font-bold uppercase tracking-widest flex flex-col gap-1">
            <span>Expiration Sequence</span>
            <span className="text-red-400/80 font-mono">{token.expiresAt}</span>
          </div>

          <button
            onClick={onClose}
            className="rounded border border-gray-600 bg-transparent px-6 py-2 text-xs font-black uppercase tracking-widest text-gray-400 transition-all hover:bg-gray-800 hover:text-white"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
