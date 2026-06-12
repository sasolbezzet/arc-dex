import { getHeader, methodNotAllowed, parseJsonSafe, readRawBody, sendJson } from '../_webhook-utils.mjs'

const PROVIDER = 'circle'
const PRODUCT = 'gateway'
const seenNotifications = globalThis.__arcoxCircleWebhookSeenNotifications || new Set()
globalThis.__arcoxCircleWebhookSeenNotifications = seenNotifications

export default async function handler(req, res) {
  if (req.method === 'HEAD') {
    res.statusCode = 200
    res.end()
    return
  }

  if (req.method === 'GET') {
    return sendJson(res, 200, {
      ok: true,
      provider: PROVIDER,
      product: PRODUCT,
      message: 'Circle Gateway webhook endpoint is alive. Use POST for callbacks.',
    })
  }

  if (req.method !== 'POST') return methodNotAllowed(res, ['HEAD', 'GET', 'POST'])

  const rawBody = await readRawBody(req)
  console.log('[webhook:circle-gateway] raw payload', rawBody)

  const payload = parseJsonSafe(rawBody)
  const verifyWebhook = String(process.env.CIRCLE_VERIFY_WEBHOOK || 'false').toLowerCase() === 'true'
  if (verifyWebhook) {
    const signature = getHeader(req, 'circle-signature') || getHeader(req, 'x-circle-signature')
    // TODO: implement Circle Gateway webhook signature verification when Circle publishes the exact header/signing scheme for this subscription.
    // Keep disabled-by-default testing mode working; when enabled, fail closed until verification is wired.
    if (!signature) {
      return sendJson(res, 401, { ok: false, provider: PROVIDER, product: PRODUCT, error: 'Circle webhook signature required' })
    }
    return sendJson(res, 401, { ok: false, provider: PROVIDER, product: PRODUCT, error: 'Circle webhook signature verification is not configured yet' })
  }

  const data = payload.data && typeof payload.data === 'object' ? payload.data : {}
  const eventId = firstString(payload.notificationId, payload.id, payload.eventId, data.notificationId, data.id)
  const eventType = firstString(payload.type, payload.eventType, payload.notificationType, data.type, data.eventType)
  const txHash = firstString(payload.txHash, payload.transactionHash, data.txHash, data.transactionHash)
  const status = firstString(payload.status, data.status, eventType)
  const extracted = {
    notificationId: eventId || null,
    eventType: eventType || null,
    subscriptionId: firstString(payload.subscriptionId, data.subscriptionId) || null,
    walletAddress: firstString(payload.walletAddress, data.walletAddress, data.address) || null,
    blockchain: firstString(payload.blockchain, payload.domain, data.blockchain, data.domain) || null,
    txHash: txHash || null,
    sourceChain: firstString(payload.sourceChain, data.sourceChain) || null,
    destinationChain: firstString(payload.destinationChain, data.destinationChain) || null,
    amount: firstString(payload.amount, data.amount) || null,
    token: firstString(payload.token, payload.currency, data.token, data.currency) || null,
    status: status || null,
    createdAt: firstString(payload.createdAt, data.createdAt) || null,
    rawPayload: payload,
  }

  // TODO: store Circle notification ID to prevent duplicate processing.
  const duplicate = Boolean(eventId && seenNotifications.has(eventId))
  if (eventId) seenNotifications.add(eventId)

  if (!duplicate) {
    if (eventType === 'gateway.deposit.finalized') {
      // TODO: mark source-chain USDC deposit as finalized.
    } else if (eventType === 'gateway.mint.forwarded') {
      // TODO: mark Gateway mint relay as forwarded/confirmed.
    } else if (eventType === 'gateway.mint.finalized') {
      // TODO: mark destination-chain USDC mint as finalized and usable by ARCOX treasury.
    } else if (eventType?.startsWith('gateway.')) {
      // TODO: store unhandled Circle Gateway lifecycle event for reconciliation.
    }
  }

  console.log('[webhook:circle-gateway] parsed event', { ...extracted, duplicate, rawPayload: undefined })

  return sendJson(res, 200, {
    ok: true,
    received: true,
    provider: PROVIDER,
    product: PRODUCT,
    eventId: eventId || null,
    eventType: eventType || null,
    status: status || null,
    duplicate,
  })
}

function firstString(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue
    return String(value)
  }
  return ''
}
