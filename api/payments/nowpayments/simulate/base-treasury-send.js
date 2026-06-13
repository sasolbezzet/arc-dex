import { methodNotAllowed, parseJsonSafe, readRawBody, sendJson } from '../../../_webhook-utils.mjs'
import { getPayment, INTERNAL_STATUS, isSandboxMode, paymentResponse, updatePaymentStatus } from '../../../_arcox-pay-store.mjs'

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
  if (!isSandboxMode()) return sendJson(res, 403, { ok: false, error: 'Simulation is disabled in production mode' })
  const body = parseJsonSafe(await readRawBody(req))
  const payment = getPayment(body.payment_id)
  if (!payment) return sendJson(res, 404, { ok: false, error: 'payment not found' })
  if (!payment.nowpayments_destination_address && !payment.pay_address) {
    return sendJson(res, 400, { ok: false, error: 'NOWPayments pay_address is required before treasury send simulation' })
  }
  const updated = updatePaymentStatus(payment, {
    internal_status: INTERNAL_STATUS.SENT_TO_NOWPAYMENTS,
    base_tx_hash: body.base_tx_hash || payment.base_tx_hash || `0xmockbase${Date.now().toString(16)}`,
  })
  return sendJson(res, 200, { ok: true, payment: paymentResponse(updated) })
}
