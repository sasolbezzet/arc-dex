import React from 'react';
import type { AgentStatus } from '../../types/agent';

export interface AgentStatusBadgeProps {
  status: AgentStatus;
  size?: 'sm' | 'md';
}

const statusConfig: Record<AgentStatus, { label: string; bgClass: string; textClass: string; dotClass: string }> = {
  connected: { label: 'Connected', bgClass: 'bg-green-500/20', textClass: 'text-green-400', dotClass: 'bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]' },
  idle: { label: 'Idle', bgClass: 'bg-slate-500/20', textClass: 'text-slate-400', dotClass: 'bg-slate-500' },
  passkey_required: { label: 'Setup Required', bgClass: 'bg-yellow-500/20', textClass: 'text-yellow-400', dotClass: 'bg-yellow-500' },
  revoked: { label: 'Revoked', bgClass: 'bg-red-500/20', textClass: 'text-red-400', dotClass: 'bg-red-500' },
  deploying: { label: 'Deploying...', bgClass: 'bg-indigo-500/20 animate-pulse', textClass: 'text-indigo-400', dotClass: 'bg-indigo-500' },
  connecting: { label: 'Connecting...', bgClass: 'bg-indigo-500/20 animate-pulse', textClass: 'text-indigo-400', dotClass: 'bg-indigo-500' },
};

export const AgentStatusBadge: React.FC<AgentStatusBadgeProps> = ({ status, size = 'sm' }) => {
  const config = statusConfig[status] || statusConfig.idle;
  const paddingClass = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm';
  const dotSizeClass = size === 'sm' ? 'w-1.5 h-1.5' : 'w-2 h-2';

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-medium ${config.bgClass} ${config.textClass} ${paddingClass}`}>
      <span className={`rounded-full ${config.dotClass} ${dotSizeClass}`} />
      {config.label}
    </span>
  );
};
