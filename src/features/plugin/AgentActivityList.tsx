import React from 'react';
import type { Activity } from '../../types/agent';
import { ExternalLink, Activity as ActivityIcon, ZapOff } from 'lucide-react';

export interface AgentActivityListProps {
  activities: Activity[];
  maxItems?: number;
}

const timeAgo = (timestamp: string): string => {
  const date = new Date(timestamp);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return 'Just now';
  let interval = seconds / 60;
  if (interval < 60) return Math.floor(interval) + 'm ago';
  interval = interval / 60;
  if (interval < 24) return Math.floor(interval) + 'h ago';
  interval = interval / 24;
  if (interval < 30) return Math.floor(interval) + 'd ago';
  interval = interval / 30;
  if (interval < 12) return Math.floor(interval) + 'mo ago';
  return Math.floor(interval / 12) + 'y ago';
};

const getIcon = (type: string): string => {
  switch (type.toLowerCase()) {
    case 'send': return '📤';
    case 'swap': return '🔄';
    case 'receive': return '📥';
    case 'approve': return '✅';
    case 'bridge': return '🌉';
    default: return '📋';
  }
};

const getBadgeStyle = (type: string): string => {
  switch (type.toLowerCase()) {
    case 'send': return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
    case 'swap': return 'bg-purple-500/10 text-purple-400 border-purple-500/20';
    case 'receive': return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    case 'approve': return 'bg-green-500/10 text-green-400 border-green-500/20';
    case 'bridge': return 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20';
    default: return 'bg-gray-500/10 text-gray-400 border-gray-500/20';
  }
};

const truncateHash = (hash: string): string => {
  if (hash.length <= 10) return hash;
  return `${hash.slice(0, 6)}...${hash.slice(-4)}`;
};

export const AgentActivityList: React.FC<AgentActivityListProps> = ({ 
  activities, 
  maxItems = 5 
}) => {
  if (!activities || activities.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 mb-2">
          <div className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-gray-500 opacity-20"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-gray-600"></span>
          </div>
          <span className="text-sm font-semibold text-gray-400 uppercase tracking-widest">Live Feed</span>
        </div>
        <div className="flex flex-col items-center justify-center p-8 text-center bg-gray-900/30 rounded-xl border border-gray-800 border-dashed">
          <div className="w-12 h-12 mb-3 rounded-full bg-gray-800/50 flex items-center justify-center">
            <ZapOff className="w-6 h-6 text-gray-600" />
          </div>
          <p className="text-sm font-medium text-gray-400">Awaiting Agent Actions</p>
          <p className="text-xs text-gray-600 mt-1">No activities recorded yet.</p>
        </div>
      </div>
    );
  }

  const visibleActivities = activities.slice(0, maxItems);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 mb-1">
        <div className="relative flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-3 w-3 bg-indigo-500 drop-shadow-[0_0_5px_rgba(99,102,241,0.8)]"></span>
        </div>
        <span className="text-sm font-bold text-indigo-400 uppercase tracking-widest drop-shadow-[0_0_8px_rgba(99,102,241,0.3)]">
          Live Activity Feed
        </span>
      </div>

      <div className="flex flex-col gap-3">
        {visibleActivities.map((activity, index) => (
          <div 
            key={activity.id || activity.txHash || index} 
            className="flex items-center gap-3 p-3.5 rounded-xl bg-gray-900/80 border border-gray-800 hover:border-gray-700 hover:bg-gray-800/50 transition-all group shadow-sm"
          >
            <div className="w-10 h-10 flex-shrink-0 flex items-center justify-center bg-gray-950 rounded-lg border border-gray-800 text-xl shadow-inner">
              {getIcon(activity.type)}
            </div>
            
            <div className="flex-1 flex flex-col justify-center min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${getBadgeStyle(activity.type)}`}>
                  {activity.type}
                </span>
                {activity.amount && activity.token && (
                  <span className="text-sm font-mono font-bold text-gray-200">
                    {activity.amount} <span className="text-gray-400 text-xs">{activity.token}</span>
                  </span>
                )}
              </div>
              {activity.timestamp && (
                <span className="text-xs text-gray-500 font-medium">
                  {timeAgo(activity.timestamp)}
                </span>
              )}
            </div>

            {activity.txHash && (
              <a 
                href={`https://etherscan.io/tx/${activity.txHash}`} 
                target="_blank" 
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-950 border border-gray-800 text-indigo-400 hover:text-indigo-300 hover:border-indigo-500/30 transition-all font-mono text-xs font-medium shrink-0"
                title="View Transaction"
              >
                {truncateHash(activity.txHash)}
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
