import { useEffect, useRef, useState } from 'react'
import { sendTokenFromEoa } from '../services/eoaTransactions'
import { swapFromEoa } from '../services/swapService'
import { registerPasskey, loginPasskey, setupSessionKey, revokeSessionKey, getMscaState } from '../services/modularWallet'
import { connectWalletConnect, getWalletConnectProviderSync, isWalletConnectAvailable, isMobile, redirectToWalletForSign } from '../services/walletConnect'

type Credential = { id: string; type: 'eoa' | 'circle' | 'solana' | 'api_key'; label: string; value: string }
type Approval = { id: string; agent: string; action: string; amount: string; token: string; source: string; to: string; status: string; createdAt: number; approvedAt?: number; txHash?: string; explorerUrl?: string; details?: string }
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
  // ── OAuth callback params (from ChatGPT/Claude redirect) ──
  const [oauthParams, setOauthParams] = useState<{ client_id: string; redirect_uri: string; state: string; code_challenge: string } | null>(null)
  const [oauthStatus, setOauthStatus] = useState<'idle' | 'signing' | 'approving' | 'done' | 'error'>('idle')

  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    if (p.get('auth') === 'mcp' && p.get('client_id') && p.get('redirect_uri')) {
      setOauthParams({
        client_id: p.get('client_id') || '',
        redirect_uri: p.get('redirect_uri') || '',
        state: p.get('state') || '',
        code_challenge: p.get('code_challenge') || '',
      })
    }
    // Deep-link from the AI agent: /plugin?tab=approvals&approval=<id>
    // Highlight the referenced approval so the user lands right on it.
    if (p.get('approval')) {
      setHighlightApproval(p.get('approval'))
      setDeepLink(true)
    }
    if (p.get('tab') === 'approvals') setDeepLink(true)
  }, [])
  const [deepLink, setDeepLink] = useState(false)
  const [highlightApproval, setHighlightApproval] = useState<string | null>(null)
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
  const [mscaState, setMscaState] = useState<{ walletAddress?: string; delegateAddress?: string; sessionActive: boolean }>(() => {
    const s = getMscaState()
    return { walletAddress: s.walletAddress, delegateAddress: s.delegateAddress, sessionActive: s.sessionActive ?? false }
  })
  const [busy, setBusy] = useState<string | null>(null)

  const authHeaders = (): Record<string, string> => sessionToken ? { 'Authorization': `Bearer ${sessionToken}` } : {}

  // ── MSCA / Passkey handlers ──
  const run = async (label: string, fn: () => Promise<any>) => {
    setBusy(label)
    try { return await fn() }
    catch (e: any) { setError(e?.message || String(e)); console.error('[msca]', e) }
    finally { setBusy(null) }
  }
  const registerMsca = async () => {
    const { walletAddress } = await registerPasskey()
    setMscaState(prev => ({ ...prev, walletAddress }))
  }
  const loginMsca = async () => {
    const { walletAddress } = await loginPasskey()
    setMscaState(prev => ({ ...prev, walletAddress }))
  }
  const setupSession = async () => {
    if (!sessionToken) throw new Error('Login dulu')
    const result = await setupSessionKey(sessionToken)
    setMscaState(prev => ({ ...prev, delegateAddress: result.delegateAddress, sessionActive: result.active }))
  }
  const revokeSession = async () => {
    if (!sessionToken) throw new Error('Login dulu')
    await revokeSessionKey(sessionToken)
    setMscaState(prev => ({ ...prev, sessionActive: false, delegateAddress: '' }))
  }

  // Clear a stale/invalid session so the deep-link auto-login can re-fire (or the
  // Sign-In wall appears). Backend session tokens are in-memory and die on every
  // backend restart, leaving localStorage holding a token the server rejects (401).
  const clearStaleSession = () => {
    localStorage.removeItem('arx_vault_token')
    autoLoginTried.current = false
    setSessionToken(null)
  }

  // Fetch a vault endpoint; on 401 clear the stale session and signal the caller.
  const vaultFetch = async (path: string, init?: RequestInit) => {
    const r = await fetch(`${API}${path}`, { ...(init || {}), headers: { ...(init?.headers || {}), ...authHeaders() } })
    if (r.status === 401) { clearStaleSession(); throw new Error('__SESSION_EXPIRED__') }
    return r.json()
  }

  const fetchAll = async () => {
    if (!sessionToken) return
    setLoading(true)
    setError(null)
    try {
      const [creds, lim, appr, act, sess] = await Promise.all([
        vaultFetch('/api/vault/credentials'),
        vaultFetch('/api/vault/limits'),
        vaultFetch('/api/vault/approvals'),
        vaultFetch('/api/vault/activity?limit=20'),
        vaultFetch('/api/vault/sessions'),
      ])
      setCredentials(creds.credentials || [])
      setLimits(lim.limits || { maxPerTx: 100, dailyLimit: 500, autoApprove: true, whitelist: [] })
      setApprovals(appr.approvals || [])
      setActivity(act.activity || [])
      setMcpSessions(sess.sessions || [])
    } catch (e: any) {
      if (e?.message !== '__SESSION_EXPIRED__') setError(e?.message || 'Gagal memuat vault')
    }
    setLoading(false)
  }

  // Auto-poll MCP sessions + approvals every 8s for live status.
  // Approvals must be polled: an agent (ChatGPT/Claude) can create a pending
  // approval while the user is looking at the page — without polling it never
  // appears until a manual reload.
  useEffect(() => {
    if (!sessionToken) return
    const poll = setInterval(async () => {
      try {
        const [s, appr, act] = await Promise.all([
          vaultFetch('/api/vault/sessions'),
          vaultFetch('/api/vault/approvals'),
          vaultFetch('/api/vault/activity?limit=20'),
        ])
        setMcpSessions(s.sessions || [])
        setApprovals(appr.approvals || [])
        setActivity(act.activity || [])
      } catch {}
    }, 8000)
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

  // WalletConnect login — for Chrome users without MetaMask extension
  const doWalletConnectLogin = async () => {
    const addr = await connectWalletConnect()
    if (!addr) return
    // Set WC provider as active EIP-1193 provider
    const wcProvider = getWalletConnectProviderSync()
    if (wcProvider) {
      // Inject WC provider into window.ethereum so siweLogin can use it
      ;(window as any).ethereum = wcProvider
    }
    // Now do SIWE login with WC-connected address
    setAuthLoading(true)
    if (isMobile()) {
      // On mobile, siweLogin sends personal_sign through WC relay.
      // Redirect user to wallet app to approve the signature.
      const loginPromise = siweLogin(addr)
      setTimeout(() => redirectToWalletForSign(), 1500)
      const token = await loginPromise
      if (token) {
        setSessionToken(token)
        localStorage.setItem('arx_vault_token', token)
      }
    } else {
      const token = await siweLogin(addr)
      if (token) {
        setSessionToken(token)
        localStorage.setItem('arx_vault_token', token)
      }
    }
    setAuthLoading(false)
  }

  // Passkey login — register or login with passkey, then get session token from backend
  const doPasskeyLogin = async () => {
    let walletAddress: string
    const existing = getMscaState()
    if (existing.walletAddress) {
      // Already have MSCA — login with existing passkey
      const result = await loginPasskey()
      walletAddress = result.walletAddress
    } else {
      // First time — register new passkey + create MSCA
      const result = await registerPasskey()
      walletAddress = result.walletAddress
    }
    // Get session token from backend (skip SIWE)
    const res = await fetch(`${API}/api/auth/passkey-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress }),
    })
    const data = await res.json()
    if (!data.success) throw new Error(data.error || 'Passkey login gagal')
    setSessionToken(data.token)
    localStorage.setItem('arx_vault_token', data.token)
  }

  // Restore session from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('arx_vault_token')
    if (saved) setSessionToken(saved)
  }, [])

  // Deep-link auto-login: when the user arrives from an agent link
  // (/plugin?tab=approvals&approval=...) with no active session, kick off SIWE
  // login automatically so the pending approval loads instead of a Sign-In wall.
  const autoLoginTried = useRef(false)
  useEffect(() => {
    if (deepLink && !sessionToken && address && !oauthParams && !autoLoginTried.current) {
      autoLoginTried.current = true
      doLogin()
    }
  }, [deepLink, sessionToken, address, oauthParams])

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

  // Approve = actually sign the transaction with MetaMask, then record the
  // result on the backend approval. Send/swap execute inline via the proven
  // browser signing paths (same code the Send/Swap panels use). Bridge is a
  // multi-step flow, so it hands off to the full Bridge page (prefilled).
  const [signingId, setSigningId] = useState<string | null>(null)
  const approve = async (a: Approval) => {
    if (!address) { setError('Wallet belum terhubung.'); return }
    setError(null)
    let details: any = {}
    try { details = a.details ? JSON.parse(a.details) : {} } catch {}

    // Bridge: hand off to the Bridge page with prefilled params. The user
    // completes the multi-step bridge (with MetaMask signing) there.
    if (a.action === 'bridge') {
      const fromChain = details.fromChain || 'Arc_Testnet'
      const toChain = details.toChain || a.to || 'Base_Sepolia'
      const params = new URLSearchParams({
        bridgeFrom: fromChain, bridgeTo: toChain,
        bridgeAmount: a.amount, bridgeToken: a.token || 'USDC',
        bridgeSource: a.source || 'eoa', approval: a.id,
      })
      window.location.href = `/arc-dex/bridge?${params.toString()}`
      return
    }

    setSigningId(a.id)
    try {
      let txHash = ''
      let explorerUrl = ''
      if (a.action === 'send') {
        if (!a.to) throw new Error('Alamat tujuan tidak ada pada permintaan.')
        const res = await sendTokenFromEoa({ from: address, to: a.to, token: a.token || 'USDC', amount: a.amount })
        txHash = res.txHash || ''
        explorerUrl = res.explorerUrl || ''
      } else if (a.action === 'swap') {
        const tokenOut = details.tokenOut || 'USDC'
        const res = await swapFromEoa({ metamaskAddress: address, tokenIn: a.token || 'USDC', tokenOut, amountIn: a.amount })
        txHash = res?.txHash || res?.transactionHash || ''
        explorerUrl = res?.explorerUrl || ''
      } else {
        throw new Error(`Aksi tidak dikenal: ${a.action}`)
      }
      // Record the signed tx on the backend approval (flips status → approved).
      try {
        await fetch(`${API}/api/vault/approvals/${a.id}/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ txHash, explorerUrl }),
        })
      } catch {}
      fetchAll()
    } catch (e: any) {
      // User rejected in MetaMask or tx failed — leave approval pending.
      const msg = e?.code === 4001 ? 'Tanda tangan dibatalkan di MetaMask.' : (e?.message || 'Transaksi gagal.')
      setError(msg)
    }
    setSigningId(null)
  }
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

  // ── OAuth approve flow: sign SIWE → get auth code → redirect back to ChatGPT ──
  const approveOAuth = async () => {
    if (!address || !oauthParams) return
    setOauthStatus('signing')
    try {
      // 1. Get SIWE challenge from MCP server
      const msgResp = await fetch(`${API}/api/auth/siwe-message?address=${address}&client_id=${oauthParams.client_id}`, { headers: authHeaders() })
      const msgData = await msgResp.json()
      if (!msgData.message) throw new Error('Gagal mendapat challenge')

      // 2. Sign with MetaMask
      const provider = (window as any).ethereum
      if (!provider) { setOauthStatus('error'); return }
      const accounts = await provider.request({ method: 'eth_requestAccounts' })
      const from = accounts[0]
      const signature = await provider.request({ method: 'personal_sign', params: [msgData.message, from] })
      setOauthStatus('approving')

      // 3. Verify → get auth code → redirect
      const codeResp = await fetch(`${API}/api/auth/siwe-verify`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: from, message: msgData.message, signature,
          clientId: oauthParams.client_id, redirectUri: oauthParams.redirect_uri,
          state: oauthParams.state, codeChallenge: oauthParams.code_challenge,
        })
      })
      const codeData = await codeResp.json()
      if (codeData.redirect) {
        setOauthStatus('done')
        window.location.href = codeData.redirect
        return
      }
      throw new Error(codeData.error || 'Gagal mendapat kode otorisasi')
    } catch (e: any) {
      setOauthStatus('error')
      setError(e?.message || 'OAuth approval gagal')
    }
  }

  // No address guard here — passkey/WalletConnect login handles auth without MetaMask

  // Not authenticated — show login
  if (!sessionToken) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className='glass' style={{ borderRadius: 12, padding: 24, textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🔐</div>
        <div style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Autentikasi Diperlukan</div>
        <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 16, lineHeight: 1.5 }}>
          Pilih metode login:<br/>
          Passkey (biometric) atau Sign-In with Wallet (MetaMask).
        </div>

        {/* Passkey login — no MetaMask needed */}
        <button onClick={() => run('passkey-login', doPasskeyLogin)} disabled={busy === 'passkey-login' || authLoading} style={{ width: '100%', padding: 12, borderRadius: 10, border: '1px solid rgba(74,222,128,0.4)', background: 'rgba(74,222,128,0.1)', color: '#4ade80', fontSize: 14, fontWeight: 600, cursor: 'pointer', marginBottom: 8 }}>
          {busy === 'passkey-login' ? 'Memproses...' : '🔐 Login dengan Passkey'}
        </button>

        <div style={{ color: '#64748b', fontSize: 11, margin: '8px 0' }}>atau</div>

        {/* WalletConnect — for Chrome without MetaMask */}
        {isWalletConnectAvailable() && (
          <button onClick={() => run('wc-login', doWalletConnectLogin)} disabled={busy === 'wc-login' || authLoading} style={{ width: '100%', padding: 12, borderRadius: 10, border: '1px solid rgba(34,197,94,0.4)', background: 'rgba(34,197,94,0.1)', color: '#22c55e', fontSize: 14, fontWeight: 600, cursor: 'pointer', marginBottom: 8 }}>
            {busy === 'wc-login' ? 'Memproses...' : '📱 WalletConnect (QR)'}
          </button>
        )}

        {/* SIWE login — MetaMask needed */}
        <button onClick={doLogin} disabled={authLoading || busy === 'passkey-login' || busy === 'wc-login'} style={{ width: '100%', padding: 12, borderRadius: 10, border: '1px solid rgba(99,102,241,0.4)', background: 'rgba(99,102,241,0.15)', color: '#818cf8', fontSize: 14, fontWeight: 600, cursor: authLoading ? 'wait' : 'pointer' }}>
          {authLoading ? 'Memproses...' : '🔓 Sign In with Wallet'}
        </button>
      </div>
    </div>
  )

  if (loading) return <div style={{ color: '#64748b', textAlign: 'center', padding: 40 }}>Memuat plugin...</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {error && <div style={{ color: '#f87171', fontSize: 12, padding: 10, background: 'rgba(239,68,68,0.1)', borderRadius: 8 }}>{error}</div>}

      {/* OAuth approval modal (from ChatGPT/Claude) */}
      {oauthParams && (
        <div className='glass' style={{ borderRadius: 12, padding: 20, marginBottom: 14, border: '1px solid rgba(99,102,241,0.3)', background: 'rgba(99,102,241,0.05)' }}>
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>🔌</div>
            <div style={{ color: '#e2e8f0', fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Permintaan Koneksi MCP</div>
            <div style={{ color: '#94a3b8', fontSize: 12 }}>AI agent ingin terhubung ke wallet ARCOX kamu</div>
          </div>
          <div style={{ background: 'rgba(18,18,26,0.6)', borderRadius: 8, padding: 10, marginBottom: 12 }}>
            <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>Agent:</div>
            <div style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>{oauthParams.client_id.startsWith('arcox_') ? 'ChatGPT / Claude' : oauthParams.client_id}</div>
            <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 8, marginBottom: 4 }}>Akses yang diminta:</div>
            <div style={{ color: '#e2e8f0', fontSize: 12 }}>• Lihat saldo wallet</div>
            <div style={{ color: '#e2e8f0', fontSize: 12 }}>• Request approval transaksi (dalam limit)</div>
            <div style={{ color: '#e2e8f0', fontSize: 12 }}>• Lihat credential vault</div>
          </div>
          <div style={{ color: '#f59e0b', fontSize: 11, marginBottom: 12, padding: '6px 10px', background: 'rgba(245,158,11,0.1)', borderRadius: 6 }}>
            ⚠️ Tanda tangan wallet diperlukan sebagai bukti kepemilikan. Kunci private kamu tidak pernah dikirim.
          </div>
          <button onClick={approveOAuth} disabled={oauthStatus === 'signing' || oauthStatus === 'approving' || oauthStatus === 'done'} style={{
            width: '100%', padding: 14, borderRadius: 10, border: 'none',
            background: 'linear-gradient(135deg, #6366f1, #818cf8)',
            color: '#fff', fontSize: 14, fontWeight: 700, cursor: oauthStatus === 'idle' ? 'pointer' : 'wait',
            opacity: oauthStatus === 'done' ? 0.5 : 1,
          }}>
            {oauthStatus === 'signing' ? '⏳ Menunggu tanda tangan MetaMask...' :
             oauthStatus === 'approving' ? '⏳ Memverifikasi...' :
             oauthStatus === 'done' ? '✅ Terhubung! Mengalihkan...' :
             oauthStatus === 'error' ? '❌ Gagal — Coba lagi' :
             '🔓 Setujui dengan Wallet'}
          </button>
          {oauthStatus === 'error' && (
            <button onClick={() => setOauthStatus('idle')} style={{ width: '100%', marginTop: 8, padding: 10, borderRadius: 8, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.1)', color: '#f87171', cursor: 'pointer', fontSize: 12 }}>Coba Lagi</button>
          )}
        </div>
      )}

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

      {/* Approvals — pending only */}
      <Section title='✅ Approvals' badge={approvals.filter(a => a.status === 'pending').length > 0 ? <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}>{approvals.filter(a => a.status === 'pending').length} menunggu</span> : undefined}>
        {approvals.filter(a => a.status === 'pending').length === 0 ? (
          <div style={{ color: '#64748b', fontSize: 12 }}>Tidak ada permintaan persetujuan.</div>
        ) : (
          approvals.filter(a => a.status === 'pending').map(a => (
            <div key={a.id} style={{ padding: '8px', background: a.id === highlightApproval ? 'rgba(245,158,11,0.12)' : 'rgba(18,18,26,0.6)', borderRadius: 8, marginBottom: 6, border: a.id === highlightApproval ? '1px solid rgba(245,158,11,0.6)' : '1px solid rgba(245,158,11,0.25)' }}>
              <div style={{ color: '#e2e8f0', fontSize: 12 }}>{a.agent}: {a.action} {a.amount} {a.token} {a.to ? `→ ${a.to.slice(0, 10)}...` : ''}</div>
              <div style={{ color: '#64748b', fontSize: 10 }}>Source: {a.source} · {fmtTime(a.createdAt)}</div>
              {a.action === 'bridge' && <div style={{ color: '#818cf8', fontSize: 10, marginTop: 4 }}>Bridge butuh beberapa langkah — Approve akan membuka halaman Bridge yang sudah terisi.</div>}
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <button onClick={() => approve(a)} disabled={signingId === a.id} style={{ flex: 1, background: 'rgba(16,185,129,0.15)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)', padding: '5px', borderRadius: 6, fontSize: 11, cursor: signingId === a.id ? 'wait' : 'pointer' }}>{signingId === a.id ? '⏳ Menunggu MetaMask...' : a.action === 'bridge' ? 'Approve & Buka Bridge' : 'Approve & Sign'}</button>
                <button onClick={() => reject(a.id)} disabled={signingId === a.id} style={{ flex: 1, background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)', padding: '5px', borderRadius: 6, fontSize: 11, cursor: 'pointer' }}>Reject</button>
              </div>
            </div>
          ))
        )}
      </Section>

      {/* Approval History — approved / rejected */}
      <Section title='📖 Riwayat Approval' badge={approvals.filter(a => a.status !== 'pending').length > 0 ? <span style={{ fontSize: 11, color: '#64748b' }}>{approvals.filter(a => a.status !== 'pending').length}</span> : undefined}>
        {approvals.filter(a => a.status !== 'pending').length === 0 ? (
          <div style={{ color: '#64748b', fontSize: 12 }}>Belum ada riwayat.</div>
        ) : (
          approvals
            .filter(a => a.status !== 'pending')
            .sort((x, y) => (y.approvedAt || y.createdAt) - (x.approvedAt || x.createdAt))
            .slice(0, 20)
            .map(a => {
              const ok = a.status === 'approved' || a.status === 'auto_approved'
              return (
                <div key={a.id} style={{ padding: '8px', background: 'rgba(18,18,26,0.6)', borderRadius: 8, marginBottom: 6, borderLeft: `3px solid ${ok ? '#10b981' : '#f87171'}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ color: '#e2e8f0', fontSize: 12 }}>{a.action} {a.amount} {a.token} {a.to ? `→ ${a.to.slice(0, 10)}...` : ''}</div>
                    <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: ok ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)', color: ok ? '#10b981' : '#f87171' }}>{a.status === 'auto_approved' ? 'auto' : a.status === 'approved' ? 'disetujui' : 'ditolak'}</span>
                  </div>
                  <div style={{ color: '#64748b', fontSize: 10 }}>{a.agent} · {fmtTime(a.approvedAt || a.createdAt)}</div>
                  {a.txHash && (
                    <a href={a.explorerUrl || `https://testnet.arcscan.app/tx/${a.txHash}`} target='_blank' rel='noreferrer' style={{ color: '#818cf8', fontSize: 10, textDecoration: 'none' }}>tx: {a.txHash.slice(0, 12)}... ↗</a>
                  )}
                </div>
              )
            })
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

      {/* Agent Wallet (MSCA + Passkey) */}
      <Section title='🔑 Agent Wallet' badge={mscaState.sessionActive ? <StatusDot on={true} label='Session aktif' /> : undefined}>
        {!mscaState.walletAddress ? (
          <div>
            <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 8 }}>
              Buat smart account (MSCA) dengan passkey. Agent bisa tx langsung di Claude/GPT tanpa MetaMask.
            </div>
            <button className='btn btn-primary' style={{ width: '100%' }} disabled={busy === 'register'} onClick={() => run('register', registerMsca)}>
              🔐 Buat dengan Passkey
            </button>
          </div>
        ) : (
          <div>
            <Row label='MSCA Address' value={<span style={{ fontFamily: 'monospace', fontSize: 11 }}>{mscaState.walletAddress?.slice(0, 10)}...{mscaState.walletAddress?.slice(-6)}</span>} />
            <Row label='Passkey' value={<span style={{ color: '#4ade80' }}>✓ Terdaftar</span>} />
            {mscaState.delegateAddress ? (
              <>
                <Row label='Delegate Key' value={<span style={{ fontFamily: 'monospace', fontSize: 11 }}>{mscaState.delegateAddress?.slice(0, 10)}...{mscaState.delegateAddress?.slice(-6)}</span>} />
                <Row label='Status' value={mscaState.sessionActive
                  ? <span style={{ color: '#4ade80' }}>● Aktif — Agent bisa tx langsung</span>
                  : <span style={{ color: '#f59e0b' }}>○ Nonaktif</span>
                } />
              </>
            ) : (
              <div style={{ marginTop: 8 }}>
                <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 8 }}>
                  Aktifkan session key agar agent bisa execute tx langsung di chat (gasless).
                </div>
                <button className='btn btn-primary' style={{ width: '100%' }} disabled={busy === 'session'} onClick={() => run('session', setupSession)}>
                  🔑 Aktifkan Session Key
                </button>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              {mscaState.sessionActive && (
                <button className='btn' style={{ flex: 1, background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' }} disabled={busy === 'revoke'} onClick={() => run('revoke', revokeSession)}>
                  Cabut Akses
                </button>
              )}
              <button className='btn' style={{ flex: 1 }} disabled={busy === 'login'} onClick={() => run('login', loginMsca)}>
                🔐 Login Passkey
              </button>
            </div>
          </div>
        )}
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
