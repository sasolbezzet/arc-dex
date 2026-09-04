import type { AgentState } from '../../types/agent'
import { shortAddress } from './CopyField'

export interface RevokeModalProps {
  agent: AgentState
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** Revoking is per-agent and irreversible; the wallet itself is untouched. */
export function RevokeModal({ agent, busy, onConfirm, onCancel }: RevokeModalProps) {
  return (
    <div className='plugin-modal-backdrop' role='dialog' aria-modal='true' aria-label='Cabut akses agent'>
      <div className='glass plugin-modal'>
        <h3>Cabut akses {agent.clientName}?</h3>
        <p>
          Agent ini langsung kehilangan akses ke Agent Wallet {shortAddress(agent.walletAddress)}, dan
          semua tokennya berhenti berlaku. Agent lain tetap berjalan normal.
        </p>
        <p>
          Dana di wallet tidak berpindah dan tidak hilang. Anda bisa menghubungkan agent ini lagi nanti
          dengan token koneksi baru.
        </p>

        <div className='plugin-modal-actions'>
          <button type='button' className='mini-button' disabled={busy} onClick={onCancel}>
            Batal
          </button>
          <button type='button' className='action-button' disabled={busy} onClick={onConfirm}>
            {busy ? 'Mencabut…' : 'Ya, cabut akses'}
          </button>
        </div>
      </div>
    </div>
  )
}
