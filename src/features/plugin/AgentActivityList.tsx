import { useI18n } from '../../i18n'
import type { Activity } from '../../types/agent'

export interface AgentActivityListProps {
  activities: Activity[]
}

const TYPE_LABEL_KEYS: Record<string, 'plugin.activitySend' | 'plugin.activitySwap' | 'plugin.activityBridge' | 'plugin.activityCardSpend' | 'plugin.activityCardRefund' | 'plugin.activityX402' | 'plugin.activityApproval' | 'plugin.activitySession'> = {
  send: 'plugin.activitySend',
  swap: 'plugin.activitySwap',
  bridge: 'plugin.activityBridge',
  card_spend: 'plugin.activityCardSpend',
  card_refund: 'plugin.activityCardRefund',
  x402_payment: 'plugin.activityX402',
  approval: 'plugin.activityApproval',
  session: 'plugin.activitySession',
}

const EXPLORER = 'https://explorer-testnet.arc.network/tx/'

function formatTime(timestamp: number, locale: string): string {
  if (!timestamp) return ''
  const date = new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString(locale === 'zh' ? 'zh-CN' : locale, { hour12: false, dateStyle: 'short', timeStyle: 'short' })
}

/** Newest agent events. The backend caps this at five entries on purpose. */
export function AgentActivityList({ activities }: AgentActivityListProps) {
  const { lang, t } = useI18n()

  if (activities.length === 0) {
    return (
      <div className='plugin-empty'>
        <strong>{t('plugin.noActivityTitle')}</strong>
        <p>{t('plugin.noActivityCopy')}</p>
      </div>
    )
  }

  return (
    <div className='plugin-list'>
      {activities.map(entry => {
        const data = (entry.data || {}) as Record<string, unknown>
        const amount = data.amount ? String(data.amount) : ''
        const token = data.token ? String(data.token) : ''
        const txHash = data.txHash ? String(data.txHash) : ''
        const detail = [data.action, data.merchantName, data.label, data.status]
          .filter(Boolean)
          .map(String)[0] || ''
        return (
          <div className='plugin-list-row' key={entry.id}>
            <div>
              <strong>
                {TYPE_LABEL_KEYS[entry.type] ? t(TYPE_LABEL_KEYS[entry.type]) : entry.type}
                {amount ? ` · ${amount} ${token}`.trimEnd() : ''}
              </strong>
              <small>
                {formatTime(entry.ts, lang)}
                {detail ? ` · ${detail}` : ''}
              </small>
            </div>
            {txHash && (
              <div className='plugin-list-actions'>
                <a
                  className='mini-button'
                  href={`${EXPLORER}${txHash}`}
                  target='_blank'
                  rel='noreferrer noopener'
                >
                  {t('plugin.viewProof')}
                </a>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
