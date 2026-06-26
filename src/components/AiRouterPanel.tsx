import { useEffect, useState } from 'react'
import { getUnifiedBalanceWithAppKit, estimateUnifiedBalanceSpendWithAppKit, spendUnifiedBalanceWithAppKit } from '../appKit'
import {
  createAiRouterApiKey,
  getAiRouterModels,
  getAiRouterStatus,
  prepareAiRouterTopUp,
  revokeAiRouterApiKey,
  rotateAiRouterApiKey,
  setAiRouterAutoPay,
  settleAiRouterTopUp,
} from '../aiRouterApi'

export function AiRouterPanel({ address }: { address: string }) {
  const [status, setStatus] = useState<any>(null)
  const [models, setModels] = useState<any[]>([])
  const [unifiedBalance, setUnifiedBalance] = useState<any>(null)
  const [topUpAmount, setTopUpAmount] = useState('0.10')
  const [newKey, setNewKey] = useState('')
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

  async function enableAutoPay(enabled: boolean) {
    await run('autoPay', () => setAiRouterAutoPay({ ownerAddress: address, enabled }))
    await refresh()
  }

  async function createKey() {
    const result = await run('apiKey', () => createAiRouterApiKey({ ownerAddress: address }))
    if (result?.apiKey) setNewKey(result.apiKey)
    await refresh()
  }

  async function topUpFromUnifiedBalance() {
    const prepared = await run('prepare', () => prepareAiRouterTopUp({ ownerAddress: address, amount: topUpAmount }))
    const payment = prepared?.payment
    if (!payment?.recipient) return
    const estimate = await run('estimate', () => estimateUnifiedBalanceSpendWithAppKit({ amount: payment.amount, recipient: payment.recipient }))
    if (!estimate) return
    const spendResult: any = await run('spend', () => spendUnifiedBalanceWithAppKit({ amount: payment.amount, recipient: payment.recipient }))
    const txHash = spendResult?.txHash || spendResult?.transactionHash || spendResult?.hash
    if (!txHash) {
      setError('Unified Balance spend submitted, but no tx hash was returned.')
      return
    }
    await run('settle', () => settleAiRouterTopUp({ paymentId: payment.id, txHash }))
    await refresh()
  }

  const autoPay = status?.autoPay
  const keys = status?.apiKeys || []
  const usage = status?.usageLogs || []

  return (
    <div className='pay-page ai-router-page'>
      <section className='glass sandbox-hero ai-router-hero'>
        <div>
          <div className='docs-kicker'>AI Router</div>
          <h2>Deposit USDC. Create API key. Use AI models.</h2>
          <p>ARCOX AI Router uses only funded Unified Balance credit. Provider API keys stay in the backend.</p>
        </div>
        <div className='ai-router-status'>
          <StatusPill label='Unified Balance' value={status?.unifiedBalance?.available ? `${status.unifiedBalance.available} USDC` : 'Check'} />
          <StatusPill label='Auto Pay' value={autoPay?.enabled ? 'ON' : 'OFF'} tone={autoPay?.enabled ? 'good' : 'warn'} />
          <StatusPill label='API Key' value={keys.length ? 'Ready' : 'Not created'} tone={keys.length ? 'good' : 'warn'} />
        </div>
      </section>

      {error && <div className='inline-error'>{error}</div>}
      {newKey && (
        <section className='glass sandbox-card'>
          <h3>New API Key</h3>
          <p className='pay-muted'>Copy now. It will not be shown again.</p>
          <div className='copy-line'><code>{newKey}</code></div>
        </section>
      )}

      <section className='ai-router-steps'>
        <div className='glass sandbox-card'>
          <h3>1. Unified Balance</h3>
          <p className='pay-muted'>Deposit USDC on the Unified Balance page, then check the available balance here.</p>
          <button className='btn btn-secondary' disabled={busy === 'balance'} onClick={checkUnified}>
            {busy === 'balance' ? 'Checking...' : 'Check Unified Balance'}
          </button>
          <div className='pay-grid'>
            <Info label='Available' value={formatUnifiedBalance(unifiedBalance)} />
            <Info label='AI Credit' value={`${status?.unifiedBalance?.available || '0.000000'} USDC`} />
          </div>
        </div>

        <div className='glass sandbox-card'>
          <h3>2. Fund AI Router</h3>
          <p className='pay-muted'>Move USDC from Unified Balance to ARCOX treasury credit. This is a real Arc Testnet settlement.</p>
          <label className='sandbox-field'>
            <span>Amount USDC</span>
            <input className='input' value={topUpAmount} onChange={event => setTopUpAmount(event.target.value)} />
          </label>
          <button className='btn btn-primary' disabled={!!busy} onClick={topUpFromUnifiedBalance}>
            {busy ? 'Processing...' : 'Fund from Unified Balance'}
          </button>
        </div>

        <div className='glass sandbox-card'>
          <h3>3. Auto Pay</h3>
          <p className='pay-muted'>Requests use your AI Router credit automatically until limits are reached.</p>
          <div className='pay-grid'>
            <Info label='Per Request' value={`${autoPay?.maxPerRequest || '0.02'} USDC`} />
            <Info label='Daily Limit' value={`${autoPay?.dailyLimit || '0.20'} USDC`} />
          </div>
          <button className={`btn ${autoPay?.enabled ? 'btn-secondary' : 'btn-primary'}`} disabled={busy === 'autoPay'} onClick={() => enableAutoPay(!autoPay?.enabled)}>
            {autoPay?.enabled ? 'Turn Auto Pay OFF' : 'Turn Auto Pay ON'}
          </button>
        </div>

        <div className='glass sandbox-card'>
          <h3>4. API Key</h3>
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
                  <button className='btn btn-secondary small' onClick={() => rotateKey(key.id)}>Rotate</button>
                  <button className='btn btn-secondary small' onClick={() => revokeKey(key.id)}>Revoke</button>
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
              <div><strong>{item.cost} USDC</strong><span>{item.status}</span></div>
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
    await run('revoke', () => revokeAiRouterApiKey({ ownerAddress: address, keyId }))
    await refresh()
  }

  async function rotateKey(keyId: string) {
    const result = await run('rotate', () => rotateAiRouterApiKey({ ownerAddress: address, keyId }))
    if (result?.apiKey) setNewKey(result.apiKey)
    await refresh()
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
