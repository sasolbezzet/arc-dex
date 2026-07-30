import { useEffect, useRef, useState } from 'react'

type Credential = { id: string; type: 'eoa' | 'circle' | 'solana' | 'api_key'; label: string; value: string }
type Approval = { id: string; agent: string; action: string; amount: string; token: string; source: string; to: string; status: string; createdAt: number }
type Limits = { maxPerTx: number; dailyLimit: number; autoApprove: boolean; whitelist: string[] }
type Activity = { id: string; type: string; data: any; ts: number }
type McpSession = { clientId: string; agent: string; connectedAt: number; lastActivity: number; active: boolean }

const API = ''
const MCP_URL = 'https://arcoxdex.vercel.app/mcp'
const SERVER_URL = 'https://arcoxdex.vercel.app'
const AUTH_URL = `${SERVER_URL}/api/auth/authorize`

const Section = ({ title, children, badge }: { title: string; children: React.ReactNode; badge?: React.ReactNode }) => (
  <div className='glass' style={{ borderRadius: 12, padding: 14, marginBottom: 14 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
      <span style={{ fontWeight: 600, fontSize: 14, color: '#e2e8f0' }}>{title}</span>
      {badge}
    </div>
    {children}
  </div>
)

const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
    <span style={{ color: '#64748b' }}>{label}</span>
    <span style={{ color: '#e2e8f0' }}>{value}</span>
  </div>
)

// 🔐 SIWE login button
async function siweLogin(address: string): Promise<string | null> {
  try {
    // 1. Get challenge
    const ch = await fetch(`${API}/api/vault/challenge`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address })
    }).then(r => r.json())
    if (!ch.message) return null

    // 2. Request MetaMask signature
    const provider = (window as any).ethereum
    if (!provider) { alert('MetaMask tidak terdeteksi'); return null }
    const accounts = await provider.request({ method: 'eth_requestAccounts' })
    const from = accounts[0]
    const signature = await provider.request({ method: 'personal_sign', params: [ch.message, from] })

    // 3. Verify → get session token
    const verify = await fetch(`${API}/api/vault/verify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: from, message: ch.message, signature })
    }).then(r => r.json())
    if (!verify.token) { alert('Verifikasi gagal: ' + (verify.error || 'unknown')); return null }
    return verify.token
  } catch (e: any) {
    alert('Login gagal: ' + (e?.message || e))
    return null
  }
}

export function PluginPanel({ address, circleWallet, solanaAddress }: { address: string | null; circleWallet: { id: string; address: string } | null; solanaAddress: string | null }) {
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [approvals, setApprovals] = useState<Approval[]>([])
  const [limits, setLimits] = useState<Limits>({ maxPerTx: 100, dailyLimit: 500, autoApprove: true, whitelist: [] })
  const [activity, setActivity] = useState<Activity[]>([])
  const [mcpSessions, setMcpSessions] = useState<McpSession[]>([])
  const [sessionToken, setSessionToken] = useState<string | null>(null)
  const [authLoading, setAuthLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newWhitelist, setNewWhitelist] = useState('')

  const authHeaders = (): Record<string, string> => sessionToken ? { 'Authorization': `Bearer ${sessionToken}` } : {}

  const fetchAll = async () => {
    if (!sessionToken) return
    setLoading(true)
    setError(null)
    try {
      const [creds, lim, appr, act, sess] = await Promise.all([
        fetch(`${API}/api/vault/credentials`, { headers: authHeaders() }).then(r => r.json()),
        fetch(`${API}/api/vault/limits`, { headers: authHeaders() }).then(r => r.json()),
        fetch(`${API}/api/vault/approvals`, { headers: authHeaders() }).then(r => r.json()),
        fetch(`${API}/api/vault/activity?limit=20`, { headers: authHeaders() }).then(r => r.json()),
        fetch(`${API}/api/vault/sessions`, { headers: authHeaders() }).then(r => r.json()),
      ])
      setCredentials(creds.credentials || [])
      setLimits(lim.limits || { maxPerTx: 100, dailyLimit: 500, autoApprove: true, whitelist: [] })
      setApprovals(appr.approvals || [])
      setActivity(act.activity || [])
      setMcpSessions(sess.sessions || [])
    } catch (e: any) {
      setError(e?.message || 'Gagal memuat vault')
    }
    setLoading(false)
  }

  // Auto-poll MCP sessions every 15s for live status
  useEffect(() => {
    if (!sessionToken) return
    const poll = setInterval(async () => {
      try {
        const s = await fetch(`${API}/api/vault/sessions`, { headers: authHeaders() }).then(r => r.json())
        setMcpSessions(s.sessions || [])
      } catch {}
    }, 15000)
    return () => clearInterval(poll)
  }, [sessionToken])

  const doLogin = async () => {
    if (!address) return
    setAuthLoading(true)
    const token = await siweLogin(address)
    if (token) {
      setSessionToken(token)
      localStorage.setItem('arx_vault_token', token)
    }
    setAuthLoading(false)
  }

  // Restore session from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('arx_vault_token')
    if (saved) setSessionToken(saved)
  }, [])

  // Fetch data when token changes
  useEffect(() => { if (sessionToken) fetchAll() }, [sessionToken])

  // Auto-register wallet credentials after login
  const hasSynced = useRef(false)
  useEffect(() => {
    if (!hasSynced.current && sessionToken && address) {
      hasSynced.current = true
      syncWalletCredentials()
    }
  }, [sessionToken, address, circleWallet, solanaAddress])

  const syncWalletCredentials = async () => {
    if (!address || !sessionToken) return
    const existing = credentials.find(c => c.type === 'eoa' && c.label === 'MetaMask EOA')
    if (!existing) {
      try { await safePostWithAuth(API, '/api/vault/credentials', { type: 'eoa', label: 'MetaMask EOA', value: address }, sessionToken) } catch {}
    }
    if (circleWallet) {
      const ec = credentials.find(c => c.type === 'circle' && c.label === 'Circle Wallet')
      if (!ec) { try { await safePostWithAuth(API, '/api/vault/credentials', { type: 'circle', label: 'Circle Wallet', value: circleWallet.address }, sessionToken) } catch {} }
    }
    if (solanaAddress) {
      const es = credentials.find(c => c.type === 'solana' && c.label === 'Solana Devnet')
      if (!es) { try { await safePostWithAuth(API, '/api/vault/credentials', { type: 'solana', label: 'Solana Devnet', value: solanaAddress }, sessionToken) } catch {} }
    }
    fetchAll()
  }

  const limitsTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const updateLimits = async (patch: Partial<Limits>) => {
    const next = { ...limits, ...patch }
    setLimits(next)
    if (limitsTimer.current) clearTimeout(limitsTimer.current)
    limitsTimer.current = setTimeout(async () => {
      try { await fetch(`${API}/api/vault/limits`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(next) }) } catch (e: any) { setError(e?.message || 'Update limits gagal') }
    }, 800)
  }

  const addWhitelist = () => { if (!newWhitelist) return; updateLimits({ whitelist: [...limits.whitelist, newWhitelist] }); setNewWhitelist('') }
  const removeWhitelist = (item: string) => updateLimits({ whitelist: limits.whitelist.filter(w => w !== item) })
  const approve = async (id: string) => { try { await fetch(`${API}/api/vault/approvals/${id}/approve`, { method: 'POST', headers: authHeaders() }) } catch {}; fetchAll() }
  const reject = async (id: string) => { try { await fetch(`${API}/api/vault/approvals/${id}/reject`, { method: 'POST', headers: authHeaders() }) } catch {}; fetchAll() }
  const fmtTime = (ts: number) => new Date(ts).toLocaleString('id-ID', { hour12: false })

  // Connection status badge
  const chatgptConnected = mcpSessions.some(s => s.active && s.agent?.includes('chatgpt'))
  const claudeConnected = mcpSessions.some(s => s.active && s.agent?.includes('claude'))
  const anyConnected = mcpSessions.some(s => s.active)
  const StatusDot = ({ on, label }: { on: boolean; label: string }) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, padding: '2px 8px', borderRadius: 4, background: on ? 'rgba(16,185,129,0.15)' : 'rgba(100,116,139,0.1)', color: on ? '#10b981' : '#64748b' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: on ? '#10b981' : '#64748b', boxShadow: on ? '0 0 6px #10b981' : 'none' }} />
      {label}
    </span>
  )

  if (!address) return <div style={{ color: '#64748b', textAlign: 'center', padding: 40 }}>Hubungkan wallet untuk membuka Plugin.</div>

  // Not authenticated — show login
  if (!sessionToken) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className='glass' style={{ borderRadius: 12, padding: 24, textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🔐</div>
        <div style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Autentikasi Diperlukan</div>
        <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 16, lineHeight: 1.5 }}>
          Demi keamanan, akses Plugin memerlukan tanda tangan wallet.<br/>
          Wallet address saja tidak cukup — bukti kepemilikan via signature diperlukan.
        </div>
        <button onClick={doLogin} disabled={authLoading} style={{ width: '100%', padding: 12, borderRadius: 10, border: '1px solid rgba(99,102,241,0.4)', background: 'rgba(99,102,241,0.15)', color: '#818cf8', fontSize: 14, fontWeight: 600, cursor: authLoading ? 'wait' : 'pointer' }}>
          {authLoading ? 'Memproses...' : '🔓 Sign In with Wallet'}
        </button>
      </div>
    </div>
  )

  if (loading) return <div style={{ color: '#64748b', textAlign: 'center', padding: 40 }}>Memuat plugin...</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {error && <div style={{ color: '#f87171', fontSize: 12, padding: 10, background: 'rgba(239,68,68,0.1)', borderRadius: 8 }}>{error}</div>}

      {/* Connection status bar */}
      <div className='glass' style={{ borderRadius: 12, padding: 10, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <StatusDot on={chatgptConnected} label="ChatGPT" />
          <StatusDot on={claudeConnected} label="Claude" />
          <StatusDot on={anyConnected} label={anyConnected ? 'Agent aktif' : 'Belum ada agent'} />
        </div>
        <button onClick={() => { localStorage.removeItem('arx_vault_token'); setSessionToken(null) }} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.1)', color: '#f87171', cursor: 'pointer' }}>Keluar</button>
      </div>

      {/* Setup MCP */}
      <Section title='🔌 Setup MCP' badge={anyConnected ? <StatusDot on={true} label="Terhubung" /> : undefined}>
        <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 10 }}>Hubungkan AI agent ke ARCOX. Copy URL ini ke Claude, ChatGPT, atau Codex sebagai MCP server.</div>
        <Row label='MCP URL' value={
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <code style={{ background: 'rgba(99,102,241,0.1)', padding: '4px 8px', borderRadius: 6, color: '#818cf8' }}>{MCP_URL}</code>
            <button onClick={() => navigator.clipboard.writeText(MCP_URL)} style={{ background: 'rgba(99,102,241,0.2)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 6, padding: '3px 8px', fontSize: 11, cursor: 'pointer' }}>Copy</button>
          </div>
        } />
        <ol style={{ color: '#94a3b8', fontSize: 11, paddingLeft: 16, marginTop: 8 }}>
          <li>Buka ChatGPT Settings → Plugins → Add MCP server</li>
          <li>Paste MCP URL di atas</li>
          <li>OAuth: pilih Dynamic Client Registration (DCR)</li>
          <li>Atau manual: Auth URL = <code style={{fontSize:10,color:'#818cf8'}}>{AUTH_URL}</code>, Token URL = <code style={{fontSize:10,color:'#818cf8'}}>{SERVER_URL}/api/auth/token</code></li>
          <li>Setelah connect, login dengan wallet address di halaman auth</li>
        </ol>
      </Section>

      {/* Credentials */}
      <Section title='🔐 Credentials'>
        <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 10 }}>Wallet dan API key yang bisa dipakai agent. Wallet terdaftar otomatis setelah login.</div>
        {credentials.length === 0 ? (
          <div style={{ color: '#64748b', fontSize: 12 }}>Belum ada credential.</div>
        ) : (
          credentials.map(c => (
            <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px', background: 'rgba(18,18,26,0.6)', borderRadius: 8, marginBottom: 6 }}>
              <div>
                <div style={{ color: '#e2e8f0', fontSize: 12, fontWeight: 600 }}>{c.label}</div>
                <div style={{ color: '#64748b', fontSize: 11 }}>{c.type.toUpperCase()} · {c.value}</div>
              </div>
              <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: c.type === 'eoa' ? 'rgba(245,158,11,0.15)' : c.type === 'circle' ? 'rgba(99,102,241,0.15)' : 'rgba(16,185,129,0.15)', color: c.type === 'eoa' ? '#f59e0b' : c.type === 'circle' ? '#818cf8' : '#10b981' }}>{c.type}</span>
            </div>
          ))
        )}
        <div style={{ marginTop: 8 }}>
          <button onClick={() => {
            const label = prompt('Nama credential:')
            const value = prompt('Value (API key):')
            if (label && value) fetch(`${API}/api/vault/credentials`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ type: 'api_key', label, value }) }).then(() => fetchAll()).catch((e: any) => setError(e?.message || 'Tambah credential gagal'))
          }} style={{ width: '100%', background: 'rgba(99,102,241,0.1)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)', padding: 8, borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>+ Tambah API Key</button>
        </div>
      </Section>

      {/* Agents */}
      <Section title='🤖 Agents' badge={anyConnected ? <StatusDot on={true} label={`${mcpSessions.filter(s => s.active).length} aktif`} /> : undefined}>
        {mcpSessions.length === 0 ? (
          <div style={{ color: '#64748b', fontSize: 12 }}>Belum ada agent terhubung. Hubungkan via MCP URL di atas.</div>
        ) : (
          mcpSessions.map((s, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px', background: 'rgba(18,18,26,0.6)', borderRadius: 8, marginBottom: 6 }}>
              <div>
                <div style={{ color: '#e2e8f0', fontSize: 12, fontWeight: 600 }}>{s.agent || 'MCP Agent'}</div>
                <div style={{ color: '#64748b', fontSize: 10 }}>ID: {s.clientId?.slice(0, 20)}... · Last: {fmtTime(s.lastActivity)}</div>
              </div>
              <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: s.active ? 'rgba(16,185,129,0.15)' : 'rgba(100,116,139,0.1)', color: s.active ? '#10b981' : '#64748b' }}>{s.active ? '🟢 Aktif' : '⭕ Idle'}</span>
            </div>
          ))
        )}
      </Section>

      {/* Approvals */}
      <Section title='✅ Approvals'>
        {approvals.filter(a => a.status === 'pending' || a.status === 'auto_approved').length === 0 ? (
          <div style={{ color: '#64748b', fontSize: 12 }}>Tidak ada permintaan persetujuan.</div>
        ) : (
          approvals.filter(a => a.status === 'pending' || a.status === 'auto_approved').map(a => (
            <div key={a.id} style={{ padding: '8px', background: 'rgba(18,18,26,0.6)', borderRadius: 8, marginBottom: 6 }}>
              <div style={{ color: '#e2e8f0', fontSize: 12 }}>{a.agent}: {a.action} {a.amount} {a.token} {a.to ? `→ ${a.to.slice(0, 10)}...` : ''}</div>
              <div style={{ color: '#64748b', fontSize: 10 }}>Source: {a.source} · {fmtTime(a.createdAt)}</div>
              {a.status === 'pending' ? (
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <button onClick={() => approve(a.id)} style={{ flex: 1, background: 'rgba(16,185,129,0.15)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)', padding: '5px', borderRadius: 6, fontSize: 11, cursor: 'pointer' }}>Approve</button>
                  <button onClick={() => reject(a.id)} style={{ flex: 1, background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)', padding: '5px', borderRadius: 6, fontSize: 11, cursor: 'pointer' }}>Reject</button>
                </div>
              ) : (
                <div style={{ color: '#10b981', fontSize: 10, marginTop: 4 }}>Auto-approved (dalam limit)</div>
              )}
            </div>
          ))
        )}
      </Section>

      {/* Limits */}
      <Section title='🛡️ Limits'>
        <Row label='Max per tx' value={
          <input type='number' value={limits.maxPerTx} onChange={e => updateLimits({ maxPerTx: Number(e.target.value) })} style={{ width: 80, background: 'rgba(18,18,26,0.8)', border: '1px solid #1e1e2e', color: '#e2e8f0', borderRadius: 6, padding: '4px 8px', fontSize: 12 }} />
        } />
        <Row label='Daily limit' value={
          <input type='number' value={limits.dailyLimit} onChange={e => updateLimits({ dailyLimit: Number(e.target.value) })} style={{ width: 80, background: 'rgba(18,18,26,0.8)', border: '1px solid #1e1e2e', color: '#e2e8f0', borderRadius: 6, padding: '4px 8px', fontSize: 12 }} />
        } />
        <Row label='Auto-approve dalam limit' value={
          <input type='checkbox' checked={limits.autoApprove} onChange={e => updateLimits({ autoApprove: e.target.checked })} style={{ cursor: 'pointer' }} />
        } />
        <div style={{ marginTop: 8 }}>
          <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>Whitelist address:</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <input type='text' value={newWhitelist} onChange={e => setNewWhitelist(e.target.value)} placeholder='0x...' style={{ flex: 1, background: 'rgba(18,18,26,0.8)', border: '1px solid #1e1e2e', color: '#e2e8f0', borderRadius: 6, padding: '4px 8px', fontSize: 12 }} />
            <button onClick={addWhitelist} style={{ background: 'rgba(99,102,241,0.2)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>+</button>
          </div>
          {limits.whitelist.map(w => (
            <div key={w} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: '#e2e8f0', background: 'rgba(18,18,26,0.6)', padding: '4px 8px', borderRadius: 6, marginBottom: 4 }}>
              <span style={{ fontFamily: 'monospace' }}>{w.slice(0, 12)}...{w.slice(-6)}</span>
              <button onClick={() => removeWhitelist(w)} style={{ background: 'transparent', color: '#f87171', border: 'none', cursor: 'pointer', fontSize: 12 }}>🗑</button>
            </div>
          ))}
        </div>
      </Section>

      {/* Activity */}
      <Section title='📜 Activity'>
        {activity.length === 0 ? (
          <div style={{ color: '#64748b', fontSize: 12 }}>Belum ada aktivitas agent.</div>
        ) : (
          activity.map(a => (
            <div key={a.id} style={{ fontSize: 11, color: '#94a3b8', padding: '4px 0', borderBottom: '1px solid #1e1e2e' }}>
              <span style={{ color: '#e2e8f0' }}>{a.type.replace(/_/g, ' ')}</span> · {fmtTime(a.ts)}
            </div>
          ))
        )}
      </Section>
    </div>
  )
}

// Helper: safePost with auth header
async function safePostWithAuth(api: string, path: string, body: any, token: string) {
  return fetch(`${api}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(body) })
}
