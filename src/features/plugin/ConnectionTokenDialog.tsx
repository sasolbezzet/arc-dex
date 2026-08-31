import React, { useState } from 'react';
import type { AgentConnectionToken } from '../../types/agent';

export interface ConnectionTokenDialogProps {
  token: AgentConnectionToken;
  onClose: () => void;
}

export const ConnectionTokenDialog: React.FC<ConnectionTokenDialogProps> = ({ token, onClose }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(token.token);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div 
        role="dialog" 
        aria-modal="true" 
        className="w-full max-w-lg rounded-xl border border-green-500/40 bg-green-500/5 p-6 shadow-xl backdrop-blur-md"
      >
        <h2 className="mb-2 text-xl font-semibold text-green-400">Connection Token</h2>
        <p className="mb-4 text-sm text-gray-300">
          This is an MCP credential used to establish agent connections, not a passkey. Please handle it securely.
        </p>

        <div className="mb-4">
          <code className="block w-full break-all rounded bg-[#12121a] p-4 font-mono text-sm text-gray-300">
            {token.token}
          </code>
        </div>

        <button
          onClick={handleCopy}
          className="mb-4 w-full rounded bg-green-500/20 px-4 py-2 text-sm font-medium text-green-400 transition-colors hover:bg-green-500/30 focus:outline-none focus:ring-2 focus:ring-green-500"
        >
          {copied ? 'Copied!' : 'Copy Token'}
        </button>

        {token.setupMessage && (
          <details className="mb-4 group">
            <summary className="cursor-pointer text-sm font-medium text-green-400 hover:text-green-300 focus:outline-none focus:ring-2 focus:ring-green-500 rounded">
              Setup Instructions
            </summary>
            <div className="mt-2 rounded bg-black/40 p-3 text-sm text-gray-300 whitespace-pre-wrap">
              {token.setupMessage}
            </div>
          </details>
        )}

        <div className="mb-6 text-sm text-gray-400">
          Berlaku sampai: {token.expiresAt}
        </div>

        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="rounded bg-white/5 px-4 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-gray-400"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
