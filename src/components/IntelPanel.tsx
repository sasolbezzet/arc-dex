import { useMemo, useState } from 'react'

type IntelType = 'address' | 'report' | 'tx' | 'contract' | 'entity' | 'token' | 'search'

const PRICES: Record<IntelType, string> = {
  address: '0.005',
  report: '0.05',
  tx: '0.005',
  contract: '0.01',
  entity: '0.02',
  token: '0.005',
  search: '0.005',
}

export function IntelPanel() {
  const [type, setType] = useState<IntelType>('address')
  const [value, setValue] = useState('')
  const [chain, setChain] = useState('ethereum')
  const [result, setResult] = useState<any>(null)
  const [requirement, setRequirement] = useState<any>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const path = useMemo(() => {
    const encoded = encodeURIComponent(value.trim())
    if (type === 'address') return `/api/intel/address/${encoded}`
    if (type === 'report') return `/api/intel/report/address/${encoded}`
    if (type === 'tx') return `/api/intel/tx/${encoded}`
    if (type === 'contract') return `/api/intel/contract/${encodeURIComponent(chain)}/${encoded}`
    if (type === 'entity') return `/api/intel/entity/${encoded}`
    if (type === 'token') return `/api/intel/token/${encoded}`
    return `/api/intel/search?q=${encoded}`
  }, [type, value, chain])

  async function analyze(mockPaid = false) {
    if (!value.trim()) {
      setError('Input is required.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const response = await fetch(path, {
        headers: mockPaid ? { 'X-PAYMENT': 'mock-paid' } : {},
      })
      const data = await response.json().catch(() => ({}))
      if (response.status === 402) {
        setRequirement(data.x402)
        setResult(null)
        return
      }
      if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`)
      setRequirement(null)
      setResult(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Intel request failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className='pay-page'>
      <section className='glass sandbox-hero'>
        <div className='docs-kicker'>ARCOX Intel</div>
        <h2>Arkham Intelligence via x402</h2>
        <p>Pay with USDC on Arc. If your USDC is on another supported chain, ARCOX can route payment to Arc using Unified Balance.</p>
        <div className='inline-warning'>Informational only. Not financial advice. Arkham API calls are served by ARCOX API; the browser never receives the Arkham API key.</div>
      </section>

      {error && <div className='inline-error'>{error}</div>}

      <section className='sandbox-grid'>
        <div className='glass sandbox-card'>
          <h3>Analysis Request</h3>
          <label className='sandbox-field'>
            <span>Category</span>
            <select className='input' value={type} onChange={event => setType(event.target.value as IntelType)}>
              <option value='address'>Wallet Intel</option>
              <option value='report'>Full Wallet Report</option>
              <option value='tx'>Transaction Intel</option>
              <option value='contract'>Contract Intel</option>
              <option value='entity'>Entity Intel</option>
              <option value='token'>Token Intel</option>
              <option value='search'>Search</option>
            </select>
          </label>
          {type === 'contract' && <Field label='Chain' value={chain} onChange={setChain} />}
          <Field label={type === 'tx' ? 'Tx Hash' : type === 'search' ? 'Search Query' : 'Address / Entity / Token'} value={value} onChange={setValue} />
          <div className='pay-grid'>
            <Info label='Price' value={`${PRICES[type]} USDC`} />
            <Info label='Network' value='Arc USDC' />
          </div>
          <button className='btn btn-primary' onClick={() => analyze(false)} disabled={loading}>{loading ? 'Analyzing...' : 'Analyze'}</button>
        </div>

        <div className='glass sandbox-card'>
          <h3>x402 Payment</h3>
          {requirement ? (
            <>
              <p className='pay-muted'>This analysis costs {requirement.amount} {requirement.asset} on {requirement.network}.</p>
              <div className='pay-grid'>
                <Info label='Recipient' value={requirement.recipient || '-'} mono />
                <Info label='Payment ID' value={requirement.paymentId || '-'} mono />
                <Info label='Resource' value={requirement.resource || '-'} mono />
                <Info label='Expires' value={`${requirement.expiresInSeconds || 300}s`} />
              </div>
              <button className='btn btn-secondary' onClick={() => analyze(true)}>Simulate x402 Paid</button>
            </>
          ) : (
            <p className='pay-muted'>If backend x402 is enabled, the first request returns HTTP 402 with price, recipient, resource, and payment ID.</p>
          )}
        </div>

        <div className='glass sandbox-card wide'>
          <h3>Result</h3>
          <pre className='json-box'>{JSON.stringify(result || requirement || {}, null, 2)}</pre>
        </div>
      </section>
    </div>
  )
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className='sandbox-field'>
      <span>{label}</span>
      <input className='input' value={value} onChange={event => onChange(event.target.value)} />
    </label>
  )
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className='pay-info'>
      <span>{label}</span>
      <strong className={mono ? 'mono' : ''}>{value}</strong>
    </div>
  )
}
