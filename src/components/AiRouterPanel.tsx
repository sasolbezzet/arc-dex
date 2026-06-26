import { useEffect, useState } from 'react'
import { addUnifiedBalanceDelegateWithAppKit, getUnifiedBalanceDelegateStatusWithAppKit, getUnifiedBalanceWithAppKit } from '../appKit'
import { ensureAuthSession } from '../auth'
import {
  createAiRouterApiKey,
  getAiRouterModels,
  getAiRouterStatus,
  revokeAiRouterApiKey,
  rotateAiRouterApiKey,
  setAiRouterAutoPay,
} from '../aiRouterApi'

export function AiRouterPanel({ address }: { address: string }) {
  const [status, setStatus] = useState<any>(null)
  const [models, setModels] = useState<any[]>([])
  const [unifiedBalance, setUnifiedBalance] = useState<any>(null)
  const [newKey, setNewKey] = useState('')
  const [revealedKeys, setRevealedKeys] = useState<Record<string, string>>({})
  const [copied, setCopied] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  async function run(label: string, fn: () => Promise<any>) {
    try {
      setBusy(label)
      setError('')
      return await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : `${label} failed`)
    } finally {
      setBusy('')
    }
  }

  async function refresh() {
    const [routerStatus, modelData] = await Promise.all([
      getAiRouterStatus(address),
      getAiRouterModels().catch(() => ({ data: [] })),
    ])
    setStatus(routerStatus)
    setModels(modelData.data || [])
  }

  useEffect(() => {
    refresh().catch(err => setError(err instanceof Error ? err.message : 'Failed to load AI Router'))
  }, [address])

  async function checkUnified() {
    const result = await run('balance', getUnifiedBalanceWithAppKit)
    if (result) setUnifiedBalance(result)
  }

  async function enableAutoPay() {
    const delegateAddress = status?.delegate?.address || status?.autoPay?.delegateAddress
    if (!delegateAddress || !String(delegateAddress).startsWith('0x')) {
      setError('Auto Pay address is not configured in backend env.')
      return
    }
    if (!await authReady()) return
    await run('autoPaySetup', () => addUnifiedBalanceDelegateWithAppKit({ delegateAddress }))
    const delegateStatus = await run('autoPayStatus', () => getUnifiedBalanceDelegateStatusWithAppKit({ delegateAddress }))
    await run('autoPay', () => setAiRouterAutoPay({
      ownerAddress: address,
      enabled: true,
      delegateStatus: String(delegateStatus || 'pending'),
      delegateAddress,
    }))
    await refresh()
  }

  async function disableAutoPay() {
    if (!await authReady()) return
    await run('autoPay', () => setAiRouterAutoPay({ ownerAddress: address, enabled: false }))
    await refresh()
  }

  async function createKey() {
    if (!await authReady()) return
    const result = await run('apiKey', () => createAiRouterApiKey({ ownerAddress: address }))
    if (result?.apiKey) {
      setNewKey(result.apiKey)
      if (result?.key?.id) setRevealedKeys(prev => ({ ...prev, [result.key.id]: result.apiKey }))
    }
    await refresh()
  }

  const autoPay = status?.autoPay
  const delegate = status?.delegate
  const autoPayStatus = delegate?.status || autoPay?.delegateStatus || autoPay?.status || 'not ready'
  const autoPayReady = autoPay?.enabled && autoPayStatus === 'ready'
  const autoPayLabel = autoPayReady ? 'Ready - siap digunakan' : formatAutoPayStatus(autoPayStatus)
  const keys = status?.apiKeys || []
  const activeKeys = keys.filter((key: any) => key.status === 'active')
  const usage = status?.usageLogs || []

  return (
    <div className='pay-page ai-router-page'>
      <section className='glass sandbox-hero ai-router-hero'>
        <div>
          <div className='docs-kicker'>AI Router</div>
          <h2>Deposit USDC. Create API key. Use AI models.</h2>
          <p>ARCOX AI Router pays each AI request from your Unified Balance through Auto Pay. Your provider keys stay in the backend.</p>
        </div>
        <div className='ai-router-status'>
          <StatusPill label='Unified Balance' value={formatUnifiedBalance(unifiedBalance)} />
          <StatusPill label='Auto Pay' value={autoPayReady ? 'Ready' : autoPay?.enabled ? 'Pending' : 'OFF'} tone={autoPayReady ? 'good' : 'warn'} />
          <StatusPill label='Readiness' value={autoPayReady ? 'Siap digunakan' : autoPayLabel} tone={autoPayReady ? 'good' : 'warn'} />
          <StatusPill label='API Key' value={activeKeys.length ? 'Ready' : 'Not created'} tone={activeKeys.length ? 'good' : 'warn'} />
        </div>
      </section>

      {error && <div className='inline-error'>{error}</div>}
      {newKey && (
        <section className='glass sandbox-card'>
          <h3>New API Key</h3>
          <p className='pay-muted'>Copy now. It will not be shown again.</p>
          <div className='copy-line with-action'>
            <code>{newKey}</code>
            <button className='btn btn-secondary small' onClick={() => copyText(newKey, 'new-key')}>
              {copied === 'new-key' ? 'Copied' : 'Copy'}
            </button>
          </div>
        </section>
      )}

      <section className='ai-router-steps'>
        <div className='glass sandbox-card'>
          <h3>1. Unified Balance</h3>
          <p className='pay-muted'>Your USDC stays in your Unified Balance until each AI request is paid.</p>
          <div className='button-row wrap'>
            <button className='btn btn-secondary' disabled={busy === 'balance'} onClick={checkUnified}>
              {busy === 'balance' ? 'Checking...' : 'Check Unified Balance'}
            </button>
            <button className='btn btn-primary' onClick={openUnifiedBalance}>Deposit USDC</button>
          </div>
          <div className='pay-grid'>
            <Info label='Available' value={formatUnifiedBalance(unifiedBalance)} />
            <Info label='Source' value='User Unified Balance' />
          </div>
        </div>

        <div className='glass sandbox-card'>
          <h3>2. Auto Pay</h3>
          <p className='pay-muted'>Enable once. Each AI request then estimates and spends from Unified Balance to ARCOX treasury.</p>
          <div className='pay-grid'>
            <Info label='Auto Pay' value={autoPayLabel} />
            <Info label='Per Request' value={`${autoPay?.maxPerRequest || '0.02'} USDC`} />
          </div>
          <div className='button-row wrap'>
            <button className='btn btn-primary' disabled={!!busy || autoPay?.enabled} onClick={enableAutoPay}>
              {busy === 'autoPaySetup' || busy === 'autoPayStatus' || busy === 'autoPay' ? 'Enabling...' : 'Enable Auto Pay'}
            </button>
            <button className='btn btn-secondary' disabled={busy === 'autoPay' || !autoPay?.enabled} onClick={disableAutoPay}>Turn OFF</button>
          </div>
        </div>

        <div className='glass sandbox-card'>
          <h3>3. API Key</h3>
          <p className='pay-muted'>Use this key in Hermes, OpenClaw, or OpenAI-compatible clients.</p>
          <button className='btn btn-primary' disabled={busy === 'apiKey'} onClick={createKey}>
            {busy === 'apiKey' ? 'Creating...' : 'Create API Key'}
          </button>
          <div className='api-key-list'>
            {keys.map((key: any) => (
              <div className='api-key-row' key={key.id}>
                <div>
                  <strong>{key.keyPreview}</strong>
                  <span>{key.scopes?.join(', ')}</span>
                </div>
                <div className='button-row'>
                  <button className='btn btn-secondary small' disabled={!revealedKeys[key.id]} onClick={() => copyText(revealedKeys[key.id], key.id)}>
                    {copied === key.id ? 'Copied' : 'Copy'}
                  </button>
                  <button className='btn btn-secondary small' disabled={busy === 'rotate' || key.status !== 'active'} onClick={() => rotateKey(key.id)}>Rotate</button>
                  <button className='btn btn-secondary small' disabled={busy === 'revoke' || key.status !== 'active'} onClick={() => revokeKey(key.id)}>Revoke</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className='sandbox-grid'>
        <div className='glass sandbox-card'>
          <h3>Models</h3>
          <div className='model-list'>
            {(models.length ? models : [{ id: 'arcox/auto', owned_by: 'arcox' }]).map(model => (
              <div className='model-row' key={model.id}>
                <strong>{model.id}</strong>
                <span>{model.owned_by || 'provider'}</span>
              </div>
            ))}
          </div>
        </div>
        <div className='glass sandbox-card'>
          <h3>Usage Log</h3>
          {usage.length ? usage.map((item: any) => (
            <div className='usage-row' key={item.requestId}>
              <div><strong>{item.model || 'arcox/auto'}</strong><span>{item.providerUsed || 'provider pending'}</span></div>
              <div><strong>{item.cost} USDC</strong><span>{item.paymentStatus || item.status}</span></div>
            </div>
          )) : <p className='pay-muted'>No usage yet.</p>}
        </div>
        <div className='glass sandbox-card'>
          <h3>Client Config</h3>
          <div className='config-snippet'>
            <code>base_url = https://api.arcox.app/v1</code>
            <code>api_key = arx_sk_...</code>
            <code>model = arcox/auto</code>
          </div>
        </div>
      </section>
    </div>
  )

  async function revokeKey(keyId: string) {
    if (!await authReady()) return
    await run('revoke', () => revokeAiRouterApiKey({ ownerAddress: address, keyId }))
    await refresh()
  }

  async function rotateKey(keyId: string) {
    if (!await authReady()) return
    const result = await run('rotate', () => rotateAiRouterApiKey({ ownerAddress: address, keyId }))
    if (result?.apiKey) {
      setNewKey(result.apiKey)
      if (result?.key?.id) setRevealedKeys(prev => ({ ...prev, [result.key.id]: result.apiKey }))
    }
    await refresh()
  }

  async function ensureWalletAuth() {
    return ensureAuthSession(address)
  }

  async function authReady() {
    const token = await run('auth', ensureWalletAuth)
    return Boolean(token)
  }

  async function copyText(value: string, id: string) {
    if (!value) return
    await navigator.clipboard.writeText(value)
    setCopied(id)
    window.setTimeout(() => setCopied(''), 1600)
  }

  function openUnifiedBalance() {
    window.history.pushState(null, '', '/unified-balance')
    window.dispatchEvent(new PopStateEvent('popstate'))
  }
}

function StatusPill({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'warn' }) {
  return (
    <div className={`ai-status-pill ${tone || ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className='pay-info'>
      <span>{label}</span>
      <strong>{value || '-'}</strong>
    </div>
  )
}

function formatUnifiedBalance(balance: any) {
  if (!balance) return 'Not checked'
  const total = balance?.totalConfirmedBalance ?? balance?.totalBalance ?? balance?.total ?? balance?.balance ?? balance?.amount
  const pending = balance?.totalPendingBalance
  if (total !== undefined && total !== null) return pending ? `${total} confirmed · ${pending} pending` : `${total} USDC`
  return '0 USDC'
}

function formatAutoPayStatus(status: string) {
  const value = String(status || '').replaceAll('_', ' ')
  if (status === 'ready') return 'Ready - siap digunakan'
  if (status === 'not_configured' || status === 'none') return 'Auto Pay belum siap'
  if (status === 'delegate_required' || status === 'auto_pay_required') return 'Aktifkan Auto Pay'
  if (status === 'pending') return 'Menunggu konfirmasi'
  return value || 'Not ready'
}
