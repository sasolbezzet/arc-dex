import { useEffect, useMemo, useState } from 'react'
import {
  createNowpaymentsSandboxPayment,
  getNanopaymentsCapabilities,
  getNowpaymentsPaymentStatus,
  quoteEcoRoute,
  simulateNowpaymentsStatus,
  simulateNowpaymentsStep,
} from '../payApi'
import type { NowpaymentsSandboxPayment } from '../payApi'

const TEST_COMMANDS = [
  ['NOWPayments health', 'curl -i https://arc-dex-bice.vercel.app/api/webhooks/nowpayments'],
  ['NOWPayments create', 'curl -i -X POST https://arc-dex-bice.vercel.app/api/payments/nowpayments/create -H "Content-Type: application/json" -d \'{"amount":1,"price_currency":"usd","pay_currency":"usdcbase","order_id":"ARCOX-TEST-001","description":"ARCOX Pay USDC Base sandbox test","user_id":"demo_user"}\''],
  ['Circle health', 'curl -i https://arc-dex-bice.vercel.app/api/webhooks/circle'],
  ['Circle HEAD', 'curl -I https://arc-dex-bice.vercel.app/api/webhooks/circle'],
]

export function PaySandbox() {
  const defaultOrderId = useMemo(() => `ARCOX-TEST-${Date.now()}`, [])
  const [form, setForm] = useState({
    amount: '1',
    price_currency: 'usd',
    pay_currency: 'usdcbase',
    order_id: defaultOrderId,
    description: 'ARCOX Pay USDC Base sandbox test',
    user_id: 'demo_user',
  })
  const [payment, setPayment] = useState<NowpaymentsSandboxPayment | null>(null)
  const [rawResult, setRawResult] = useState<any>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [userWallet, setUserWallet] = useState('0xUSER')
  const [ecoResult, setEcoResult] = useState<any>(null)
  const [nanopaymentsResult, setNanopaymentsResult] = useState<any>(null)

  const paymentId = payment?.id || ''
  const isPending = payment && !['paid', 'finished', 'failed', 'expired'].includes(String(payment.payment_status || payment.internal_status).toLowerCase())

  useEffect(() => {
    if (!paymentId || !isPending) return
    const timer = window.setInterval(() => {
      getNowpaymentsPaymentStatus(paymentId).then(result => {
        setPayment(result.payment)
        setRawResult(result)
      }).catch(() => {})
    }, 8000)
    return () => window.clearInterval(timer)
  }, [paymentId, isPending])

  const update = (key: string, value: string) => setForm(prev => ({ ...prev, [key]: value }))

  async function run(label: string, fn: () => Promise<any>) {
    try {
      setBusy(label)
      setError('')
      const result = await fn()
      setRawResult(result)
      if (result.payment) setPayment(result.payment)
    } catch (e) {
      setError(e instanceof Error ? e.message : `${label} failed`)
    } finally {
      setBusy('')
    }
  }

  const createPayment = () => run('create', async () => createNowpaymentsSandboxPayment({ ...form, amount: Number(form.amount) }))
  const checkStatus = () => paymentId && run('status', async () => getNowpaymentsPaymentStatus(paymentId))
  const simArc = () => paymentId && run('arc', async () => simulateNowpaymentsStep('user-arc-payment', {
    payment_id: paymentId,
    user_wallet_address: userWallet,
    amount: form.amount,
    arc_tx_hash: `0xmockarc${Date.now().toString(16)}`,
  }))
  const simBridge = () => paymentId && run('bridge', async () => simulateNowpaymentsStep('bridge-to-base', {
    payment_id: paymentId,
    bridge_tx_hash: `0xmockbridge${Date.now().toString(16)}`,
  }))
  const simBaseSend = () => paymentId && run('base-send', async () => simulateNowpaymentsStep('base-treasury-send', {
    payment_id: paymentId,
    base_tx_hash: `0xmockbase${Date.now().toString(16)}`,
  }))
  const simFinished = () => paymentId && run('finish', async () => simulateNowpaymentsStep('finish', { payment_id: paymentId }))
  const simFailed = () => payment && run('failed', async () => simulateNowpaymentsStatus({
    payment_id: payment.provider_payment_id || payment.id,
    order_id: payment.order_id,
    payment_status: 'failed',
  }))
  const previewEco = () => run('eco', async () => {
    const result = await quoteEcoRoute({
      sourceChain: 'base',
      destinationChain: 'arc-testnet',
      sourceToken: 'USDC',
      destinationToken: 'USDC',
      amount: form.amount,
      recipient: payment?.arc_treasury_address || 'ARCOX Arc Treasury',
      invoiceId: payment?.id,
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
        <h2>ARCOX Pay Sandbox</h2>
        <p>USDC-first sandbox for NOWPayments invoices, treasury routing simulation, Circle webhook listening, MCP payment tools, and x402 readiness on Arc Testnet.</p>
        <div className='inline-warning'>Sandbox/testing only. Do not send mainnet funds unless production mode is enabled.</div>
      </section>

      {error && <div className='inline-error'>{error}</div>}

      <section className='sandbox-grid'>
        <div className='glass sandbox-card'>
          <h3>Create NOWPayments Sandbox Payment</h3>
          <Field label='Amount' value={form.amount} onChange={v => update('amount', v)} />
          <Field label='Price Currency' value={form.price_currency} onChange={v => update('price_currency', v)} />
          <Field label='Pay Currency' value={form.pay_currency} onChange={v => update('pay_currency', v)} />
          <Field label='Order ID' value={form.order_id} onChange={v => update('order_id', v)} />
          <Field label='Description' value={form.description} onChange={v => update('description', v)} />
          <Field label='User ID' value={form.user_id} onChange={v => update('user_id', v)} />
          <button className='btn btn-primary' onClick={createPayment} disabled={busy === 'create'}>Create NOWPayments Sandbox Payment</button>
        </div>

        <div className='glass sandbox-card wide'>
          <h3>3-Wallet Flow</h3>
          <div className='flow-steps'>
            <FlowStep title='User Wallet' value={userWallet} extra='Pays USDC on Arc / mock Arc testnet' />
            <FlowStep title='ARCOX Arc Treasury' value={payment?.arc_treasury_address || 'Set ARCOX_ARC_TREASURY_ADDRESS'} extra='Receives user payment' />
            <FlowStep title='ARCOX Base Treasury' value={payment?.base_treasury_address || 'Set ARCOX_BASE_TREASURY_ADDRESS'} extra='Simulates USDC Base liquidity' />
            <FlowStep title='NOWPayments pay_address' value={payment?.nowpayments_destination_address || payment?.pay_address || 'Created by NOWPayments'} extra='Destination returned by provider' />
          </div>
          <Field label='User Wallet for Simulation' value={userWallet} onChange={setUserWallet} />
        </div>

        <div className='glass sandbox-card wide'>
          <h3>Payment Detail</h3>
          {payment ? (
            <>
              <div className='pay-grid'>
                <Info label='Order ID' value={payment.order_id} />
                <Info label='Internal Payment ID' value={payment.id} mono />
                <Info label='Provider Payment ID' value={payment.provider_payment_id || '-'} mono />
                <Info label='Payment Status' value={payment.payment_status} />
                <Info label='Internal Status' value={payment.internal_status} />
                <Info label='Pay Amount' value={`${payment.pay_amount || payment.amount} ${payment.pay_currency}`} />
                <Info label='Pay Address' value={payment.pay_address || '-'} mono />
                <Info label='Arc Tx' value={payment.arc_tx_hash || '-'} mono />
                <Info label='Bridge Tx' value={payment.bridge_tx_hash || '-'} mono />
                <Info label='Base Tx' value={payment.base_tx_hash || '-'} mono />
              </div>
              <div className='button-row wrap'>
                <button className='btn btn-secondary' onClick={checkStatus}>Check Status</button>
                <button className='btn btn-secondary' onClick={simArc}>Simulate User Paid Arc Treasury</button>
                <button className='btn btn-secondary' onClick={simBridge}>Simulate Bridge Arc to Base</button>
                <button className='btn btn-secondary' onClick={simBaseSend}>Simulate Base Treasury Sent to NOWPayments</button>
                <button className='btn btn-primary' onClick={simFinished}>Simulate NOWPayments Finished</button>
                <button className='btn btn-secondary' onClick={simFailed}>Simulate Failed</button>
                <button className='btn btn-secondary' onClick={() => copy(payment.pay_address)}>Copy Payment Address</button>
                <button className='btn btn-secondary' onClick={() => copy(payment.payment_url || payment.invoice_url)}>Copy Payment URL</button>
              </div>
            </>
          ) : (
            <p className='pay-muted'>Create a sandbox payment to see provider IDs, pay address, treasury addresses, and simulation controls.</p>
          )}
        </div>

        <div className='glass sandbox-card'>
          <h3>Eco / Cross-Chain Preview</h3>
          <p className='pay-muted'>Preview future pay cross-chain routing. This is adapter/mock readiness, not hidden execution.</p>
          <button className='btn btn-primary' onClick={previewEco}>Preview Eco Route</button>
          {ecoResult && <pre className='json-box'>{JSON.stringify(ecoResult, null, 2)}</pre>}
        </div>

        <div className='glass sandbox-card'>
          <h3>Circle Nanopayments Readiness</h3>
          <p className='pay-muted'>Checks x402/Gateway readiness metadata. Gas-free nanopayments are not live.</p>
          <button className='btn btn-primary' onClick={loadNanopayments}>Check Readiness</button>
          {nanopaymentsResult && <pre className='json-box'>{JSON.stringify(nanopaymentsResult, null, 2)}</pre>}
        </div>

        <div className='glass sandbox-card wide'>
          <h3>Raw Response</h3>
          <details open>
            <summary>Provider/API JSON</summary>
            <pre className='json-box'>{JSON.stringify(rawResult || payment || {}, null, 2)}</pre>
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
