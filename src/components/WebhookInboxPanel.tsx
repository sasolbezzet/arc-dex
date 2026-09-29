import { useCallback, useEffect, useState } from 'react'

/**
 * Inbox event webhook Circle (Wallets/Modular/Contracts) untuk memantau status
 * `challenges.*` dan `rampSession.*` tanpa membuka Circle Console.
 *
 * Hanya ringkasan yang ditampilkan: endpoint `/api/webhooks/events` sengaja tidak
 * mengirim payload mentah maupun alamat wallet (bisa milik user lain pada akun
 * Circle yang sama).
 */
const FAMILIES = ['all', 'transactions', 'challenges', 'contracts', 'modularWallet', 'rampSession'] as const
type Family = typeof FAMILIES[number]

type WebhookEvent = {
  id: string | null
  notificationId: string | null
  eventType: string | null
  family: string
  subtype: string | null
  status: string | null
  processed: boolean
  matched: boolean
  createdAt: string | null
  reference: {
    txHash: string | null
    userOpHash: string | null
    challengeId: string | null
    sessionId: string | null
    contractAddress: string | null
    blockHeight: number | null
  }
}

type InboxResponse = {
  ok?: boolean
  total?: number
  families?: Record<string, number>
  events?: WebhookEvent[]
  error?: string
}

function authToken(): string {
  try {
    const raw = localStorage.getItem('arc-dex-auth')
    return raw ? String(JSON.parse(raw)?.token || '') : ''
  } catch {
    return ''
  }
}

function short(value: string | null | undefined): string {
  if (!value) return ''
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value
}

function statusColor(status: string | null): string {
  const value = String(status || '').toLowerCase()
  if (['complete', 'completed', 'confirmed', 'success', 'succeeded', 'approved'].includes(value)) return '#10b981'
  if (['failed', 'rejected', 'denied', 'expired', 'reverted', 'cancelled', 'canceled', 'error'].includes(value)) return '#f87171'
  if (value) return '#f59e0b'
  return '#64748b'
}

function eventReference(event: WebhookEvent): string {
  const ref = event.reference || ({} as WebhookEvent['reference'])
  const candidate = ref.txHash || ref.userOpHash || ref.challengeId || ref.sessionId || ref.contractAddress
  return short(candidate || event.notificationId)
}

export function WebhookInboxPanel() {
  const [family, setFamily] = useState<Family>('all')
  const [events, setEvents] = useState<WebhookEvent[]>([])
  const [families, setFamilies] = useState<Record<string, number>>({})
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async (next: Family) => {
    const token = authToken()
    if (!token) {
      setEvents([])
      setLoaded(false)
      setError('')
      return
    }
    setLoading(true)
    setError('')
    try {
      const query = new URLSearchParams({ limit: '30' })
      if (next !== 'all') query.set('family', next)
      const response = await fetch(`/api/webhooks/events?${query.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const data: InboxResponse = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data?.error || `Inbox request failed (${response.status})`)
      setEvents(data.events || [])
      setFamilies(data.families || {})
      setLoaded(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat inbox webhook')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(family) }, [family, load])

  return (
    <div className='glass' style={{ borderRadius: 12, padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: '#e2e8f0' }}>🔔 Webhook Inbox</div>
        <button
          onClick={() => load(family)}
          disabled={loading}
          style={{ fontSize: 11, background: 'rgba(99,102,241,0.12)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)', padding: '4px 8px', borderRadius: 8, cursor: loading ? 'not-allowed' : 'pointer' }}
        >
          {loading ? '…' : '↻ Refresh'}
        </button>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {FAMILIES.map(item => (
          <button
            key={item}
            onClick={() => setFamily(item)}
            style={{
              fontSize: 11,
              background: family === item ? 'rgba(99,102,241,0.22)' : 'rgba(18,18,26,0.8)',
              color: family === item ? '#c7d2fe' : '#94a3b8',
              border: family === item ? '1px solid rgba(99,102,241,0.55)' : '1px solid #1e1e2e',
              padding: '5px 8px',
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            {item === 'all' ? `all (${Object.values(families).reduce((sum, count) => sum + count, 0)})` : `${item} (${families[item] || 0})`}
          </button>
        ))}
      </div>
      {!authToken() ? (
        <div style={{ color: '#64748b', fontSize: 12, textAlign: 'center', padding: '12px 0' }}>Hubungkan wallet untuk melihat inbox webhook.</div>
      ) : error ? (
        <div style={{ color: '#f87171', fontSize: 12 }}>{error}</div>
      ) : loaded && events.length === 0 ? (
        <div style={{ color: '#64748b', fontSize: 12, textAlign: 'center', padding: '12px 0' }}>Belum ada event webhook{family === 'all' ? '' : ` untuk ${family}`}.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {events.map(event => (
            <div key={event.id || event.notificationId} style={{ borderTop: '1px solid #1e1e2e', paddingTop: 6, fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ color: '#e2e8f0', fontWeight: 600, wordBreak: 'break-all' }}>{event.eventType || 'unknown'}</span>
                <span style={{ color: statusColor(event.status), fontWeight: 700 }}>{event.status || (event.processed ? 'processed' : 'received')}</span>
              </div>
              <div style={{ color: '#64748b', fontSize: 11, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span>{event.createdAt ? new Date(event.createdAt).toLocaleString() : '-'}</span>
                <span style={{ fontFamily: 'monospace' }}>{eventReference(event)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
