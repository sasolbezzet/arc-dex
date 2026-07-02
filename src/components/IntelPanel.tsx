import { useEffect, useMemo, useState } from 'react'
import { switchToArcTestnet } from '../domain/arcNetwork'
import { ARC_TOKENS } from '../domain/tokens'
import { estimateDelegatedUnifiedBalance, estimateX402UnifiedBalance, markX402UnifiedBalanceSpendSubmitted, spendDelegatedUnifiedBalance } from '../payApi'
import { estimateUnifiedBalanceSpendWithAppKit, spendUnifiedBalanceWithAppKit } from '../appKit'
import type { AgentIdentity } from '../services/agentIdentity'

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
  const [paying, setPaying] = useState(false)
  const [paymentTx, setPaymentTx] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<'arc' | 'unified'>('arc')
  const [unifiedSourceChain, setUnifiedSourceChain] = useState('auto')
  const [unifiedEstimate, setUnifiedEstimate] = useState<any>(null)
  const [walletPaymentSubmitted, setWalletPaymentSubmitted] = useState(false)
  const [paymentPaid, setPaymentPaid] = useState<{ paymentId: string } | null>(null)

  const selected = SERVICE_BY_ID[type]
  const path = useMemo(() => selected.buildPath(value.trim(), chain.trim()), [selected, value, chain])
  const requestPath = useMemo(() => {
    if (!selected.needsTimeWindow) return path
    const joiner = path.includes('?') ? '&' : '?'
    return `${path}${joiner}timeLast=${encodeURIComponent(timeWindow)}`
  }, [path, selected.needsTimeWindow, timeWindow])

  async function analyze(proof?: { paymentId: string }) {
    if (selected.needsValue !== false && !value.trim()) {
      setError('Input is required.')
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
    if (!window.ethereum) {
      setError('Wallet browser tidak terdeteksi.')
      return
    }
    setPaying(true)
    setError('')
    try {
      await switchToArcTestnet()
      const [account] = await window.ethereum.request({ method: 'eth_requestAccounts' })
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
      const txHash = await window.ethereum.request({
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
          const result = await spendDelegatedUnifiedBalance({ purpose: 'x402', invoiceId: requirement.invoiceId, amount: String(requirement.amount || requirement.uniqueAmount), destinationChain: 'Arc_Testnet', sourceChain: unifiedSourceChain, maxTotalDebit: (unifiedEstimate as any)?.maxTotalDebit || (unifiedEstimate as any)?.totalDebit })
          setPaymentTx(result.spend?.txHash || '')
          setWalletPaymentSubmitted(true)
          setRequirement(result.invoice || requirement)
          await checkInvoiceStatus()
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

  return (
    <div className='pay-page'>
      <section className='glass sandbox-hero'>
        <div className='docs-kicker'>ARCOX Intel</div>
        <h2>Arkham Intelligence via x402</h2>
        <p>Choose a paid Intel service, pay the Arc USDC invoice with an attached transaction memo, then ARCOX API unlocks the Arkham result after the memo payment is detected.</p>
        <div className='inline-warning'>Informational only. Not financial advice. Arkham API calls are served by ARCOX API; the browser never receives the Arkham API key.</div>
      </section>

      {error && <div className='inline-error'>{error}</div>}

      <section className='sandbox-grid'>
        <div className='glass sandbox-card'>
          <h3>Analysis Request</h3>
          <ServicePicker
            value={type}
            onChange={next => {
              setType(next)
              setResult(null)
              setRequirement(null)
              setUnifiedEstimate(null)
            }}
          />
          {selected.needsChain && <Field label='Chain' value={chain} onChange={setChain} placeholder='ethereum, base, arbitrum...' />}
          {selected.needsTimeWindow && (
            <label className='sandbox-field'>
              <span>Time Window</span>
              <select className='input compact-intel-select' value={timeWindow} onChange={event => setTimeWindow(event.target.value)}>
                {TIME_WINDOWS.map(window => <option key={window} value={window}>{window}</option>)}
              </select>
            </label>
          )}
          {selected.needsValue !== false && <Field label={selected.inputLabel || 'Input'} value={value} onChange={setValue} placeholder={selected.placeholder || selected.inputLabel || ''} />}
          <div className='pay-grid'>
            <Info label='Price' value={`${selected.price} USDC`} />
            <Info label='Payment Network' value='Arc Testnet USDC' />
            <Info label='Service Group' value={selected.group} />
            <Info label='Backend Route' value={requestPath} mono />
          </div>
          <button className='btn btn-primary' onClick={() => analyze()} disabled={loading}>{loading ? 'Analyzing...' : 'Analyze'}</button>
        </div>

        <div className='glass sandbox-card'>
          <h3>x402 Payment</h3>
          {requirement ? (
            <>
              <p className='pay-muted'>Pay with the wallet button so ARCOX can attach the invoice memo on-chain. Manual txHash unlocks are not accepted.</p>
              <div className='sandbox-field'>
                <span>Payment Method</span>
                <div className='payment-method-picker' role='radiogroup' aria-label='Payment method'>
                  <button type='button' role='radio' aria-checked={paymentMethod === 'arc'} className={paymentMethod === 'arc' ? 'active' : ''} onClick={() => setPaymentMethod('arc')}>
                    <strong>Arc USDC</strong><small>Wallet memo payment</small>
                  </button>
                  <button type='button' role='radio' aria-checked={paymentMethod === 'unified'} className={paymentMethod === 'unified' ? 'active' : ''} onClick={() => setPaymentMethod('unified')}>
                    <strong>Unified Balance</strong><small>Circle Gateway spend</small>
                  </button>
                </div>
              </div>
              <div className='pay-grid'>
                <Info label='Invoice ID' value={requirement.invoiceId || '-'} mono />
                <Info label='Status' value={statusLabel(requirement.status || 'pending')} />
                <Info label='Recipient' value={requirement.recipient || '-'} mono />
                <Info label='Exact Amount' value={`${requirement.uniqueAmount || requirement.amount} ${requirement.asset || 'USDC'}`} />
                <Info label='Network' value={requirement.network || '-'} />
                <Info label='Settlement' value={requirement.settlementStatus || requirement.status || '-'} />
                <Info label='Payment ID' value={requirement.paymentId || '-'} mono />
                <Info label='Resource' value={requirement.resource || '-'} mono />
                <Info label='Memo ID' value={requirement.memoId || '-'} mono />
                <Info label='Agent Identity' value={requirement.agentId ? `#${requirement.agentId}` : 'Personal'} />
                <Info label='Expires' value={`${requirement.expiresInSeconds || 300}s`} />
              </div>
              <button className='btn btn-primary' onClick={checkInvoiceStatus} disabled={loading || !requirement.invoiceId}>
                {loading ? 'Checking...' : 'Check Payment Status'}
              </button>
              {paymentMethod === 'arc' ? (
                <button className='btn btn-secondary' onClick={payInvoiceWithWallet} disabled={paying || loading || !isPayable(requirement.status)}>
                  {paying ? 'Sending USDC...' : 'Pay with Arc USDC Memo'}
                </button>
              ) : (
                <>
                  <label className='sandbox-field'>
                    <span>Unified Balance Source</span>
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
                      {paying ? 'Estimating...' : 'Estimate Unified Balance'}
                    </button>
                    <button className='btn btn-primary' onClick={payWithUnifiedBalance} disabled={paying || loading || !isPayable(requirement.status)}>
                      {paying ? 'Submitting...' : 'Pay with Unified Balance'}
                    </button>
                  </div>
                </>
              )}
              {unifiedEstimate && (
                <div className='pay-grid'>
                  <Info label='UB Route' value='Gateway spend to Arc Testnet' />
                  <Info label='Invoice Receive' value={`${unifiedEstimate.requestedReceiveAmount || requirement.amount} USDC`} />
                  <Info label='Gateway Fees' value={`${unifiedEstimate.totalFee || '0'} USDC`} />
                  <Info label='Total Unified Debit' value={`${unifiedEstimate.totalDebit || unifiedEstimate.spendAmount || requirement.amount} USDC`} />
                  {unifiedEstimate.maxTotalDebit && <Info label='Max Approved Debit' value={`${unifiedEstimate.maxTotalDebit} USDC`} />}
                </div>
              )}
              {paymentTx && <p className='pay-muted'>Payment submitted. Waiting for on-chain settlement: {short(paymentTx, 10, 8)}</p>}
            </>
          ) : (
            <p className='pay-muted'>The first request creates a payment invoice. Once paid, the same service returns the unlocked result.</p>
          )}
        </div>

        <div className='glass sandbox-card wide'>
          <h3>Result</h3>
          <IntelResult result={result} requirement={requirement} selected={selected} />
        </div>
      </section>
    </div>
  )
}

function delegatedFallbackError(error: unknown) {
  return /chainId.*NaN|Maximum retry attempts|Failed to fetch|Gateway API error|Request timed out|temporarily unavailable/i.test(error instanceof Error ? error.message : String(error))
}

function ServicePicker({ value, onChange }: { value: IntelType; onChange: (value: IntelType) => void }) {
  return (
    <div className='sandbox-field'>
      <span>Service</span>
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
  if (result?.ok) {
    const presentation = normalizePresentation(result, selected)
    const quality = presentation.dataQuality
    const payment = result.x402Payment
    return (
      <div className='intel-result'>
        <div className='intel-result-header'>
          <div>
            <div className='docs-kicker'>Unlocked Result</div>
            <h4>{presentation.title || selected.label}</h4>
            <p>{presentation.subtitle || 'Arkham intelligence data is available for review.'}</p>
          </div>
          <span className={`intel-pill ${quality.status === 'partial' ? 'warning' : ''}`}>{quality.status || 'complete'}</span>
        </div>

        <div className='intel-result-meta'>
          <Info label='Service' value={selected.label} />
          <Info label='Data Provider' value={presentation.provider || 'Arkham Intel API'} />
          <Info label='Generated At' value={formatDate(presentation.generatedAt)} />
          <Info label='Coverage' value={`${quality.fieldCount} labeled fields, ${quality.recordCount} records, ${quality.sectionCount} sections`} />
          <Info label='ARCOX Resource' value={presentation.resource || requestLabel(selected)} mono />
          <Info label='Provider Endpoint' value={presentation.providerPath || 'Arkham endpoint'} mono />
          <Info label='Query Parameters' value={formatQuery(presentation.query)} mono />
          <Info label='Access Status' value='Paid and unlocked' />
        </div>

        {payment && (
          <section className='intel-detail-section intel-payment-receipt'>
            <div className='intel-section-heading'>
              <div><span>Payment Receipt</span><h4>x402 Access Payment</h4></div>
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
                <span className='intel-field-label'>Payment Transaction</span>
                {payment.txHash ? (
                  <a className='intel-field-value mono intel-tx-link' href={`https://testnet.arcscan.app/tx/${payment.txHash}`} target='_blank' rel='noreferrer'>{payment.txHash}</a>
                ) : <strong className='intel-field-value'>Not reported</strong>}
              </div>
            </div>
          </section>
        )}

        {presentation.overview.length > 0 && (
          <section className='intel-detail-section'>
            <div className='intel-section-heading'><div><span>Overview</span><h4>Key Result Fields</h4></div></div>
            <div className='intel-field-grid'>
              {presentation.overview.map((field, index) => <DetailField key={`${field.path || field.label}-${index}`} field={field} />)}
            </div>
          </section>
        )}

        {presentation.sections.map(section => (
          <section className='intel-detail-section' key={section.id}>
            <div className='intel-section-heading'>
              <div><span>Result Section</span><h4>{section.title}</h4></div>
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
            {!section.fields.length && !section.records.length && <p className='pay-muted'>No populated data was returned for this section.</p>}
          </section>
        ))}

        <section className='intel-detail-section intel-quality'>
          <div className='intel-section-heading'><div><span>Data Quality</span><h4>Coverage and Interpretation</h4></div></div>
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
          {!quality.fieldCount && !quality.recordCount && <p className='pay-muted'>The provider returned no populated fields or records for this query.</p>}
        </section>
      </div>
    )
  }
  if (requirement) {
    return (
      <div className='intel-result'>
        <div className='intel-result-header'>
          <div>
            <div className='docs-kicker'>Payment Required</div>
            <h4>{selected.label}</h4>
            <p>Pay this invoice to unlock the Arkham result. No intelligence data is shown before payment.</p>
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
  return <p className='pay-muted'>Run an analysis to create an x402 invoice or show an unlocked Arkham result.</p>
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
