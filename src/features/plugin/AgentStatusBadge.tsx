import { useI18n } from '../../i18n'
import type { AgentStatus } from '../../types/agent'

const LABEL_KEYS: Record<AgentStatus, 'plugin.connected' | 'common.ready' | 'common.notConnected' | 'wallet.connecting' | 'plugin.revoke'> = {
  connected: 'plugin.connected',
  idle: 'common.ready',
  not_connected: 'common.notConnected',
  connecting: 'wallet.connecting',
  revoked: 'plugin.revoke',
}

export interface AgentStatusBadgeProps {
  status: AgentStatus
}

/** One shared status pill so every surface labels an agent identically. */
export function AgentStatusBadge({ status }: AgentStatusBadgeProps) {
  const { t } = useI18n()
  return (
    <span className={`agent-status ${status}`}>
      <i />
      {t(LABEL_KEYS[status] || LABEL_KEYS.idle)}
    </span>
  )
}
