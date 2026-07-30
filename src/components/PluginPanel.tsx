import { useEffect, useRef, useState } from 'react'
import { safePost } from '../api'

type Credential = { id: string; type: 'eoa' | 'circle' | 'solana' | 'api_key'; label: string; value: string }
type Approval = { id: string; agent: string; action: string; amount: string; token: string; source: string; to: string; status: string; createdAt: number }
type Limits = { maxPerTx: number; dailyLimit: number; autoApprove: boolean; whitelist: string[] }
type Activity = { id: string; type: string; data: any; ts: number }

const API = ''
const MCP_URL = 'https://arcoxdex.vercel.app/mcp'

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className='glass' style={{ borderRadius: 12, padding: 14, marginBottom: 14 }}>
    <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10, color: '#e2e8f0' }}>{title}</div>
    {children}
  </div>
)

const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
    <span style={{ color: '#64748b' }}>{label}</span>
    <span style={{ color: '#e2e8f0' }}>{value}</span>
  </div>
)

export function PluginPanel({ address, circleWallet, solanaAddress }: { address: string | null; circleWallet: { id: string; address: string } | null; solanaAddress: string | null }) {
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [approvals, setApprovals] = useState<Approval[]>([])
  const [limits, setLimits] = useState<Limits>({ maxPerTx: 100, dailyLimit: 500, autoApprove: true, whitelist: [] })
  const [activity, setActivity] = useState<Activity[]>([])
  const [agents] = useState([
    { name: 'ARCOX Agent (Hermes)', url: MCP_URL, status: 'active', last: 'now' },
    { name: 'ARCOX Agent (Claude/Codex)', url: MCP_URL, status: 'ready', last: 'never connected' },
  ])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newWhitelist, setNewWhitelist] = useState('')

  const authHeaders = () => ({ 'x-wallet-address': address || '' })

  const fetchAll = async () => {
    if (!address) return
    setLoading(true)
    setError(null)
    try {
      const [creds, lim, appr, act] = await Promise.all([
        fetch(`${API}/api/vault/credentials`, { headers: authHeaders() }).then(r => r.json()),
        fetch(`${API}/api/vault/limits`, { headers: authHeaders() }).then(r => r.json()),
        fetch(`${API}/api/vault/approvals`, { headers: authHeaders() }).then(r => r.json()),
        fetch(`${API}/api/vault/activity?limit=20`, { headers: authHeaders() }).then(r => r.json()),
      ])
      setCredentials(creds.credentials || [])
      setLimits(lim.limits || { maxPerTx: 100, dailyLimit: 500, autoApprove: true, whitelist: [] })
      setApprovals(appr.approvals || [])
      setActivity(act.activity || [])
    } catch (e: any) {
      setError(e?.message || 'Gagal memuat vault')
    }
    setLoading(false)
  }

  useEffect(() => { fetchAll() }, [address])

  const syncWalletCredentials = async () => {
    if (!address) return
    const existing = credentials.find(c => c.type === 'eoa' && c.label === 'MetaMask EOA')
    if (!existing) {
      try { await safePost(API, '/api/vault/credentials', { type: 'eoa', label: 'MetaMask EOA', value: address }) } catch {}
    }
    if (circleWallet) {
      const existingCircle = credentials.find(c => c.type === 'circle' && c.label === 'Circle Wallet')
      if (!existingCircle) {
        try { await safePost(API, '/api/vault/credentials', { type: 'circle', label: 'Circle Wallet', value: circleWallet.address }) } catch {}
      }
    }
    if (solanaAddress) {
      const existingSol = credentials.find(c => c.type === 'solana' && c.label === 'Solana Devnet')
      if (!existingSol) {
        try { await safePost(API, '/api/vault/credentials', { type: 'solana', label: 'Solana Devnet', value: solanaAddress }) } catch {}
      }
    }
    fetchAll()
  }

  const hasSynced = useRef(false)
  useEffect(() => {
    if (!hasSynced.current && address) {
      hasSynced.current = true
      syncWalletCredentials()
    }
  }, [address, circleWallet, solanaAddress])

  const limitsTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const updateLimits = async (patch: Partial<Limits>) => {
    const next = { ...limits, ...patch }
    setLimits(next)
    if (limitsTimer.current) clearTimeout(limitsTimer.current)
    limitsTimer.current = setTimeout(async () => {
      try { await safePost(API, '/api/vault/limits', next) } catch (e: any) { setError(e?.message || 'Update limits gagal') }
    }, 800)
  }

  const addWhitelist = () => {
    if (!newWhitelist) return
    const list = [...limits.whitelist, newWhitelist]
    setNewWhitelist('')
    updateLimits({ whitelist: list })
  }

  const removeWhitelist = (item: string) => {
    updateLimits({ whitelist: limits.whitelist.filter(w => w !== item) })
  }

  const approve = async (id: string) => {
    try { await safePost(API, `/api/vault/approvals/${id}/approve`, {}) } catch (e: any) { setError(e?.message || 'Approve gagal') }
    fetchAll()
  }

  const reject = async (id: string) => {
    try { await safePost(API, `/api/vault/approvals/${id}/reject`, {}) } catch (e: any) { setError(e?.message || 'Reject gagal') }
    fetchAll()
  }

  const fmtTime = (ts: number) => new Date(ts).toLocaleString('id-ID', { hour12: false })

  if (!address) return <div style={{ color: '#64748b', textAlign: 'center', padding: 40 }}>Hubungkan wallet untuk membuka Plugin.</div>
  if (loading) return <div style={{ color: '#64748b', textAlign: 'center', padding: 40 }}>Memuat plugin...</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {error && <div style={{ color: '#f87171', fontSize: 12, padding: 10, background: 'rgba(239,68,68,0.1)', borderRadius: 8 }}>{error}</div>}

      {/* Setup MCP */}
      <Section title='🔌 Setup MCP'>
        <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 10 }}>Hubungkan AI agent ke ARCOX. Copy URL ini ke Claude, ChatGPT, atau Codex sebagai MCP server.</div>
        <Row label='MCP URL' value={
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <code style={{ background: 'rgba(99,102,241,0.1)', padding: '4px 8px', borderRadius: 6, color: '#818cf8' }}>{MCP_URL}</code>
            <button onClick={() => navigator.clipboard.writeText(MCP_URL)} style={{ background: 'rgba(99,102,241,0.2)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 6, padding: '3px 8px', fontSize: 11, cursor: 'pointer' }}>Copy</button>
          </div>
        } />
        <ol style={{ color: '#94a3b8', fontSize: 11, paddingLeft: 16, marginTop: 8 }}>
          <li>Buka Claude Desktop / ChatGPT Settings → Plugins / MCP</li>
          <li>Pilih Add MCP server</li>
          <li>Paste URL di atas</li>
          <li>Agent siap digunakan dalam limit yang kamu set</li>
        </ol>
      </Section>

      {/* Credentials */}
      <Section title='🔐 Credentials'>
        <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 10 }}>Wallet dan API key yang bisa dipakai agent.</div>
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
            if (label && value) safePost(API, '/api/vault/credentials', { type: 'api_key', label, value }).then(fetchAll).catch((e: any) => setError(e?.message || 'Tambah credential gagal'))
          }} style={{ width: '100%', background: 'rgba(99,102,241,0.1)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)', padding: 8, borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>+ Tambah API Key</button>
        </div>
      </Section>

      {/* Agents */}
      <Section title='🤖 Agents'>
        {agents.map((a, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px', background: 'rgba(18,18,26,0.6)', borderRadius: 8, marginBottom: 6 }}>
            <div>
              <div style={{ color: '#e2e8f0', fontSize: 12, fontWeight: 600 }}>{a.name}</div>
              <div style={{ color: '#64748b', fontSize: 10 }}>{a.url}</div>
            </div>
            <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: a.status === 'active' ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)', color: a.status === 'active' ? '#10b981' : '#f59e0b' }}>{a.status}</span>
          </div>
        ))}
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
