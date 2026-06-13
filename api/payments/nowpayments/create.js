import { methodNotAllowed, parseJsonSafe, readRawBody, sendJson } from '../../_webhook-utils.mjs'
import { attachProviderPayment, createMockNowpaymentsResponse, createPaymentRecord, payConfig, paymentResponse } from '../../_arcox-pay-store.mjs'

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])

  const body = parseJsonSafe(await readRawBody(req))
  const amount = Number(body.amount || body.price_amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    return sendJson(res, 400, { ok: false, error: 'amount must be greater than 0' })
  }

  const cfg = payConfig()
  const input = {
    ...body,
    amount: String(body.amount || body.price_amount),
    price_currency: String(body.price_currency || cfg.defaultPriceCurrency).toLowerCase(),
    pay_currency: String(body.pay_currency || cfg.defaultPayCurrency).toLowerCase(),
    order_id: body.order_id || `ARCOX-${Date.now()}`,
  }
  const payment = createPaymentRecord(input)
  let providerResponse
  let providerError = null

  if (process.env.NOWPAYMENTS_API_KEY) {
    try {
      providerResponse = await createNowpaymentsPayment(cfg, input)
    } catch (error) {
      providerError = error instanceof Error ? error.message : String(error)
      if (cfg.mode === 'production') {
        return sendJson(res, 502, { ok: false, error: 'NOWPayments create payment failed', detail: providerError })
      }
    }
  }

  if (!providerResponse) providerResponse = createMockNowpaymentsResponse(payment, input)
  if (!providerResponse.pay_address && cfg.mode !== 'production') {
    providerResponse.pay_address = cfg.sandboxNowpaymentsDestinationAddress
    providerResponse.mockPayAddress = true
  }

  const updated = attachProviderPayment(payment, {
    ...providerResponse,
    providerError,
  })

  return sendJson(res, 200, {
    ok: true,
    mockMode: Boolean(providerResponse.mockMode || providerError || !process.env.NOWPAYMENTS_API_KEY),
    payment: paymentResponse(updated),
  })
}

async function createNowpaymentsPayment(cfg, input) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12_000)
  try {
    const resp = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.NOWPAYMENTS_API_KEY,
      },
      body: JSON.stringify({
        price_amount: Number(input.amount),
        price_currency: input.price_currency,
        pay_currency: input.pay_currency,
        order_id: input.order_id,
        order_description: input.description || 'ARCOX Pay USDC Base sandbox test',
        ipn_callback_url: `${cfg.appBaseUrl.replace(/\/$/, '')}/api/webhooks/nowpayments`,
        ...(input.case ? { case: input.case } : {}),
      }),
      signal: controller.signal,
    })
    const text = await resp.text()
    let data = {}
    try { data = text ? JSON.parse(text) : {} } catch { data = { raw: text } }
    if (!resp.ok) throw new Error(data?.message || data?.error || `NOWPayments HTTP ${resp.status}`)
    return data
  } finally {
    clearTimeout(timeout)
  }
}
