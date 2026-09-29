import { useCallback, useEffect, useState } from 'react'

/**
 * Inbox event webhook Circle (Wallets/Modular/Contracts) untuk memantau status
 * `challenges.*` dan `rampSession.*` tanpa membuka Circle Console.
 *
 * Hanya ringkasan yang ditampilkan: endpoint `/api/webhooks/events` sengaja tidak
 * mengirim payload mentah maupun alamat wallet (bisa milik user lain pada akun
 * Circle yang sama). Ringkasan status dihitung server dari seluruh event, jadi
 * filter di bawah tidak mengubahnya.
 */
const FAMILIES = ['all', 'transactions', 'challenges', 'contracts', 'modularWallet', 'rampSession'] as const
type Family = typeof FAMILIES[number]

type NotificationEvent = {
  id: string | null
  notificationId: string | null
  eventType: string | null
  family: string
  subtype: string | null
  status: string | null
  processed: boolean
  matched: boolean
  simulated: boolean
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

type SubjectStatus = {
  failed: boolean
  succeeded: boolean
  status: string | null
  lastEventType: string
  occurrences: number
  updatedAt: string | null
}

type ChallengeStatus = SubjectStatus & { challengeId: string; type: string | null }
type RampStatus = SubjectStatus & { sessionId: string; kycStatus: string | null }
type Failure = { eventType: string; family: string; status: string | null; subjectId: string | null; createdAt: string | null }

// Alert tersimpan di vault: terikat owner, tahan restart, bisa di-acknowledge.
type WebhookAlert = {
  id: string
  family: string
  subjectId: string | null
  eventType: string
  status: string | null
  count: number
  ts: number
  simulated: boolean
}

type InboxState = { challenges?: ChallengeStatus[]; rampSessions?: RampStatus[]; failures?: Failure[] }

type InboxResponse = {
  ok?: boolean
  total?: number
  families?: Record<string, number>
  state?: InboxState
  alerts?: WebhookAlert[]
  events?: NotificationEvent[]
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

function fmtTime(value: string | null | undefined): string {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString()
}

function statusColor(status: string | null): string {
  const value = String(status || '').toLowerCase()
  if (['complete', 'completed', 'confirmed', 'success', 'succeeded', 'approved', 'depositreceived', 'kycapproved'].includes(value)) return '#10b981'
  if (['failed', 'rejected', 'denied', 'expired', 'reverted', 'cancelled', 'canceled', 'error'].includes(value)) return '#f87171'
  if (value) return '#f59e0b'
  return '#64748b'
}

function eventReference(event: NotificationEvent): string {
  const ref = event.reference || ({} as NotificationEvent['reference'])
  const candidate = ref.txHash || ref.userOpHash || ref.challengeId || ref.sessionId || ref.contractAddress
  return short(candidate || event.notificationId)
}

function StatusRow({ label, value, failed, succeeded, meta }: { label: string; value: string | null; failed: boolean; succeeded: boolean; meta: string }) {
  const color = failed ? '#f87171' : succeeded ? '#10b981' : statusColor(value)
  return (
    <div style={{ borderTop: '1px solid #1e1e2e', paddingTop: 6, fontSize: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ color: '#e2e8f0', fontFamily: 'monospace', wordBreak: 'break-all' }}>{label}</span>
        <span style={{ color, fontWeight: 700 }}>{failed ? '⚠ ' : ''}{value || (succeeded ? 'ok' : 'pending')}</span>
      </div>
      <div style={{ color: '#64748b', fontSize: 11 }}>{meta}</div>
    </div>
  )
}

export function WebhookInboxPanel() {
  const [family, setFamily] = useState<Family>('all')
  const [events, setEvents] = useState<NotificationEvent[]>([])
  const [families, setFamilies] = useState<Record<string, number>>({})
  const [state, setState] = useState<InboxState>({})
  const [alerts, setAlerts] = useState<WebhookAlert[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async (next: Family) => {
    const token = authToken()
    if (!token) {
      setEvents([])
      setState({})
      setAlerts([])
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
      setState(data.state || {})
      setAlerts(data.alerts || [])
      setLoaded(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat inbox webhook')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(family) }, [family, load])

  const acknowledge = useCallback(async (id: string) => {
    const token = authToken()
    if (!token) return
    try {
      await fetch(`/api/webhooks/alerts/${encodeURIComponent(id)}/ack`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
    } catch { /* biarkan refresh berikutnya yang memperbaiki tampilan */ }
    load(family)
  }, [family, load])

  const failures = state.failures || []
  const challenges = state.challenges || []
  const rampSessions = state.rampSessions || []
  const hasToken = Boolean(authToken())

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

      {!hasToken ? (
        <div style={{ color: '#64748b', fontSize: 12, textAlign: 'center', padding: '12px 0' }}>Hubungkan wallet untuk melihat inbox webhook.</div>
      ) : (
        <>
          {alerts.length > 0 && (
            <div style={{ background: 'rgba(248,113,113,0.16)', border: '1px solid rgba(248,113,113,0.45)', borderRadius: 10, padding: '8px 10px', marginBottom: 10 }}>
              <div style={{ color: '#f87171', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>⚠ {alerts.length} alert wallet perlu tindakan</div>
              {alerts.map(alert => (
                <div key={alert.id} style={{ borderTop: '1px solid rgba(248,113,113,0.25)', paddingTop: 4, marginTop: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                    <span style={{ color: '#fecaca', fontSize: 12, wordBreak: 'break-all' }}>{alert.eventType}</span>
                    <button
                      onClick={() => acknowledge(alert.id)}
                      style={{ fontSize: 10, background: 'rgba(248,113,113,0.2)', color: '#fecaca', border: '1px solid rgba(248,113,113,0.5)', padding: '2px 8px', borderRadius: 6, cursor: 'pointer' }}
                    >
                      Acknowledge
                    </button>
                  </div>
                  <div style={{ color: '#fca5a5', fontSize: 11 }}>
                    {alert.status || 'gagal'} · {alert.family}{alert.count > 1 ? ` · ${alert.count}×` : ''}{alert.simulated ? ' · simulated' : ''} · {fmtTime(new Date(alert.ts).toISOString())}
                  </div>
                </div>
              ))}
            </div>
          )}

          {failures.length > 0 && (
            <div style={{ background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.35)', borderRadius: 10, padding: '8px 10px', marginBottom: 10 }}>
              <div style={{ color: '#f87171', fontSize: 12, fontWeight: 700 }}>⚠ {failures.length} event gagal</div>
              {failures.slice(0, 3).map(failure => (
                <div key={`${failure.eventType}-${failure.subjectId || ''}-${failure.createdAt || ''}`} style={{ color: '#fca5a5', fontSize: 11, marginTop: 2 }}>
                  {failure.eventType} · {failure.status || 'gagal'} · {fmtTime(failure.createdAt)}
                </div>
              ))}
            </div>
          )}

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

          {error ? (
            <div style={{ color: '#f87171', fontSize: 12 }}>{error}</div>
          ) : loaded && events.length === 0 ? (
            <div style={{ color: '#64748b', fontSize: 12, textAlign: 'center', padding: '12px 0' }}>Belum ada event webhook{family === 'all' ? '' : ` untuk ${family}`}.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {events.map(event => (
                <div key={event.id || event.notificationId} style={{ borderTop: '1px solid #1e1e2e', paddingTop: 6, fontSize: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ color: '#e2e8f0', fontWeight: 600, wordBreak: 'break-all' }}>
                      {event.eventType || 'unknown'}{event.simulated && <span style={{ color: '#f59e0b', fontWeight: 400 }}> · simulasi</span>}
                    </span>
                    <span style={{ color: statusColor(event.status), fontWeight: 700 }}>{event.status || (event.processed ? 'processed' : 'received')}</span>
                  </div>
                  <div style={{ color: '#64748b', fontSize: 11, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span>{fmtTime(event.createdAt)}</span>
                    <span style={{ fontFamily: 'monospace' }}>{eventReference(event)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {(challenges.length > 0 || rampSessions.length > 0) && (
            <div style={{ marginTop: 12 }}>
              <div style={{ color: '#94a3b8', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Status terkini</div>
              {challenges.slice(0, 5).map(challenge => (
                <StatusRow
                  key={challenge.challengeId}
                  label={short(challenge.challengeId) || 'challenge'}
                  value={challenge.status}
                  failed={challenge.failed}
                  succeeded={challenge.succeeded}
                  meta={`${challenge.type || challenge.lastEventType} · ${challenge.occurrences}× · ${fmtTime(challenge.updatedAt)}`}
                />
              ))}
              {rampSessions.slice(0, 5).map(session => (
                <StatusRow
                  key={session.sessionId}
                  label={short(session.sessionId) || 'session'}
                  value={session.kycStatus || session.status}
                  failed={session.failed}
                  succeeded={session.succeeded}
                  meta={`${session.lastEventType} · ${session.occurrences}× · ${fmtTime(session.updatedAt)}`}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
