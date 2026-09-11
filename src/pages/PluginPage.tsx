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
import { MCPSetupTutorial } from '../features/plugin/MCPSetupTutorial'
import { useI18n } from '../i18n'
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
    deleteAgent,
    approveRequest,
    rejectRequest,
    saveLimits,
    setConnectionToken,
    dismissError,
    dismissNotice,
    refreshAgentBalances,
  } = useAgentManager()

  const oauth = useOAuthApproval()
  const { t } = useI18n()
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
          <button type='button' className='text-button' onClick={dismissError}>{t('plugin.dismiss')}</button>
        </div>
      )}
      {notice && (
        <div className='inline-notice plugin-alert'>
          <span>{notice}</span>
          <button type='button' className='text-button' onClick={dismissNotice}>{t('plugin.dismiss')}</button>
        </div>
      )}

      <section className='glass plugin-hero plugin-hero-v2'>
        <div className='plugin-hero-copy'>
          <div className='plugin-eyebrow'><span className='plugin-eyebrow-dot' /> {t('plugin.heroEyebrow')}</div>
          <h2>{t('plugin.heroTitle')}</h2>
          <p>{t('plugin.heroCopy')}</p>
          <div className='plugin-hero-actions'>
            <button type='button' className='action-button' onClick={() => setTab('overview')}>{t('plugin.manageAgents')}</button>
            {pendingApprovals.length > 0 && <button type='button' className='mini-button' onClick={() => setTab('approvals')}>{t('plugin.reviewRequests', { count: pendingApprovals.length })}</button>}
          </div>
        </div>
        <div className='plugin-hero-meta plugin-hero-metrics'>
          <div className='plugin-metric-primary'><strong>{agents.length}</strong><span>{t('plugin.agentsRegistered')}</span></div>
          <div className='plugin-metric-row'><span>{t('plugin.online')}</span><strong>{connectedCount}</strong></div>
          <div className='plugin-metric-row'><span>{t('plugin.requests')}</span><strong className={pendingApprovals.length ? 'is-warning' : ''}>{pendingApprovals.length}</strong></div>
        </div>
      </section>

      <section className='glass plugin-first-run' aria-labelledby='plugin-first-run-title'>
        <div className='plugin-section-heading'>
          <div><span className='section-eyebrow'>{t('plugin.firstRunEyebrow')}</span><strong id='plugin-first-run-title'>{t('plugin.firstRunTitle')}</strong></div>
          <span className='plugin-secure-label'>{t('plugin.noPrivateKey')}</span>
        </div>
        <p className='plugin-muted-copy'>{t('plugin.identitySeparation')}</p>
        <div className='plugin-first-run-grid'>
          {(['1', '2', '3', '4'] as const).map((step, index) => <div className='plugin-first-run-step' key={step}><b>0{index + 1}</b><div><strong>{t(`plugin.firstRunStep${step}Title` as never)}</strong><span>{t(`plugin.firstRunStep${step}Copy` as never)}</span></div></div>)}
        </div>
      </section>

      {!hasSession && (
        <section className='plugin-session-banner'>
          <div className='plugin-session-icon'>⌁</div>
          <div>
            <strong>{t('plugin.sessionTitle')}</strong>
            <p>{t('plugin.sessionCopy')}</p>
          </div>
          <div className='plugin-session-actions'>
            <button type='button' className='mini-button mini-button-primary' onClick={() => handleConnect('hermes')}>{t('plugin.createAgentWallet')}</button>
            <button type='button' className='text-button' onClick={() => handleLogin('hermes')}>{t('plugin.loginExistingPasskey')}</button>
          </div>
        </section>
      )}

      <section className='glass plugin-connect-strip'>
        <div className='plugin-section-heading'>
          <div><span className='section-eyebrow'>{t('plugin.endpointEyebrow')}</span><strong>{t('plugin.connectNewAgent')}</strong></div>
          <span className='plugin-secure-label'>{t('plugin.ownerControlled')}</span>
        </div>
        <p>{t('plugin.endpointCopy')}</p>
        <CopyField value={MCP_URL} ariaLabel={t('plugin.copyMcpUrl')} />
      </section>

      <MCPSetupTutorial />

      <nav className='glass plugin-tabs plugin-tabs-v2' aria-label={t('plugin.navigationLabel')}>
        {([
          ['overview', t('plugin.tabOverview'), agents.length],
          ['approvals', t('plugin.tabApprovals'), pendingApprovals.length],
          ['activity', t('plugin.tabActivity'), activity.length],
          ['security', t('plugin.tabSecurity'), credentials.length],
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
            <div><span className='section-eyebrow'>{t('plugin.identityEyebrow')}</span><h3>{t('plugin.yourAgents')}</h3></div>
            <span>{agents.length} {t('plugin.connections')}</span>
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
                  onLogin={() => loginAgent(agent.agentKey)}
                  onCreateToken={() => createToken(agent.agentKey)}
                  onRevoke={() => setRevokeTarget(agent)}
                  onDelete={() => void deleteAgent(agent.agentKey)}
                  onBalanceChainChange={(chain) => refreshAgentBalances([agent], chain)}
                />
              ))}
            </div>
          ) : (
            <div className='plugin-empty plugin-empty-hero'>
              <div className='plugin-empty-mark'>+</div>
              <strong>{t('plugin.noAgentsTitle')}</strong>
              <p>{t('plugin.noAgentsCopy')}</p>
            </div>
          )}

          <div className='plugin-section-title plugin-section-title-spaced'>
            <div><span className='section-eyebrow'>{t('plugin.connectionMethods')}</span><h3>{t('plugin.addAgent')}</h3></div>
          </div>
          <div className='plugin-provider-grid'>
            {AGENT_TYPES.map(type => {
              const config = AGENT_CONFIGS[type]
              const connected = connectedTypes.has(type)
              return (
                <article key={type} className='plugin-provider-card' style={{ ['--agent-accent' as string]: config.accent }}>
                  <div className='plugin-provider-mark'>{config.mark}</div>
                  <div className='plugin-provider-copy'><strong>{config.name}</strong><span>{connected ? t('plugin.alreadyConnected') : config.connectionType}</span></div>
                  <p>{config.description}</p>
                  {connected
                    ? <button type='button' className='mini-button' onClick={() => setTab('activity')}>{t('plugin.viewConnection')}</button>
                    : type === 'hermes'
                      ? <div className='plugin-provider-actions'><button type='button' className='mini-button' disabled={Boolean(busyAction)} onClick={() => handleConnect(type)}>{t('plugin.createAgentWallet')}</button><button type='button' className='text-button' disabled={Boolean(busyAction)} onClick={() => handleLogin(type)}>{t('plugin.loginExistingPasskey')}</button></div>
                      : type === 'grok'
                        ? <p className='agent-action-hint'>{t('plugin.flowGrokStep1')}</p>
                        : <div className='agent-external-note'>{t('plugin.externalAgentHint')}</div>}
                </article>
              )
            })}
          </div>
        </div>
      )}

      {tab === 'approvals' && (
        <section className='plugin-panel-section'>
          <div className='plugin-section-title'><div><span className='section-eyebrow'>{t('plugin.approvalsAction')}</span><h3>{t('plugin.approvalsNeedYou')}</h3></div><span className='plugin-count-badge'>{t('plugin.pendingCount', { count: pendingApprovals.length })}</span></div>
          <div className='plugin-safety-note'><span>!</span><p>{t('plugin.approvalsNote')}</p></div>
          <ApprovalsList approvals={pendingApprovals} busyAction={busyAction} onApprove={approveRequest} onReject={rejectRequest} />
        </section>
      )}

      {tab === 'activity' && (
        <section className='plugin-panel-section'>
          <div className='plugin-section-title'><div><span className='section-eyebrow'>{t('plugin.activityEyebrow')}</span><h3>{t('plugin.activityTitle')}</h3></div><select className='plugin-select' value={activityAgentKey} onChange={event => setActivityAgentKey(event.target.value)}><option value='all'>{t('plugin.allAgents')}</option>{agents.map(agent => <option key={agent.agentKey} value={agent.agentKey}>{displayAgentName(agent)}</option>)}</select></div>
          <div className='plugin-activity-summary'><span><strong>{visibleActivity.length}</strong> {t('plugin.eventsShown', { count: visibleActivity.length }).replace(String(visibleActivity.length), '').trim()}</span><span>{t('plugin.autoRefresh')}</span></div>
          <AgentActivityList activities={visibleActivity} />
        </section>
      )}

      {tab === 'security' && (
        <div className='plugin-security-grid'>
          <section className='plugin-panel-section'>
            <div className='plugin-section-title'><div><span className='section-eyebrow'>{t('plugin.spendingSection')}</span><h3>{t('plugin.ownerDefaultLimits')}</h3></div><span className='plugin-secure-label'>{t('plugin.failClosed')}</span></div>
            <p className='plugin-muted-copy'>{t('plugin.policyCopy')}</p>
            <div className='plugin-form-grid'>
              <label><span>{t('plugin.maxPerTxLabel')}</span><div className='plugin-input-wrap'>                  <input className='input' inputMode='decimal' value={String(currentMaxPerTx)} onChange={event => setDraftMaxPerTx(event.target.value)} aria-label={t('plugin.maxPerTxLabel')} /><em>USDC</em></div></label>
              <label><span>{t('plugin.dailyLimitLabel')}</span><div className='plugin-input-wrap'>                  <input className='input' inputMode='decimal' value={String(currentDailyLimit)} onChange={event => setDraftDailyLimit(event.target.value)} aria-label={t('plugin.dailyLimitLabel')} /><em>USDC</em></div></label>
            </div>
            <div className='plugin-policy-row'><span>{t('plugin.autoApproveLabel')}</span><strong>{limits?.autoApprove ? t('plugin.enabled') : t('plugin.disabled')}</strong></div>
            <div className='plugin-policy-row'><span>{t('plugin.whitelistLabel')}</span><strong>{t('plugin.addressCount', { count: limits?.whitelist?.length || 0 })}</strong></div>
            <button type='button' className='action-button plugin-save-button' disabled={busyAction === 'limits'} onClick={handleSaveLimits}>{busyAction === 'limits' ? t('plugin.savingLimits') : t('plugin.saveLimits')}</button>
          </section>

          <section className='plugin-panel-section'>
            <div className='plugin-section-title'><div><span className='section-eyebrow'>{t('plugin.vaultEyebrow')}</span><h3>{t('plugin.storedCredentials')}</h3></div><span>{credentials.length} {t('plugin.items')}</span></div>
            <p className='plugin-muted-copy'>{t('plugin.vaultCopy')}</p>
            {credentials.length === 0 ? <div className='plugin-empty plugin-empty-small'><strong>{t('plugin.noCredentialsTitle')}</strong><p>{t('plugin.noCredentialsCopy')}</p></div> : <div className='plugin-credential-list'>{credentials.map(credential => <div className='plugin-credential-row' key={credential.id}><span className='plugin-credential-icon'>{credential.type === 'api_key' ? 'AK' : 'WK'}</span><div><strong>{credential.label}</strong><small>{credential.type}</small></div><code>{credential.value || '••••••••'}</code></div>)}</div>}
          </section>

          <section className='plugin-panel-section plugin-security-wide'>
            <div className='plugin-section-title'><div><span className='section-eyebrow'>{t('plugin.securitySection')}</span><h3>{t('plugin.securityLayers')}</h3></div></div>
            <div className='plugin-security-checks'><div><b>✓</b><span><strong>{t('plugin.walletIsolated')}</strong><small>{t('plugin.walletIsolatedCopy')}</small></span></div><div><b>✓</b><span><strong>{t('plugin.tokenScoped')}</strong><small>{t('plugin.tokenScopedCopy')}</small></span></div><div><b>✓</b><span><strong>{t('plugin.pkcePasskey')}</strong><small>{t('plugin.pkcePasskeyCopy')}</small></span></div><div><b>✓</b><span><strong>{t('plugin.activeSession')}</strong><small>{t('plugin.activeSessionCopy', { count: mcpSessions.length })}</small></span></div></div>
          </section>
        </div>
      )}

      {connectionToken && <ConnectionTokenDialog token={connectionToken} onClose={() => setConnectionToken(null)} />}
      {revokeTarget && <RevokeModal agent={revokeTarget} busy={busyAction === `revoke:${revokeTarget.agentKey}`} onConfirm={async () => { const target = revokeTarget; setRevokeTarget(null); await revokeAgent(target.agentKey) }} onCancel={() => setRevokeTarget(null)} />}
    </div>
  )
}
