import { useEffect, useMemo, useState } from 'react'
import { switchToArcTestnet } from '../domain/arcNetwork'
import { ARC_TOKENS } from '../domain/tokens'
import { estimateDelegatedUnifiedBalance, estimateX402UnifiedBalance, markX402UnifiedBalanceSpendSubmitted, spendDelegatedUnifiedBalance } from '../payApi'
import { estimateUnifiedBalanceSpendWithAppKit, spendUnifiedBalanceWithAppKit } from '../appKit'
import { getAuthToken } from '../auth'
import type { AgentIdentity } from '../services/agentIdentity'
import { findConnectedWalletProvider, normalizeWalletProvider } from '../walletProvider'
import { useI18n } from '../i18n'

type IntelType =
  | 'address'
  | 'address_all'
  | 'address_enriched'
  | 'balances'
  | 'counterparties'
  | 'flows'
  | 'history'
  | 'volume'
  | 'portfolio'
  | 'report'
  | 'tx'
  | 'tx_transfers'
  | 'contract'
  | 'entity'
  | 'entity_summary'
  | 'entity_balances'
  | 'entity_flows'
  | 'token'
  | 'token_contract'
  | 'token_market'
  | 'token_holders'
  | 'token_contract_holders'
  | 'token_top_flow'
  | 'token_trending'
  | 'token_top'
  | 'search'

declare global { interface Window { ethereum?: any } }

type IntelService = {
  id: IntelType
  label: string
  group: string
  price: string
  inputLabel?: string
  placeholder?: string
  needsValue?: boolean
  needsChain?: boolean
  needsTimeWindow?: boolean
  buildPath: (value: string, chain: string) => string
}

type IntelField = {
  label: string
  value: string
  rawValue?: unknown
  path?: string
  kind?: 'address' | 'hash' | 'datetime' | 'boolean' | 'amount' | 'number' | 'url' | 'text'
}

type IntelRecord = { index: number; title: string; fields: IntelField[] }
type IntelSection = { id: string; title: string; description?: string; fields: IntelField[]; records: IntelRecord[] }
type IntelPresentation = {
  title: string
  subtitle: string
  service: string
  provider: string
  generatedAt: string
  resource?: string
  providerPath?: string
  query?: Record<string, string>
  overview: IntelField[]
  sections: IntelSection[]
  dataQuality: { status: string; fieldCount: number; recordCount: number; sectionCount: number; partial?: boolean; errors?: Array<{ section: string; message: string }> }
  guidance?: string[]
}

const SERVICES: IntelService[] = [
  service('address', 'Wallet Intel', 'Wallet', '0.005', 'Wallet address', value => `/api/intel/address/${enc(value)}`),
  service('address_all', 'Wallet Intel: All', 'Wallet', '0.01', 'Wallet address', value => `/api/intel/address/${enc(value)}/all`),
  service('address_enriched', 'Wallet Enriched', 'Wallet', '0.01', 'Wallet address', value => `/api/intel/address/${enc(value)}/enriched`),
  service('balances', 'Wallet Balances', 'Wallet', '0.01', 'Wallet address', value => `/api/intel/address/${enc(value)}/balances`),
  service('counterparties', 'Wallet Counterparties', 'Wallet', '0.02', 'Wallet address', value => `/api/intel/address/${enc(value)}/counterparties`),
  service('flows', 'Wallet Flows', 'Wallet', '0.03', 'Wallet address', value => `/api/intel/address/${enc(value)}/flows`, false, true, true),
  service('history', 'Wallet History', 'Wallet', '0.03', 'Wallet address', value => `/api/intel/address/${enc(value)}/history`, false, true, true),
  service('volume', 'Wallet Volume', 'Wallet', '0.03', 'Wallet address', value => `/api/intel/address/${enc(value)}/volume`, false, true, true),
  service('portfolio', 'Wallet Portfolio', 'Wallet', '0.01', 'Wallet address', value => `/api/intel/address/${enc(value)}/portfolio`),
  service('report', 'Full Wallet Report', 'Wallet', '0.05', 'Wallet address', value => `/api/intel/report/address/${enc(value)}`),
  service('tx', 'Transaction Intel', 'Transaction', '0.005', 'Transaction hash', value => `/api/intel/tx/${enc(value)}`),
  service('tx_transfers', 'Transaction Transfers', 'Transaction', '0.005', 'Transaction hash', (value, chain) => `/api/intel/tx/${enc(value)}/transfers?chain=${enc(chain || 'ethereum')}`, true),
  service('contract', 'Contract Intel', 'Contract', '0.01', 'Contract address', (value, chain) => `/api/intel/contract/${enc(chain)}/${enc(value)}`, true),
  service('entity', 'Entity Intel', 'Entity', '0.02', 'Entity name or ID', value => `/api/intel/entity/${enc(value)}`),
  service('entity_summary', 'Entity Summary', 'Entity', '0.02', 'Entity name or ID', value => `/api/intel/entity/${enc(value)}/summary`),
  service('entity_balances', 'Entity Balances', 'Entity', '0.02', 'Entity name or ID', value => `/api/intel/entity/${enc(value)}/balances`),
  service('entity_flows', 'Entity Flows', 'Entity', '0.02', 'Entity name or ID', value => `/api/intel/entity/${enc(value)}/flows`, false, true, true),
  service('token', 'Token Intel', 'Token', '0.005', 'Token ID or symbol', value => `/api/intel/token/${enc(value)}`),
  service('token_contract', 'Token Contract Intel', 'Token', '0.005', 'Token contract address', (value, chain) => `/api/intel/token/${enc(chain)}/${enc(value)}`, true),
  service('token_market', 'Token Market', 'Token', '0.005', 'Token ID or symbol', value => `/api/intel/token/${enc(value)}/market`),
  service('token_holders', 'Token Holders', 'Token', '0.03', 'Token ID or symbol', value => `/api/intel/token/${enc(value)}/holders`),
  service('token_contract_holders', 'Token Contract Holders', 'Token', '0.03', 'Token contract address', (value, chain) => `/api/intel/token/${enc(chain)}/${enc(value)}/holders`, true),
  service('token_top_flow', 'Token Top Flow', 'Token', '0.03', 'Token ID or symbol', value => `/api/intel/token/${enc(value)}/top-flow`, false, true, true),
  service('token_trending', 'Trending Tokens', 'Token', '0.005', '', () => '/api/intel/token/trending', false, false),
  service('token_top', 'Top Tokens', 'Token', '0.005', '', () => '/api/intel/token/top', false, false),
  service('search', 'Search', 'Search', '0.005', 'Search query', value => `/api/intel/search?q=${enc(value)}`),
]

const SERVICE_BY_ID = Object.fromEntries(SERVICES.map(item => [item.id, item])) as Record<IntelType, IntelService>
const TIME_WINDOWS = ['1h', '24h', '7d', '30d']
const UB_SOURCES = [
  { id: 'auto', label: 'Auto' },
  { id: 'Arc_Testnet', label: 'Arc' },
  { id: 'Base_Sepolia', label: 'Base' },
  { id: 'Ethereum_Sepolia', label: 'ETH' },
  { id: 'Arbitrum_Sepolia', label: 'ARB' },
  { id: 'Solana_Devnet', label: 'SOL' },
]

export function IntelPanel({ address, activeAgentIdentity }: { address: string; activeAgentIdentity: AgentIdentity | null }) {
  const [type, setType] = useState<IntelType>('address')
  const [value, setValue] = useState('')
  const [chain, setChain] = useState('ethereum')
  const [timeWindow, setTimeWindow] = useState('24h')
  const [result, setResult] = useState<any>(null)
  const [requirement, setRequirement] = useState<any>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { t } = useI18n()
  const [paying, setPaying] = useState(false)
  const [paymentTx, setPaymentTx] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<'arc' | 'unified'>('arc')
  const [unifiedSourceChain, setUnifiedSourceChain] = useState('auto')
  const [unifiedEstimate, setUnifiedEstimate] = useState<any>(null)
  const [walletPaymentSubmitted, setWalletPaymentSubmitted] = useState(false)
  const [paymentPaid, setPaymentPaid] = useState<{ paymentId: string } | null>(null)
  const [adminStats, setAdminStats] = useState<any>(null)
  const [adminHealth, setAdminHealth] = useState<any>(null)
  const [adminCircuits, setAdminCircuits] = useState<any>(null)
  const [adminLoading, setAdminLoading] = useState(false)

  const selected = SERVICE_BY_ID[type]
  const path = useMemo(() => selected.buildPath(value.trim(), chain.trim()), [selected, value, chain])
  const requestPath = useMemo(() => {
    if (!selected.needsTimeWindow) return path
    const joiner = path.includes('?') ? '&' : '?'
    return `${path}${joiner}timeLast=${encodeURIComponent(timeWindow)}`
  }, [path, selected.needsTimeWindow, timeWindow])

  async function analyze(proof?: { paymentId: string }) {
    if (selected.needsValue !== false && !value.trim()) {
      setError(t('common.input') + ' is required.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const response = await fetch(requestPath, {
        headers: {
          ...((proof || paymentPaid) ? { 'X-PAYMENT-ID': (proof || paymentPaid)!.paymentId } : {}),
          'X-ARCOX-OWNER': address,
          ...(activeAgentIdentity ? { 'X-ARCOX-AGENT-ID': activeAgentIdentity.agentId } : {}),
        },
      })
      const data = await response.json().catch(() => ({}))
      if (response.status === 402) {
        setRequirement(data.x402)
        setResult(null)
        setPaymentPaid(null)
        setPaymentTx('')
        setWalletPaymentSubmitted(false)
        return
      }
      if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`)
      setRequirement(null)
      setPaymentPaid(null)
      setWalletPaymentSubmitted(false)
      setResult(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Intel request failed.')
    } finally {
      setLoading(false)
    }
  }

  async function checkInvoiceStatus() {
    if (!requirement) return
    setLoading(true)
    setError('')
    try {
      const invoiceId = requirement.invoiceId || requirement.paymentId
      const response = await fetch(`/api/x402/invoices/${encodeURIComponent(invoiceId)}/status`, { cache: 'no-store' })
      const text = await response.text()
      let data: any = {}
      try { data = text ? JSON.parse(text) : {} } catch { data = { raw: text } }
      if (!response.ok || data.error) throw new Error(data.error || data.raw || `Invoice status failed: HTTP ${response.status}`)
      const invoice = data.x402 || data.invoice
      if (!invoice) throw new Error('Invoice status response is empty.')
      setRequirement(invoice)
      if (invoice?.status === 'paid' || invoice?.status === 'service_unlocked') {
        setPaymentPaid({ paymentId: invoice.paymentId })
        await analyze({ paymentId: invoice.paymentId })
      } else if (invoice?.status === 'expired') {
        setError('Invoice expired. Request a new analysis to create a fresh invoice.')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invoice status check failed.')
    } finally {
      setLoading(false)
    }
  }

  async function payInvoiceWithWallet() {
    if (!requirement?.recipient || !requirement?.amount) return
    setPaying(true)
    setError('')
    try {
      await switchToArcTestnet()
      const provider = await findConnectedWalletProvider()
      if (!provider) throw new Error('Wallet EVM tidak terdeteksi.')
      const ethereum = normalizeWalletProvider(provider)
      const [account] = await ethereum.request({ method: 'eth_requestAccounts' })
      if (!account) throw new Error('Wallet belum terkoneksi.')
      const { encodeFunctionData, erc20Abi, parseUnits, keccak256, toHex } = await import('viem')
      const amount = parseUnits(String(requirement.amount || requirement.uniqueAmount), 6)
      const transferData = encodeFunctionData({
        abi: erc20Abi,
        functionName: 'transfer',
        args: [requirement.recipient as `0x${string}`, amount],
      })
      const memoData = (requirement.memoData || toHex(JSON.stringify({
        app: 'arcox',
        type: 'x402',
        invoiceId: requirement.invoiceId,
        paymentId: requirement.paymentId,
        resource: requirement.resource,
      }))) as `0x${string}`
      const memoId = (requirement.memoId || keccak256(toHex(String(requirement.paymentId || requirement.invoiceId)))) as `0x${string}`
      const memoContract = (requirement.memoContract || '0x5294E9927c3306DcBaDb03fe70b92e01cCede505') as `0x${string}`
      const data = encodeFunctionData({
        abi: [{
          type: 'function',
          name: 'memo',
          stateMutability: 'nonpayable',
          inputs: [
            { name: 'target', type: 'address' },
            { name: 'data', type: 'bytes' },
            { name: 'memoId', type: 'bytes32' },
            { name: 'memoData', type: 'bytes' },
          ],
          outputs: [],
        }],
        functionName: 'memo',
        args: [ARC_TOKENS.USDC.address, transferData, memoId, memoData],
      })
      const txHash = await ethereum.request({
        method: 'eth_sendTransaction',
        params: [{ from: account, to: memoContract, data, value: '0x0' }],
      })
      setPaymentTx(txHash)
      setWalletPaymentSubmitted(true)
      await checkInvoiceStatus()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Payment failed.')
    } finally {
      setPaying(false)
    }
  }

  async function estimateUnifiedPayment() {
    if (!requirement?.invoiceId || !requirement?.recipient || !requirement?.amount) return
    setPaying(true)
    setError('')
    try {
      const sdkEstimate = await estimateUnifiedBalanceSpendWithAppKit({
        amount: String(requirement.amount || requirement.uniqueAmount),
        recipient: requirement.recipient,
        sourceChain: unifiedSourceChain as any,
      })
      setUnifiedEstimate(sdkEstimate)
      const result = await estimateX402UnifiedBalance(requirement.invoiceId, {
        route: 'Circle Gateway Unified Balance -> Arc Testnet USDC',
        fees: (sdkEstimate as any)?.fees || [],
        sourceChain: unifiedSourceChain,
        delegateStatus: 'estimate_ready',
      })
      setRequirement(result.invoice || result.x402)
    } catch (e) {
      if (!delegatedFallbackError(e)) {
        setError(e instanceof Error ? e.message : 'Unified Balance estimate failed.')
      } else {
        try {
          const result = await estimateDelegatedUnifiedBalance({ purpose: 'x402', invoiceId: requirement.invoiceId, amount: String(requirement.amount || requirement.uniqueAmount), destinationChain: 'Arc_Testnet', sourceChain: unifiedSourceChain })
          setUnifiedEstimate({ ...result.estimate, delegated: true })
          setRequirement(result.invoice || requirement)
        } catch (fallbackError) {
          setError(fallbackError instanceof Error ? fallbackError.message : 'Unified Balance estimate failed.')
        }
      }
    } finally {
      setPaying(false)
    }
  }

  async function payWithUnifiedBalance() {
    if (!requirement?.invoiceId || !requirement?.recipient || !requirement?.amount) return
    setPaying(true)
    setError('')
    try {
      if ((unifiedEstimate as any)?.delegated) {
        if (!(unifiedEstimate as any)?.maxTotalDebit) {
          const estimate = await estimateDelegatedUnifiedBalance({ purpose: 'x402', invoiceId: requirement.invoiceId, amount: String(requirement.amount || requirement.uniqueAmount), destinationChain: 'Arc_Testnet', sourceChain: unifiedSourceChain })
          setUnifiedEstimate({ ...estimate.estimate, delegated: true })
          setRequirement(estimate.invoice || requirement)
          return
        }
        const result = await spendDelegatedUnifiedBalance({ purpose: 'x402', invoiceId: requirement.invoiceId, amount: String(requirement.amount || requirement.uniqueAmount), destinationChain: 'Arc_Testnet', sourceChain: unifiedSourceChain, maxTotalDebit: (unifiedEstimate as any)?.maxTotalDebit || (unifiedEstimate as any)?.totalDebit })
        const txHash = result.spend?.txHash || ''
        setPaymentTx(txHash)
        setWalletPaymentSubmitted(true)
        setRequirement(result.invoice || requirement)
        await checkInvoiceStatus()
        return
      }
      if (!unifiedEstimate) {
        await estimateUnifiedPayment()
        return
      }
      const spend = await spendUnifiedBalanceWithAppKit({
        amount: String(requirement.amount || requirement.uniqueAmount),
        recipient: requirement.recipient,
        sourceChain: unifiedSourceChain as any,
      })
      const txHash = (spend as any)?.txHash || ''
      setPaymentTx(txHash)
      setWalletPaymentSubmitted(true)
      const result = await markX402UnifiedBalanceSpendSubmitted(requirement.invoiceId, {
        txHash,
        transferId: (spend as any)?.transferId || '',
        spendResult: spend,
      })
      setRequirement(result.invoice || result.x402)
      await checkInvoiceStatus()
    } catch (e) {
      if (!delegatedFallbackError(e)) {
        setError(e instanceof Error ? e.message : 'Unified Balance spend failed.')
      } else {
        try {
          const result = await estimateDelegatedUnifiedBalance({ purpose: 'x402', invoiceId: requirement.invoiceId, amount: String(requirement.amount || requirement.uniqueAmount), destinationChain: 'Arc_Testnet', sourceChain: unifiedSourceChain })
          setUnifiedEstimate({ ...result.estimate, delegated: true })
          setRequirement(result.invoice || requirement)
        } catch (fallbackError) {
          setError(fallbackError instanceof Error ? fallbackError.message : 'Unified Balance spend failed.')
        }
      }
    } finally {
      setPaying(false)
    }
  }

  useEffect(() => {
    if (!requirement || !['payment_required', 'estimate_ready', 'awaiting_signature', 'spend_submitted', 'settlement_pending', 'pending'].includes(requirement.status) || !walletPaymentSubmitted) return
    const timer = setInterval(() => {
      checkInvoiceStatus().catch(() => {})
    }, 5000)
    return () => clearInterval(timer)
  }, [requirement?.invoiceId, requirement?.paymentId, requirement?.status, walletPaymentSubmitted])

  // x402 operator snapshot: usage analytics (owner-gated) + treasury health +
  // provider circuit state. All read-only; never triggers a payment.
  async function loadAdminStats() {
    setAdminLoading(true)
    try {
      const token = getAuthToken()
      const [statsResponse, treasuryResponse, circuitsResponse] = await Promise.all([
        fetch('/api/x402/stats', {
          headers: {
            Authorization: `Bearer ${token}`,
            'X-Arcox-Owner': address,
          },
          cache: 'no-store',
        }),
        fetch('/api/x402/treasury-health', { cache: 'no-store' }),
        fetch('/api/intel/provider-health', { cache: 'no-store' }),
      ])
      const [statsData, treasuryData, circuitsData] = await Promise.all([
        statsResponse.json().catch(() => ({})),
        treasuryResponse.json().catch(() => ({})),
        circuitsResponse.json().catch(() => ({})),
      ])
      if (statsResponse.ok) setAdminStats(statsData.stats || statsData)
      setAdminHealth(treasuryResponse.ok ? treasuryData : null)
      setAdminCircuits(circuitsResponse.ok ? circuitsData.circuits || [] : [])
    } catch {
      // Snapshot is best-effort; the main intel flow is unaffected.
    } finally {
      setAdminLoading(false)
    }
  }

  useEffect(() => {
    // Deferred so the synchronous loading flag does not cascade renders inside
    // the effect body (react-hooks/set-state-in-effect).
    const timer = setTimeout(() => {
      loadAdminStats().catch(() => {})
    }, 0)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address])

  return (
    <div className='pay-page'>
      <section className='glass sandbox-hero'>
        <div className='docs-kicker'>{t('intel.insightsTitle')}</div>
        <h2>{t('intel.hero')}</h2>
        <p>{t('intel.copy')}</p>
        <div className='inline-warning'>{t('intel.warning')}</div>
      </section>

      {error && <div className='inline-error'>{error}</div>}

      <section className='sandbox-grid'>
        <div className='glass sandbox-card'>
          <h3>{t('intel.choose')}</h3>
          <ServicePicker
            value={type}
            onChange={next => {
              setType(next)
              setResult(null)
              setRequirement(null)
              setUnifiedEstimate(null)
            }}
          />
          {selected.needsChain && <Field label={t('intel.chain')} value={chain} onChange={setChain} placeholder='ethereum, base, arbitrum...' />}
          {selected.needsTimeWindow && (
            <label className='sandbox-field'>
              <span>{t('intel.timeWindow')}</span>
              <select className='input compact-intel-select' value={timeWindow} onChange={event => setTimeWindow(event.target.value)}>
                {TIME_WINDOWS.map(window => <option key={window} value={window}>{window}</option>)}
              </select>
            </label>
          )}
          {selected.needsValue !== false && <Field label={selected.inputLabel || t('intel.input')} value={value} onChange={setValue} placeholder={selected.placeholder || selected.inputLabel || ''} />}
          <div className='pay-grid'>
            <Info label={t('intel.price')} value={`${selected.price} USDC`} />
            <Info label={t('intel.payWith')} value='USDC on Arc Testnet' />
            <Info label={t('intel.category')} value={selected.group} />
          </div>
          <button className='btn btn-primary' onClick={() => analyze()} disabled={loading}>{loading ? t('intel.analyzing') : t('intel.analyze')}</button>
        </div>

        <div className='glass sandbox-card'>
          <h3>{t('intel.payment')}</h3>
          {requirement ? (
            <>
              <p className='pay-muted'>{t('intel.paymentCopy')}</p>
              <div className='sandbox-field'>
                <span>{t('intel.paymentMethod')}</span>
                <div className='payment-method-picker' role='radiogroup' aria-label={t('intel.paymentMethod')}>
                  <button type='button' role='radio' aria-checked={paymentMethod === 'arc'} className={paymentMethod === 'arc' ? 'active' : ''} onClick={() => setPaymentMethod('arc')}>
                    <strong>Arc USDC</strong><small>{t('intel.payFromWallet')}</small>
                  </button>
                  <button type='button' role='radio' aria-checked={paymentMethod === 'unified'} className={paymentMethod === 'unified' ? 'active' : ''} onClick={() => setPaymentMethod('unified')}>
                    <strong>Unified Balance</strong><small>{t('intel.payFromDeposited')}</small>
                  </button>
                </div>
              </div>
              <div className='pay-grid'>
                <Info label='Invoice ID' value={requirement.invoiceId || '-'} mono />
                <Info label='Status' value={statusLabel(requirement.status || 'pending')} />
                <Info label='Recipient' value={requirement.recipient || '-'} mono />
                <Info label='Exact Amount' value={`${requirement.uniqueAmount || requirement.amount} ${requirement.asset || 'USDC'}`} />
                <Info label='Network' value={requirement.network || '-'} />
                <Info label='Payment Status' value={requirement.settlementStatus || requirement.status || '-'} />
                <Info label='Payment ID' value={requirement.paymentId || '-'} mono />
                <Info label='Resource' value={requirement.resource || '-'} mono />
                <Info label='Memo ID' value={requirement.memoId || '-'} mono />
                <Info label='Agent Identity' value={requirement.agentId ? `#${requirement.agentId}` : 'Personal'} />
                <Info label='Expires' value={`${requirement.expiresInSeconds || 300}s`} />
              </div>
              <button className='btn btn-primary' onClick={checkInvoiceStatus} disabled={loading || !requirement.invoiceId}>
                {loading ? t('common.checking') : t('intel.checkPayment')}
              </button>
              {paymentMethod === 'arc' ? (
                <button className='btn btn-secondary' onClick={payInvoiceWithWallet} disabled={paying || loading || !isPayable(requirement.status)}>
                  {paying ? t('common.paymentSending') : t('intel.payArc')}
                </button>
              ) : (
                <>
                  <label className='sandbox-field'>
                    <span>{t('intel.unifiedSource')}</span>
                    <div className='compact-chain-grid compact-chain-grid--stacked'>
                      {UB_SOURCES.map(source => (
                        <button key={source.id} type='button' className={unifiedSourceChain === source.id ? 'active' : ''} onClick={() => { setUnifiedSourceChain(source.id); setUnifiedEstimate(null) }}>
                          {source.label}
                        </button>
                      ))}
                    </div>
                  </label>
                  <div className='button-row wrap'>
                    <button className='btn btn-secondary' onClick={estimateUnifiedPayment} disabled={paying || loading || !isPayable(requirement.status)}>
                      {paying ? t('common.checking') : t('intel.estimate')}
                    </button>
                    <button className='btn btn-primary' onClick={payWithUnifiedBalance} disabled={paying || loading || !isPayable(requirement.status)}>
                      {paying ? t('ui.submitting') : t('intel.payUnified')}
                    </button>
                  </div>
                </>
              )}
              {unifiedEstimate && (
                <div className='pay-grid'>
                  <Info label='Report Price' value={`${unifiedEstimate.requestedReceiveAmount || requirement.amount} USDC`} />
                  <Info label='Network Fee' value={`${unifiedEstimate.totalFee || '0'} USDC`} />
                  <Info label='Estimated Total' value={`${unifiedEstimate.totalDebit || unifiedEstimate.spendAmount || requirement.amount} USDC`} />
                  {unifiedEstimate.maxTotalDebit && <Info label='Maximum Total' value={`${unifiedEstimate.maxTotalDebit} USDC`} />}
                </div>
              )}
              {paymentTx && <p className='pay-muted'>{t('common.waitingSettlement')} {short(paymentTx, 10, 8)}</p>}
            </>
          ) : (
            <p className='pay-muted'>The first request creates a payment invoice. Once paid, the same service returns the unlocked result.</p>
          )}
        </div>

        <div className='glass sandbox-card wide'>
          <h3>{t('intel.result')}</h3>
          <IntelResult result={result} requirement={requirement} selected={selected} />
        </div>
      </section>

      <section className='glass sandbox-card wide'>
        <div className='intel-section-heading'>
          <div><span>x402 operator</span><h3>x402 Status</h3></div>
          <button type='button' className='btn btn-secondary' onClick={() => loadAdminStats()} disabled={adminLoading}>
            {adminLoading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
        <AdminStats stats={adminStats} health={adminHealth} circuits={adminCircuits} />
      </section>
    </div>
  )
}

function AdminStats({ stats, health, circuits }: { stats: any; health: any; circuits: any }) {
  if (!stats && !health && !circuits) {
    return <p className='pay-muted'>Sign in with an active MSCA session to see x402 usage analytics.</p>
  }
  const degradedCount = Array.isArray(circuits)
    ? circuits.filter((circuit: any) => circuit?.state === 'open').length
    : 0
  return (
    <div className='intel-result'>
      <div className='pay-grid'>
        <Info label='Total Revenue' value={stats ? `${stats.revenueUsdc ?? '-'} USDC` : '-'} />
        <Info label='Revenue (24h)' value={stats ? `${stats.revenueLast24hUsdc ?? '-'} USDC` : '-'} />
        <Info label='Paid Invoices' value={String(stats?.totals?.paid ?? '-')} />
        <Info label='Open Invoices' value={String(stats?.totals?.open ?? '-')} />
        <Info label='Total Invoices' value={String(stats?.totals?.invoices ?? '-')} />
        <Info label='Paid (24h)' value={String(stats?.paid24h ?? '-')} />
        <Info label='Provider Not Found' value={String(stats?.providerErrors?.provider_not_found ?? '-')} />
        <Info label='Provider Errors' value={String(stats?.providerErrors?.provider_error ?? '-')} />
      </div>
      {stats && (
        <div className='pay-grid'>
          <Info label='Refund Pending Review' value={String(stats?.refunds?.pending_review ?? '-')} />
          <Info label='Refund Approved' value={String(stats?.refunds?.refund_approved ?? '-')} />
          <Info label='Refunded' value={String(stats?.refunds?.refunded ?? '-')} />
          <Info label='Manual Review' value={String(stats?.refunds?.manual_review ?? '-')} />
          <Info label='Refund Failed (Manual)' value={String(stats?.refunds?.refund_failed_manual ?? '-')} />
          <Info label='Refunded Total' value={`${stats?.refunds?.refundedUsdc ?? '-'} USDC`} />
        </div>
      )}
      <div className='pay-grid'>
        <Info label='Treasury Balance' value={health ? `${health.totalUsdc ?? '-'} USDC` : '-'} />
        <Info label='Treasury Min' value={health ? `${health.minUsdc ?? '-'} USDC` : '-'} />
        <Info label='Treasury Status' value={health ? (health.healthy ? 'Healthy' : health.known === false ? 'Unknown (fail-open)' : 'LOW') : '-'} />
        <Info label='Degraded Services' value={String(degradedCount)} />
      </div>
      {health?.byChain && (
        <div className='pay-grid'>
          {Object.entries(health.byChain).map(([chain, amount]) => (
            <Info key={chain} label={`Treasury · ${chain}`} value={`${String(amount)} USDC`} />
          ))}
        </div>
      )}
      {Array.isArray(circuits) && circuits.length > 0 && (
        <div className='pay-grid'>
          {circuits.map((circuit: any) => (
            <Info key={circuit?.key} label={`Circuit · ${circuit?.key || '-'}`} value={String(circuit?.state || '-')} />
          ))}
        </div>
      )}
    </div>
  )
}

function delegatedFallbackError(error: unknown) {
  return /chainId.*NaN|Maximum retry attempts|Failed to fetch|Gateway API error|Request timed out|temporarily unavailable/i.test(error instanceof Error ? error.message : String(error))
}

function ServicePicker({ value, onChange }: { value: IntelType; onChange: (value: IntelType) => void }) {
  return (
    <div className='sandbox-field'>
      <span>{t('intel.service')}</span>
      <div className='intel-service-list'>
        {Object.entries(groupServices()).map(([group, services]) => (
          <div className='intel-service-group' key={group}>
            <strong>{group}</strong>
            <div className='intel-service-options'>
              {services.map(item => (
                <button key={item.id} type='button' className={value === item.id ? 'active' : ''} onClick={() => onChange(item.id)}>
                  <span>{item.label}</span>
                  <small>{item.price} USDC</small>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function IntelResult({ result, requirement, selected }: { result: any; requirement: any; selected: IntelService }) {
  const { t } = useI18n()
  if (result?.ok) {
    const presentation = normalizePresentation(result, selected)
    const quality = presentation.dataQuality
    const payment = result.x402Payment
    return (
      <div className='intel-result'>
        <div className='intel-result-header'>
          <div>
            <div className='docs-kicker'>{t('common.paidUnlocked')}</div>
            <h4>{presentation.title || selected.label}</h4>
            <p>{presentation.subtitle || t('intel.copy')}</p>
          </div>
          <span className={`intel-pill ${quality.status === 'partial' ? 'warning' : ''}`}>{quality.status || 'complete'}</span>
        </div>

        <div className='intel-result-meta'>
          <Info label={t('intel.service')} value={selected.label} />
          <Info label={t('intel.dataProvider')} value={presentation.provider || 'Arkham Intel API'} />
          <Info label={t('intel.generatedAt')} value={formatDate(presentation.generatedAt)} />
          <Info label={t('intel.coverage')} value={`${quality.fieldCount} labeled fields, ${quality.recordCount} records, ${quality.sectionCount} sections`} />
          <Info label='ARCOX Resource' value={presentation.resource || requestLabel(selected)} mono />
          <Info label='Provider Endpoint' value={presentation.providerPath || 'Arkham endpoint'} mono />
          <Info label='Query Parameters' value={formatQuery(presentation.query)} mono />
          <Info label={t('intel.accessStatus')} value='Paid and unlocked' />
        </div>

        {payment && (
          <section className='intel-detail-section intel-payment-receipt'>
            <div className='intel-section-heading'>
              <div><span>{t('intel.paymentReceipt')}</span><h4>{t('intel.accessPayment')}</h4></div>
              <span className='intel-pill'>{statusLabel(payment.status || 'paid')}</span>
            </div>
            <div className='intel-field-grid'>
              <DetailField field={{ label: 'Invoice ID', value: payment.invoiceId || '-', kind: 'text' }} mono />
              <DetailField field={{ label: 'Payment ID', value: payment.paymentId || '-', kind: 'text' }} mono />
              <DetailField field={{ label: 'Exact Amount Paid', value: `${payment.amount || '-'} ${payment.asset || 'USDC'}`, kind: 'amount' }} />
              <DetailField field={{ label: 'Payment Network', value: payment.network || '-', kind: 'text' }} />
              <DetailField field={{ label: 'Treasury Recipient', value: payment.recipient || '-', kind: 'address' }} mono />
              <DetailField field={{ label: 'Paid At', value: formatDate(payment.paidAt), kind: 'datetime' }} />
              <DetailField field={{ label: 'Reconciled By', value: payment.reconciledBy || 'On-chain reconciliation', kind: 'text' }} />
              <div className='intel-field intel-field--wide'>
                <span className='intel-field-label'>{t('intel.paymentTransaction')}</span>
                {payment.txHash ? (
                  <a className='intel-field-value mono intel-tx-link' href={`https://testnet.arcscan.app/tx/${payment.txHash}`} target='_blank' rel='noreferrer'>{payment.txHash}</a>
                ) : <strong className='intel-field-value'>{t('intel.notReported')}</strong>}
              </div>
            </div>
          </section>
        )}

        {presentation.overview.length > 0 && (
          <section className='intel-detail-section'>
            <div className='intel-section-heading'><div><span>{t('intel.overview')}</span><h4>{t('intel.resultFields')}</h4></div></div>
            <div className='intel-field-grid'>
              {presentation.overview.map((field, index) => <DetailField key={`${field.path || field.label}-${index}`} field={field} />)}
            </div>
          </section>
        )}

        {presentation.sections.map(section => (
          <section className='intel-detail-section' key={section.id}>
            <div className='intel-section-heading'>
              <div><span>{t('intel.resultSection')}</span><h4>{section.title}</h4></div>
              <small>{section.description || `${section.records.length} records`}</small>
            </div>
            {section.fields.length > 0 && (
              <div className='intel-field-grid'>
                {section.fields.map((field, index) => <DetailField key={`${field.path || field.label}-${index}`} field={field} />)}
              </div>
            )}
            {section.records.length > 0 && (
              <div className='intel-record-list'>
                {section.records.map(record => (
                  <article className='intel-record-card' key={`${section.id}-${record.index}`}>
                    <div className='intel-record-heading'><span>Record {record.index}</span><strong>{record.title}</strong></div>
                    <div className='intel-record-fields'>
                      {record.fields.map((field, index) => <DetailField key={`${field.path || field.label}-${index}`} field={field} />)}
                    </div>
                  </article>
                ))}
              </div>
            )}
            {!section.fields.length && !section.records.length && <p className='pay-muted'>{t('intel.noData')}</p>}
          </section>
        ))}

        <section className='intel-detail-section intel-quality'>
          <div className='intel-section-heading'><div><span>{t('intel.dataQuality')}</span><h4>{t('intel.coverageInterpretation')}</h4></div></div>
          {quality.errors && quality.errors.length > 0 && (
            <div className='intel-error-list'>
              {quality.errors.map((item, index) => <p key={`${item.section}-${index}`}><strong>{humanize(item.section)}:</strong> {item.message}</p>)}
            </div>
          )}
          {presentation.guidance && presentation.guidance.length > 0 && (
            <ul className='intel-guidance'>
              {presentation.guidance.map((note, index) => <li key={index}>{note}</li>)}
            </ul>
          )}
          {!quality.fieldCount && !quality.recordCount && <p className='pay-muted'>{t('intel.noFields')}</p>}
        </section>
      </div>
    )
  }
  if (requirement) {
    return (
      <div className='intel-result'>
        <div className='intel-result-header'>
          <div>
            <div className='docs-kicker'>{t('intel.paymentRequired')}</div>
            <h4>{selected.label}</h4>
            <p>{t('intel.payRequired')}</p>
          </div>
          <span className='intel-pill warning'>{statusLabel(requirement.status || 'pending')}</span>
        </div>
        <div className='pay-grid'>
          <Info label='Invoice' value={requirement.invoiceId || '-'} mono />
          <Info label='Status' value={statusLabel(requirement.status || 'pending')} />
          <Info label='Exact Amount' value={`${requirement.uniqueAmount || requirement.amount} ${requirement.asset || 'USDC'}`} />
          <Info label='Recipient' value={requirement.recipient || '-'} mono />
        </div>
      </div>
    )
  }
  return <p className='pay-muted'>{t('intel.runFirst')}</p>
}

function DetailField({ field, mono = false }: { field: IntelField; mono?: boolean }) {
  const isMono = mono || field.kind === 'address' || field.kind === 'hash'
  return (
    <div className='intel-field'>
      <span className='intel-field-label'>{field.label}</span>
      {field.kind === 'url' && /^https?:\/\//.test(field.value) ? (
        <a className={`intel-field-value ${isMono ? 'mono' : ''}`} href={field.value} target='_blank' rel='noreferrer'>{field.value}</a>
      ) : (
        <strong className={`intel-field-value ${isMono ? 'mono' : ''}`}>{field.value || '-'}</strong>
      )}
    </div>
  )
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <label className='sandbox-field'>
      <span>{label}</span>
      <input className='input' value={value} placeholder={placeholder} onChange={event => onChange(event.target.value)} />
    </label>
  )
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className='pay-info'>
      <span>{label}</span>
      <strong className={mono ? 'mono' : ''}>{value || '-'}</strong>
    </div>
  )
}

function isPayable(status: string) {
  return ['payment_required', 'estimate_ready', 'awaiting_signature', 'spend_submitted', 'settlement_pending', 'pending'].includes(status)
}

function service(
  id: IntelType,
  label: string,
  group: string,
  price: string,
  inputLabel: string,
  buildPath: (value: string, chain: string) => string,
  needsChain = false,
  needsValue = true,
  needsTimeWindow = false,
): IntelService {
  return { id, label, group, price, inputLabel, needsChain, needsValue, needsTimeWindow, buildPath }
}

function groupServices() {
  return SERVICES.reduce<Record<string, IntelService[]>>((acc, item) => {
    acc[item.group] = [...(acc[item.group] || []), item]
    return acc
  }, {})
}

function normalizePresentation(result: any, selected: IntelService): IntelPresentation {
  if (result?.intelPresentation?.dataQuality) return result.intelPresentation as IntelPresentation
  const payload = result?.report || result?.data || result
  const fields = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? Object.entries(payload)
      .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
      .slice(0, 16)
      .map(([key, value]) => ({ label: humanize(key), value: String(value), path: key, kind: inferFieldKind(key, value) }))
    : []
  const records = Array.isArray(payload) ? payload.slice(0, 30).map((item, index) => ({
    index: index + 1,
    title: `Record ${index + 1}`,
    fields: item && typeof item === 'object'
      ? Object.entries(item).filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value)).slice(0, 12).map(([key, value]) => ({ label: humanize(key), value: String(value), path: `${index}.${key}`, kind: inferFieldKind(key, value) }))
      : [{ label: 'Value', value: String(item), path: String(index), kind: 'text' as const }],
  })) : []
  return {
    title: selected.label,
    subtitle: 'Structured on-chain intelligence returned by Arkham through ARCOX.',
    service: selected.id,
    provider: 'Arkham Intel API',
    generatedAt: new Date().toISOString(),
    resource: '',
    providerPath: '',
    query: {},
    overview: fields,
    sections: records.length ? [{ id: 'records', title: 'Records', description: `${records.length} records returned`, fields: [], records }] : [],
    dataQuality: { status: fields.length || records.length ? 'complete' : 'empty', fieldCount: fields.length + records.reduce((sum, item) => sum + item.fields.length, 0), recordCount: records.length, sectionCount: records.length ? 1 : 0 },
    guidance: [result?.disclaimer || 'Informational only. Not financial advice.'],
  }
}

function requestLabel(selected: IntelService) {
  return `ARCOX Intel: ${selected.label}`
}

function formatQuery(query?: Record<string, string>) {
  if (!query || !Object.keys(query).length) return 'No additional parameters'
  return Object.entries(query).map(([key, value]) => `${key}=${value}`).join(', ')
}

function inferFieldKind(key: string, value: unknown): IntelField['kind'] {
  const text = String(value)
  if (/^(0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/.test(text)) return 'address'
  if (/^(0x[a-fA-F0-9]{64}|[1-9A-HJ-NP-Za-km-z]{64,100})$/.test(text)) return 'hash'
  if (/time|date|created|updated|timestamp/i.test(key)) return 'datetime'
  if (typeof value === 'number') return 'number'
  return 'text'
}

function humanize(key: string) {
  return key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/\b\w/g, s => s.toUpperCase())
}

function statusLabel(value: string) {
  return value ? value.replace(/[_-]+/g, ' ').replace(/\b\w/g, s => s.toUpperCase()) : '-'
}

function short(value: string, left = 8, right = 6) {
  if (!value || value.length <= left + right + 3) return value || '-'
  return `${value.slice(0, left)}...${value.slice(-right)}`
}

function formatDate(value: string) {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function enc(value: string) {
  return encodeURIComponent(value.trim())
}
