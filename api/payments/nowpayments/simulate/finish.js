import { methodNotAllowed, parseJsonSafe, readRawBody, sendJson } from '../../../_webhook-utils.mjs'
import { applyNowpaymentsEvent, getPayment, isSandboxMode, paymentResponse } from '../../../_arcox-pay-store.mjs'

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
  if (!isSandboxMode()) return sendJson(res, 403, { ok: false, error: 'Simulation is disabled in production mode' })
  const body = parseJsonSafe(await readRawBody(req))
  const payment = getPayment(body.payment_id)
  if (!payment) return sendJson(res, 404, { ok: false, error: 'payment not found' })
  const result = applyNowpaymentsEvent({
    payment_id: payment.provider_payment_id || payment.id,
    order_id: payment.order_id,
    payment_status: 'finished',
    price_amount: payment.amount,
    price_currency: payment.price_currency,
    pay_amount: payment.pay_amount || payment.amount,
    pay_currency: payment.pay_currency,
    pay_address: payment.pay_address,
  })
  return sendJson(res, 200, {
    ok: true,
    duplicate: result.duplicate,
    event: result.event,
    payment: result.payment ? paymentResponse(result.payment) : paymentResponse(payment),
  })
}
