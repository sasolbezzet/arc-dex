import React from 'react';
import type { Approval } from '../../types/agent';

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
      <div className="text-gray-500 text-sm italic py-4">
        Tidak ada permintaan pending
      </div>
    );
  }

  const sortedApprovals = [...approvals].sort((a, b) => {
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return (
    <div className="flex flex-col gap-3">
      {sortedApprovals.map((approval) => {
        const isSigning = signingId === approval.id;
        
        let borderClass = 'border-l-gray-400';
        let icon = '📝';
        let typeLabel = approval.type;

        if (approval.type === 'send') {
          borderClass = 'border-l-blue-500';
          icon = '💸';
          typeLabel = 'Send';
        } else if (approval.type === 'swap') {
          borderClass = 'border-l-purple-500';
          icon = '🔄';
          typeLabel = 'Swap';
        } else if (approval.type === 'bridge') {
          borderClass = 'border-l-green-500';
          icon = '🌉';
          typeLabel = 'Bridge';
        }

        return (
          <div key={approval.id} className={`bg-white rounded-lg shadow-sm border border-gray-200 border-l-4 ${borderClass} p-4 flex flex-col gap-3`}>
            <div className="flex justify-between items-start">
              <div className="flex items-center gap-2">
                <span className="text-xl" role="img" aria-label={typeLabel}>{icon}</span>
                <span className="font-semibold text-gray-800 capitalize">{typeLabel}</span>
              </div>
              <span className="text-xs text-gray-500 font-medium">
                {timeAgo(approval.createdAt)}
              </span>
            </div>
            
            <div className="text-sm text-gray-700">
              <div className="font-medium text-base">
                {approval.amount} {approval.token}
              </div>
              {approval.type === 'send' && approval.destination && (
                <div className="text-xs text-gray-500 truncate mt-1 bg-gray-50 p-1.5 rounded border border-gray-100">
                  <span className="font-semibold mr-1">To:</span> 
                  {truncateAddress(approval.destination)}
                </div>
              )}
            </div>

            <div className="mt-1 flex gap-2 w-full">
              {isSigning ? (
                <div className="flex-1 bg-gray-100 text-gray-600 rounded-md py-2 text-center text-sm font-medium animate-pulse border border-gray-200">
                  Signing...
                </div>
              ) : (
                <>
                  <button
                    onClick={() => onApprove(approval.id)}
                    disabled={!!signingId}
                    className="flex-1 bg-green-50 hover:bg-green-100 text-green-700 border border-green-200 rounded-md py-2 text-center text-sm font-semibold transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-green-500"
                  >
                    <span>✅</span> Approve
                  </button>
                  <button
                    onClick={() => onReject(approval.id)}
                    disabled={!!signingId}
                    className="flex-1 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-md py-2 text-center text-sm font-semibold transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-red-500"
                  >
                    <span>❌</span> Reject
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
