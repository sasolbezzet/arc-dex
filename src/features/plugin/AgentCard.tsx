import { AGENT_CONFIGS, type AgentState, type AgentType } from '../../types/agent'
import { AgentStatusBadge } from './AgentStatusBadge'
import { CopyField, shortAddress } from './CopyField'

export interface AgentCardProps {
  agentType: AgentType
  agent?: AgentState
  /** Wallet remembered in this browser even before a backend binding exists. */
  knownWallet?: string
  busyAction: string | null
  onConnect: () => void
  onLogin: () => void
  onCreateToken: () => void
  onRevoke: () => void
}

function formatTime(value: number | null): string {
  if (!value) return 'Belum ada'
  const date = new Date(value < 1e12 ? value * 1000 : value)
  if (Number.isNaN(date.getTime())) return 'Belum ada'
  return date.toLocaleString('id-ID', { hour12: false, dateStyle: 'short', timeStyle: 'short' })
}

function shortAgentKey(value: string): string {
  if (!value) return 'Belum terdaftar'
  return value.length <= 30 ? value : `${value.slice(0, 18)}…${value.slice(-8)}`
}

function modeLabel(agent?: AgentState): string {
  if (agent?.connectionMode === 'token') return 'Token header'
  if (agent?.connectionMode === 'oauth') return 'OAuth + PKCE'
  return 'MCP'
}

/** A single agent control card. agentKey is deliberately the identity boundary. */
export function AgentCard({
  agentType,
  agent,
  knownWallet,
  busyAction,
  onConnect,
  onLogin,
  onCreateToken,
  onRevoke,
}: AgentCardProps) {
  const config = AGENT_CONFIGS[agentType]
  const wallet = agent?.walletAddress || knownWallet || ''
  const status = agent?.status || (wallet ? 'idle' : 'not_connected')
  const isHermes = agentType === 'hermes'
  const busy = Boolean(busyAction && (busyAction.includes(agentType) || (agent && busyAction.includes(agent.agentKey))))
  const anyBusy = Boolean(busyAction)

  return (
    <article className={`glass agent-card ${agent ? 'agent-card-connected' : 'agent-card-empty'}`} style={{ ['--agent-accent' as string]: config.accent }}>
      <div className='agent-card-head'>
        <div className='agent-mark'>{config.mark}</div>
        <div className='agent-card-title'>
          <strong>{agent?.clientName || config.name}</strong>
          <span>{agent ? modeLabel(agent) : config.connectionType}</span>
        </div>
        <AgentStatusBadge status={status} />
      </div>

      <div className='agent-card-description'>
        <p>{config.description}</p>
        {agent && <code className='agent-key'>{shortAgentKey(agent.agentKey)}</code>}
      </div>

      {wallet
        ? <CopyField label='Agent Wallet' value={wallet} display={shortAddress(wallet)} ariaLabel='Salin alamat Agent Wallet' />
        : (
          <div className='agent-wallet-row'>
            <span>Agent Wallet</span>
            <code>Belum dibuat</code>
          </div>
        )}

      {agent ? (
        <>
          <div className='agent-balance-panel'>
            <div className='agent-balance-head'><span>Saldo Agent Wallet · Arc</span><small>{agent.balanceUpdatedAt ? 'Diperbarui' : 'Memuat…'}</small></div>
            {agent.balance
              ? <div className='agent-balance-values'>
                  <div><strong>{agent.balance.USDC ?? '0'}</strong><span>USDC</span></div>
                  <div><strong>{agent.balance.EURC ?? '0'}</strong><span>EURC</span></div>
                  <div><strong>{agent.balance.USYC ?? '0'}</strong><span>USYC</span></div>
                  <div><strong>{agent.balance.cirBTC ?? '0'}</strong><span>cirBTC</span></div>
                </div>
              : <p className='agent-balance-unavailable'>Saldo belum tersedia. Muat ulang setelah backend RPC merespons.</p>}
          </div>

          <div className='agent-health-grid'>
            <div className='agent-health-item'>
              <span>Passkey</span>
              <strong className='is-good'>{agent.passkeyBound === false ? 'Belum terikat' : 'Terikat'}</strong>
            </div>
            <div className='agent-health-item'>
              <span>MCP</span>
              <strong className={agent.status === 'connected' ? 'is-good' : ''}>{agent.status === 'connected' ? 'Online' : 'Menunggu koneksi'}</strong>
            </div>
            <div className='agent-health-item'>
              <span>Spend hari ini</span>
              <strong>{agent.spentToday} USDC</strong>
            </div>
          </div>

          <div className='agent-meta'>
            <div>
              <small>Terakhir dipakai</small>
              <strong>{formatTime(agent.lastUsedAt || agent.lastActivity)}</strong>
            </div>
            <div>
              <small>Terhubung sejak</small>
              <strong>{formatTime(agent.boundAt || agent.connectedAt)}</strong>
            </div>
          </div>
        </>
      ) : (
        <div className='agent-setup-copy'>
          <span className='setup-dot' />
          <p>{isHermes ? 'Buat Agent Wallet lalu salin token koneksi ke terminal Hermes.' : `Mulai koneksi dari aplikasi ${config.name}. Permintaan izin akan kembali ke halaman ini.`}</p>
        </div>
      )}

      <div className='agent-actions'>
        {isHermes && !agent && (
          <>
            <button type='button' className='action-button' disabled={anyBusy} onClick={onConnect}>
              {busy ? 'Menyiapkan…' : 'Buat Agent Wallet'}
            </button>
            <button type='button' className='mini-button' disabled={anyBusy} onClick={onLogin}>
              {busy ? 'Membuka passkey…' : 'Login passkey'}
            </button>
          </>
        )}
        {isHermes && agent && (
          <button type='button' className='action-button' disabled={anyBusy} onClick={onCreateToken}>
            {busyAction === `token:${agent.agentKey}` ? 'Membuat token…' : 'Rotasi token koneksi'}
          </button>
        )}
        {!isHermes && agent && (
          <button type='button' className='action-button' disabled={anyBusy} onClick={onLogin}>
            {busy ? 'Membuka passkey…' : 'Login passkey'}
          </button>
        )}
        {agent && (
          <>
            <button type='button' className='mini-button' disabled={anyBusy} onClick={onLogin}>
              Buka wallet
            </button>
            <button type='button' className='mini-button mini-button-danger' disabled={anyBusy} onClick={onRevoke}>
              Cabut akses
            </button>
          </>
        )}
        {!agent && !isHermes && (
          <div className='agent-external-note'>Koneksi dimulai dari aplikasi agent</div>
        )}
      </div>

      {!agent && isHermes && (
        <p className='agent-action-hint'>Login passkey memakai Agent Wallet Hermes yang sudah terdaftar; Buat Agent Wallet membuat wallet baru.</p>
      )}
    </article>
  )
}
