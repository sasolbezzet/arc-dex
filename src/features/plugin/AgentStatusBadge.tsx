import type { AgentStatus } from '../../types/agent'

const LABELS: Record<AgentStatus, string> = {
  connected: 'Terhubung',
  idle: 'Siap',
  not_connected: 'Belum terhubung',
  connecting: 'Menghubungkan',
  revoked: 'Dicabut',
}

export interface AgentStatusBadgeProps {
  status: AgentStatus
}

/** One shared status pill so every surface labels an agent identically. */
export function AgentStatusBadge({ status }: AgentStatusBadgeProps) {
  return (
    <span className={`agent-status ${status}`}>
      <i />
      {LABELS[status] || LABELS.idle}
    </span>
  )
}
