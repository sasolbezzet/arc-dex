import { methodNotAllowed, parseJsonSafe, readRawBody, sendJson } from '../../_webhook-utils.mjs'
import { applyNowpaymentsEvent, isSandboxMode, paymentResponse } from '../../_arcox-pay-store.mjs'

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
  if (!isSandboxMode()) return sendJson(res, 403, { ok: false, error: 'Simulation is disabled in production mode' })
  const body = parseJsonSafe(await readRawBody(req))
  const result = applyNowpaymentsEvent({
    payment_id: body.payment_id,
    order_id: body.order_id,
    payment_status: body.payment_status || 'finished',
    price_amount: body.price_amount,
    price_currency: body.price_currency,
    pay_amount: body.pay_amount,
    pay_currency: body.pay_currency,
    pay_address: body.pay_address,
  })
  return sendJson(res, 200, {
    ok: true,
    duplicate: result.duplicate,
    event: result.event,
    payment: result.payment ? paymentResponse(result.payment) : null,
  })
}
