import { methodNotAllowed, sendJson } from '../../_webhook-utils.mjs'
import { listPayments, paymentResponse } from '../../_arcox-pay-store.mjs'

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
  const limit = Number(req.query?.limit || 10)
  return sendJson(res, 200, {
    ok: true,
    payments: listPayments(limit).map(paymentResponse),
  })
}
