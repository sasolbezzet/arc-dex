import { useEffect, useState } from 'react'
import {
  createX402Invoice,
  estimateX402UnifiedBalance,
  getX402InvoiceStatus,
  getTreasuryStatus,
} from '../payApi'
import type { X402Invoice } from '../payApi'

const TEST_COMMANDS = [
  ['Create x402 invoice', 'curl -i -X POST https://arcoxdex.vercel.app/api/x402/invoices/create -H "Content-Type: application/json" -d \'{"resource":"/api/intel/address/0x0000000000000000000000000000000000000000","service":"arcox_intel"}\''],
  ['Check x402 status', 'curl -i https://arcoxdex.vercel.app/api/x402/invoices/INVOICE_ID/status'],
  ['Circle webhook URL', 'https://arcoxdex.vercel.app/api/circle/webhook'],
  ['Intel paid retry', 'curl -i https://arcoxdex.vercel.app/api/intel/address/0x0000000000000000000000000000000000000000 -H "X-PAYMENT-ID: PAYMENT_ID"'],
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
  const [treasuryResult, setTreasuryResult] = useState<any>(null)

  const invoiceId = invoice?.invoiceId || ''
  const isPending = !!invoice && ['payment_required', 'estimate_ready', 'awaiting_signature', 'spend_submitted', 'settlement_pending', 'pending'].includes(invoice.status)

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
  const estimateUnified = () => invoiceId && run('unified', async () => estimateX402UnifiedBalance(invoiceId, {
    route: 'Circle Gateway Unified Balance -> Arc Testnet USDC',
    delegateStatus: 'estimate_required_in_wallet',
  }))
  const loadTreasury = () => run('treasury', async () => {
    const result = await getTreasuryStatus()
    setTreasuryResult(result)
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
        <h2>ARCOX x402 Testnet Payments</h2>
        <p>Internal ARCOX invoice flow for paid Intel API access. Pay exact Arc USDC with an on-chain memo, or estimate a Unified Balance spend to the same Arc treasury recipient.</p>
        <div className='inline-warning'>Real testnet only. No NowPayments, no fake unlock, and no manual txHash fallback.</div>
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
          <h3>Payment Flow</h3>
          <div className='flow-steps'>
            <FlowStep title='User Wallet' value='Arc USDC or Unified Balance' extra='Signs the payment' />
            <FlowStep title='ARCOX Treasury' value={invoice?.recipient || 'Set X402_RECIPIENT_ADDRESS'} extra='Arc Testnet USDC receiver' />
            <FlowStep title='Reconciliation' value='Arc memo / ERC20 Transfer / Gateway webhook' extra='Marks invoice paid only after settlement' />
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
                <Info label='Base Units' value={invoice.amountBaseUnits || '-'} mono />
                <Info label='Recipient' value={invoice.recipient} mono />
                <Info label='Network' value={invoice.network} />
                <Info label='Settlement' value={invoice.settlementStatus || invoice.status} />
                <Info label='Resource' value={invoice.resource} mono />
                <Info label='Paid Tx' value={invoice.txHash || '-'} mono />
                <Info label='Memo ID' value={invoice.memoId || '-'} mono />
              </div>
              <div className='button-row wrap'>
                <button className='btn btn-secondary' onClick={checkStatus}>Check Status</button>
                <button className='btn btn-secondary' onClick={estimateUnified}>Estimate Unified Balance</button>
                <button className='btn btn-secondary' onClick={() => copy(invoice.recipient)}>Copy Treasury Address</button>
                <button className='btn btn-secondary' onClick={() => copy(invoice.amount)}>Copy Exact Amount</button>
                <button className='btn btn-secondary' onClick={() => copy(invoice.paymentId)}>Copy Payment ID</button>
              </div>
            </>
          ) : (
            <p className='pay-muted'>Create an invoice to see the exact amount, Circle treasury recipient, and payment ID.</p>
          )}
        </div>

        <div className='glass sandbox-card wide'>
          <h3>Unified Balance</h3>
          <p className='pay-muted'>Unified Balance is a USDC routing layer, not a third wallet. The app estimates before spend and keeps settlement pending until Arc/Gateway confirms payment.</p>
          <button className='btn btn-primary' onClick={loadTreasury}>Check Treasury Readiness</button>
          {treasuryResult && (
            <div className='pay-grid'>
              <Info label='Mode' value={treasuryResult.mode || '-'} />
              <Info label='Network' value={treasuryResult.network || '-'} />
              <Info label='Treasury' value={treasuryResult.treasuryWallet || treasuryResult.recipient || '-'} mono />
              <Info label='Methods' value={(treasuryResult.supportedPaymentMethods || []).join(', ') || '-'} />
            </div>
          )}
        </div>

        <div className='glass sandbox-card wide'>
          <h3>Response Details</h3>
          <details>
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
