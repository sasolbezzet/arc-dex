import { useEffect, useMemo, useState } from 'react'
import { switchToArcTestnet } from '../domain/arcNetwork'
import { ARC_TOKENS } from '../domain/tokens'
import { estimateX402UnifiedBalance, markX402UnifiedBalanceSpendSubmitted } from '../payApi'
import { estimateUnifiedBalanceSpendWithAppKit, spendUnifiedBalanceWithAppKit } from '../appKit'

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
  buildPath: (value: string, chain: string) => string
}

const SERVICES: IntelService[] = [
  service('address', 'Wallet Intel', 'Wallet', '0.005', 'Wallet address', value => `/api/intel/address/${enc(value)}`),
  service('address_all', 'Wallet Intel: All', 'Wallet', '0.01', 'Wallet address', value => `/api/intel/address/${enc(value)}/all`),
  service('address_enriched', 'Wallet Enriched', 'Wallet', '0.01', 'Wallet address', value => `/api/intel/address/${enc(value)}/enriched`),
  service('balances', 'Wallet Balances', 'Wallet', '0.01', 'Wallet address', value => `/api/intel/address/${enc(value)}/balances`),
  service('counterparties', 'Wallet Counterparties', 'Wallet', '0.02', 'Wallet address', value => `/api/intel/address/${enc(value)}/counterparties`),
  service('flows', 'Wallet Flows', 'Wallet', '0.03', 'Wallet address', value => `/api/intel/address/${enc(value)}/flows`),
  service('history', 'Wallet History', 'Wallet', '0.03', 'Wallet address', value => `/api/intel/address/${enc(value)}/history`),
  service('volume', 'Wallet Volume', 'Wallet', '0.03', 'Wallet address', value => `/api/intel/address/${enc(value)}/volume`),
  service('portfolio', 'Wallet Portfolio', 'Wallet', '0.01', 'Wallet address', value => `/api/intel/address/${enc(value)}/portfolio`),
  service('report', 'Full Wallet Report', 'Wallet', '0.05', 'Wallet address', value => `/api/intel/report/address/${enc(value)}`),
  service('tx', 'Transaction Intel', 'Transaction', '0.005', 'Transaction hash', value => `/api/intel/tx/${enc(value)}`),
  service('tx_transfers', 'Transaction Transfers', 'Transaction', '0.005', 'Transaction hash', value => `/api/intel/tx/${enc(value)}/transfers`),
  service('contract', 'Contract Intel', 'Contract', '0.01', 'Contract address', (value, chain) => `/api/intel/contract/${enc(chain)}/${enc(value)}`, true),
  service('entity', 'Entity Intel', 'Entity', '0.02', 'Entity name or ID', value => `/api/intel/entity/${enc(value)}`),
  service('entity_summary', 'Entity Summary', 'Entity', '0.02', 'Entity name or ID', value => `/api/intel/entity/${enc(value)}/summary`),
  service('entity_balances', 'Entity Balances', 'Entity', '0.02', 'Entity name or ID', value => `/api/intel/entity/${enc(value)}/balances`),
  service('entity_flows', 'Entity Flows', 'Entity', '0.02', 'Entity name or ID', value => `/api/intel/entity/${enc(value)}/flows`),
  service('token', 'Token Intel', 'Token', '0.005', 'Token ID or symbol', value => `/api/intel/token/${enc(value)}`),
  service('token_contract', 'Token Contract Intel', 'Token', '0.005', 'Token contract address', (value, chain) => `/api/intel/token/${enc(chain)}/${enc(value)}`, true),
  service('token_market', 'Token Market', 'Token', '0.005', 'Token ID or symbol', value => `/api/intel/token/${enc(value)}/market`),
  service('token_holders', 'Token Holders', 'Token', '0.03', 'Token ID or symbol', value => `/api/intel/token/${enc(value)}/holders`),
  service('token_contract_holders', 'Token Contract Holders', 'Token', '0.03', 'Token contract address', (value, chain) => `/api/intel/token/${enc(chain)}/${enc(value)}/holders`, true),
  service('token_top_flow', 'Token Top Flow', 'Token', '0.03', 'Token ID or symbol', value => `/api/intel/token/${enc(value)}/top-flow`),
  service('token_trending', 'Trending Tokens', 'Token', '0.005', '', () => '/api/intel/token/trending', false, false),
  service('token_top', 'Top Tokens', 'Token', '0.005', '', () => '/api/intel/token/top', false, false),
  service('search', 'Search', 'Search', '0.005', 'Search query', value => `/api/intel/search?q=${enc(value)}`),
]

const SERVICE_BY_ID = Object.fromEntries(SERVICES.map(item => [item.id, item])) as Record<IntelType, IntelService>

export function IntelPanel() {
  const [type, setType] = useState<IntelType>('address')
  const [value, setValue] = useState('')
  const [chain, setChain] = useState('ethereum')
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

  async function analyze(proof?: { paymentId: string }) {
    if (selected.needsValue !== false && !value.trim()) {
      setError('Input is required.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const response = await fetch(path, {
        headers: {
          ...((proof || paymentPaid) ? { 'X-PAYMENT-ID': (proof || paymentPaid)!.paymentId } : {}),
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
      setError(e instanceof Error ? e.message : 'Unified Balance estimate failed.')
    } finally {
      setPaying(false)
    }
  }

  async function payWithUnifiedBalance() {
    if (!requirement?.invoiceId || !requirement?.recipient || !requirement?.amount) return
    setPaying(true)
    setError('')
    try {
      if (!unifiedEstimate) await estimateUnifiedPayment()
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
      setError(e instanceof Error ? e.message : 'Unified Balance spend failed.')
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
          <label className='sandbox-field'>
            <span>Service</span>
            <select className='input' value={type} onChange={event => { setType(event.target.value as IntelType); setResult(null); setRequirement(null) }}>
              {Object.entries(groupServices()).map(([group, services]) => (
                <optgroup key={group} label={group}>
                  {services.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
          {selected.needsChain && <Field label='Chain' value={chain} onChange={setChain} placeholder='ethereum, base, arbitrum...' />}
          {selected.needsValue !== false && <Field label={selected.inputLabel || 'Input'} value={value} onChange={setValue} placeholder={selected.placeholder || selected.inputLabel || ''} />}
          <div className='pay-grid'>
            <Info label='Price' value={`${selected.price} USDC`} />
            <Info label='Payment Network' value='Arc Testnet USDC' />
            <Info label='Service Group' value={selected.group} />
            <Info label='Backend Route' value={path} mono />
          </div>
          <button className='btn btn-primary' onClick={() => analyze()} disabled={loading}>{loading ? 'Analyzing...' : 'Analyze'}</button>
        </div>

        <div className='glass sandbox-card'>
          <h3>x402 Payment</h3>
          {requirement ? (
            <>
              <p className='pay-muted'>Pay with the wallet button so ARCOX can attach the invoice memo on-chain. Manual txHash unlocks are not accepted.</p>
              <label className='sandbox-field'>
                <span>Payment Method</span>
                <select className='input' value={paymentMethod} onChange={event => setPaymentMethod(event.target.value as 'arc' | 'unified')}>
                  <option value='arc'>Pay with Arc USDC memo</option>
                  <option value='unified'>Pay with Unified Balance / Circle Gateway</option>
                </select>
              </label>
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
                    <select className='input' value={unifiedSourceChain} onChange={event => setUnifiedSourceChain(event.target.value)}>
                      <option value='auto'>Auto allocation</option>
                      <option value='Arc_Testnet'>Arc Testnet</option>
                      <option value='Base_Sepolia'>Base Sepolia</option>
                      <option value='Ethereum_Sepolia'>Ethereum Sepolia</option>
                      <option value='Arbitrum_Sepolia'>Arbitrum Sepolia</option>
                    </select>
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
                  <Info label='UB Fee Items' value={String((unifiedEstimate?.fees || []).length || 0)} />
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

function IntelResult({ result, requirement, selected }: { result: any; requirement: any; selected: IntelService }) {
  if (result?.ok) {
    const payload = result.report || result.data || result
    const summary = summarizeIntelPayload(payload)
    const rows = rowsFromPayload(payload)
    return (
      <div className='intel-result'>
        <div className='intel-result-header'>
          <div>
            <div className='docs-kicker'>Unlocked Result</div>
            <h4>{summary.title || selected.label}</h4>
            <p>{summary.description || 'Arkham intelligence data is available for review.'}</p>
          </div>
          <span className='intel-pill'>{result.mode || 'arkham'}</span>
        </div>
        <div className='pay-grid'>
          <Info label='Service' value={selected.label} />
          <Info label='Source' value={result.mode || 'arkham'} />
          <Info label='Status' value='Paid and unlocked' />
          <Info label='Disclaimer' value={result.disclaimer || 'Informational only'} />
        </div>
        {result.x402Payment && (
          <div className='intel-section'>
            <h4>Payment</h4>
            <div className='pay-grid'>
              <Info label='Invoice' value={result.x402Payment.invoiceId || '-'} mono />
              <Info label='Amount' value={`${result.x402Payment.amount || '-'} ${result.x402Payment.asset || 'USDC'}`} />
              <Info label='Tx Hash' value={result.x402Payment.txHash ? short(result.x402Payment.txHash, 12, 10) : '-'} mono />
              <Info label='Paid At' value={formatDate(result.x402Payment.paidAt)} />
            </div>
          </div>
        )}
        {summary.highlights.length > 0 && (
          <div className='intel-section'>
            <h4>Highlights</h4>
            <div className='intel-highlight-grid'>
              {summary.highlights.map(item => <Info key={item.label} label={item.label} value={item.value} mono={item.mono} />)}
            </div>
          </div>
        )}
        {rows.length > 0 && (
          <div className='intel-section'>
            <h4>Records</h4>
            <div className='intel-record-list'>
              {rows.slice(0, 12).map((row, index) => (
                <div className='intel-record' key={index}>
                  <strong>{row.title}</strong>
                  <span>{row.subtitle}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {summary.sections.length > 0 && (
          <div className='intel-section'>
            <h4>Sections</h4>
            <div className='intel-section-grid'>
              {summary.sections.map(section => (
                <div className='intel-mini-card' key={section.title}>
                  <strong>{section.title}</strong>
                  <span>{section.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}
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
): IntelService {
  return { id, label, group, price, inputLabel, needsChain, needsValue, buildPath }
}

function groupServices() {
  return SERVICES.reduce<Record<string, IntelService[]>>((acc, item) => {
    acc[item.group] = [...(acc[item.group] || []), item]
    return acc
  }, {})
}

function summarizeIntelPayload(payload: any) {
  const root = unwrap(payload)
  const title = firstString(root, ['name', 'label', 'entityName', 'arkhamLabel.name', 'address', 'hash', 'id', 'symbol'])
  const description = firstString(root, ['description', 'summary', 'entityType', 'type', 'chain'])
  const highlights = keyFacts(root)
  const sections = Object.entries(root || {})
    .filter(([, value]) => value && typeof value === 'object')
    .slice(0, 8)
    .map(([key, value]) => ({ title: humanize(key), value: Array.isArray(value) ? `${value.length} records` : `${Object.keys(value as any).length} fields` }))
  return { title, description, highlights, sections }
}

function rowsFromPayload(payload: any) {
  const root = unwrap(payload)
  const arrays = collectArrays(root)
  const first = arrays.find(item => item.items.length > 0)
  if (!first) return []
  return first.items
    .filter(item => item && typeof item === 'object')
    .map((item: any) => ({
      title: firstString(item, ['name', 'label', 'tokenName', 'symbol', 'address', 'hash', 'txHash', 'entityName']) || first.path,
      subtitle: compact([
        firstString(item, ['chain', 'blockchain', 'type', 'status']),
        firstString(item, ['amount', 'balance', 'value', 'usdValue', 'price']),
        firstString(item, ['timestamp', 'time', 'date']),
      ]).join(' | ') || `${Object.keys(item).length} fields`,
    }))
}

function keyFacts(root: any) {
  const facts: { label: string; value: string; mono?: boolean }[] = []
  for (const key of ['address', 'hash', 'txHash', 'chain', 'blockchain', 'entity', 'entityName', 'symbol', 'tokenName', 'balance', 'amount', 'usdValue', 'volume', 'status']) {
    const value = getPath(root, key)
    if (value !== undefined && value !== null && typeof value !== 'object') {
      facts.push({ label: humanize(key), value: String(value), mono: /address|hash|tx/i.test(key) })
    }
  }
  if (Array.isArray(root)) facts.push({ label: 'Records', value: String(root.length) })
  if (!Array.isArray(root) && root && typeof root === 'object') facts.push({ label: 'Fields', value: String(Object.keys(root).length) })
  return facts.slice(0, 8)
}

function collectArrays(value: any, path = 'records', out: { path: string; items: any[] }[] = []) {
  if (Array.isArray(value)) out.push({ path, items: value })
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) collectArrays(child, humanize(key), out)
  }
  return out
}

function unwrap(value: any): any {
  if (value?.data !== undefined && Object.keys(value).length <= 4) return unwrap(value.data)
  return value
}

function firstString(root: any, keys: string[]) {
  for (const key of keys) {
    const value = getPath(root, key)
    if (value !== undefined && value !== null && value !== '') return String(value)
  }
  return ''
}

function getPath(root: any, path: string): any {
  return path.split('.').reduce((acc, key) => (acc && typeof acc === 'object' ? acc[key] : undefined), root)
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

function compact(items: Array<string | undefined | null>) {
  return items.filter(Boolean) as string[]
}

function formatDate(value: string) {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function enc(value: string) {
  return encodeURIComponent(value.trim())
}
