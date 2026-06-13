import { getHeader, methodNotAllowed, parseJsonSafe, readRawBody, sendJson } from '../_webhook-utils.mjs'
import { markWebhookProcessed, recordWebhookEvent } from '../_arcox-pay-store.mjs'

const PROVIDER = 'circle'
const PRODUCT = 'gateway'
const seenNotifications = globalThis.__arcoxCircleWebhookSeenNotifications || new Set()
globalThis.__arcoxCircleWebhookSeenNotifications = seenNotifications
const LISTENING_EVENTS = [
  'contracts.eventLog',
  'transactions.inbound',
  'transactions.outbound',
  'challenges.',
  'rampSession.',
  'modularWallet.',
  'gateway.',
]

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
      message: 'Circle webhook endpoint is alive. Use POST for callbacks.',
      listeningEvents: LISTENING_EVENTS,
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
  const eventType = firstString(payload.type, payload.eventType, payload.notificationType, payload.event, data.type, data.eventType, data.event)
  const txHash = firstString(payload.txHash, payload.transactionHash, data.txHash, data.transactionHash)
  const status = firstString(payload.status, data.status, eventType)
  const extracted = {
    id: eventId || null,
    notificationId: eventId || null,
    eventType: eventType || null,
    notificationType: firstString(payload.notificationType, data.notificationType) || null,
    subscriptionId: firstString(payload.subscriptionId, data.subscriptionId) || null,
    transactionId: firstString(payload.transactionId, data.transactionId) || null,
    walletId: firstString(payload.walletId, data.walletId) || null,
    transferId: firstString(payload.transferId, data.transferId) || null,
    paymentId: firstString(payload.paymentId, data.paymentId) || null,
    walletAddress: firstString(payload.walletAddress, data.walletAddress, data.address) || null,
    blockchain: firstString(payload.blockchain, payload.chain, payload.domain, data.blockchain, data.chain, data.domain) || null,
    txHash: txHash || null,
    sourceChain: firstString(payload.sourceChain, data.sourceChain) || null,
    destinationChain: firstString(payload.destinationChain, data.destinationChain) || null,
    amount: firstString(payload.amount, data.amount) || null,
    currency: firstString(payload.currency, data.currency) || null,
    token: firstString(payload.token, payload.currency, data.token, data.currency) || null,
    status: status || null,
    source: firstString(payload.source, data.source) || null,
    destination: firstString(payload.destination, data.destination) || null,
    sourceAddress: firstString(payload.sourceAddress, data.sourceAddress) || null,
    destinationAddress: firstString(payload.destinationAddress, data.destinationAddress) || null,
    contractAddress: firstString(payload.contractAddress, data.contractAddress) || null,
    userOperationHash: firstString(payload.userOperationHash, data.userOperationHash) || null,
    challengeId: firstString(payload.challengeId, data.challengeId) || null,
    rampSessionId: firstString(payload.rampSessionId, data.rampSessionId) || null,
    createdAt: firstString(payload.createdAt, data.createdAt) || null,
    rawPayload: payload,
  }

  // TODO: persist Circle notification ID in webhook_events table to prevent duplicate processing across server restarts.
  const duplicate = Boolean(eventId && seenNotifications.has(eventId))
  if (eventId) seenNotifications.add(eventId)
  const stored = recordWebhookEvent({
    provider: PROVIDER,
    event_id: eventId || `circle:${Date.now()}`,
    event_type: eventType,
    payment_id: extracted.paymentId,
    order_id: firstString(payload.orderId, data.orderId),
    raw_payload_json: payload,
  })

  if (!duplicate) {
    if (eventType === 'contracts.eventLog') {
      // TODO: map contract events to ARCOX smart contract activity.
    } else if (eventType === 'transactions.inbound') {
      // TODO: match inbound USDC deposit to ARCOX user/payment session.
    } else if (eventType === 'transactions.outbound') {
      // TODO: match outbound payment or treasury movement.
    } else if (eventType?.startsWith('challenges.')) {
      // TODO: update pending user operation/challenge state.
    } else if (eventType?.startsWith('rampSession.')) {
      // TODO: update onramp/offramp session status.
    } else if (eventType?.startsWith('modularWallet.')) {
      // TODO: update modular wallet activity timeline.
    } else if (eventType === 'gateway.deposit.finalized') {
      // TODO: mark source-chain USDC deposit as finalized.
    } else if (eventType === 'gateway.mint.forwarded') {
      // TODO: mark Gateway mint relay as forwarded/confirmed.
    } else if (eventType === 'gateway.mint.finalized') {
      // TODO: mark destination-chain USDC mint as finalized and usable by ARCOX treasury.
    } else if (eventType?.startsWith('gateway.')) {
      // TODO: store unhandled Circle Gateway lifecycle event for reconciliation.
    }
    markWebhookProcessed(stored.event.event_id, { matched: false, extracted })
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
