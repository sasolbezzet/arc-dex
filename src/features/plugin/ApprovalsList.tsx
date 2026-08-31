import React from 'react';
import type { Approval } from '../../types/agent';
import { Loader2, ExternalLink, ArrowRightLeft, Send, Repeat, Check, X } from 'lucide-react';

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
      <div className="flex flex-col items-center justify-center p-8 text-gray-500 bg-gray-900/50 rounded-xl border border-gray-800">
        <div className="w-16 h-16 mb-4 rounded-full bg-gray-800 flex items-center justify-center">
          <Check className="w-8 h-8 text-gray-600" />
        </div>
        <p className="text-sm font-medium">No pending approvals</p>
        <p className="text-xs text-gray-600 mt-1">You're all caught up!</p>
      </div>
    );
  }

  const sortedApprovals = [...approvals].sort((a, b) => {
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return (
    <div className="flex flex-col gap-4">
      {sortedApprovals.map((approval) => {
        const isSigning = signingId === approval.id;
        const isDisabled = !!signingId;
        
        let typeInfo = {
          icon: <Send className="w-5 h-5 text-blue-400" />,
          label: 'Send',
          bg: 'bg-blue-500/10',
          border: 'border-blue-500/20'
        };

        if (approval.type === 'swap') {
          typeInfo = {
            icon: <Repeat className="w-5 h-5 text-purple-400" />,
            label: 'Swap',
            bg: 'bg-purple-500/10',
            border: 'border-purple-500/20'
          };
        } else if (approval.type === 'bridge') {
          typeInfo = {
            icon: <ArrowRightLeft className="w-5 h-5 text-emerald-400" />,
            label: 'Bridge',
            bg: 'bg-emerald-500/10',
            border: 'border-emerald-500/20'
          };
        }

        return (
          <div 
            key={approval.id} 
            className="group bg-gray-900 rounded-xl border border-gray-800 overflow-hidden hover:border-gray-700 transition-colors shadow-lg"
          >
            {/* Header */}
            <div className={`px-4 py-3 border-b border-gray-800 flex justify-between items-center ${typeInfo.bg}`}>
              <div className="flex items-center gap-2">
                <div className={`p-1.5 rounded-lg bg-gray-900 border ${typeInfo.border}`}>
                  {typeInfo.icon}
                </div>
                <span className="font-medium text-gray-200">{typeInfo.label} Operation</span>
              </div>
              <span className="text-xs text-gray-500 font-medium bg-gray-800 px-2 py-1 rounded-md">
                {timeAgo(approval.createdAt)}
              </span>
            </div>
            
            {/* Body */}
            <div className="p-4">
              <div className="flex items-baseline gap-2 mb-4">
                <span className="text-3xl font-bold text-white tracking-tight">
                  {approval.amount}
                </span>
                <span className="text-sm font-semibold px-2.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                  {approval.token}
                </span>
              </div>

              {approval.type === 'send' && approval.destination && (
                <div className="flex items-center justify-between p-3 rounded-lg bg-gray-800/50 border border-gray-700/50 mb-4">
                  <div className="flex flex-col">
                    <span className="text-xs text-gray-500 font-medium mb-1">Destination Address</span>
                    <div className="flex items-center gap-2 text-sm text-gray-300 font-mono">
                      {truncateAddress(approval.destination)}
                      <a 
                        href={`https://basescan.org/address/${approval.destination}`} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-indigo-400 hover:text-indigo-300 transition-colors p-1"
                        title="View on Explorer"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 mt-2">
                <button
                  onClick={() => onReject(approval.id)}
                  disabled={isDisabled}
                  className="flex-1 px-4 py-2.5 rounded-lg border border-rose-500/50 text-rose-400 font-medium text-sm hover:bg-rose-500/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-rose-500/50"
                >
                  <X className="w-4 h-4" />
                  Reject
                </button>
                <button
                  onClick={() => onApprove(approval.id)}
                  disabled={isDisabled}
                  className="flex-1 px-4 py-2.5 rounded-lg bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white font-medium text-sm transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                >
                  {isSigning ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Signing...
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      Approve
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
