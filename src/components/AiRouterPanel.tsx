import { useEffect, useState } from 'react'
import {
  addUnifiedBalanceDelegateWithAppKit,
  getUnifiedBalanceDelegateStatusWithAppKit,
  getUnifiedBalanceWithAppKit,
  removeUnifiedBalanceDelegateWithAppKit,
} from '../appKit'
import { ensureAuthSession } from '../auth'
import {
  createAiRouterApiKey,
  getAiRouterModels,
  getAiRouterStatus,
  revokeAiRouterApiKey,
  setAiRouterAutoPay,
} from '../aiRouterApi'

export function AiRouterPanel({ address }: { address: string }) {
  const [status, setStatus] = useState<any>(null)
  const [models, setModels] = useState<any[]>([])
  const [unifiedBalance, setUnifiedBalance] = useState<any>(null)
  const [newKey, setNewKey] = useState('')
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

  async function runRequired(label: string, fn: () => Promise<any>) {
    try {
      setBusy(label)
      setError('')
      return await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : `${label} failed`)
      throw e
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
    const delegateAddress = autoPayAddress(status)
    if (!delegateAddress) {
      setError('Auto Pay address is not configured in backend env. Isi AI_ROUTER_DELEGATE_ADDRESS atau CIRCLE_X402_TREASURY_ADDRESS dengan address 0x valid.')
      return
    }
    if (!await authReady()) return
    try {
      await runRequired('autoPaySetup', () => addUnifiedBalanceDelegateWithAppKit({ delegateAddress }))
    } catch {
      return
    }
    const delegateStatus = await run('autoPayStatus', () => getUnifiedBalanceDelegateStatusWithAppKit({ delegateAddress }))
    const normalizedStatus = normalizeAutoPayStatus(delegateStatus, true)
    await run('autoPay', () => setAiRouterAutoPay({
      ownerAddress: address,
      enabled: true,
      delegateStatus: normalizedStatus,
      delegateAddress,
    }))
    setStatus((prev: any) => prev ? {
      ...prev,
      autoPay: { ...prev.autoPay, enabled: true, delegateStatus: normalizedStatus, status: normalizedStatus === 'ready' ? 'ready' : 'auto_pay_required' },
      delegate: { ...prev.delegate, status: normalizedStatus, address: delegateAddress },
    } : prev)
    await refresh()
  }

  async function disableAutoPay() {
    const delegateAddress = autoPayAddress(status)
    if (!delegateAddress) {
      setError('Auto Pay address is not configured in backend env. Isi AI_ROUTER_DELEGATE_ADDRESS atau CIRCLE_X402_TREASURY_ADDRESS dengan address 0x valid.')
      return
    }
    if (!await authReady()) return
    try {
      await runRequired('autoPayRemove', () => removeUnifiedBalanceDelegateWithAppKit({ delegateAddress }))
    } catch {
      return
    }
    await run('autoPay', () => setAiRouterAutoPay({ ownerAddress: address, enabled: false }))
    setStatus((prev: any) => prev ? {
      ...prev,
      autoPay: { ...prev.autoPay, enabled: false, delegateStatus: 'not_configured', status: 'off' },
      delegate: { ...prev.delegate, status: 'not_configured', address: delegateAddress },
    } : prev)
    await refresh()
  }

  async function createKey() {
    if (!await authReady()) return
    const result = await run('apiKey', () => createAiRouterApiKey({ ownerAddress: address }))
    if (result?.apiKey) {
      setNewKey(result.apiKey)
    }
    if (result?.key) {
      setStatus((prev: any) => prev ? {
        ...prev,
        apiKeys: [result.key, ...(prev.apiKeys || []).filter((key: any) => key.id !== result.key.id)],
      } : prev)
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
          <p>Auto Pay only approves delegated spend. Each AI request is paid from your Unified Balance, not from your wallet balance.</p>
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
          <p className='pay-muted'>Enable once. This is only an approval; AI requests spend USDC from Unified Balance to ARCOX treasury.</p>
          <div className='pay-grid'>
            <Info label='Auto Pay' value={autoPayLabel} />
            <Info label='Per Request' value={`${autoPay?.maxPerRequest || '0.02'} USDC`} />
          </div>
          <div className='button-row wrap'>
            <button className='btn btn-primary' disabled={!!busy || autoPayReady} onClick={enableAutoPay}>
              {busy === 'autoPaySetup' || busy === 'autoPayStatus' || busy === 'autoPay' ? 'Enabling...' : 'Enable Auto Pay'}
            </button>
            <button className='btn btn-secondary' disabled={!!busy || !autoPay?.enabled} onClick={disableAutoPay}>
              {busy === 'autoPayRemove' || busy === 'autoPay' ? 'Turning off...' : 'Turn OFF'}
            </button>
          </div>
        </div>

        <div className='glass sandbox-card'>
          <h3>3. API Key</h3>
          <p className='pay-muted'>Use this key in Hermes, OpenClaw, or OpenAI-compatible clients.</p>
          <div className='button-row wrap'>
            <button className='btn btn-primary' disabled={busy === 'apiKey'} onClick={createKey}>
              {busy === 'apiKey' ? 'Creating...' : 'Create API Key'}
            </button>
          </div>
          <div className='api-key-list'>
            {activeKeys.length ? activeKeys.map((key: any) => (
              <div className='api-key-row' key={key.id}>
                <div>
                  <strong>{key.keyPreview}</strong>
                  <span>{key.scopes?.join(', ')}</span>
                </div>
                <div className='button-row'>
                  <button className='btn btn-secondary small danger' disabled={busy === 'delete'} onClick={() => deleteKey(key.id)}>Delete</button>
                </div>
              </div>
            )) : <p className='pay-muted'>No active API key yet.</p>}
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
            <code>base_url = https://arc-dex-bice.vercel.app/v1</code>
            <code>api_key = arx_sk_...</code>
            <code>model = arcox/auto</code>
          </div>
        </div>
      </section>
    </div>
  )

  async function deleteKey(keyId: string) {
    if (!await authReady()) return
    const result = await run('delete', () => revokeAiRouterApiKey({ ownerAddress: address, keyId }))
    if (result?.ok) {
      setStatus((prev: any) => prev ? {
        ...prev,
        apiKeys: (prev.apiKeys || []).map((key: any) => key.id === keyId ? { ...key, status: 'revoked' } : key),
      } : prev)
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

function isEvmAddress(value: any) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || '').trim())
}

function autoPayAddress(status: any) {
  const candidates = [
    status?.delegate?.address,
    status?.autoPay?.delegateAddress,
    status?.autoPay?.autoPayAddress,
    status?.treasury,
  ]
  return String(candidates.find(isEvmAddress) || '')
}

function normalizeAutoPayStatus(value: any, setupSucceeded = false) {
  if (value === true) return 'ready'
  if (value === false || value === null) return setupSucceeded ? 'ready' : 'not_configured'
  if (typeof value === 'string') {
    const normalized = value.toLowerCase().replaceAll('_', ' ').trim()
    if (['ready', 'enabled', 'active', 'approved', 'allowed', 'complete', 'completed', 'success', 'delegated'].includes(normalized)) return 'ready'
    if (['none', 'missing', 'disabled', 'not configured', 'not ready'].includes(normalized)) return setupSucceeded ? 'ready' : 'not_configured'
    if (normalized.includes('ready') || normalized.includes('enabled') || normalized.includes('active')) return 'ready'
    if (normalized.includes('pending') || normalized.includes('processing')) return setupSucceeded ? 'ready' : 'pending'
    return value
  }
  if (typeof value === 'object') {
    const status = value.status || value.state || value.delegateStatus || value.readiness
    if (status) return normalizeAutoPayStatus(status, setupSucceeded)
    const flags = ['ready', 'isReady', 'enabled', 'isEnabled', 'delegated', 'isDelegated', 'allowed', 'hasDelegate']
    if (flags.some(flag => value[flag] === true)) return 'ready'
    if (setupSucceeded) return 'ready'
  }
  return setupSucceeded ? 'ready' : 'pending'
}
