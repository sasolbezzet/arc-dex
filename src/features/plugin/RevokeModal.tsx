import { useI18n } from '../../i18n'
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
  const { t } = useI18n()
  return (
    <div className='plugin-modal-backdrop' role='dialog' aria-modal='true' aria-label={t('plugin.revokeTitle', { agent: agent.clientName })}>
      <div className='glass plugin-modal'>
        <h3>{t('plugin.revokeTitle', { agent: agent.clientName })}</h3>
        <p>{t('plugin.revokeCopy1', { agent: agent.clientName, wallet: shortAddress(agent.walletAddress) })}</p>
        <p>{t('plugin.revokeCopy2')}</p>

        <div className='plugin-modal-actions'>
          <button type='button' className='mini-button' disabled={busy} onClick={onCancel}>
            {t('plugin.cancel')}
          </button>
          <button type='button' className='action-button' disabled={busy} onClick={onConfirm}>
            {busy ? t('plugin.revokeBusy') : t('plugin.confirmRevoke')}
          </button>
        </div>
      </div>
    </div>
  )
}
