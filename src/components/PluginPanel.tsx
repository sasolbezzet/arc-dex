import { useEffect, useRef, useState } from 'react'
import { sendTokenFromEoa } from '../services/eoaTransactions'
import { swapFromEoa } from '../services/swapService'
import { registerPasskey, loginPasskey, deploySmartAccount, setupSessionKey, revokeSessionKey, getMscaState, signPendingTx, registerDelegateOwner } from '../services/modularWallet'
import { MultiChainBalances } from './MultiChainBalances'
import { connectWalletConnect, getWalletConnectProviderSync, isMobile } from '../services/walletConnect'
import { findConnectedWalletProvider } from '../walletProvider'

type Credential = { id: string; type: 'eoa' | 'circle' | 'solana' | 'api_key'; label: string; value: string }
type Approval = { id: string; agent: string; action: string; amount: string; token: string; source: string; to: string; status: string; createdAt: number; approvedAt?: number; txHash?: string; explorerUrl?: string; details?: string }
type Limits = { maxPerTx: number; dailyLimit: number; autoApprove: boolean; whitelist: string[] }
type Activity = { id: string; type: string; data: any; ts: number }
type McpSession = { clientId: string; agent: string; connectedAt: number; lastActivity: number; active: boolean }
type PendingTx = { txId: string; walletAddress: string; calls: Array<{ to: string; data: string; value: string }>; chainKey: string; paymaster: boolean; status: string; createdAt: number }

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

    // 2. Request signature — works with MetaMask, WalletConnect, or any injected provider.
    const provider = await findConnectedWalletProvider(address)
    if (!provider) { alert('Wallet tidak terdeteksi. Connect wallet terlebih dahulu.'); return null }
    const accounts = await provider.request({ method: 'eth_accounts' }) as string[]
    const from = accounts?.[0]
    if (!from || from.toLowerCase() !== address.toLowerCase()) {
      throw new Error('Wallet terhubung berbeda dari wallet utama ARCOX.')
    }
    const signature = await provider.request({ method: 'personal_sign', params: [ch.message, from] }) as string

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
  const [pendingTxs, setPendingTxs] = useState<PendingTx[]>([])
  const [sessionToken, setSessionToken] = useState<string | null>(null)
  const [authLoading, setAuthLoading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newWhitelist, setNewWhitelist] = useState('')
  const [mscaState, setMscaState] = useState<{ walletAddress?: string; delegateAddress?: string; sessionActive: boolean; deployed?: boolean }>(() => {
    const s = getMscaState()
    return { walletAddress: s.walletAddress, delegateAddress: s.delegateAddress, sessionActive: s.sessionActive ?? false, deployed: s.deployed }
  })
  const [busy, setBusy] = useState<string | null>(null)

  const authHeaders = (): Record<string, string> => sessionToken ? { 'Authorization': `Bearer ${sessionToken}` } : {}

  // ── MSCA / Passkey handlers ──
  const run = async (label: string, fn: () => Promise<any>) => {
    setBusy(label)
    try { return await fn() }
    catch (e: any) {
      const msg = e?.message || String(e)
      // WebAuthn errors need user-friendly hints
      if (msg.includes('timed out') || msg.includes('not allowed') || msg.includes('NotSupportedError')) {
        setError('Passkey tidak tersedia. Pastikan Windows Hello / Touch ID / security key sudah aktif di perangkat Anda, lalu coba lagi. Atau gunakan "Sign In with Wallet" sebagai alternatif.')
      } else if (msg.includes('Cannot find the entity config')) {
        setError('Konfigurasi Circle belum lengkap. Hubungi admin.')
      } else {
        setError(msg)
      }
      console.error('[msca]', e)
    }
    finally { setBusy(null) }
  }
  const passkeySessionToken = async (walletAddress: string) => {
    const res = await fetch(`${API}/api/auth/passkey-login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress }),
    })
    const data = await res.json()
    if (!data.success || !data.token) throw new Error(data?.error || 'Passkey login gagal')
    setSessionToken(data.token)
    localStorage.setItem('arx_vault_token', data.token)
    return data.token
  }
  const autoActivateSession = async (walletAddress: string, eoaAddress?: string) => {
    // Ensure a vault session token for this MSCA, then (re)activate its session
    // key. Backend `storeSessionKey` auto-revokes any other active MSCA owned by
    // the same identity (ownerAddress/EURO), so the selected one becomes the
    // single active session and the rest turn off automatically.
    const token = await passkeySessionToken(walletAddress)
    if (!token) throw new Error('Passkey token gagal')
    const result = await setupSessionKey(token, eoaAddress)
    // Deploy MSCA if not yet deployed — pass delegate address so addOwners is included
    const alreadyDeployed = getMscaState().deployed
    if (!alreadyDeployed) {
      await deploySmartAccount(result.delegateAddress)
    }
    // Register delegate as on-chain owner via recovery mechanism (ONE-TIME)
    // After this, backend can sign all transactions automatically
    await registerDelegateOwner(result.delegateAddress)
    setMscaState(prev => ({
      ...prev, walletAddress, delegateAddress: result.delegateAddress, sessionActive: result.active, deployed: true,
    }))
    return token
  }
  const registerMsca = async () => {
    const existing = getMscaState()
    if (existing.walletAddress) {
      // MSCA sudah terkunci — jangan buat baru tanpa konfirmasi eksplisit.
      throw new Error('Agent Wallet sudah ada. Gunakan "Login Passkey". Buat wallet baru hanya via "Buat Wallet Baru" yang menyertakan konfirmasi, karena dana wallet lama tidak berpindah.')
    }
    const { walletAddress } = await registerPasskey()
    // Flow: setupSessionKey (generate delegate) → deploySmartAccount (deploy + addOwners)
    // Backend generates delegate EOA, then frontend deploys MSCA with delegate as owner.
    await autoActivateSession(walletAddress, address ?? undefined)
  }
  const forceRegisterMsca = async () => {
    // Perlu konfirmasi eksplisit dari user di tombol: dana wallet lama tidak pindah.
    const { walletAddress } = await registerPasskey()
    await autoActivateSession(walletAddress, address ?? undefined)
  }
  const loginMsca = async () => {
    // Login Passkey (WebAuthn) → pilih passkey/MSCA yang telah terdaftar di device.
    // MSCA yang dipilih otomatis jadi session key aktif; yang lain di-off.
    const { walletAddress } = await loginPasskey()
    await autoActivateSession(walletAddress, address ?? undefined)
  }
  const setupSession = async () => {
    if (!sessionToken) {
      // Auto-login: sign SIWE message to get vault session before session key setup.
      if (!address) throw new Error('Wallet belum terhubung')
      const token = await siweLogin(address)
      if (!token) throw new Error('Login vault gagal. Tanda tangan wallet diperlukan.')
      setSessionToken(token)
      localStorage.setItem('arx_vault_token', token)
      const result = await setupSessionKey(token, address)
      setMscaState(prev => ({ ...prev, delegateAddress: result.delegateAddress, sessionActive: result.active, deployed: prev.deployed }))
      return
    }
    const result = await setupSessionKey(sessionToken, address)
    setMscaState(prev => ({ ...prev, delegateAddress: result.delegateAddress, sessionActive: result.active, deployed: prev.deployed }))
  }
  const revokeSession = async () => {
    if (!sessionToken) throw new Error('Login vault gagal')
    await revokeSessionKey(sessionToken)
    setMscaState(prev => ({ ...prev, sessionActive: false, delegateAddress: '', deployed: prev.deployed }))
  }

  const approvePendingTx = async (tx: PendingTx) => {
    const result = await signPendingTx(tx.txId, tx.calls, tx.chainKey)
    // Remove from pending list immediately
    setPendingTxs(prev => prev.filter(t => t.txId !== tx.txId))
    if (result.error) throw new Error(result.error)
    return result
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

  // Auto-poll MCP sessions + approvals + pending txs every 8s for live status.
  // Approvals must be polled: an agent (ChatGPT/Claude) can create a pending
  // approval while the user is looking at the page — without polling it never
  // appears until a manual reload.
  useEffect(() => {
    if (!sessionToken) return
    const poll = setInterval(async () => {
      try {
        const [s, appr, act, txs] = await Promise.all([
          vaultFetch('/api/vault/sessions'),
          vaultFetch('/api/vault/approvals'),
          vaultFetch('/api/vault/activity?limit=20'),
          vaultFetch('/api/pending-txs').catch(() => ({ txs: [] })),
        ])
        setMcpSessions(s.sessions || [])
        setApprovals(appr.approvals || [])
        setActivity(act.activity || [])
        setPendingTxs((txs.txs || []).filter((t: PendingTx) => t.status === 'pending'))
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
      const token = await siweLogin(addr)
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
    // Deploy if needed — get delegate address first via setupSessionKey
    if (!getMscaState().deployed) {
      const result = await setupSessionKey(data.token, undefined)
      await deploySmartAccount(result.delegateAddress)
      await registerDelegateOwner(result.delegateAddress)
    }
  }

  // Poll backend session-key status so the indicator reflects the server truth,
  // not just the last local saveState (localStorage can be stale after a failed
  // setup or a backend-side revoke).
  const refreshSessionStatus = async () => {
    if (!sessionToken) return
    try {
      const r = await fetch(`${API}/api/session/status`, { headers: authHeaders() })
      if (r.status === 401) { clearStaleSession(); return }
      const data = await r.json()
      const info = data?.session || null
      const active = Boolean(info && info.active)
      setMscaState(prev => ({
        walletAddress: prev.walletAddress,
        delegateAddress: info?.delegateAddress || prev.delegateAddress || '',
        sessionActive: active,
        deployed: prev.deployed,
      }))
    } catch { /* ignore transient network errors */ }
  }
  useEffect(() => {
    if (!sessionToken) return
    refreshSessionStatus()
    const poll = setInterval(refreshSessionStatus, 8000)
    return () => clearInterval(poll)
  }, [sessionToken])

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

      // 2. Sign with the already-connected wallet provider.
      // Do not use window.ethereum: on mobile it can trigger an unintended app switch.
      const provider = await findConnectedWalletProvider(address)
      if (!provider) {
        throw new Error('Wallet utama tidak terdeteksi. Hubungkan wallet di halaman ARCOX terlebih dahulu.')
      }
      const accounts = await provider.request({ method: 'eth_accounts' })
      const from = accounts?.[0]
      if (!from || from.toLowerCase() !== address.toLowerCase()) {
        throw new Error('Wallet terhubung berbeda dari wallet utama ARCOX.')
      }
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

  // Wallet utama adalah identitas Plugin. Tidak ada login kedua di sini.
  if (!address) return (
    <div className='glass' style={{ borderRadius: 12, padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
      Hubungkan wallet utama untuk membuka Plugin.
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
          <li>ChatGPT: Settings → Connectors → Add custom connector. Claude: Settings → Connectors → Add custom connector.</li>
          <li>Paste MCP URL di atas</li>
          <li>OAuth: pilih Dynamic Client Registration (DCR)</li>
          <li>Atau manual: Auth URL = <code style={{fontSize:10,color:'#818cf8'}}>{AUTH_URL}</code>, Token URL = <code style={{fontSize:10,color:'#818cf8'}}>{SERVER_URL}/api/auth/token</code></li>
          <li>Setelah connect, setujui dengan tanda tangan wallet di halaman auth.</li>
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
      <Section title='🔑 Agent Wallet' badge={
        mscaState.walletAddress
          ? (mscaState.sessionActive ? <StatusDot on={true} label={mscaState.deployed ? 'Deployed & aktif' : 'Session aktif'} /> : <StatusDot on={false} label='Session belum aktif' />)
          : undefined
      }>
        {!mscaState.walletAddress ? (
          <div>
            <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 8 }}>
              Buat smart account (MSCA) dengan passkey. Login Plugin tanpa MetaMask; transaksi chat tetap mengikuti limit dan otorisasi MCP.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className='btn btn-primary' style={{ flex: 1 }} disabled={busy === 'login'} onClick={() => run('login', loginMsca)}>
                🔐 Login Passkey
              </button>
              <button className='btn' style={{ flex: 1, border: '1px solid #1e1e2e' }} disabled={busy === 'register'} onClick={() => run('register', registerMsca)}>
                ✨ Buat Baru
              </button>
            </div>
          </div>
        ) : (
          <div>
            <Row label='MSCA Address' value={<span style={{ fontFamily: 'monospace', fontSize: 11 }}>{mscaState.walletAddress?.slice(0, 10)}...{mscaState.walletAddress?.slice(-6)}</span>} />
            <Row label='Passkey' value={<span style={{ color: '#4ade80' }}>✓ Terdaftar</span>} />
            <Row label='Contract' value={mscaState.deployed
              ? <span style={{ color: '#4ade80' }}>✓ Deployed</span>
              : <span style={{ color: '#f59e0b' }}>○ Belum deployed</span>
            } />
            {mscaState.delegateAddress ? (
              <>
                <Row label='Delegate Key' value={<span style={{ fontFamily: 'monospace', fontSize: 11 }}>{mscaState.delegateAddress?.slice(0, 10)}...{mscaState.delegateAddress?.slice(-6)}</span>} />
                <Row label='Status' value={mscaState.sessionActive
                  ? <span style={{ color: '#4ade80' }}>● Aktif — transfer dalam limit</span>
                  : <span style={{ color: '#f59e0b' }}>○ Nonaktif</span>
                } />
              </>
            ) : (
              <div style={{ marginTop: 8 }}>
                <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 8 }}>
                  Aktifkan session key untuk transfer yang diizinkan. Swap session belum tersedia sampai calldata router diverifikasi.
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
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #1e1e2e' }}>
              <div style={{ color: '#64748b', fontSize: 11, marginBottom: 6 }}>
                Ganti ke Agent Wallet baru? Membuat wallet baru menghasilkan alamat baru — dana dan izin wallet lama TIDAK berpindah otomatis.
              </div>
              <button className='btn' style={{ width: '100%', border: '1px solid rgba(239,68,68,0.4)', color: '#fca5a5', background: 'rgba(239,68,68,0.08)' }} disabled={busy === 'register'} onClick={async () => {
                if (!window.confirm('Buat Agent Wallet MSCA baru?\n\nWallet baru mendapat alamat baru. Dana dan izin wallet lama TIDAK berpindah otomatis. Lanjutkan?')) return
                run('register', forceRegisterMsca)
              }}>
                🆕 Buat Wallet Baru (ganti MSCA)
              </button>
            </div>
          </div>
        )}
      </Section>

      {/* Multi-chain Agent Wallet Balances */}
      {mscaState.walletAddress && (
        <Section title='💰 Agent Wallet Balances'>
          <MultiChainBalances walletAddress={mscaState.walletAddress} />
        </Section>
      )}

      {/* Pending Transactions (passkey approval) */}
      {pendingTxs.length > 0 && (
        <Section title='⏳ Transaksi Menunggu Persetujuan' badge={<span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}>{pendingTxs.length}</span>}>
          {pendingTxs.map(tx => (
            <div key={tx.txId} style={{ padding: '8px 0', borderBottom: '1px solid #1e1e2e' }}>
              <div style={{ fontSize: 12, color: '#e2e8f0', marginBottom: 4 }}>
                <span style={{ color: '#f59e0b' }}>Agent minta transaksi</span>
                <span style={{ color: '#64748b', marginLeft: 8 }}>{fmtTime(tx.createdAt)}</span>
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'monospace', marginBottom: 6 }}>
                {tx.calls.length} call · {tx.chainKey}
              </div>
              <button
                className='btn btn-primary'
                style={{ width: '100%', fontSize: 12 }}
                disabled={busy === `pending-${tx.txId}`}
                onClick={async () => {
                  try {
                    setBusy(`pending-${tx.txId}`)
                    setError(null)
                    const result = await approvePendingTx(tx)
                    if (result.txHash) alert(`Transaksi berhasil!\n${result.explorerUrl}`)
                  } catch (e: any) {
                    setError(e?.message || 'Gagal menandatangani')
                  } finally { setBusy(null) }
                }}
              >
                {busy === `pending-${tx.txId}` ? 'Menandatangani...' : '🔐 Approve dengan Passkey'}
              </button>
            </div>
          ))}
        </Section>
      )}

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
