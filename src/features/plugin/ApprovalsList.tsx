import type { Approval } from '../../types/agent'

export interface ApprovalsListProps {
  approvals: Approval[]
  busyAction: string | null
  onApprove: (id: string) => void
  onReject: (id: string) => void
}

const ACTION_LABEL: Record<string, string> = {
  send: 'Kirim',
  swap: 'Tukar',
  bridge: 'Pindah jaringan',
}

function timeAgo(timestamp: number): string {
  if (!timestamp) return ''
  const ms = Date.now() - (timestamp < 1e12 ? timestamp * 1000 : timestamp)
  const minutes = Math.floor(ms / 60000)
  if (minutes < 1) return 'baru saja'
  if (minutes < 60) return `${minutes} menit lalu`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} jam lalu`
  return `${Math.floor(hours / 24)} hari lalu`
}

/** Requests an agent wants the owner to approve before any value moves. */
export function ApprovalsList({ approvals, busyAction, onApprove, onReject }: ApprovalsListProps) {
  if (approvals.length === 0) {
    return (
      <div className='plugin-empty'>
        <strong>Tidak ada permintaan menunggu</strong>
        <p>Saat agent meminta mengirim atau menukar dana, permintaannya muncul di sini untuk Anda setujui.</p>
      </div>
    )
  }

  return (
    <div className='plugin-list'>
      {approvals.map(approval => (
        <div className='plugin-list-row' key={approval.id}>
          <div>
            <strong>
              {ACTION_LABEL[approval.action] || approval.action} {approval.amount} {approval.token}
            </strong>
            <small>
              {approval.agent || 'Agent'}
              {approval.to ? ` · ke ${approval.to.slice(0, 10)}…${approval.to.slice(-6)}` : ''}
              {approval.createdAt ? ` · ${timeAgo(approval.createdAt)}` : ''}
            </small>
          </div>
          <div className='plugin-list-actions'>
            <button
              type='button'
              className='mini-button mini-button-primary'
              disabled={Boolean(busyAction)}
              onClick={() => onApprove(approval.id)}
            >
              {busyAction === `approve:${approval.id}` ? 'Menyetujui…' : 'Setujui'}
            </button>
            <button
              type='button'
              className='mini-button'
              disabled={Boolean(busyAction)}
              onClick={() => onReject(approval.id)}
            >
              Tolak
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
