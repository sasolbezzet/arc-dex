// TODO: replace this in-memory webhook ledger with persistent PostgreSQL/Redis storage before production use.
const state = globalThis.__arcoxPayState || {
  webhookEvents: new Map(),
}

globalThis.__arcoxPayState = state

export function nowIso() {
  return new Date().toISOString()
}

export function makeId(prefix) {
  const rand = Math.random().toString(36).slice(2, 10)
  return `${prefix}_${Date.now().toString(36)}_${rand}`
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
