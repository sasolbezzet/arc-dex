// TODO: replace this sandbox in-memory ledger with persistent PostgreSQL/Redis storage before production use.
const state = globalThis.__arcoxPaySandboxState || {
  payments: new Map(),
  webhookEvents: new Map(),
  mcpSessions: new Map(),
}

globalThis.__arcoxPaySandboxState = state

export const INTERNAL_STATUS = {
  CREATED: 'created',
  WAITING_USER_ARC_PAYMENT: 'waiting_user_arc_payment',
  ARC_FUNDED: 'arc_funded',
  BRIDGING_TO_BASE: 'bridging_to_base',
  BASE_TREASURY_FUNDED: 'base_treasury_funded',
  NOWPAYMENTS_INVOICE_CREATED: 'nowpayments_invoice_created',
  SENT_TO_NOWPAYMENTS: 'sent_to_nowpayments',
  WAITING_NOWPAYMENTS_IPN: 'waiting_nowpayments_ipn',
  PAID: 'paid',
  FAILED: 'failed',
  EXPIRED: 'expired',
}

export function nowIso() {
  return new Date().toISOString()
}

export function makeId(prefix) {
  const rand = Math.random().toString(36).slice(2, 10)
  return `${prefix}_${Date.now().toString(36)}_${rand}`
}

export function nowpaymentsMode() {
  return String(process.env.NOWPAYMENTS_MODE || 'sandbox').toLowerCase()
}

export function isSandboxMode() {
  return nowpaymentsMode() !== 'production'
}

export function payConfig() {
  return {
    mode: nowpaymentsMode(),
    baseUrl: process.env.NOWPAYMENTS_BASE_URL || 'https://api-sandbox.nowpayments.io/v1',
    appBaseUrl: process.env.ARCOX_PAY_BASE_URL || process.env.ARCOX_WEB_URL || 'https://arc-dex-bice.vercel.app',
    defaultPayCurrency: process.env.ARCOX_DEFAULT_PAY_CURRENCY || 'usdcbase',
    defaultPriceCurrency: process.env.ARCOX_DEFAULT_PRICE_CURRENCY || 'usd',
    arcTreasuryAddress: process.env.ARCOX_ARC_TREASURY_ADDRESS || '',
    baseTreasuryAddress: process.env.ARCOX_BASE_TREASURY_ADDRESS || '',
    sandboxNowpaymentsDestinationAddress: process.env.ARCOX_SANDBOX_NOWPAYMENTS_DESTINATION_ADDRESS || '0xSANDBOX_NOWPAYMENTS_DESTINATION',
  }
}

export function listPayments(limit = 10) {
  return [...state.payments.values()]
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, Math.max(1, Math.min(Number(limit) || 10, 100)))
}

export function getPayment(paymentId) {
  if (!paymentId) return null
  return state.payments.get(String(paymentId)) || findPaymentByProviderOrOrder(paymentId)
}

export function findPaymentByProviderOrOrder(value) {
  const needle = String(value || '')
  if (!needle) return null
  for (const payment of state.payments.values()) {
    if (
      String(payment.provider_payment_id || '') === needle ||
      String(payment.provider_invoice_id || '') === needle ||
      String(payment.order_id || '') === needle
    ) {
      return payment
    }
  }
  return null
}

export function savePayment(payment) {
  const updated = { ...payment, updated_at: nowIso() }
  state.payments.set(updated.id, updated)
  return updated
}

export function createPaymentRecord(input = {}) {
  const cfg = payConfig()
  const createdAt = nowIso()
  const id = makeId('pay')
  const orderId = String(input.order_id || input.orderId || `ARCOX-${Date.now()}`)
  const amount = String(input.amount || input.price_amount || '')
  const priceCurrency = String(input.price_currency || cfg.defaultPriceCurrency).toLowerCase()
  const payCurrency = String(input.pay_currency || cfg.defaultPayCurrency).toLowerCase()
  const payment = {
    id,
    provider: 'nowpayments',
    provider_payment_id: null,
    provider_invoice_id: null,
    order_id: orderId,
    user_id: input.user_id || null,
    merchant_id: input.merchant_id || null,
    amount,
    price_currency: priceCurrency,
    pay_currency: payCurrency,
    pay_amount: null,
    pay_address: null,
    payout_wallet_address: cfg.baseTreasuryAddress || null,
    payment_status: 'created',
    internal_status: INTERNAL_STATUS.WAITING_USER_ARC_PAYMENT,
    route: 'arc-usdc-to-base-usdc-nowpayments',
    mode: cfg.mode,
    user_wallet_address: null,
    arc_treasury_address: cfg.arcTreasuryAddress || null,
    base_treasury_address: cfg.baseTreasuryAddress || null,
    nowpayments_destination_address: null,
    arc_tx_hash: null,
    bridge_tx_hash: null,
    base_tx_hash: null,
    metadata_json: {
      description: input.description || input.order_description || '',
      status_history: [{ status: INTERNAL_STATUS.WAITING_USER_ARC_PAYMENT, created_at: createdAt }],
    },
    created_at: createdAt,
    updated_at: createdAt,
  }
  state.payments.set(id, payment)
  return payment
}

export function attachProviderPayment(payment, providerResponse = {}) {
  const cfg = payConfig()
  const payAddress = providerResponse.pay_address || providerResponse.payAddress || cfg.sandboxNowpaymentsDestinationAddress
  return savePayment({
    ...payment,
    provider_payment_id: providerResponse.payment_id || providerResponse.id || payment.provider_payment_id,
    provider_invoice_id: providerResponse.invoice_id || providerResponse.invoiceId || payment.provider_invoice_id,
    payment_status: providerResponse.payment_status || providerResponse.status || 'waiting',
    internal_status: INTERNAL_STATUS.NOWPAYMENTS_INVOICE_CREATED,
    pay_amount: providerResponse.pay_amount || providerResponse.payAmount || payment.amount,
    pay_address: payAddress,
    nowpayments_destination_address: payAddress,
    metadata_json: {
      ...(payment.metadata_json || {}),
      provider_response: providerResponse,
      payment_url: providerResponse.payment_url || providerResponse.invoice_url || providerResponse.url || null,
      expires_at: providerResponse.expires_at || providerResponse.expiration_estimate_date || null,
      status_history: [
        ...((payment.metadata_json && payment.metadata_json.status_history) || []),
        { status: INTERNAL_STATUS.NOWPAYMENTS_INVOICE_CREATED, created_at: nowIso() },
      ],
    },
  })
}

export function updatePaymentStatus(payment, changes = {}) {
  const nextStatus = changes.internal_status || payment.internal_status
  const history = [...((payment.metadata_json && payment.metadata_json.status_history) || [])]
  if (nextStatus !== payment.internal_status) history.push({ status: nextStatus, created_at: nowIso() })
  return savePayment({
    ...payment,
    ...changes,
    metadata_json: {
      ...(payment.metadata_json || {}),
      ...(changes.metadata_json || {}),
      status_history: history,
    },
  })
}

export function normalizeNowpaymentsStatus(status) {
  const value = String(status || '').toLowerCase()
  if (['finished', 'confirmed'].includes(value)) return { payment_status: value, internal_status: INTERNAL_STATUS.PAID, public_status: 'paid' }
  if (['waiting', 'confirming', 'sending'].includes(value)) return { payment_status: value, internal_status: INTERNAL_STATUS.WAITING_NOWPAYMENTS_IPN, public_status: 'processing' }
  if (value === 'partially_paid') return { payment_status: value, internal_status: INTERNAL_STATUS.WAITING_NOWPAYMENTS_IPN, public_status: 'partial' }
  if (value === 'expired') return { payment_status: value, internal_status: INTERNAL_STATUS.EXPIRED, public_status: 'expired' }
  if (['failed', 'refunded'].includes(value)) return { payment_status: value, internal_status: INTERNAL_STATUS.FAILED, public_status: value }
  return { payment_status: value || 'unknown', internal_status: undefined, public_status: value || 'unknown' }
}

export function makeNowpaymentsEventId(event = {}) {
  return [
    'nowpayments',
    event.payment_id || 'no-payment',
    event.payment_status || 'no-status',
    event.order_id || 'no-order',
  ].join(':')
}

export function recordWebhookEvent(input = {}) {
  const eventId = String(input.event_id || input.id || makeId('evt'))
  const existing = state.webhookEvents.get(eventId)
  if (existing) return { event: existing, duplicate: true }
  const event = {
    id: eventId,
    provider: input.provider || 'unknown',
    event_id: eventId,
    event_type: input.event_type || null,
    payment_id: input.payment_id || null,
    order_id: input.order_id || null,
    raw_payload_json: input.raw_payload_json || {},
    processed: false,
    created_at: nowIso(),
  }
  state.webhookEvents.set(eventId, event)
  return { event, duplicate: false }
}

export function markWebhookProcessed(eventId, extra = {}) {
  const current = state.webhookEvents.get(eventId)
  if (!current) return null
  const next = { ...current, ...extra, processed: true, processed_at: nowIso() }
  state.webhookEvents.set(eventId, next)
  return next
}

export function applyNowpaymentsEvent(payload = {}) {
  const event = {
    payment_id: payload.payment_id,
    payment_status: payload.payment_status,
    order_id: payload.order_id,
    price_amount: payload.price_amount,
    price_currency: payload.price_currency,
    pay_amount: payload.pay_amount,
    pay_currency: payload.pay_currency,
    actually_paid: payload.actually_paid,
    pay_address: payload.pay_address,
    purchase_id: payload.purchase_id,
    outcome_amount: payload.outcome_amount,
    outcome_currency: payload.outcome_currency,
  }
  const eventId = makeNowpaymentsEventId(event)
  const { duplicate } = recordWebhookEvent({
    provider: 'nowpayments',
    event_id: eventId,
    event_type: event.payment_status,
    payment_id: event.payment_id,
    order_id: event.order_id,
    raw_payload_json: payload,
  })
  if (duplicate) return { event, duplicate: true, payment: findPaymentByProviderOrOrder(event.payment_id || event.order_id) }

  let payment = findPaymentByProviderOrOrder(event.payment_id) || findPaymentByProviderOrOrder(event.order_id)
  if (payment) {
    const mapped = normalizeNowpaymentsStatus(event.payment_status)
    payment = updatePaymentStatus(payment, {
      provider_payment_id: event.payment_id || payment.provider_payment_id,
      order_id: event.order_id || payment.order_id,
      payment_status: mapped.payment_status,
      internal_status: mapped.internal_status || payment.internal_status,
      pay_amount: event.pay_amount || payment.pay_amount,
      pay_currency: event.pay_currency || payment.pay_currency,
      pay_address: event.pay_address || payment.pay_address,
      nowpayments_destination_address: event.pay_address || payment.nowpayments_destination_address,
      metadata_json: {
        last_nowpayments_event: event,
        public_status: mapped.public_status,
      },
    })
  }
  markWebhookProcessed(eventId, { payment_id: event.payment_id, order_id: event.order_id, matched: Boolean(payment) })
  return { event, duplicate: false, payment }
}

export function createMockNowpaymentsResponse(payment, input = {}) {
  const cfg = payConfig()
  return {
    payment_id: `np_mock_${payment.id}`,
    payment_status: 'waiting',
    pay_address: cfg.sandboxNowpaymentsDestinationAddress,
    price_amount: payment.amount,
    price_currency: payment.price_currency,
    pay_amount: payment.amount,
    pay_currency: payment.pay_currency,
    order_id: payment.order_id,
    purchase_id: `purchase_${payment.id}`,
    payment_url: `${cfg.appBaseUrl}/pay/sandbox?payment_id=${encodeURIComponent(payment.id)}`,
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    mockMode: true,
    case: input.case || null,
  }
}

export function paymentResponse(payment) {
  const paymentUrl = payment.metadata_json?.payment_url || null
  return {
    id: payment.id,
    payment_id: payment.id,
    provider: payment.provider,
    provider_payment_id: payment.provider_payment_id,
    provider_invoice_id: payment.provider_invoice_id,
    order_id: payment.order_id,
    user_id: payment.user_id,
    amount: payment.amount,
    price_amount: payment.amount,
    price_currency: payment.price_currency,
    pay_currency: payment.pay_currency,
    pay_amount: payment.pay_amount,
    pay_address: payment.pay_address,
    payout_wallet_address: payment.payout_wallet_address,
    payment_status: payment.payment_status,
    internal_status: payment.internal_status,
    route: payment.route,
    mode: payment.mode,
    user_wallet_address: payment.user_wallet_address,
    arc_treasury_address: payment.arc_treasury_address,
    base_treasury_address: payment.base_treasury_address,
    nowpayments_destination_address: payment.nowpayments_destination_address,
    arc_tx_hash: payment.arc_tx_hash,
    bridge_tx_hash: payment.bridge_tx_hash,
    base_tx_hash: payment.base_tx_hash,
    invoice_url: paymentUrl,
    payment_url: paymentUrl,
    expires_at: payment.metadata_json?.expires_at || null,
    metadata_json: payment.metadata_json,
    raw_provider_response: payment.metadata_json?.provider_response || null,
    created_at: payment.created_at,
    updated_at: payment.updated_at,
  }
}
