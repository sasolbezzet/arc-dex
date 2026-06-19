import { useEffect, useState } from 'react'
import {
  createX402Invoice,
  getNanopaymentsCapabilities,
  getX402InvoiceStatus,
  quoteEcoRoute,
} from '../payApi'
import type { X402Invoice } from '../payApi'

const TEST_COMMANDS = [
  ['Create x402 invoice', 'curl -i -X POST https://arc-dex-bice.vercel.app/api/x402/invoices/create -H "Content-Type: application/json" -d \'{"resource":"/api/intel/address/0x0000000000000000000000000000000000000000","service":"arcox_intel"}\''],
  ['Check x402 status', 'curl -i https://arc-dex-bice.vercel.app/api/x402/invoices/INVOICE_ID/status'],
  ['Circle webhook URL', 'https://arc-dex-bice.vercel.app/api/circle/webhook'],
  ['Intel paid retry', 'curl -i https://arc-dex-bice.vercel.app/api/intel/address/0x0000000000000000000000000000000000000000 -H "X-PAYMENT-ID: PAYMENT_ID"'],
]

export function PaySandbox() {
  const [form, setForm] = useState({
    resource: '/api/intel/address/0x0000000000000000000000000000000000000000',
    service: 'arcox_intel',
    amount: '',
  })
  const [invoice, setInvoice] = useState<X402Invoice | null>(null)
  const [rawResult, setRawResult] = useState<any>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [ecoResult, setEcoResult] = useState<any>(null)
  const [nanopaymentsResult, setNanopaymentsResult] = useState<any>(null)

  const invoiceId = invoice?.invoiceId || ''
  const isPending = invoice?.status === 'pending'

  useEffect(() => {
    if (!invoiceId || !isPending) return
    const timer = window.setInterval(() => {
      getX402InvoiceStatus(invoiceId).then(result => {
        setInvoice(result.invoice || result.x402)
        setRawResult(result)
      }).catch(() => {})
    }, 8000)
    return () => window.clearInterval(timer)
  }, [invoiceId, isPending])

  const update = (key: string, value: string) => setForm(prev => ({ ...prev, [key]: value }))

  async function run(label: string, fn: () => Promise<any>) {
    try {
      setBusy(label)
      setError('')
      const result = await fn()
      setRawResult(result)
      if (result.invoice || result.x402) setInvoice(result.invoice || result.x402)
    } catch (e) {
      setError(e instanceof Error ? e.message : `${label} failed`)
    } finally {
      setBusy('')
    }
  }

  const createPayment = () => run('create', async () => createX402Invoice({ ...form, amount: form.amount || undefined }))
  const checkStatus = () => invoiceId && run('status', async () => getX402InvoiceStatus(invoiceId))
  const previewEco = () => run('eco', async () => {
    const result = await quoteEcoRoute({
      sourceChain: 'base',
      destinationChain: 'arc-testnet',
      sourceToken: 'USDC',
      destinationToken: 'USDC',
      amount: invoice?.amount || '0.005',
      recipient: invoice?.recipient || 'ARCOX Circle Treasury',
      invoiceId: invoice?.invoiceId,
    })
    setEcoResult(result)
    return result
  })
  const loadNanopayments = () => run('nanopayments', async () => {
    const result = await getNanopaymentsCapabilities()
    setNanopaymentsResult(result)
    return result
  })

  const copy = async (value?: string | null) => {
    if (!value) return
    await navigator.clipboard?.writeText(value)
  }

  return (
    <div className='pay-page sandbox-page'>
      <section className='glass sandbox-hero'>
        <div className='docs-kicker'>ARCOX Pay</div>
        <h2>ARCOX x402 Circle Sandbox</h2>
        <p>Internal ARCOX invoice flow for paid Intel API access. User pays the exact unique USDC amount to one Circle treasury wallet; Circle transactions.inbound webhook unlocks the resource.</p>
        <div className='inline-warning'>Testnet only. No manual txHash fallback and no mockPaid proof.</div>
      </section>

      {error && <div className='inline-error'>{error}</div>}

      <section className='sandbox-grid'>
        <div className='glass sandbox-card'>
          <h3>Create x402 Invoice</h3>
          <Field label='Resource' value={form.resource} onChange={v => update('resource', v)} />
          <Field label='Service' value={form.service} onChange={v => update('service', v)} />
          <Field label='Base Amount Override' value={form.amount} onChange={v => update('amount', v)} />
          <button className='btn btn-primary' onClick={createPayment} disabled={busy === 'create'}>Create ARCOX x402 Invoice</button>
        </div>

        <div className='glass sandbox-card wide'>
          <h3>Circle Treasury Flow</h3>
          <div className='flow-steps'>
            <FlowStep title='User Wallet' value='Any supported testnet USDC wallet' extra='Sends the exact unique amount' />
            <FlowStep title='Circle Treasury' value={invoice?.recipient || 'Set CIRCLE_X402_TREASURY_ADDRESS'} extra='Single ARCOX treasury receiver' />
            <FlowStep title='Circle Webhook' value='transactions.inbound' extra='Detects confirmed inbound USDC' />
            <FlowStep title='ARCOX Intel' value={invoice?.resource || form.resource} extra='Unlocked only after invoice is paid' />
          </div>
        </div>

        <div className='glass sandbox-card wide'>
          <h3>Invoice Detail</h3>
          {invoice ? (
            <>
              <div className='pay-grid'>
                <Info label='Invoice ID' value={invoice.invoiceId} mono />
                <Info label='Payment ID' value={invoice.paymentId} mono />
                <Info label='Status' value={invoice.status} />
                <Info label='Exact Amount' value={`${invoice.amount} ${invoice.asset}`} />
                <Info label='Recipient' value={invoice.recipient} mono />
                <Info label='Network' value={invoice.network} />
                <Info label='Resource' value={invoice.resource} mono />
                <Info label='Paid Tx' value={invoice.txHash || '-'} mono />
              </div>
              <div className='button-row wrap'>
                <button className='btn btn-secondary' onClick={checkStatus}>Check Status</button>
                <button className='btn btn-secondary' onClick={() => copy(invoice.recipient)}>Copy Treasury Address</button>
                <button className='btn btn-secondary' onClick={() => copy(invoice.amount)}>Copy Exact Amount</button>
                <button className='btn btn-secondary' onClick={() => copy(invoice.paymentId)}>Copy Payment ID</button>
              </div>
            </>
          ) : (
            <p className='pay-muted'>Create an invoice to see the exact amount, Circle treasury recipient, and payment ID.</p>
          )}
        </div>

        <div className='glass sandbox-card'>
          <h3>Eco / Cross-Chain Preview</h3>
          <p className='pay-muted'>Preview future pay cross-chain routing. This is adapter readiness, not hidden execution.</p>
          <button className='btn btn-primary' onClick={previewEco}>Preview Eco Route</button>
          {ecoResult && <pre className='json-box'>{JSON.stringify(ecoResult, null, 2)}</pre>}
        </div>

        <div className='glass sandbox-card'>
          <h3>Circle x402 Readiness</h3>
          <p className='pay-muted'>Checks x402/Gateway readiness metadata for ARCOX paid API access.</p>
          <button className='btn btn-primary' onClick={loadNanopayments}>Check Readiness</button>
          {nanopaymentsResult && <pre className='json-box'>{JSON.stringify(nanopaymentsResult, null, 2)}</pre>}
        </div>

        <div className='glass sandbox-card wide'>
          <h3>Raw Response</h3>
          <details open>
            <summary>API JSON</summary>
            <pre className='json-box'>{JSON.stringify(rawResult || invoice || {}, null, 2)}</pre>
          </details>
        </div>

        <div className='glass sandbox-card wide'>
          <h3>API Test Commands</h3>
          <div className='api-example-grid'>
            {TEST_COMMANDS.map(([title, command]) => (
              <div className='api-example' key={title}>
                <strong>{title}</strong>
                <pre>{command}</pre>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

function Field({ label, value, onChange, disabled = false }: { label: string; value: string; onChange: (value: string) => void; disabled?: boolean }) {
  return (
    <label className='sandbox-field'>
      <span>{label}</span>
      <input className='input' value={value} disabled={disabled} onChange={event => onChange(event.target.value)} />
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

function FlowStep({ title, value, extra }: { title: string; value: string; extra: string }) {
  return (
    <div className='flow-step'>
      <span>{title}</span>
      <strong>{value}</strong>
      <small>{extra}</small>
    </div>
  )
}
