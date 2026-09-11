import { useState } from 'react'
import { useI18n } from '../../i18n'
import { AGENT_CONFIGS, SUPPORTED_CHAINS, type AgentState, type AgentType, type SupportedChain } from '../../types/agent'
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
  onDelete: () => void
  onBalanceChainChange: (chain: SupportedChain) => void
}

const CHAIN_LABELS: Record<SupportedChain, { short: string; tone: string; fullKey: 'plugin.arcTestnet' | 'plugin.baseSepolia' | 'plugin.arbitrumSepolia' }> = {
  'arc-testnet': { short: 'Arc', fullKey: 'plugin.arcTestnet', tone: 'arc' },
  'base-sepolia': { short: 'Base', fullKey: 'plugin.baseSepolia', tone: 'base' },
  'arbitrum-sepolia': { short: 'Arbitrum', fullKey: 'plugin.arbitrumSepolia', tone: 'arb' },
}

function formatTime(value: number | null, locale: string): string {
  if (!value) return '—'
  const date = new Date(value < 1e12 ? value * 1000 : value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(locale, { hour12: false, dateStyle: 'short', timeStyle: 'short' })
}

function shortAgentKey(value: string): string {
  if (!value) return '—'
  return value.length <= 30 ? value : `${value.slice(0, 18)}…${value.slice(-8)}`
}

function modeLabel(agent?: AgentState): string {
  if (agent?.connectionMode === 'token') return 'Token header'
  if (agent?.connectionMode === 'oauth') return 'OAuth + PKCE'
  return 'MCP'
}

const AGENT_COPY_KEYS: Record<AgentType, { name: 'plugin.hermesName' | 'plugin.claudeName' | 'plugin.chatgptName' | 'plugin.grokName' | 'plugin.externalConnectionType'; description: 'plugin.hermesDescription' | 'plugin.claudeDescription' | 'plugin.chatgptDescription' | 'plugin.grokDescription' | 'plugin.externalConnectionType'; type: 'plugin.connectionTokenType' | 'plugin.browserApprovalType' | 'plugin.customMcpOAuthType' | 'plugin.externalConnectionType' }> = {
  hermes: { name: 'plugin.hermesName', description: 'plugin.hermesDescription', type: 'plugin.connectionTokenType' },
  claude: { name: 'plugin.claudeName', description: 'plugin.claudeDescription', type: 'plugin.browserApprovalType' },
  chatgpt: { name: 'plugin.chatgptName', description: 'plugin.chatgptDescription', type: 'plugin.browserApprovalType' },
  grok: { name: 'plugin.grokName', description: 'plugin.grokDescription', type: 'plugin.customMcpOAuthType' },
  custom: { name: 'plugin.externalConnectionType', description: 'plugin.externalConnectionType', type: 'plugin.externalConnectionType' },
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
  onDelete,
  onBalanceChainChange,
}: AgentCardProps) {
  const [balanceChain, setBalanceChain] = useState<SupportedChain>('arc-testnet')
  const { lang, t } = useI18n()
  const config = AGENT_CONFIGS[agentType]
  const copyKeys = AGENT_COPY_KEYS[agentType]
  const wallet = agent?.walletAddress || knownWallet || ''
  const safeAgentKey = String(agent?.agentKey || '').trim()
  const status = agent?.status || (wallet ? 'idle' : 'not_connected')
  const isHermes = agentType === 'hermes'
  const busy = Boolean(busyAction && (busyAction.includes(agentType) || (agent && busyAction.includes(agent.agentKey))))
  const selectedBalance = agent?.balances?.[balanceChain] ?? (agent?.balanceChain === balanceChain ? agent.balance : undefined)
  const anyBusy = Boolean(busyAction)

  return (
    <article className={`glass agent-card ${agent ? 'agent-card-connected' : 'agent-card-empty'}`} style={{ ['--agent-accent' as string]: config.accent }}>
      <div className='agent-card-head'>
        <div className='agent-mark'>{config.mark}</div>
        <div className='agent-card-title'>
          <strong>{agent?.clientName || config.name}</strong>
          <span>{agent ? modeLabel(agent) : t(copyKeys.type)}</span>
        </div>
        <AgentStatusBadge status={status} />
      </div>

      <div className='agent-card-description'>
        <p>{t(copyKeys.description)}</p>
        {agent && <code className='agent-key'>{shortAgentKey(agent.agentKey)}</code>}
      </div>

      {wallet
        ? <CopyField label={t('plugin.agentWallet')} value={wallet} display={shortAddress(wallet)} ariaLabel={t('plugin.copyAgentWalletAddress')} />
        : (
          <div className='agent-wallet-row'>
            <span>{t('plugin.agentWallet')}</span>
            <code>{t('common.missing')}</code>
          </div>
        )}

      {agent ? (
        <>
          <div className='agent-balance-panel'>
            <div className='agent-balance-head'>
              <div><span>{t('plugin.balanceTitle')}</span><small>{t('plugin.balancePerChain')}</small></div>
              <strong className={`agent-selected-chain agent-selected-chain--${CHAIN_LABELS[balanceChain].tone}`}>{t(CHAIN_LABELS[balanceChain].fullKey)}</strong>
            </div>
            <div className='agent-chain-tabs' role='tablist' aria-label={t('plugin.selectBalanceNetwork')}>
              {SUPPORTED_CHAINS.map(chain => <button key={chain} type='button' className={`agent-chain-tab agent-chain-tab--${CHAIN_LABELS[chain].tone} ${balanceChain === chain ? 'active' : ''}`} onClick={() => { setBalanceChain(chain); onBalanceChainChange(chain) }} role='tab' aria-selected={balanceChain === chain}>
                <span className='agent-chain-dot' /><span>{CHAIN_LABELS[chain].short}</span><small>{chain === 'arc-testnet' ? 'Testnet' : 'Sepolia'}</small>
              </button>)}
            </div>
            <div className='agent-balance-updated'>{agent.balanceUpdatedAt ? t('plugin.balanceUpdated') : t('plugin.loadingBalance')}</div>
            {selectedBalance
              ? <div className='agent-balance-values'>
                  <div><strong>{selectedBalance.USDC ?? '0'}</strong><span>USDC</span></div>
                  <div><strong>{selectedBalance.EURC ?? '0'}</strong><span>EURC</span></div>
                  <div><strong>{selectedBalance.USYC ?? '0'}</strong><span>USYC</span></div>
                  <div><strong>{selectedBalance.cirBTC ?? '0'}</strong><span>cirBTC</span></div>
                </div>
              : <p className='agent-balance-unavailable'>{t('plugin.walletBalanceUnavailable')}</p>}
          </div>

          {isHermes && (agent.readiness || agent.readinessLoading) && (
            <div className='agent-health-grid'>
              <div className='agent-health-item'>
                <span>{t('plugin.hermesMcp')}</span>
                <strong className={agent.readiness?.mcp.connected ? 'is-good' : ''}>
                  {agent.readinessLoading && !agent.readiness ? t('plugin.checking') : agent.readiness?.mcp.connected ? t('plugin.connected') : agent.readiness?.mcp.configured ? t('plugin.tokenWaiting') : t('plugin.notConfigured')}
                </strong>
              </div>
              <div className='agent-health-item'>
                <span>{t('plugin.execution')}</span>
                <strong className={agent.readiness?.execution.ready ? 'is-good' : 'is-warning'}>
                  {agent.readinessLoading && !agent.readiness ? t('plugin.checking') : agent.readiness?.execution.ready ? t('plugin.ready') : `${t('plugin.notReady')} (${agent.readiness?.execution.reason || t('plugin.needsSetup')})`}
                </strong>
              </div>
            </div>
          )}

          <div className='agent-health-grid'>
            <div className='agent-health-item'>
              <span>{t('plugin.passkeyLabel')}</span>
              <strong className='is-good'>{agent.passkeyBound === false ? t('common.notConnected') : t('plugin.passkeyRegistered')}</strong>
            </div>
            <div className='agent-health-item'>
              <span>{t('plugin.mcpAgent')}</span>
              <strong className={agent.status === 'connected' ? 'is-good' : ''}>{agent.status === 'connected' ? t('plugin.connected') : agent.status === 'revoked' ? t('plugin.sessionInactive') : t('plugin.waitingMcp')}</strong>
            </div>
            <div className='agent-health-item'>
              <span>{t('plugin.spendToday')}</span>
              <strong>{agent.spentToday} USDC</strong>
            </div>
          </div>

          <div className='agent-meta'>
            <div>
              <small>{t('plugin.lastUsed')}</small>
              <strong>{formatTime(agent.lastUsedAt || agent.lastActivity, lang === 'zh' ? 'zh-CN' : lang)}</strong>
            </div>
            <div>
              <small>{t('plugin.connectedSince')}</small>
              <strong>{formatTime(agent.boundAt || agent.connectedAt, lang === 'zh' ? 'zh-CN' : lang)}</strong>
            </div>
          </div>
        </>
      ) : (
        <div className='agent-setup-copy'>
          <span className='setup-dot' />
          <p>{t(isHermes ? 'plugin.flowHermesStep1' : agentType === 'grok' ? 'plugin.flowGrokStep1' : 'plugin.flowClaudeStep1')}</p>
        </div>
      )}

      <div className='agent-actions'>
        {isHermes && !agent && (
          <>
            <button type='button' className='action-button' disabled={anyBusy} onClick={onConnect}>
              {busy ? t('common.preparing') : t('plugin.newWalletButton')}
            </button>
            <button type='button' className='mini-button' disabled={anyBusy} onClick={onLogin}>
              {busy ? t('plugin.waitingPasskey') : t('plugin.loginPasskey')}
            </button>
          </>
        )}
        {isHermes && agent && (
          <button type='button' className='action-button' disabled={anyBusy} onClick={onCreateToken}>
            {busyAction === `token:${safeAgentKey}` ? t('plugin.creatingToken') : t('plugin.rotateToken')}
          </button>
        )}
        {agent && (
          <button type='button' className='mini-button' disabled={anyBusy} onClick={onLogin}>
            {busy ? t('plugin.waitingPasskey') : t('plugin.loginPasskey')}
          </button>
        )}
        {agent && (
          <>
            {agent.status !== 'revoked' && <button type='button' className='mini-button mini-button-danger' disabled={anyBusy} onClick={onRevoke}>
              {t('plugin.revoke')}
            </button>}
            <button type='button' className='mini-button mini-button-danger' disabled={anyBusy} onClick={onDelete}>
              {t('common.delete')}
            </button>
          </>
        )}
        {!agent && !isHermes && agentType === 'grok' && (
          <p className='agent-action-hint'>{t('plugin.flowGrokNote')}</p>
        )}
        {!agent && !isHermes && agentType !== 'grok' && (
          <div className='agent-external-note'>{t('plugin.externalAgentHint')}</div>
        )}
      </div>

      {!agent && isHermes && (
        <p className='agent-action-hint'>{t('plugin.flowHermesNote')}</p>
      )}
    </article>
  )
}
