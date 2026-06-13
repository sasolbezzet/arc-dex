import { getHeader, hmacHex, methodNotAllowed, parseJsonSafe, readRawBody, safeEqualHex, sendJson, stableStringify } from '../_webhook-utils.mjs'
import { applyNowpaymentsEvent, paymentResponse } from '../_arcox-pay-store.mjs'

const PROVIDER = 'nowpayments'

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return sendJson(res, 200, {
      ok: true,
      provider: PROVIDER,
      message: 'NOWPayments webhook endpoint is alive. Use POST for callbacks.',
    })
  }

  if (req.method !== 'POST') return methodNotAllowed(res, ['GET', 'POST'])

  const rawBody = await readRawBody(req)
  console.log('[webhook:nowpayments] raw payload', rawBody)

  const payload = parseJsonSafe(rawBody)
  const verifyIpn = String(process.env.NOWPAYMENTS_VERIFY_IPN || 'false').toLowerCase() === 'true'
  if (verifyIpn) {
    const secret = process.env.NOWPAYMENTS_IPN_SECRET || ''
    const signature = getHeader(req, 'x-nowpayments-sig')
    if (!secret || !signature) {
      return sendJson(res, 401, { ok: false, provider: PROVIDER, error: 'NOWPayments IPN signature required' })
    }
    const signedPayload = payload?._parseError ? rawBody : stableStringify(payload)
    const expected = hmacHex('sha512', secret, signedPayload)
    if (!safeEqualHex(expected, signature)) {
      return sendJson(res, 401, { ok: false, provider: PROVIDER, error: 'Invalid NOWPayments IPN signature' })
    }
  }

  const result = applyNowpaymentsEvent(payload)
  const event = result.event

  console.log('[webhook:nowpayments] parsed event', { ...event, duplicate: result.duplicate })

  // TODO: save NOWPayments webhook payload into payment_events/webhook_events table.
  // TODO: if payment_status is finished/confirmed, mark order as paid and unlock ARCOX service.
  // TODO: update ARCOX merchant callback when production settlement is enabled.

  return sendJson(res, 200, {
    ok: true,
    received: true,
    provider: PROVIDER,
    payment_id: event.payment_id || null,
    payment_status: event.payment_status || null,
    order_id: event.order_id || null,
    duplicate: result.duplicate,
    payment: result.payment ? paymentResponse(result.payment) : null,
  })
}
