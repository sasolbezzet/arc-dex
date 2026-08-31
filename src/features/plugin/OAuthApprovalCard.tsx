import { oauthAgentLabel, type OAuthStep } from '../../hooks/useOAuthApproval'

export interface OAuthApprovalCardProps {
  clientId: string
  step: OAuthStep
  stepLabel: string
  busy: boolean
  error: string | null
  onApprove: (mode: 'login' | 'register') => void
  onCancel: () => void
}

const STEPS: Array<{ key: OAuthStep; label: string }> = [
  { key: 'passkey', label: 'Buka Agent Wallet dengan passkey' },
  { key: 'checking', label: 'Periksa kesiapan wallet' },
  { key: 'approving', label: 'Izinkan akses agent' },
  { key: 'done', label: 'Kembali ke aplikasi agent' },
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
  const agentLabel = oauthAgentLabel(clientId)
  const currentIndex = ORDER.indexOf(step === 'error' ? 'idle' : step)

  return (
    <section className='glass plugin-oauth'>
      <div className='plugin-oauth-head'>
        <div className='plugin-oauth-mark'>!</div>
        <div style={{ minWidth: 0 }}>
          <strong style={{ color: '#fde68a', fontSize: 14 }}>{agentLabel} meminta akses</strong>
          <p style={{ margin: '4px 0 0', color: '#a8b3c7', fontSize: 12 }}>
            Setujui hanya jika Anda memang baru saja memulai koneksi ini dari {agentLabel}.
            Agent akan bisa memakai Agent Wallet ini sesuai batas yang Anda tetapkan.
          </p>
        </div>
      </div>

      <div className='plugin-oauth-steps'>
        {STEPS.map((item, index) => {
          const itemIndex = ORDER.indexOf(item.key)
          const state = currentIndex > itemIndex ? 'done' : currentIndex === itemIndex ? 'active' : ''
          return (
            <div className={`plugin-oauth-step ${state}`} key={item.key}>
              <i>{state === 'done' ? '✓' : index + 1}</i>
              {item.label}
            </div>
          )
        })}
      </div>

      {busy && <p style={{ color: '#fde68a', fontSize: 12 }}>{stepLabel}</p>}
      {error && <div className='inline-error'>{error}</div>}

      <div className='plugin-modal-actions' style={{ justifyContent: 'flex-start' }}>
        <button type='button' className='action-button' disabled={busy} onClick={() => onApprove('login')}>
          {busy ? 'Memproses…' : 'Izinkan dengan passkey saya'}
        </button>
        <button type='button' className='mini-button' disabled={busy} onClick={() => onApprove('register')}>
          Buat wallet baru untuk agent ini
        </button>
        <button type='button' className='mini-button' disabled={busy} onClick={onCancel}>
          Tolak
        </button>
      </div>

      <p style={{ color: '#71809a', fontSize: 11, margin: 0 }}>
        Hubungkan wallet utama terlebih dahulu. ARCOX memakai wallet utama untuk membuktikan owner dan passkey untuk membuktikan Agent Wallet.
      </p>
    </section>
  )
}
