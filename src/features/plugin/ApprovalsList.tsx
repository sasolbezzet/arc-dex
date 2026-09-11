import { useI18n } from '../../i18n'
import type { Approval } from '../../types/agent'

export interface ApprovalsListProps {
  approvals: Approval[]
  busyAction: string | null
  onApprove: (id: string) => void
  onReject: (id: string) => void
}

const ACTION_LABEL_KEYS: Record<string, 'plugin.approvalActionSend' | 'plugin.approvalActionSwap' | 'plugin.approvalActionBridge'> = {
  send: 'plugin.approvalActionSend',
  swap: 'plugin.approvalActionSwap',
  bridge: 'plugin.approvalActionBridge',
}

function timeAgo(timestamp: number, t: (key: 'plugin.justNow' | 'plugin.minutesAgo' | 'plugin.hoursAgo' | 'plugin.daysAgo', params?: Record<string, string | number>) => string): string {
  if (!timestamp) return ''
  const ms = Date.now() - (timestamp < 1e12 ? timestamp * 1000 : timestamp)
  const minutes = Math.floor(ms / 60000)
  if (minutes < 1) return t('plugin.justNow')
  if (minutes < 60) return t('plugin.minutesAgo', { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('plugin.hoursAgo', { count: hours })
  return t('plugin.daysAgo', { count: Math.floor(hours / 24) })
}

/** Requests an agent wants the owner to approve before any value moves. */
export function ApprovalsList({ approvals, busyAction, onApprove, onReject }: ApprovalsListProps) {
  const { t } = useI18n()

  if (approvals.length === 0) {
    return (
      <div className='plugin-empty'>
        <strong>{t('plugin.approvalEmpty')}</strong>
        <p>{t('plugin.approvalEmptyCopy')}</p>
      </div>
    )
  }

  return (
    <div className='plugin-list'>
      {approvals.map(approval => (
        <div className='plugin-list-row' key={approval.id}>
          <div>
            <strong>
              {ACTION_LABEL_KEYS[approval.action] ? t(ACTION_LABEL_KEYS[approval.action]) : approval.action} {approval.amount} {approval.token}
            </strong>
            <small>
              {approval.agent || t('plugin.hermesName')}
              {approval.to ? ` · ${t('plugin.approvalTarget')} ${approval.to.slice(0, 10)}…${approval.to.slice(-6)}` : ''}
              {approval.createdAt ? ` · ${timeAgo(approval.createdAt, t)}` : ''}
            </small>
          </div>
          <div className='plugin-list-actions'>
            <button
              type='button'
              className='mini-button mini-button-primary'
              disabled={Boolean(busyAction)}
              onClick={() => onApprove(approval.id)}
            >
              {busyAction === `approve:${approval.id}` ? t('plugin.approving') : t('plugin.approve')}
            </button>
            <button
              type='button'
              className='mini-button'
              disabled={Boolean(busyAction)}
              onClick={() => onReject(approval.id)}
            >
              {busyAction === `reject:${approval.id}` ? t('plugin.rejecting') : t('plugin.reject')}
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
