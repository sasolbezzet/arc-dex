import { oauthAgentLabel, type OAuthStep } from '../../hooks/useOAuthApproval'
import { useI18n } from '../../i18n'

export interface OAuthApprovalCardProps {
  clientId: string
  step: OAuthStep
  stepLabel: string
  busy: boolean
  error: string | null
  onApprove: (mode: 'login' | 'register') => void
  onCancel: () => void
}

const STEP_KEYS: Array<{ key: OAuthStep; labelKey: 'plugin.oauthStepPasskey' | 'plugin.oauthStepChecking' | 'plugin.oauthStepApproving' | 'plugin.oauthStepDone' }> = [
  { key: 'passkey', labelKey: 'plugin.oauthStepPasskey' },
  { key: 'checking', labelKey: 'plugin.oauthStepChecking' },
  { key: 'approving', labelKey: 'plugin.oauthStepApproving' },
  { key: 'done', labelKey: 'plugin.oauthStepDone' },
]

const ORDER: OAuthStep[] = ['idle', 'passkey', 'checking', 'approving', 'done']

/**
 * Shown when Claude / ChatGPT redirects the user here to approve a connection.
 * Wording deliberately avoids protocol jargon: the user sees Izinkan / periksa /
 * kembali instead of OAuth, PKCE, and UserOperation.
 */
export function OAuthApprovalCard({
  clientId,
  step,
  stepLabel,
  busy,
  error,
  onApprove,
  onCancel,
}: OAuthApprovalCardProps) {
  const { t } = useI18n()
  const agentLabel = oauthAgentLabel(clientId)
  const currentIndex = ORDER.indexOf(step === 'error' ? 'idle' : step)

  return (
    <section className='glass plugin-oauth'>
      <div className='plugin-oauth-head'>
        <div className='plugin-oauth-mark'>!</div>
        <div style={{ minWidth: 0 }}>
          <strong style={{ color: '#fde68a', fontSize: 14 }}>{t('plugin.oauthRequestTitle', { agent: agentLabel })}</strong>
          <p style={{ margin: '4px 0 0', color: '#a8b3c7', fontSize: 12 }}>
            {t('plugin.oauthRequestCopy', { agent: agentLabel })} {t('plugin.oauthRequestFlow')}
          </p>
        </div>
      </div>

      <div className='plugin-oauth-steps'>
        {STEP_KEYS.map((item, index) => {
          const itemIndex = ORDER.indexOf(item.key)
          const state = currentIndex > itemIndex ? 'done' : currentIndex === itemIndex ? 'active' : ''
          return (
            <div className={`plugin-oauth-step ${state}`} key={item.key}>
              <i>{state === 'done' ? '✓' : index + 1}</i>
              {t(item.labelKey)}
            </div>
          )
        })}
      </div>

      {busy && <p style={{ color: '#fde68a', fontSize: 12 }}>{stepLabel || t('plugin.processing')}</p>}
      {error && <div className='inline-error'>{error}</div>}

      <div className='plugin-modal-actions' style={{ justifyContent: 'flex-start' }}>
        <button type='button' className='action-button' disabled={busy} onClick={() => onApprove('login')}>
          {busy ? t('plugin.processing') : t('plugin.loginPasskey')}
        </button>
        <button type='button' className='mini-button' disabled={busy} onClick={() => onApprove('register')}>
          {t('plugin.createAgentWallet')}
        </button>
        <button type='button' className='mini-button' disabled={busy} onClick={onCancel}>
          {t('plugin.oauthCancel')}
        </button>
      </div>

      <p style={{ color: '#71809a', fontSize: 11, margin: 0 }}>
        {t('plugin.oauthFootnote')}
      </p>
    </section>
  )
}
