import { methodNotAllowed, parseJsonSafe, readRawBody, sendJson } from '../../../_webhook-utils.mjs'
import { getPayment, INTERNAL_STATUS, isSandboxMode, paymentResponse, updatePaymentStatus } from '../../../_arcox-pay-store.mjs'

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
  if (!isSandboxMode()) return sendJson(res, 403, { ok: false, error: 'Simulation is disabled in production mode' })
  const body = parseJsonSafe(await readRawBody(req))
  const payment = getPayment(body.payment_id)
  if (!payment) return sendJson(res, 404, { ok: false, error: 'payment not found' })
  const updated = updatePaymentStatus(payment, {
    internal_status: INTERNAL_STATUS.ARC_FUNDED,
    user_wallet_address: body.user_wallet_address || payment.user_wallet_address,
    arc_tx_hash: body.arc_tx_hash || payment.arc_tx_hash || `0xmockarc${Date.now().toString(16)}`,
    metadata_json: { simulated_arc_payment_amount: body.amount || payment.amount },
  })
  return sendJson(res, 200, { ok: true, payment: paymentResponse(updated) })
}
