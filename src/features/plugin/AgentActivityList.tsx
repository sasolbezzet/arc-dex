import React from 'react';
import type { Activity } from '../../types/agent';

export interface AgentActivityListProps {
  activities: Activity[];
  maxItems?: number;
}

const timeAgo = (timestamp: string): string => {
  const date = new Date(timestamp);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return Math.floor(seconds) + ' secs ago';
  let interval = seconds / 60;
  if (interval < 60) return Math.floor(interval) + ' mins ago';
  interval = interval / 60;
  if (interval < 24) return Math.floor(interval) + ' hours ago';
  interval = interval / 24;
  if (interval < 30) return Math.floor(interval) + ' days ago';
  interval = interval / 30;
  if (interval < 12) return Math.floor(interval) + ' months ago';
  return Math.floor(interval / 12) + ' years ago';
};

const getIcon = (type: string): string => {
  switch (type.toLowerCase()) {
    case 'send': return '📤';
    case 'swap': return '🔄';
    case 'receive': return '📥';
    case 'approve': return '✅';
    default: return '📋';
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
      <div className="text-gray-400 text-xs italic py-2">
        Belum ada aktivitas
      </div>
    );
  }

  const visibleActivities = activities.slice(0, maxItems);

  return (
    <div className="flex flex-col gap-2">
      {visibleActivities.map((activity, index) => (
        <div 
          key={activity.id || activity.txHash || index} 
          className="flex items-center gap-2 text-xs p-2 rounded bg-gray-800/50"
        >
          <span className="text-base">{getIcon(activity.type)}</span>
          
          <div className="flex-1 flex flex-col justify-center">
            <div className="flex items-center gap-1">
              <span className="font-semibold text-white capitalize">{activity.type}</span>
              {activity.amount && activity.token && (
                <span className="text-gray-300 font-medium">
                  {activity.amount} {activity.token}
                </span>
              )}
            </div>
            {activity.timestamp && (
              <span className="text-gray-500">
                {timeAgo(activity.timestamp)}
              </span>
            )}
          </div>

          {activity.txHash && (
            <a 
              href={`https://etherscan.io/tx/${activity.txHash}`} 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-indigo-400 hover:text-indigo-300 font-medium"
            >
              {truncateHash(activity.txHash)}
            </a>
          )}
        </div>
      ))}
    </div>
  );
};
