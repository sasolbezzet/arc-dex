import { useEffect, useState } from 'react'
import {
  addUnifiedBalanceDelegateWithAppKit,
  confirmedUnifiedBalanceChains,
  getUnifiedBalanceDelegateStatusWithAppKit,
  getUnifiedBalanceWithAppKit,
  getConnectedSolanaAddress,
  removeUnifiedBalanceDelegateWithAppKit,
  UNIFIED_BALANCE_CHAINS,
} from '../appKit'
import { ensureAuthSession } from '../auth'
import {
  createAiRouterApiKey,
  getAiRouterDelegateStatus,
  getAiRouterModels,
  getAiRouterStatus,
  refreshAiRouterAutoPayReadiness,
  revokeAiRouterApiKey,
  setAiRouterAutoPay,
} from '../aiRouterApi'
import type { AgentIdentity } from '../services/agentIdentity'

export function AiRouterPanel({ address, activeAgentIdentity }: { address: string; activeAgentIdentity: AgentIdentity | null }) {
  const [status, setStatus] = useState<any>(null)
  const [models, setModels] = useState<any[]>([])
  const [unifiedBalance, setUnifiedBalance] = useState<any>(null)
  const [newKey, setNewKey] = useState('')
  const [copied, setCopied] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const solanaDelegateForPolling = autoPaySolanaAddress(status)

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

  useEffect(() => {
    const pending = (status?.autoPay?.delegateChains || status?.delegate?.chains || []).some((item: any) => item.status === 'pending')
    if (!pending) return
    const timer = window.setInterval(async () => {
      try {
        const result = await refreshAiRouterAutoPayReadiness(address)
        if (!result?.autoPay) return
        let refreshedAutoPay = result.autoPay
        const solanaEntry = (refreshedAutoPay.delegateChains || []).find((item: any) => item.chain === 'Solana_Devnet' && item.status === 'pending')
        const solanaOwnerAddress = String(refreshedAutoPay.solanaOwnerAddress || '')
        const solanaDelegateAddress = solanaDelegateForPolling
        if (solanaEntry && solanaOwnerAddress && solanaDelegateAddress && await getConnectedSolanaAddress(false) === solanaOwnerAddress) {
          const solanaStatus = normalizeAutoPayStatus(await getUnifiedBalanceDelegateStatusWithAppKit({ delegateAddress: solanaDelegateAddress, chain: 'Solana_Devnet' }))
          if (solanaStatus === 'ready') {
            const delegateChains = refreshedAutoPay.delegateChains.map((item: any) => item.chain === 'Solana_Devnet' ? { ...item, status: 'ready' } : item)
            const saved = await setAiRouterAutoPay({
              ownerAddress: address,
              solanaOwnerAddress,
              enabled: true,
              delegateStatus: 'ready',
              delegateAddress: refreshedAutoPay.delegateAddress,
              delegateChains,
            })
            refreshedAutoPay = saved?.autoPay || { ...refreshedAutoPay, delegateStatus: 'ready', delegateChains }
          }
        }
        setStatus((prev: any) => prev ? {
          ...prev,
          autoPay: refreshedAutoPay,
          delegate: { ...prev.delegate, status: refreshedAutoPay.delegateStatus, chains: refreshedAutoPay.delegateChains },
        } : prev)
      } catch {}
    }, 10_000)
    return () => window.clearInterval(timer)
  }, [address, solanaDelegateForPolling, status?.autoPay?.delegateChains, status?.delegate?.chains])

  async function checkUnified() {
    const result = await run('balance', getUnifiedBalanceWithAppKit)
    if (result) setUnifiedBalance(result)
  }

  async function enableAutoPay() {
    const delegateAddress = autoPayAddress(status)
    const solanaDelegateAddress = autoPaySolanaAddress(status)
    if (!delegateAddress) {
      setError('Auto Pay address is not configured in backend env. Isi AI_ROUTER_DELEGATE_ADDRESS atau CIRCLE_X402_TREASURY_ADDRESS dengan address 0x valid.')
      return
    }
    if (!await authReady()) return
    const balance = unifiedBalance || await runRequired('balance', getUnifiedBalanceWithAppKit)
    if (!unifiedBalance) setUnifiedBalance(balance)
    const sourceChains = confirmedUnifiedBalanceChains(balance)
    if (!sourceChains.length) {
      setError('Deposit USDC to Unified Balance before enabling Auto Pay.')
      return
    }
    setBusy('autoPaySetup')
    const delegateChains: Array<{ chain: string; status: string }> = []
    const failures: string[] = []
    const solanaOwnerAddress = sourceChains.includes('Solana_Devnet') ? await getConnectedSolanaAddress(true) : String(autoPay?.solanaOwnerAddress || '')
    const previousChains = new Map((autoPay?.delegateChains || delegate?.chains || []).map((item: any) => [item.chain, item.status]))
    for (const chain of sourceChains) {
      try {
        const chainDelegate = chain === 'Solana_Devnet' ? solanaDelegateAddress : delegateAddress
        const chainOwner = chain === 'Solana_Devnet' ? solanaOwnerAddress : address
        if (!chainDelegate) throw new Error('Solana Auto Pay signer is not configured')
        const isSelf = chain === 'Solana_Devnet' ? chainDelegate === chainOwner : sameAddress(chainDelegate, chainOwner)
        let chainStatus: any = isSelf
          ? 'ready'
          : await resolveAutoPayStatus(chainOwner, chainDelegate, chain, previousChains.get(chain))
        if (!isSelf && chainStatus === 'none') {
          await addUnifiedBalanceDelegateWithAppKit({ delegateAddress: chainDelegate, chain })
          chainStatus = 'pending'
          try {
            if (chain === 'Solana_Devnet') {
              chainStatus = normalizeAutoPayStatus(await getUnifiedBalanceDelegateStatusWithAppKit({ delegateAddress: chainDelegate, chain }))
            } else {
            const refreshed = await getAiRouterDelegateStatus({ ownerAddress: address, delegateAddress, chain })
            if (refreshed.status === 'ready') chainStatus = 'ready'
            }
          } catch {}
        }
        delegateChains.push({ chain, status: normalizeAutoPayStatus(chainStatus) })
      } catch (error) {
        const previous = normalizeAutoPayStatus(previousChains.get(chain))
        delegateChains.push({ chain, status: previous === 'ready' || previous === 'pending' ? previous : 'not_configured' })
        failures.push(`${chain}: ${error instanceof Error ? error.message : 'setup failed'}`)
      }
    }
    const normalizedStatus = delegateChains.some(item => item.status === 'ready') ? 'ready' : delegateChains.some(item => item.status === 'pending') ? 'pending' : 'not_configured'
    const policyEnabled = normalizedStatus === 'ready' || normalizedStatus === 'pending'
    const savedPolicy = await run('autoPay', () => setAiRouterAutoPay({
      ownerAddress: address,
      enabled: policyEnabled,
      delegateStatus: normalizedStatus,
      delegateAddress,
      delegateChains,
      solanaOwnerAddress,
    }))
    if (!savedPolicy) {
      setBusy('')
      return
    }
    setStatus((prev: any) => prev ? {
      ...prev,
      autoPay: { ...prev.autoPay, enabled: policyEnabled, delegateStatus: normalizedStatus, delegateChains, status: normalizedStatus === 'ready' ? 'ready' : 'auto_pay_required' },
      delegate: { ...prev.delegate, status: normalizedStatus, address: delegateAddress, chains: delegateChains },
    } : prev)
    if (failures.length) setError(`Sebagian status Auto Pay belum dapat diperiksa. ${failures.join(' | ')}`)
    setBusy('')
    await refresh()
  }

  async function disableAutoPay() {
    const delegateAddress = autoPayAddress(status)
    const solanaDelegateAddress = autoPaySolanaAddress(status)
    if (!delegateAddress) {
      setError('Auto Pay address is not configured in backend env. Isi AI_ROUTER_DELEGATE_ADDRESS atau CIRCLE_X402_TREASURY_ADDRESS dengan address 0x valid.')
      return
    }
    if (!await authReady()) return
    setBusy('autoPayRemove')
    const currentChains = autoPay?.delegateChains || delegate?.chains || []
    try {
      await setAiRouterAutoPay({
        ownerAddress: address,
        enabled: false,
        delegateStatus: 'not_configured',
        delegateAddress,
        delegateChains: currentChains,
      })
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to turn Auto Pay off')
      setBusy('')
      return
    }
    const remainingChains: Array<{ chain: string; status: string }> = []
    const failures: string[] = []
    if (!sameAddress(delegateAddress, address)) {
      const configured = new Map<string, string>(currentChains.map((item: any) => [String(item.chain), normalizeAutoPayStatus(item.status)]))
      const chains = UNIFIED_BALANCE_CHAINS.filter(chain => ['ready', 'pending'].includes(configured.get(chain) || ''))
      for (const chain of chains) {
        try {
          const chainDelegate = chain === 'Solana_Devnet' ? solanaDelegateAddress : delegateAddress
          const chainOwner = chain === 'Solana_Devnet' ? await getConnectedSolanaAddress(true) : address
          if (!chainDelegate) throw new Error('Solana Auto Pay signer is not configured')
          const chainStatus = await resolveAutoPayStatus(chainOwner, chainDelegate, chain, configured.get(chain))
          if (chainStatus !== 'none') await removeUnifiedBalanceDelegateWithAppKit({ delegateAddress: chainDelegate, chain })
          remainingChains.push({ chain, status: 'not_configured' })
        } catch (error) {
          remainingChains.push({ chain, status: configured.get(chain) || 'pending' })
          failures.push(`${chain}: ${error instanceof Error ? error.message : 'revoke failed'}`)
        }
      }
    }
    await setAiRouterAutoPay({ ownerAddress: address, enabled: false, delegateStatus: 'not_configured', delegateAddress, delegateChains: remainingChains })
    setStatus((prev: any) => prev ? {
      ...prev,
      autoPay: { ...prev.autoPay, enabled: false, delegateStatus: 'not_configured', delegateChains: remainingChains, status: 'off' },
      delegate: { ...prev.delegate, status: 'not_configured', address: delegateAddress, chains: remainingChains },
    } : prev)
    if (failures.length) setError(`Auto Pay OFF. Ulangi Turn OFF untuk chain yang belum berhasil dicabut: ${failures.join(' | ')}`)
    setBusy('')
    await refresh()
  }

  async function setSolanaAutoPayOnly(enabled: boolean) {
    const delegateAddress = autoPayAddress(status)
    const solanaDelegateAddress = autoPaySolanaAddress(status)
    if (!delegateAddress || !solanaDelegateAddress) {
      setError('Solana Auto Pay signer is not configured on the backend.')
      return
    }
    if (!await authReady()) return
    setBusy(enabled ? 'solanaAutoPayOn' : 'solanaAutoPayOff')
    setError('')
    try {
      const solanaOwnerAddress = await getConnectedSolanaAddress(true)
      const currentChains = autoPay?.delegateChains || delegate?.chains || []
      const previous = currentChains.find((item: any) => item.chain === 'Solana_Devnet')?.status
      let chainStatus = await resolveAutoPayStatus(solanaOwnerAddress, solanaDelegateAddress, 'Solana_Devnet', previous)
      if (enabled && chainStatus === 'not_configured') {
        await addUnifiedBalanceDelegateWithAppKit({ delegateAddress: solanaDelegateAddress, chain: 'Solana_Devnet' })
        chainStatus = normalizeAutoPayStatus(await getUnifiedBalanceDelegateStatusWithAppKit({ delegateAddress: solanaDelegateAddress, chain: 'Solana_Devnet' }))
      }
      if (!enabled && chainStatus !== 'not_configured') {
        await removeUnifiedBalanceDelegateWithAppKit({ delegateAddress: solanaDelegateAddress, chain: 'Solana_Devnet' })
        chainStatus = 'not_configured'
      }
      const delegateChains = mergeDelegateChain(currentChains, 'Solana_Devnet', normalizeAutoPayStatus(chainStatus))
      const activeChains = delegateChains.filter(item => ['ready', 'pending'].includes(normalizeAutoPayStatus(item.status)))
      const delegateStatus = activeChains.some(item => normalizeAutoPayStatus(item.status) === 'ready') ? 'ready' : activeChains.length ? 'pending' : 'not_configured'
      const saved = await setAiRouterAutoPay({
        ownerAddress: address,
        solanaOwnerAddress,
        enabled: activeChains.length > 0,
        delegateStatus,
        delegateAddress,
        delegateChains,
      })
      setStatus((current: any) => current ? {
        ...current,
        autoPay: saved.autoPay,
        delegate: { ...current.delegate, status: delegateStatus, address: delegateAddress, chains: delegateChains },
      } : current)
    } catch (error) {
      setError(error instanceof Error ? error.message : `Solana Auto Pay ${enabled ? 'enable' : 'disable'} failed`)
    } finally {
      setBusy('')
    }
    await refresh()
  }

  async function createKey() {
    if (!await authReady()) return
    const result = await runRequired('apiKey', () => createAiRouterApiKey({ ownerAddress: address }))
    setNewKey(result.apiKey || '')
    await refresh()
  }

  const autoPay = status?.autoPay
  const delegate = status?.delegate
  const autoPayStatus = delegate?.status || autoPay?.delegateStatus || autoPay?.status || 'not ready'
  const autoPayReady = autoPay?.enabled && autoPayStatus === 'ready'
  const autoPayLabel = autoPayReady ? 'Ready - siap digunakan' : formatAutoPayStatus(autoPayStatus)
  const solanaAutoPayStatus = normalizeAutoPayStatus((autoPay?.delegateChains || delegate?.chains || []).find((item: any) => item.chain === 'Solana_Devnet')?.status)
  const solanaAutoPayReady = solanaAutoPayStatus === 'ready'
  const readyChainCount = (autoPay?.delegateChains || delegate?.chains || []).filter((item: any) => item.status === 'ready').length
  const fundedChainCount = unifiedBalance ? confirmedUnifiedBalanceChains(unifiedBalance).length : 0
  const sourceChainCount = Math.max(fundedChainCount, (autoPay?.delegateChains || delegate?.chains || []).length)
  const hasAutoPaySetup = Boolean(autoPay?.enabled) || (autoPay?.delegateChains || delegate?.chains || []).some((item: any) => ['ready', 'pending'].includes(normalizeAutoPayStatus(item.status)))
  const keys = status?.apiKeys || []
  const activeKeys = keys.filter((key: any) => key.status === 'active')
  const visibleKeys = keys.filter((key: any) => key.status !== 'revoked')
  const usage = (status?.usageLogs || []).slice(0, 5)

  return (
    <div className='pay-page ai-router-page'>
      <section className='glass sandbox-hero ai-router-hero'>
        <div>
          <div className='docs-kicker'>AI Router</div>
          <h2>Deposit USDC. Create API key. Use AI models.</h2>
          <p>Each AI request is paid automatically from your deposited USDC.</p>
        </div>
        <div className='ai-router-status'>
          <StatusPill label='Unified Balance' value={formatUnifiedBalance(unifiedBalance)} />
          <StatusPill label='Auto Pay' value={autoPayReady ? 'Ready' : autoPay?.enabled ? 'Pending' : 'OFF'} tone={autoPayReady ? 'good' : 'warn'} />
          <StatusPill label='Available Networks' value={sourceChainCount ? `${readyChainCount}/${sourceChainCount} ready` : 'Not ready'} tone={sourceChainCount > 0 && readyChainCount === sourceChainCount ? 'good' : 'warn'} />
          <StatusPill label='Readiness' value={autoPayReady ? 'Siap digunakan' : autoPayLabel} tone={autoPayReady ? 'good' : 'warn'} />
          <StatusPill label='API Key' value={activeKeys.length ? 'Ready' : 'Not created'} tone={activeKeys.length ? 'good' : 'warn'} />
          <StatusPill label='Security' value={status?.security?.transactionWalletMatchRequired ? 'Protected' : 'Unavailable'} tone={status?.security?.transactionWalletMatchRequired ? 'good' : 'warn'} />
          <StatusPill label='Agent Identity' value={activeAgentIdentity ? `#${activeAgentIdentity.agentId}` : 'Personal'} tone={activeAgentIdentity ? 'good' : undefined} />
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
          <p className='pay-muted'>Approve each funded network once. Future AI requests are then paid automatically.</p>
          <div className='pay-grid'>
            <Info label='Auto Pay' value={autoPayLabel} />
            <Info label='Payment Source' value='Unified Balance' />
          </div>
          <div className='button-row wrap'>
            <button className='btn btn-primary' disabled={!!busy} onClick={enableAutoPay}>
              {busy === 'autoPaySetup' || busy === 'autoPayStatus' || busy === 'autoPay' ? 'Preparing...' : autoPayReady ? 'Sync Auto Pay Chains' : 'Enable Auto Pay'}
            </button>
            <button className='btn btn-secondary' disabled={!!busy || !hasAutoPaySetup} onClick={disableAutoPay}>
              {busy === 'autoPayRemove' || busy === 'autoPay' ? 'Turning off...' : 'Turn OFF'}
            </button>
          </div>
          <div className='pay-grid'>
            <Info label='Solana Devnet Auto Pay' value={formatAutoPayStatus(solanaAutoPayStatus)} />
            <Info label='Solana Delegate' value={autoPaySolanaAddress(status) || 'Not configured'} />
          </div>
          <div className='button-row wrap'>
            <button className='btn btn-primary' disabled={!!busy || solanaAutoPayReady} onClick={() => setSolanaAutoPayOnly(true)}>
              {busy === 'solanaAutoPayOn' ? 'Enabling Solana...' : 'Enable Solana Auto Pay'}
            </button>
            <button className='btn btn-secondary' disabled={!!busy || !solanaAutoPayReady} onClick={() => setSolanaAutoPayOnly(false)}>
              {busy === 'solanaAutoPayOff' ? 'Disabling Solana...' : 'Turn OFF Solana Auto Pay'}
            </button>
          </div>
        </div>

        <div className='glass sandbox-card'>
          <h3>3. API Key</h3>
          <p className='pay-muted'>Create a key for Hermes and other supported AI apps. Copy it now because it cannot be shown again.</p>
          <div className='button-row wrap'>
            <button className='btn btn-primary' disabled={busy === 'apiKey'} onClick={createKey}>
              {busy === 'apiKey' ? 'Creating...' : 'Create API Key'}
            </button>
          </div>
          <div className='api-key-list'>
            {visibleKeys.length ? visibleKeys.map((key: any) => (
              <div className='api-key-row' key={key.id}>
                <div>
                  <strong>{key.keyPreview}</strong>
                  <span>{key.agentId ? `Agent #${key.agentId} · ` : 'Personal · '}{key.status}</span>
                </div>
                <div className='button-row'>
                  <button className='btn btn-secondary small danger' disabled={busy === 'delete'} onClick={() => deleteKey(key)}>Delete</button>
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
                <span>{model.price_usdc ? `${model.price_usdc} USDC/request` : model.owned_by || 'provider'}</span>
              </div>
            ))}
          </div>
        </div>
        <div className='glass sandbox-card'>
          <h3>Usage Log</h3>
          {usage.length ? usage.map((item: any) => (
            <div className='usage-row' key={item.requestId}>
              <div><strong>{item.model || 'arcox/auto'}</strong><span>{item.providerUsed || 'provider pending'}</span></div>
              <div>
                <strong>{item.cost} USDC</strong>
                {item.txHash ? (
                  <a className='tx-link' href={`https://testnet.arcscan.app/tx/${item.txHash}`} target='_blank' rel='noreferrer'>
                    {shortHash(item.txHash)}
                  </a>
                ) : (
                  <span>{item.paymentStatus || item.status}</span>
                )}
              </div>
            </div>
          )) : <p className='pay-muted'>No usage yet.</p>}
        </div>
        <div className='glass sandbox-card'>
          <h3>Client Config</h3>
          <div className='config-snippet'>
            <code>base_url = https://arcoxdex.vercel.app/v1</code>
            <code>api_key = arx_sk_...</code>
            <code>model = arcox/auto</code>
          </div>
        </div>
      </section>
    </div>
  )

  async function deleteKey(key: any) {
    if (!await authReady()) return
    await runRequired('delete', () => revokeAiRouterApiKey({ ownerAddress: address, keyId: key.id }))
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

function sameAddress(a: string, b: string) {
  return String(a || '').toLowerCase() === String(b || '').toLowerCase()
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

function autoPaySolanaAddress(status: any) {
  return String(status?.solanaDelegateAddress || status?.delegate?.solanaAddress || '')
}

function shortHash(value: string) {
  return value ? `${value.slice(0, 8)}...${value.slice(-6)}` : ''
}

function normalizeAutoPayStatus(value: any) {
  if (value === true) return 'ready'
  if (value === false || value === null || value === undefined || value === '') return 'not_configured'
  if (typeof value === 'string') {
    const normalized = value.toLowerCase().replaceAll('_', ' ').trim()
    if (['ready', 'enabled', 'active', 'approved', 'allowed', 'complete', 'completed', 'success', 'delegated'].includes(normalized)) return 'ready'
    if (['none', 'missing', 'disabled', 'not configured', 'not ready'].includes(normalized)) return 'not_configured'
    if (normalized.includes('ready') || normalized.includes('enabled') || normalized.includes('active')) return 'ready'
    if (normalized.includes('pending') || normalized.includes('processing')) return 'pending'
    return value
  }
  if (typeof value === 'object') {
    const status = value.status || value.state || value.delegateStatus || value.readiness
    if (status) return normalizeAutoPayStatus(status)
    const flags = ['ready', 'isReady', 'enabled', 'isEnabled', 'delegated', 'isDelegated', 'allowed', 'hasDelegate']
    if (flags.some(flag => value[flag] === true)) return 'ready'
  }
  return 'pending'
}

function mergeDelegateChain(chains: any[], chain: string, status: string) {
  const next = (Array.isArray(chains) ? chains : []).filter(item => item?.chain !== chain).map(item => ({ chain: String(item.chain), status: normalizeAutoPayStatus(item.status) }))
  next.push({ chain, status })
  return next
}

async function resolveAutoPayStatus(ownerAddress: string, delegateAddress: string, chain: any, previousStatus?: any) {
  if (chain === 'Solana_Devnet') {
    try {
      return normalizeAutoPayStatus(await getUnifiedBalanceDelegateStatusWithAppKit({ delegateAddress, chain }))
    } catch (error) {
      const previous = normalizeAutoPayStatus(previousStatus)
      if (previous === 'ready' || previous === 'pending') return previous
      throw error
    }
  }
  try {
    const result = await getAiRouterDelegateStatus({ ownerAddress, delegateAddress, chain })
    return result.status
  } catch {
    try {
      return await getUnifiedBalanceDelegateStatusWithAppKit({ delegateAddress, chain })
    } catch (error) {
      if (/failed to fetch gateway info/i.test(error instanceof Error ? error.message : String(error))) return 'pending'
      const previous = normalizeAutoPayStatus(previousStatus)
      if (previous === 'ready' || previous === 'pending') return previous
      throw error
    }
  }
}
