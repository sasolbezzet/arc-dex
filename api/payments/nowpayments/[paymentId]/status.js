import { methodNotAllowed, sendJson } from '../../../_webhook-utils.mjs'
import { getPayment, isSandboxMode, payConfig, paymentResponse, updatePaymentStatus } from '../../../_arcox-pay-store.mjs'

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
  const paymentId = req.query?.paymentId
  let payment = getPayment(paymentId)
  if (!payment) return sendJson(res, 404, { ok: false, error: 'payment not found' })

  if (payment.provider_payment_id && process.env.NOWPAYMENTS_API_KEY) {
    try {
      const status = await getProviderStatus(payment.provider_payment_id)
      payment = updatePaymentStatus(payment, {
        payment_status: status.payment_status || status.status || payment.payment_status,
        metadata_json: { last_provider_status: status },
      })
    } catch (error) {
      payment = updatePaymentStatus(payment, {
        metadata_json: {
          last_provider_status_error: error instanceof Error ? error.message : String(error),
        },
      })
    }
  }

  return sendJson(res, 200, {
    ok: true,
    sandboxMode: isSandboxMode(),
    payment: paymentResponse(payment),
  })
}

async function getProviderStatus(providerPaymentId) {
  const cfg = payConfig()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const resp = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/payment/${encodeURIComponent(providerPaymentId)}`, {
      headers: { 'x-api-key': process.env.NOWPAYMENTS_API_KEY },
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
