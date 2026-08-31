import type { Activity } from '../../types/agent'

export interface AgentActivityListProps {
  activities: Activity[]
}

const TYPE_LABEL: Record<string, string> = {
  send: 'Kirim dana',
  swap: 'Tukar token',
  bridge: 'Pindah jaringan',
  card_spend: 'Pembayaran kartu',
  card_refund: 'Pengembalian kartu',
  x402_payment: 'Pembayaran data',
  approval: 'Permintaan izin',
  session: 'Sesi Agent Wallet',
}

const EXPLORER = 'https://explorer-testnet.arc.network/tx/'

function formatTime(timestamp: number): string {
  if (!timestamp) return ''
  const date = new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString('id-ID', { hour12: false, dateStyle: 'short', timeStyle: 'short' })
}

/** Newest agent events. The backend caps this at five entries on purpose. */
export function AgentActivityList({ activities }: AgentActivityListProps) {
  if (activities.length === 0) {
    return (
      <div className='plugin-empty'>
        <strong>Belum ada aktivitas</strong>
        <p>Setiap tindakan agent — kirim, tukar, pembayaran — tercatat di sini setelah selesai.</p>
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
                {TYPE_LABEL[entry.type] || entry.type}
                {amount ? ` · ${amount} ${token}`.trimEnd() : ''}
              </strong>
              <small>
                {formatTime(entry.ts)}
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
                  Lihat bukti
                </a>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
