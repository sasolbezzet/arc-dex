import React from 'react';
import type { Approval } from '../../types/agent';
import { Loader2, ExternalLink, ArrowRightLeft, Send, Repeat, Check, X, Shield, ShieldCheck } from 'lucide-react';

export interface ApprovalsListProps {
  approvals: Approval[];
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  signingId?: string | null;
}

function timeAgo(dateInput: number | Date | string): string {
  if (!dateInput) return '';
  const date = new Date(dateInput);
  const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
  
  let interval = seconds / 31536000;
  if (interval > 1) return Math.floor(interval) + ' years ago';
  interval = seconds / 2592000;
  if (interval > 1) return Math.floor(interval) + ' months ago';
  interval = seconds / 86400;
  if (interval > 1) return Math.floor(interval) + ' days ago';
  interval = seconds / 3600;
  if (interval > 1) return Math.floor(interval) + ' hours ago';
  interval = seconds / 60;
  if (interval > 1) return Math.floor(interval) + ' minutes ago';
  return 'just now';
}

function truncateAddress(addr: string) {
  if (!addr) return '';
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export const ApprovalsList: React.FC<ApprovalsListProps> = ({
  approvals,
  onApprove,
  onReject,
  signingId
}) => {
  if (!approvals || approvals.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-indigo-400">
            <ShieldCheck className="w-5 h-5" />
            <h3 className="font-semibold text-sm">Security Firewall</h3>
          </div>
          <span className="bg-green-500/20 text-green-400 py-0.5 px-2 rounded-full text-xs font-medium border border-green-500/30">
            0 Pending
          </span>
        </div>
        <div className="flex flex-col items-center justify-center p-8 text-gray-500 bg-gray-900/50 rounded-xl border border-gray-800">
          <div className="w-16 h-16 mb-4 rounded-full bg-gray-800 flex items-center justify-center shadow-inner">
            <ShieldCheck className="w-8 h-8 text-emerald-500" />
          </div>
          <p className="text-sm font-medium text-gray-300">No pending approvals</p>
          <p className="text-xs text-gray-500 mt-1">Your wallet is secure.</p>
        </div>
      </div>
    );
  }

  const sortedApprovals = [...approvals].sort((a, b) => {
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between mb-2 pb-3 border-b border-gray-800/80">
        <div className="flex items-center gap-2 text-rose-400 drop-shadow-[0_0_8px_rgba(244,63,94,0.4)]">
          <Shield className="w-5 h-5" />
          <h3 className="font-semibold text-sm">Security Firewall</h3>
        </div>
        <span className="bg-rose-500/20 text-rose-400 py-0.5 px-2.5 rounded-full text-xs font-bold border border-rose-500/30 shadow-[0_0_10px_rgba(244,63,94,0.2)]">
          {approvals.length} Pending
        </span>
      </div>

      <div className="flex flex-col gap-4">
        {sortedApprovals.map((approval) => {
          const isSigning = signingId === approval.id;
          const isDisabled = !!signingId;
          
          let typeInfo = {
            icon: <Send className="w-5 h-5 text-blue-400" />,
            label: 'Send 📤',
            bg: 'bg-blue-500/10',
            border: 'border-blue-500/20',
            glow: 'shadow-[0_0_15px_rgba(59,130,246,0.15)]'
          };

          if (approval.type === 'swap') {
            typeInfo = {
              icon: <Repeat className="w-5 h-5 text-purple-400" />,
              label: 'Swap 🔄',
              bg: 'bg-purple-500/10',
              border: 'border-purple-500/20',
              glow: 'shadow-[0_0_15px_rgba(168,85,247,0.15)]'
            };
          } else if (approval.type === 'bridge') {
            typeInfo = {
              icon: <ArrowRightLeft className="w-5 h-5 text-emerald-400" />,
              label: 'Bridge 🌉',
              bg: 'bg-emerald-500/10',
              border: 'border-emerald-500/20',
              glow: 'shadow-[0_0_15px_rgba(16,185,129,0.15)]'
            };
          }

          return (
            <div 
              key={approval.id} 
              className={`group bg-gray-900 rounded-xl border border-gray-800 overflow-hidden hover:border-gray-700 transition-all ${typeInfo.glow}`}
            >
              {/* Header */}
              <div className={`px-4 py-3 border-b border-gray-800 flex justify-between items-center ${typeInfo.bg}`}>
                <div className="flex items-center gap-2">
                  <div className={`p-1.5 rounded-lg bg-gray-900 border ${typeInfo.border}`}>
                    {typeInfo.icon}
                  </div>
                  <span className="font-semibold text-gray-100">{typeInfo.label}</span>
                </div>
                <span className="text-xs text-gray-400 font-medium bg-gray-900/80 px-2.5 py-1 rounded-md border border-gray-800">
                  {timeAgo(approval.createdAt)}
                </span>
              </div>
              
              {/* Body */}
              <div className="p-5">
                <div className="flex flex-col gap-1 mb-5">
                  <span className="text-xs text-gray-500 font-medium uppercase tracking-wider">Amount</span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-bold font-mono text-white drop-shadow-[0_0_10px_rgba(255,255,255,0.4)]">
                      {approval.amount}
                    </span>
                    <span className="text-sm font-bold px-2 py-1 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                      {approval.token}
                    </span>
                  </div>
                </div>

                {approval.type === 'send' && approval.destination && (
                  <div className="flex items-center justify-between p-3.5 rounded-lg bg-gray-950/50 border border-gray-800 mb-5 group-hover:border-gray-700 transition-colors">
                    <div className="flex flex-col gap-1.5">
                      <span className="text-xs text-gray-500 font-medium">Destination</span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-300 font-mono bg-gray-900 px-2 py-0.5 rounded border border-gray-800">
                          {truncateAddress(approval.destination)}
                        </span>
                        <a 
                          href={`https://basescan.org/address/${approval.destination}`} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-1 text-xs font-medium"
                          title="View on Explorer"
                        >
                          Explorer <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    </div>
                  </div>
                )}
                
                <div className="mb-5">
                  <span className="inline-block px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest rounded bg-yellow-500/10 text-yellow-500 border border-yellow-500/30">
                    Standard Risk
                  </span>
                </div>

                {/* Actions */}
                <div className="flex gap-3">
                  <button
                    onClick={() => onReject(approval.id)}
                    disabled={isDisabled}
                    className="flex-1 px-4 py-3 rounded-lg border border-rose-500/50 text-rose-400 font-semibold text-sm hover:bg-rose-500/10 hover:border-rose-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 focus:outline-none"
                  >
                    <X className="w-4 h-4" />
                    Reject
                  </button>
                  <button
                    onClick={() => onApprove(approval.id)}
                    disabled={isDisabled}
                    className="flex-[2] px-4 py-3 rounded-lg bg-gradient-to-r from-emerald-500 to-emerald-400 hover:from-emerald-400 hover:to-emerald-300 text-gray-900 font-bold text-sm transition-all shadow-[0_0_15px_rgba(16,185,129,0.3)] hover:shadow-[0_0_25px_rgba(16,185,129,0.5)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 focus:outline-none"
                  >
                    {isSigning ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Executing...
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4" />
                        Approve & Execute
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
