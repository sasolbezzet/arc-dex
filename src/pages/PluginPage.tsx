import { useMemo, useState } from 'react'
import { useAgentManager } from '../hooks/useAgentManager'
import { useOAuthApproval } from '../hooks/useOAuthApproval'
import { AgentCard } from '../features/plugin/AgentCard'
import { ApprovalsList } from '../features/plugin/ApprovalsList'
import { AgentActivityList } from '../features/plugin/AgentActivityList'
import { ConnectionTokenDialog } from '../features/plugin/ConnectionTokenDialog'
import { RevokeModal } from '../features/plugin/RevokeModal'
import { OAuthApprovalCard } from '../features/plugin/OAuthApprovalCard'
import { CopyField } from '../features/plugin/CopyField'
import { AGENT_TYPES, AGENT_CONFIGS, MCP_URL, type AgentState, type AgentType } from '../types/agent'

type TabId = 'overview' | 'approvals' | 'activity' | 'security'

function displayAgentName(agent: AgentState): string {
  return agent.clientName || AGENT_CONFIGS[agent.agentType]?.name || 'Agent'
}

/**
 * Agent control center: identity, permissions, approvals, activity, and
 * connection security live in one page. The exact agentKey remains the identity
 * boundary; agentType is used only for visual grouping and copy.
 */
export default function PluginPage() {
  const {
    agents,
    pendingApprovals,
    activity,
    credentials,
    limits,
    connectionToken,
    connectedCount,
    mcpSessions,
    busyAction,
    error,
    notice,
    hasSession,
    connectHermes,
    prepareAgentWallet,
    loginAgent,
    createToken,
    revokeAgent,
    approveRequest,
    rejectRequest,
    saveLimits,
    setConnectionToken,
    dismissError,
    dismissNotice,
  } = useAgentManager()

  const oauth = useOAuthApproval()
  const [tab, setTab] = useState<TabId>('overview')
  const [activityAgentKey, setActivityAgentKey] = useState('all')
  const [revokeTarget, setRevokeTarget] = useState<AgentState | null>(null)
  const [draftMaxPerTx, setDraftMaxPerTx] = useState<string | null>(null)
  const [draftDailyLimit, setDraftDailyLimit] = useState<string | null>(null)

  const visibleActivity = useMemo(
    () => activityAgentKey === 'all'
      ? activity
      : activity.filter(entry => String(entry.data?.agentKey || '') === activityAgentKey),
    [activity, activityAgentKey],
  )
  const connectedTypes = useMemo(() => new Set(agents.map(agent => agent.agentType)), [agents])
  const currentMaxPerTx = draftMaxPerTx ?? limits?.maxPerTx ?? '100'
  const currentDailyLimit = draftDailyLimit ?? limits?.dailyLimit ?? '500'

  const handleConnect = (type: AgentType) => {
    // The primary empty-state action is the first-time path: create a
    // dedicated Agent Wallet. Returning users use the secondary Login action.
    if (type === 'hermes') return connectHermes('register')
    return prepareAgentWallet(type, 'register')
  }

  const handleLogin = (type: AgentType) => {
    if (type === 'hermes') return connectHermes('login')
    return prepareAgentWallet(type, 'login')
  }

  const handleSaveLimits = () => {
    void saveLimits({
      maxPerTx: Number(draftMaxPerTx ?? limits?.maxPerTx ?? 100),
      dailyLimit: Number(draftDailyLimit ?? limits?.dailyLimit ?? 500),
      autoApprove: limits?.autoApprove ?? true,
      whitelist: limits?.whitelist ?? [],
    })
  }

  return (
    <div className='plugin-page'>
      {oauth.request && (
        <OAuthApprovalCard
          clientId={oauth.request.clientId}
          step={oauth.step}
          stepLabel={oauth.stepLabel}
          busy={oauth.busy}
          error={oauth.error}
          onApprove={oauth.approve}
          onCancel={oauth.cancel}
        />
      )}

      {error && (
        <div className='inline-error plugin-alert'>
          <span>{error}</span>
          <button type='button' className='text-button' onClick={dismissError}>Tutup</button>
        </div>
      )}
      {notice && (
        <div className='inline-notice plugin-alert'>
          <span>{notice}</span>
          <button type='button' className='text-button' onClick={dismissNotice}>Tutup</button>
        </div>
      )}

      <section className='glass plugin-hero plugin-hero-v2'>
        <div className='plugin-hero-copy'>
          <div className='plugin-eyebrow'><span className='plugin-eyebrow-dot' /> Agent control center</div>
          <h2>Kontrol semua agent Anda</h2>
          <p>Kelola wallet, akses MCP, batas pengeluaran, dan setiap permintaan transaksi dari satu tempat.</p>
          <div className='plugin-hero-actions'>
            <button type='button' className='action-button' onClick={() => setTab('overview')}>Kelola agent</button>
            {pendingApprovals.length > 0 && <button type='button' className='mini-button' onClick={() => setTab('approvals')}>Tinjau {pendingApprovals.length} permintaan</button>}
          </div>
        </div>
        <div className='plugin-hero-meta plugin-hero-metrics'>
          <div className='plugin-metric-primary'><strong>{agents.length}</strong><span>agent terdaftar</span></div>
          <div className='plugin-metric-row'><span>Online</span><strong>{connectedCount}</strong></div>
          <div className='plugin-metric-row'><span>Permintaan</span><strong className={pendingApprovals.length ? 'is-warning' : ''}>{pendingApprovals.length}</strong></div>
        </div>
      </section>

      <section className='glass plugin-first-run' aria-labelledby='plugin-first-run-title'>
        <div className='plugin-section-heading'>
          <div><span className='section-eyebrow'>Panduan pertama kali</span><strong id='plugin-first-run-title'>Satu urutan untuk semua agent</strong></div>
          <span className='plugin-secure-label'>● tidak ada private key</span>
        </div>
        <p className='plugin-muted-copy'>Pisahkan tiga hal ini: wallet utama untuk fitur DEX, Agent Wallet yang dikunci passkey, dan koneksi MCP ke agent AI.</p>
        <div className='plugin-first-run-grid'>
          <div className='plugin-first-run-step'><b>01</b><div><strong>Aktifkan Agent Wallet</strong><span>Tekan <em>Buat Agent Wallet</em> atau buka kartu agent yang ingin dipakai. Pilih Login jika wallet sudah ada; pilih Buat baru hanya untuk agent baru.</span></div></div>
          <div className='plugin-first-run-step'><b>02</b><div><strong>Mulai dari aplikasi agent</strong><span>Hermes memakai token dari ARCOX. Claude dan ChatGPT dimulai dari pengaturan MCP mereka, lalu otomatis kembali ke halaman approval ARCOX.</span></div></div>
          <div className='plugin-first-run-step'><b>03</b><div><strong>Setujui satu kali</strong><span>Di halaman ARCOX, periksa nama agent lalu pilih Login passkey atau Buat wallet baru. Tidak perlu SIWE wallet utama untuk koneksi MCP.</span></div></div>
          <div className='plugin-first-run-step'><b>04</b><div><strong>Selesai dan pantau</strong><span>Hermes menerima token satu kali. Claude/ChatGPT kembali ke aplikasinya; status, approval, limit, dan activity terlihat di tab ini.</span></div></div>
        </div>
      </section>

      {!hasSession && (
        <section className='plugin-session-banner'>
          <div className='plugin-session-icon'>⌁</div>
          <div>
            <strong>Aktifkan Agent Wallet dengan passkey</strong>
            <p>Ini berbeda dari wallet utama. Passkey mengunci wallet khusus agent dan membuka kontrol keamanan.</p>
          </div>
          <div className='plugin-session-actions'>
            <button type='button' className='mini-button mini-button-primary' onClick={() => handleConnect('hermes')}>Buat Agent Wallet</button>
            <button type='button' className='text-button' onClick={() => handleLogin('hermes')}>Login passkey yang sudah ada</button>
          </div>
        </section>
      )}

      <section className='glass plugin-connect-strip'>
        <div className='plugin-section-heading'>
          <div><span className='section-eyebrow'>Endpoint MCP</span><strong>Hubungkan agent baru</strong></div>
          <span className='plugin-secure-label'>● owner-controlled</span>
        </div>
        <p>Gunakan URL ini pada Claude, ChatGPT, Hermes, atau client MCP lain. Setiap koneksi mendapat wallet dan izin terpisah.</p>
        <CopyField value={MCP_URL} ariaLabel='Salin alamat koneksi MCP' />
      </section>

      <nav className='glass plugin-tabs plugin-tabs-v2' aria-label='Navigasi Plugin'>
        {([
          ['overview', 'Overview', agents.length],
          ['approvals', 'Permintaan izin', pendingApprovals.length],
          ['activity', 'Aktivitas', activity.length],
          ['security', 'Keamanan', credentials.length],
        ] as const).map(([id, label, count]) => (
          <button key={id} type='button' className={`plugin-tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
            <span>{label}</span>
            {count > 0 && <b>{count}</b>}
          </button>
        ))}
      </nav>

      {tab === 'overview' && (
        <div className='plugin-overview'>
          <div className='plugin-section-title'>
            <div><span className='section-eyebrow'>Identitas terisolasi</span><h3>Agent Anda</h3></div>
            <span>{agents.length} koneksi</span>
          </div>

          {agents.length > 0 ? (
            <div className='agent-grid'>
              {agents.map(agent => (
                <AgentCard
                  key={agent.agentKey}
                  agentType={agent.agentType}
                  agent={agent}
                  busyAction={busyAction}
                  onConnect={() => loginAgent(agent.agentKey)}
                  onCreateWallet={() => loginAgent(agent.agentKey)}
                  onLogin={() => loginAgent(agent.agentKey)}
                  onCreateToken={() => createToken(agent.agentKey)}
                  onRevoke={() => setRevokeTarget(agent)}
                />
              ))}
            </div>
          ) : (
            <div className='plugin-empty plugin-empty-hero'>
              <div className='plugin-empty-mark'>+</div>
              <strong>Belum ada agent yang terhubung</strong>
              <p>Pilih metode koneksi di bawah untuk membuat Agent Wallet pertama Anda.</p>
            </div>
          )}

          <div className='plugin-section-title plugin-section-title-spaced'>
            <div><span className='section-eyebrow'>Metode koneksi</span><h3>Tambah agent</h3></div>
          </div>
          <div className='plugin-provider-grid'>
            {AGENT_TYPES.map(type => {
              const config = AGENT_CONFIGS[type]
              const connected = connectedTypes.has(type)
              return (
                <article key={type} className='plugin-provider-card' style={{ ['--agent-accent' as string]: config.accent }}>
                  <div className='plugin-provider-mark'>{config.mark}</div>
                  <div className='plugin-provider-copy'><strong>{config.name}</strong><span>{connected ? 'Sudah terhubung' : config.connectionType}</span></div>
                  <p>{config.description}</p>
                  {connected
                    ? <button type='button' className='mini-button' onClick={() => setTab('activity')}>Lihat koneksi</button>
                    : type === 'hermes'
                      ? <button type='button' className='mini-button' disabled={Boolean(busyAction)} onClick={() => handleConnect(type)}>Buat Agent Wallet</button>
                      : <div className='agent-external-note'>Mulai dari {config.name}, lalu kembali ke sini</div>}
                </article>
              )
            })}
          </div>
        </div>
      )}

      {tab === 'approvals' && (
        <section className='plugin-panel-section'>
          <div className='plugin-section-title'><div><span className='section-eyebrow'>Tindakan bernilai</span><h3>Permintaan yang memerlukan Anda</h3></div><span className='plugin-count-badge'>{pendingApprovals.length} pending</span></div>
          <div className='plugin-safety-note'><span>!</span><p>Periksa agent, jumlah, token, chain, dan alamat tujuan sebelum menyetujui. Tombol ini hanya mengubah status persetujuan; transaksi tetap mengikuti flow signing yang aman.</p></div>
          <ApprovalsList approvals={pendingApprovals} busyAction={busyAction} onApprove={approveRequest} onReject={rejectRequest} />
        </section>
      )}

      {tab === 'activity' && (
        <section className='plugin-panel-section'>
          <div className='plugin-section-title'><div><span className='section-eyebrow'>Audit trail</span><h3>Aktivitas terbaru</h3></div><select className='plugin-select' value={activityAgentKey} onChange={event => setActivityAgentKey(event.target.value)}><option value='all'>Semua agent</option>{agents.map(agent => <option key={agent.agentKey} value={agent.agentKey}>{displayAgentName(agent)}</option>)}</select></div>
          <div className='plugin-activity-summary'><span><strong>{visibleActivity.length}</strong> event ditampilkan</span><span>Auto-refresh setiap 10 detik</span></div>
          <AgentActivityList activities={visibleActivity} />
        </section>
      )}

      {tab === 'security' && (
        <div className='plugin-security-grid'>
          <section className='plugin-panel-section'>
            <div className='plugin-section-title'><div><span className='section-eyebrow'>Spending policy</span><h3>Batas default owner</h3></div><span className='plugin-secure-label'>● fail-closed</span></div>
            <p className='plugin-muted-copy'>Batas ini menjadi pagar dasar. Policy per-agent akan menjadi lapisan berikutnya saat tersedia.</p>
            <div className='plugin-form-grid'>
              <label><span>Maksimum per transaksi</span><div className='plugin-input-wrap'>                  <input className='input' inputMode='decimal' value={String(currentMaxPerTx)} onChange={event => setDraftMaxPerTx(event.target.value)} aria-label='Maksimum per transaksi' /><em>USDC</em></div></label>
              <label><span>Batas harian</span><div className='plugin-input-wrap'>                  <input className='input' inputMode='decimal' value={String(currentDailyLimit)} onChange={event => setDraftDailyLimit(event.target.value)} aria-label='Batas harian' /><em>USDC</em></div></label>
            </div>
            <div className='plugin-policy-row'><span>Auto-approve</span><strong>{limits?.autoApprove ? 'Aktif' : 'Nonaktif'}</strong></div>
            <div className='plugin-policy-row'><span>Whitelist</span><strong>{limits?.whitelist?.length || 0} alamat</strong></div>
            <button type='button' className='action-button plugin-save-button' disabled={busyAction === 'limits'} onClick={handleSaveLimits}>{busyAction === 'limits' ? 'Menyimpan…' : 'Simpan batas'}</button>
          </section>

          <section className='plugin-panel-section'>
            <div className='plugin-section-title'><div><span className='section-eyebrow'>Vault access</span><h3>Credential tersimpan</h3></div><span>{credentials.length} item</span></div>
            <p className='plugin-muted-copy'>Nilai sensitif selalu dimasking. MCP agent tidak dapat mengelola credential owner.</p>
            {credentials.length === 0 ? <div className='plugin-empty plugin-empty-small'><strong>Belum ada credential</strong><p>Credential wallet akan terdaftar setelah autentikasi berhasil.</p></div> : <div className='plugin-credential-list'>{credentials.map(credential => <div className='plugin-credential-row' key={credential.id}><span className='plugin-credential-icon'>{credential.type === 'api_key' ? 'AK' : 'WK'}</span><div><strong>{credential.label}</strong><small>{credential.type}</small></div><code>{credential.value || '••••••••'}</code></div>)}</div>}
          </section>

          <section className='plugin-panel-section plugin-security-wide'>
            <div className='plugin-section-title'><div><span className='section-eyebrow'>Connection security</span><h3>Lapisan perlindungan aktif</h3></div></div>
            <div className='plugin-security-checks'><div><b>✓</b><span><strong>Wallet terisolasi</strong><small>Setiap agent dikunci ke MSCA masing-masing.</small></span></div><div><b>✓</b><span><strong>Token scoped</strong><small>Revoke satu agent tidak mematikan agent lain.</small></span></div><div><b>✓</b><span><strong>PKCE + passkey</strong><small>Koneksi OAuth diverifikasi terhadap request asli.</small></span></div><div><b>✓</b><span><strong>Session aktif</strong><small>{mcpSessions.length} sesi MCP terdeteksi oleh backend.</small></span></div></div>
          </section>
        </div>
      )}

      {connectionToken && <ConnectionTokenDialog token={connectionToken} onClose={() => setConnectionToken(null)} />}
      {revokeTarget && <RevokeModal agent={revokeTarget} busy={busyAction === `revoke:${revokeTarget.agentKey}`} onConfirm={async () => { const target = revokeTarget; setRevokeTarget(null); await revokeAgent(target.agentKey) }} onCancel={() => setRevokeTarget(null)} />}
    </div>
  )
}
