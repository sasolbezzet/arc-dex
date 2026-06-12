import { useState } from 'react'
import { createInvoice, getInvoiceStatus, getNanopaymentsCapabilities, quoteEcoRoute, simulateCircleWebhook } from '../payApi'
import type { ArcoxInvoice } from '../payApi'

const EXAMPLES = [
  ['POST /api/invoices', { orderId: 'ORDER-123', amount: '10', token: 'USDC', network: 'arc-testnet', merchantAddress: '0xMerchantAddress', memo: 'AI agent setup service', expiresInMinutes: 15 }],
  ['GET /api/invoices/:invoiceId', { invoiceId: 'inv_123' }],
  ['PATCH /api/invoices/:invoiceId', { status: 'pending', txHash: '0x...' }],
  ['GET /api/invoices/:invoiceId/status', { invoiceId: 'inv_123' }],
  ['POST /api/webhooks/circle-gateway', { notificationId: 'evt_123', eventType: 'gateway.mint.finalized', data: { invoiceId: 'inv_123', txHash: '0x...' } }],
  ['POST /api/dev/simulate-webhook', { invoiceId: 'inv_123', eventType: 'gateway.mint.finalized', txHash: '0x...' }],
  ['GET /api/nanopayments/capabilities', { protocol: 'x402', paymentRail: 'circle-gateway-nanopayments', live: false }],
]

export function PaySandbox() {
  const [form, setForm] = useState({
    orderId: 'ORDER-123',
    amount: '10',
    token: 'USDC',
    merchantAddress: '',
    memo: 'AI agent setup service',
    expiresInMinutes: '15',
  })
  const [invoice, setInvoice] = useState<ArcoxInvoice | null>(null)
  const [draftPreview, setDraftPreview] = useState(false)
  const [statusId, setStatusId] = useState('')
  const [statusResult, setStatusResult] = useState<any>(null)
  const [webhook, setWebhook] = useState({ invoiceId: '', eventType: 'gateway.mint.finalized', txHash: '0x1230000000000000000000000000000000000000000000000000000000000123' })
  const [webhookResult, setWebhookResult] = useState<any>(null)
  const [eco, setEco] = useState({ sourceChain: 'base-sepolia', destinationChain: 'arc-testnet', sourceToken: 'USDC', destinationToken: 'USDC', amount: '10', invoiceId: '' })
  const [ecoResult, setEcoResult] = useState<any>(null)
  const [nanopaymentsResult, setNanopaymentsResult] = useState<any>(null)
  const [error, setError] = useState('')

  const updateForm = (key: string, value: string) => setForm(prev => ({ ...prev, [key]: value }))

  const previewInvoice = () => {
    setError('')
    if (!form.amount) {
      setError('Amount is required.')
      return
    }
    if (!form.merchantAddress) {
      setError('Receiver wallet / merchant address is required.')
      return
    }
    setDraftPreview(true)
  }

  const create = async () => {
    try {
      setError('')
      const next = await createInvoice({ ...form, expiresInMinutes: Number(form.expiresInMinutes || 15) })
      setInvoice(next)
      setStatusId(next.invoiceId)
      setWebhook(prev => ({ ...prev, invoiceId: next.invoiceId }))
      setEco(prev => ({ ...prev, invoiceId: next.invoiceId }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create invoice failed.')
    }
  }

  const checkStatus = async () => {
    try {
      setError('')
      setStatusResult(await getInvoiceStatus(statusId))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Status check failed.')
    }
  }

  const simulate = async () => {
    try {
      setError('')
      const result = await simulateCircleWebhook(webhook)
      setWebhookResult(result)
      if (result.invoice) setInvoice(result.invoice)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Webhook simulation failed. ENABLE_DEV_TOOLS may be disabled.')
    }
  }

  const previewEco = async () => {
    try {
      setError('')
      setEcoResult(await quoteEcoRoute({ ...eco, recipient: form.merchantAddress }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Eco preview failed.')
    }
  }

  const loadNanopayments = async () => {
    try {
      setError('')
      setNanopaymentsResult(await getNanopaymentsCapabilities())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nanopayments readiness check failed.')
    }
  }

  return (
    <div className='pay-page sandbox-page'>
      <section className='glass sandbox-hero'>
        <div className='docs-kicker'>ARCOX Pay</div>
        <h2>ARCOX Pay Sandbox</h2>
        <p>A developer sandbox for testing ARCOX Pay invoices, USDC payment links, webhook events, and API responses on Arc Testnet.</p>
      </section>

      {error && <div className='inline-error'>{error}</div>}

      <section className='sandbox-grid'>
        <div className='glass sandbox-card'>
          <h3>Create Payment Request</h3>
          <p className='pay-muted'>For merchants: enter the receiver wallet first. The payer cannot edit this address on checkout.</p>
          <Field label='Order ID' value={form.orderId} onChange={v => updateForm('orderId', v)} />
          <Field label='Amount' value={form.amount} onChange={v => updateForm('amount', v)} />
          <Field label='Token' value={form.token} onChange={v => updateForm('token', v)} />
          <Field label='Receiver Wallet / Merchant Address' value={form.merchantAddress} onChange={v => { updateForm('merchantAddress', v); setDraftPreview(false) }} />
          <Field label='Receive Network' value='arc-testnet' onChange={() => {}} disabled />
          <Field label='Memo' value={form.memo} onChange={v => updateForm('memo', v)} />
          <Field label='Expires In Minutes' value={form.expiresInMinutes} onChange={v => updateForm('expiresInMinutes', v)} />
          <button className='btn btn-primary' onClick={previewInvoice}>Preview Invoice</button>
          {draftPreview && (
            <div className='pay-preview'>
              <h3>Invoice Preview</h3>
              <div className='pay-grid'>
                <Info label='Buyer pays' value={`${form.amount || '0'} USDC`} />
                <Info label='Merchant receives' value={`${form.amount || '0'} USDC on Arc Testnet`} />
                <Info label='Receiver wallet' value={form.merchantAddress || '-'} mono />
                <Info label='Order ID' value={form.orderId || '-'} />
                <Info label='Memo' value={form.memo || '-'} />
                <Info label='Expires in' value={`${form.expiresInMinutes || '15'} minutes`} />
              </div>
              <button className='btn btn-primary' onClick={create}>Create Payment Link</button>
            </div>
          )}
          {invoice && (
            <div className='json-box'>
              <a href={invoice.paymentUrl} className='header-link-button'>Lihat preview pembayaran</a>
              <pre>{JSON.stringify(invoice, null, 2)}</pre>
            </div>
          )}
        </div>

        <div className='glass sandbox-card'>
          <h3>Payment Status Checker</h3>
          <Field label='Invoice ID' value={statusId} onChange={setStatusId} />
          <button className='btn btn-primary' onClick={checkStatus}>Check Status</button>
          {statusResult && <pre className='json-box'>{JSON.stringify(statusResult, null, 2)}</pre>}
        </div>

        <div className='glass sandbox-card'>
          <h3>Webhook Simulator</h3>
          <Field label='Invoice ID' value={webhook.invoiceId} onChange={v => setWebhook(prev => ({ ...prev, invoiceId: v }))} />
          <Field label='Event Type' value={webhook.eventType} onChange={v => setWebhook(prev => ({ ...prev, eventType: v }))} />
          <Field label='Tx Hash' value={webhook.txHash} onChange={v => setWebhook(prev => ({ ...prev, txHash: v }))} />
          <button className='btn btn-primary' onClick={simulate}>Simulate Webhook</button>
          {webhookResult && <pre className='json-box'>{JSON.stringify(webhookResult, null, 2)}</pre>}
        </div>

        <div className='glass sandbox-card'>
          <h3>Pay Cross-Chain Preview</h3>
          <p className='pay-muted'>Preview how a buyer can pay from another chain while the merchant receives USDC on Arc. Receiver is taken from the invoice/merchant field.</p>
          <Field label='Source Chain' value={eco.sourceChain} onChange={v => setEco(prev => ({ ...prev, sourceChain: v }))} />
          <Field label='Destination Chain' value={eco.destinationChain} onChange={v => setEco(prev => ({ ...prev, destinationChain: v }))} />
          <Field label='Source Token' value={eco.sourceToken} onChange={v => setEco(prev => ({ ...prev, sourceToken: v }))} />
          <Field label='Destination Token' value={eco.destinationToken} onChange={v => setEco(prev => ({ ...prev, destinationToken: v }))} />
          <Field label='Amount' value={eco.amount} onChange={v => setEco(prev => ({ ...prev, amount: v }))} />
          <Field label='Receiver Wallet' value={form.merchantAddress} onChange={v => updateForm('merchantAddress', v)} />
          <Field label='Invoice ID' value={eco.invoiceId} onChange={v => setEco(prev => ({ ...prev, invoiceId: v }))} />
          <button className='btn btn-primary' onClick={previewEco}>Preview Eco Route</button>
          {ecoResult && <pre className='json-box'>{JSON.stringify(ecoResult, null, 2)}</pre>}
        </div>

        <div className='glass sandbox-card'>
          <h3>Circle Nanopayments Readiness</h3>
          <p>Preview ARCOX x402 readiness for future Circle Gateway Nanopayments. This does not make gas-free nanopayments live.</p>
          <button className='btn btn-primary' onClick={loadNanopayments}>Check Readiness</button>
          {nanopaymentsResult && <pre className='json-box'>{JSON.stringify(nanopaymentsResult, null, 2)}</pre>}
        </div>
      </section>

      <section className='sandbox-grid'>
        <div className='glass sandbox-card wide'>
          <h3>API Viewer</h3>
          <div className='api-example-grid'>
            {EXAMPLES.map(([title, payload]) => (
              <div className='api-example' key={String(title)}>
                <strong>{String(title)}</strong>
                <pre>{JSON.stringify(payload, null, 2)}</pre>
              </div>
            ))}
          </div>
        </div>

        <div className='glass sandbox-card'>
          <h3>Docs / Links</h3>
          {['ARCOX Pay docs', 'ARCOX MCP docs', 'ARCOX API docs', 'Circle Gateway docs', 'Circle Gateway Nanopayments docs', 'Eco docs', 'x402 docs', 'Privacy roadmap'].map(item => <p key={item}>{item}</p>)}
        </div>

        <div className='glass sandbox-card'>
          <h3>Glossary</h3>
          <p><strong>Merchant</strong> receives payment. <strong>Buyer</strong> pays invoice. <strong>Invoice</strong> is a payment request. <strong>Payment link</strong> opens checkout. <strong>USDC</strong> is the token. <strong>Arc</strong> is the testnet network. <strong>Webhook</strong> updates status. <strong>Circle Gateway</strong> lifecycle events are supported. <strong>Nanopayments</strong> are x402 readiness only. <strong>Eco Routes</strong> are mock mode. <strong>x402</strong> is disabled by default. <strong>MCP agent</strong> uses quote-before-execute. <strong>Privacy roadmap</strong> is future only.</p>
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
