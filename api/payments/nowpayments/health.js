import { methodNotAllowed, sendJson } from '../../_webhook-utils.mjs'
import { payConfig } from '../../_arcox-pay-store.mjs'

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
  const cfg = payConfig()
  return sendJson(res, 200, {
    ok: true,
    provider: 'nowpayments',
    mode: cfg.mode,
    baseUrl: cfg.baseUrl,
  })
}
