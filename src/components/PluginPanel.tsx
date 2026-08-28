import { useEffect, useRef, useState } from 'react'
import { sendTokenFromEoa } from '../services/eoaTransactions'
import { swapFromEoa } from '../services/swapService'
import { registerPasskey, loginPasskey, deployAllSmartAccounts, deploySmartAccountOnChain, registerDelegateOwner, setupSessionKey, revokeSessionKey, getMscaState, getDeploymentStatus, signPendingTx } from '../services/modularWallet'
import { MultiChainBalances } from './MultiChainBalances'
import { AgentWalletList, type AgentWalletEntry } from './AgentWalletList'
import { connectWalletConnect, disconnectWalletConnect, getWalletConnectProviderSync, isMobile, isWalletConnectAvailable, redirectToWalletForSign, resumeWalletConnect } from '../services/walletConnect'
import { findConnectedWalletProvider } from '../walletProvider'
import { useI18n } from '../i18n'
import { createAgentConnectionToken, createBootstrapConnectionToken, getAgentActivity, getAgentCards, linkCardToAgent, listVaultAgents, listVaultCards, revokeVaultAgent, unlinkCardFromAgent, type AgentActivityEntry, type AgentConnectionToken, type LinkedAgentCard, type OwnerAgentCard, type VaultAgent } from '../vaultAgentsApi'

type Credential = { id: string; type: 'eoa' | 'circle' | 'solana' | 'api_key'; label: string; value: string }
type Approval = { id: string; agent: string; action: string; amount: string; token: string; source: string; to: string; status: string; createdAt: number; approvedAt?: number; txHash?: string; explorerUrl?: string; details?: string }
type Limits = { maxPerTx: number; dailyLimit: number; autoApprove: boolean; whitelist: string[] }
type Activity = { id: string; type: string; data: any; ts: number }
type McpSession = { clientId: string; agent: string; connectedAt: number; lastActivity: number; active: boolean }
type AgentDetails = { activity: AgentActivityEntry[]; cards: LinkedAgentCard[] }
type AgentCardDraft = { cardId: string; maxPerTx: string; daily: string }
type PendingTx = { txId: string; walletAddress: string; calls: Array<{ to: string; data: string; value: string }>; chainKey: string; paymaster: boolean; status: string; createdAt: number }

const API = ''
// Use the public web origin in the user-facing setup instructions. Vercel
// forwards this route to the non-Vercel backend without exposing its VPS URL.
const MCP_URL = 'https://arcoxdex.vercel.app/mcp'

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

// WalletConnect disconnect can itself wait on a dead relay. Never await that
// cleanup before updating the UI: otherwise a completed/expired signature can
// leave the OAuth card forever on "Menunggu persetujuan wallet".
function cleanupWalletConnectInBackground(t: ReturnType<typeof useI18n>['t']) {
  if (!isMobile() || !getWalletConnectProviderSync()) return
  void withTimeout(
    disconnectWalletConnect(),
    4_000,
    t('plugin.relayTimeout'),
  ).catch(() => {})
}

const Section = ({ title, children, badge, style }: { title: string; children: React.ReactNode; badge?: React.ReactNode; style?: React.CSSProperties }) => (
  <div className='glass' style={{ borderRadius: 12, padding: 14, marginBottom: 14, ...style }}>
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

const StatusDot = ({ on, label }: { on: boolean; label: string }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, padding: '2px 8px', borderRadius: 4, background: on ? 'rgba(16,185,129,0.15)' : 'rgba(100,116,139,0.1)', color: on ? '#10b981' : '#64748b' }}>
    <span style={{ width: 6, height: 6, borderRadius: '50%', background: on ? '#10b981' : '#64748b', boxShadow: on ? '0 0 6px #10b981' : 'none' }} />
    {label}
  </span>
)

// 🔐 SIWE login button
async function siweLogin(address: string, t: ReturnType<typeof useI18n>['t']): Promise<string | null> {
  try {
    // 1. Get challenge
    const ch = await fetch(`${API}/api/vault/challenge`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address })
    }).then(r => r.json())
    if (!ch.message) return null

    // 2. Request signature — works with MetaMask, WalletConnect, or any injected provider.
    const provider = await findConnectedWalletProvider(address)
    if (!provider) { alert(t('plugin.walletNotDetected')); return null }
    const accounts = await provider.request({ method: 'eth_accounts' }) as string[]
    const from = accounts?.[0]
    if (!from || from.toLowerCase() !== address.toLowerCase()) {
      throw new Error(t('plugin.walletDifferent'))
    }
    const signature = await provider.request({ method: 'personal_sign', params: [ch.message, from] }) as string

    // 3. Verify → get session token
    const verify = await fetch(`${API}/api/vault/verify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: from, message: ch.message, signature })
    }).then(r => r.json())
    if (!verify.token) { alert(`${t('plugin.verifyFailed')}: ${verify.error || t('plugin.unknown')}`); return null }
    return verify.token
  } catch (e: any) {
    alert(`${t('plugin.loginFailed')}: ${e?.message || e}`)
    return null
  }
}

export function PluginPanel({ address, circleWallet, solanaAddress }: { address: string | null; circleWallet: { id: string; address: string } | null; solanaAddress: string | null }) {
  const { t } = useI18n()
  // OAuth approval for Claude/ChatGPT stays available whenever the browser was
  // redirected here with ?auth=mcp&…; only the ambient Hermes guidance was
  // removed. Without parsing these params the connector approval never shows.
  const [oauthParams, setOauthParams] = useState<{ request_id: string; client_id: string; redirect_uri: string; state: string; code_challenge: string } | null>(null)
  // RFC 8628 device pairing (Hermes on a headless VPS): the agent shows a
  // short user code that the user enters here; approval binds the same SIWE +
  // passkey identity as the loopback flow without any redirect URL.
  const [deviceUserCode, setDeviceUserCode] = useState<string | null>(null)
  const [deviceClientName, setDeviceClientName] = useState<string>('')
  // Device approval must make the wallet target explicit. The Passkey result
  // is still the source of truth; this choice is checked against it below.
  const [deviceWalletChoice, setDeviceWalletChoice] = useState<string>('new')
  // OAuth approval has two deliberate signing steps: the passkey binds the
  // Agent Wallet, then the connected EOA signs SIWE for the MCP identity. Keep
  // these phases separate so the UI never says "wallet" while WebAuthn is open.
  const [oauthStatus, setOauthStatus] = useState<'idle' | 'passkey' | 'checking' | 'wallet' | 'approving' | 'done' | 'error'>('idle')
  const [, setOauthPasskeyMode] = useState<'Login' | 'Register'>('Login')
  const [deepLink, setDeepLink] = useState(false)
  const [highlightApproval, setHighlightApproval] = useState<string | null>(null)
  const oauthAttempt = useRef(0)
  // Device pairing: keep the SIWE challenge + MSCA binding in refs so the
  // "Sudah tanda tangan? Lanjutkan" button can re-drive the wallet signature
  // without re-running the passkey/session phases.
  const deviceMessageRef = useRef('')
  const deviceMessageHexRef = useRef('')
  const deviceMscaWalletRef = useRef('')
  const deviceMscaTokenRef = useRef('')
  const deviceWalletChoiceInitialized = useRef(false)

  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    // Claude/ChatGPT connector: the agent redirects the user here with
    // ?auth=mcp&request_id=… to run the passkey + SIWE approval.
    if (p.get('auth') === 'mcp' && p.get('request_id') && p.get('client_id') && p.get('redirect_uri')) {
      setOauthParams({
        request_id: p.get('request_id') || '',
        client_id: p.get('client_id') || '',
        redirect_uri: p.get('redirect_uri') || '',
        state: p.get('state') || '',
        code_challenge: p.get('code_challenge') || '',
      })
    }
    if (p.get('auth') === 'device' && p.get('user_code')) {
      const userCode = p.get('user_code') || ''
      setDeviceUserCode(userCode)
      fetch(`${API}/api/auth/device/status?user_code=${encodeURIComponent(userCode)}`)
        .then(r => r.json())
        .then(d => { if (d?.clientName) setDeviceClientName(String(d.clientName)) })
        .catch(() => { /* status is cosmetic; approve reports real errors */ })
    }
    // Deep-link from the AI agent: /plugin?tab=approvals&approval=<id>
    // Highlight the referenced approval so the user lands right on it.
    if (p.get('approval')) {
      setHighlightApproval(p.get('approval'))
      setDeepLink(true)
    }
    if (p.get('tab') === 'approvals') setDeepLink(true)
  }, [])
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [approvals, setApprovals] = useState<Approval[]>([])
  const [limits, setLimits] = useState<Limits>({ maxPerTx: 100, dailyLimit: 500, autoApprove: true, whitelist: [] })
  const [activity, setActivity] = useState<Activity[]>([])
  const [mcpSessions, setMcpSessions] = useState<McpSession[]>([])
  const [pendingTxs, setPendingTxs] = useState<PendingTx[]>([])
  const [sessionToken, setSessionTokenState] = useState<string | null>(null)
  const sessionTokenRef = useRef<string | null>(null)
  const setSessionToken = (token: string | null) => {
    sessionTokenRef.current = token
    setSessionTokenState(token)
  }
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newWhitelist, setNewWhitelist] = useState('')
  const [mscaState, setMscaState] = useState<{ walletAddress?: string; delegateAddress?: string; sessionActive: boolean; deployed?: boolean; deploymentStatus?: Record<string, { status: 'deployed' | 'failed' | 'unsupported'; error?: string; userOpHash?: string; authorizationUserOpHash?: string; authorizationDelegateAddress?: string; authorizationStatus?: 'pending' | 'authorized' | 'failed'; authorizationError?: string; updatedAt: number }>; chainAuthorizationStatus?: Record<string, 'authorized' | 'failed'> }>(() => {
    const s = getMscaState()
    return { walletAddress: s.walletAddress, delegateAddress: s.delegateAddress, sessionActive: s.sessionActive ?? false, deployed: s.deployed, deploymentStatus: s.deploymentStatus, chainAuthorizationStatus: undefined }
  })
  const [busy, setBusy] = useState<string | null>(null)
  const [destinationReady, setDestinationReady] = useState(false)
  const [vaultAgents, setVaultAgents] = useState<VaultAgent[]>([])
  const [ownerCards, setOwnerCards] = useState<OwnerAgentCard[]>([])
  const [agentDetails, setAgentDetails] = useState<Record<string, AgentDetails>>({})
  const [agentCardDrafts, setAgentCardDrafts] = useState<Record<string, AgentCardDraft>>({})
  const [expandedAgentKey, setExpandedAgentKey] = useState<string | null>(null)
  const [connectionToken, setConnectionToken] = useState<AgentConnectionToken | null>(null)
  const [agentAction, setAgentAction] = useState<string | null>(null)
  const [bootstrapAgentName, setBootstrapAgentName] = useState('Hermes Agent')

  // Load owner-visible bindings when a device approval is opened in a fresh
  // tab. This is cosmetic discovery only; every selected wallet is verified by
  // the Passkey ceremony and backend session check before approval.
  useEffect(() => {
    if (!deviceUserCode) {
      deviceWalletChoiceInitialized.current = false
      setDeviceWalletChoice('new')
      return
    }
    if (!deviceWalletChoiceInitialized.current) {
      deviceWalletChoiceInitialized.current = true
      setDeviceWalletChoice(mscaState.walletAddress || 'new')
    }
    const token = localStorage.getItem('arx_passkey_vault_token') || localStorage.getItem('arx_vault_token') || ''
    if (token) void listVaultAgents(token).then(setVaultAgents).catch(() => {})
  }, [deviceUserCode, mscaState.walletAddress])

  const deviceWalletOptions = Array.from(new Map([
    ...(mscaState.walletAddress ? [{ walletAddress: mscaState.walletAddress, agents: [] as VaultAgent[] }] : []),
    ...vaultAgents.map(agent => ({ walletAddress: agent.walletAddress, agents: [agent] })),
  ].filter(item => item.walletAddress).map(item => {
    const key = item.walletAddress.toLowerCase()
    const existing = (vaultAgents.filter(agent => agent.walletAddress.toLowerCase() === key))
    return [key, { walletAddress: item.walletAddress, agents: existing }]
  })).values())

  // "1 wallet = 1 agent" overview: every Agent Wallet is labeled with the
  // agent that owns it and stays visible no matter which passkey session is
  // active in this browser. The active browser wallet is appended when it is
  // not bound to an agent yet (freshly created, awaiting first connection).
  const agentWalletEntries: AgentWalletEntry[] = vaultAgents.map(agent => ({
    address: agent.walletAddress,
    label: agent.clientName || agent.agentKey.split('|')[0] || t('plugin.mcpAgent'),
    live: mcpSessions.some(s => s.active && s.clientId === agent.agentKey.split('|')[0]),
  }))
  if (mscaState.walletAddress && !agentWalletEntries.some(w => w.address.toLowerCase() === mscaState.walletAddress!.toLowerCase())) {
    agentWalletEntries.push({ address: mscaState.walletAddress, label: t('plugin.walletBrowserActive'), live: false })
  }

  const authHeaders = (): Record<string, string> => sessionToken ? { 'Authorization': `Bearer ${sessionToken}` } : {}

  // ── MSCA / Passkey handlers ──
  const run = async (label: string, fn: () => Promise<any>) => {
    setBusy(label)
    try { return await fn() }
    catch (e: any) {
      const msg = e?.message || String(e)
      // WebAuthn errors are normalized by modularWallet.ts. Do not classify
      // every generic RPC/network error as "passkey unavailable"; that hides
      // the actual Circle error and makes bridge/login debugging impossible.
      if (/Passkey (hanya|membutuhkan|dibatalkan|tidak dapat|tidak menyediakan)/i.test(msg)) {
        setError(msg)
      } else if (msg.includes('Cannot find the entity config')) {
        setError(t('plugin.circleConfigIncomplete'))
      } else {
        setError(msg)
      }
      console.error('[msca]', e)
    }
    finally { setBusy(null) }
  }
  const authorizeDelegateOnChain = async (chainKey: 'base-sepolia' | 'arbitrum-sepolia', walletAddress: string, delegateAddress: string, token: string) => {
    // registerDelegateOwner sends a single addOwners UserOperation that both
    // deploys the deterministic MSCA (first UserOp carries factory initCode)
    // and adds the delegate owner, so no separate deployment is required.
    let authorization
    try {
      authorization = await registerDelegateOwner(delegateAddress, chainKey, token)
    } catch (error: any) {
      throw new Error(`${chainKey}: authorization UserOp gagal: ${error?.message || 'unknown error'}`)
    }
    if (!authorization.success || !authorization.userOpHash) throw new Error(`${chainKey}: authorization UserOp tidak tersedia`)
    const response = await fetch(`${API}/api/session/authorize-chain`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ walletAddress, delegateAddress, chainKey, authorizationUserOpHash: authorization.userOpHash }),
    })
    const data = await response.json()
    if (!response.ok || !data.success) throw new Error(`${chainKey}: ${data.error || 'verifikasi authorization gagal'}`)
    return data
  }

  const autoActivateSession = async (walletAddress: string, eoaAddress?: string, existingToken?: string) => {
    // Login activation: one addOwners UserOp on Arc deploys the MSCA and
    // authorizes the delegate in a single operation, then activates the
    // session. Base and Arbitrum are prepared immediately afterwards in the
    // same flow (one UserOp each), so the agent wallet is usable everywhere.
    const token = existingToken
    if (!token) throw new Error(t('plugin.passkeyTokenFailed'))

    // Binding an EOA is optional. Only send ownerAddress when this browser has
    // a separate SIWE proof; the passkey/MSCA token is never an EOA proof.
    const ownerSessionToken = eoaAddress ? localStorage.getItem('arx_eoa_vault_token') || undefined : undefined
    const verifiedEoaAddress = ownerSessionToken ? eoaAddress : undefined

    // Arc: reserve delegate + addOwners (deploy+authorize) + backend setup.
    const result = await setupSessionKey(token, verifiedEoaAddress, ownerSessionToken)
    setMscaState(prev => ({
      ...prev,
      walletAddress,
      delegateAddress: result.delegateAddress,
      sessionActive: result.active,
      deployed: true,
      deploymentStatus: getDeploymentStatus(),
      chainAuthorizationStatus: { 'arc-testnet': 'authorized' },
    }))

    // Prepare destination chains automatically. Best-effort: a destination
    // failure must never deactivate the Arc session that MCP relies on.
    const chainAuthorizationStatus: Record<string, 'authorized' | 'failed'> = { 'arc-testnet': 'authorized' }
    const errors: string[] = []
    for (const chainKey of ['base-sepolia', 'arbitrum-sepolia'] as const) {
      try {
        await authorizeDelegateOnChain(chainKey, walletAddress, result.delegateAddress, token)
        chainAuthorizationStatus[chainKey] = 'authorized'
      } catch (error: any) {
        chainAuthorizationStatus[chainKey] = 'failed'
        errors.push(error?.message || `${chainKey}: authorization gagal`)
      }
    }
    setMscaState(prev => ({ ...prev, deploymentStatus: getDeploymentStatus(), chainAuthorizationStatus }))
    if (errors.length) setError(`Deployment/authorization belum lengkap: ${errors.join('; ')}`)
    return token
  }
  const registerMsca = async () => {
    const existing = getMscaState()
    if (existing.walletAddress) {
      // MSCA sudah terkunci — jangan buat baru tanpa konfirmasi eksplisit.
      throw new Error('Agent Wallet sudah ada. Gunakan "Login Passkey". Buat wallet baru hanya via "Buat Wallet Baru" yang menyertakan konfirmasi, karena dana wallet lama tidak berpindah.')
    }
    const { walletAddress, sessionToken } = await registerPasskey()
    // Publish the newly derived MSCA before setting the token. Token polling
    // starts immediately and must not persist an intermediate empty address.
    setMscaState(prev => ({ ...prev, walletAddress, sessionActive: false }))
    setSessionToken(sessionToken)
    localStorage.setItem('arx_vault_token', sessionToken)
    localStorage.setItem('arx_passkey_vault_token', sessionToken)
    await autoActivateSession(walletAddress, address ?? undefined, sessionToken)
  }
  const forceRegisterMsca = async () => {
    // Perlu konfirmasi eksplisit dari user di tombol: dana wallet lama tidak pindah.
    const { walletAddress, sessionToken } = await registerPasskey()
    // Publish the newly derived MSCA before setting the token. Token polling
    // starts immediately and must not persist an intermediate empty address.
    setMscaState(prev => ({ ...prev, walletAddress, sessionActive: false }))
    setSessionToken(sessionToken)
    localStorage.setItem('arx_vault_token', sessionToken)
    localStorage.setItem('arx_passkey_vault_token', sessionToken)
    await autoActivateSession(walletAddress, address ?? undefined, sessionToken)
  }
  const loginMsca = async () => {
    // Login Passkey (WebAuthn) → pilih passkey/MSCA yang telah terdaftar di device.
    // MSCA yang dipilih otomatis jadi session key aktif; yang lain di-off.
    const { walletAddress, sessionToken } = await loginPasskey()
    setMscaState(prev => ({ ...prev, walletAddress, sessionActive: false }))
    setSessionToken(sessionToken)
    localStorage.setItem('arx_vault_token', sessionToken)
    localStorage.setItem('arx_passkey_vault_token', sessionToken)
    await autoActivateSession(walletAddress, address ?? undefined, sessionToken)
  }
  const revokeSession = async () => {
    if (!sessionToken) throw new Error(t('plugin.vaultLoginFailed'))
    await revokeSessionKey(sessionToken)
    setMscaState(prev => ({ ...prev, sessionActive: false, delegateAddress: '', deployed: prev.deployed }))
  }

  const retryMscaDeployments = async () => {
    const deployment = await deployAllSmartAccounts()
    if (deployment.results['arc-testnet']?.status !== 'deployed') throw new Error('Deployment Arc masih gagal. Periksa policy Gas Station dan coba lagi.')
    const walletAddress = mscaState.walletAddress
    const delegateAddress = mscaState.delegateAddress
    const token = sessionToken || (walletAddress ? (await loginPasskey()).sessionToken : '')
    const chainAuthorizationStatus: Record<string, 'authorized' | 'failed'> = { 'arc-testnet': 'authorized' }
    const errors: string[] = []
    if (walletAddress && delegateAddress && token) {
      for (const chainKey of ['base-sepolia', 'arbitrum-sepolia'] as const) {
        // Deployment must be confirmed before authorization; do not turn a
        // deployment failure into a misleading addOwners error.
        if (deployment.results[chainKey]?.status !== 'deployed') {
          errors.push(deployment.results[chainKey]?.error || `${chainKey}: deployment belum berhasil`)
          continue
        }
        try { await authorizeDelegateOnChain(chainKey, walletAddress, delegateAddress, token); chainAuthorizationStatus[chainKey] = 'authorized' }
        catch (error: any) { chainAuthorizationStatus[chainKey] = 'failed'; errors.push(error?.message || `${chainKey}: authorization gagal`) }
      }
    }
    setMscaState(prev => ({ ...prev, deployed: true, deploymentStatus: getDeploymentStatus(), chainAuthorizationStatus }))
    if (errors.length) setError(`Deployment/authorization belum lengkap: ${errors.join('; ')}`)
  }

  const prepareBaseSepoliaBridge = async () => {
    if (!mscaState.walletAddress || !mscaState.delegateAddress || !mscaState.sessionActive) throw new Error(t('plugin.sessionActivateFirst'))
    const fresh = sessionToken ? null : await loginPasskey()
    const token = sessionToken || fresh!.sessionToken
    if (!token) throw new Error('Passkey token gagal.')
    await deploySmartAccountOnChain('base-sepolia')
    await authorizeDelegateOnChain('base-sepolia', mscaState.walletAddress, mscaState.delegateAddress, token)
    setMscaState(prev => ({ ...prev, chainAuthorizationStatus: { ...(prev.chainAuthorizationStatus || {}), 'base-sepolia': 'authorized' } }))
    setDestinationReady(true)
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
  const clearStaleSession = (staleToken?: string) => {
    // A request made with the previous EOA token can finish after passkey login
    // has installed a new MSCA token. Never let that late 401 erase the newer
    // passkey credential (or the EOA proof needed for OAuth owner binding).
    const currentToken = localStorage.getItem('arx_vault_token')
    // The ref changes synchronously with setSessionToken, so an in-flight
    // request from the previous React render cannot clear the new credential.
    if (staleToken && sessionTokenRef.current !== staleToken) return
    if (staleToken && currentToken !== staleToken) return
    localStorage.removeItem('arx_vault_token')
    localStorage.removeItem('arx_passkey_vault_token')
    autoLoginTried.current = false
    setSessionToken(null)
  }

  // Fetch a vault endpoint; on 401 clear only the token that made this request.
  const vaultFetch = async (path: string, init?: RequestInit) => {
    const requestToken = sessionToken
    const r = await fetch(`${API}${path}`, {
      ...(init || {}),
      headers: { ...(init?.headers || {}), ...(requestToken ? { Authorization: `Bearer ${requestToken}` } : {}) },
    })
    if (r.status === 401) { clearStaleSession(requestToken || undefined); throw new Error('__SESSION_EXPIRED__') }
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
        vaultFetch('/api/vault/activity?limit=5'),
        vaultFetch('/api/vault/sessions'),
      ])
      setCredentials(creds.credentials || [])
      setLimits(lim.limits || { maxPerTx: 100, dailyLimit: 500, autoApprove: true, whitelist: [] })
      setApprovals(appr.approvals || [])
      setActivity((act.activity || []).slice(0, 5))
      setMcpSessions(sess.sessions || [])
    } catch (e: any) {
      if (e?.message !== '__SESSION_EXPIRED__') setError(e?.message || t('plugin.vaultLoadFailed'))
    }
    setLoading(false)
  }

  const refreshVaultAgents = async () => {
    if (!sessionToken) return
    try {
      const [agents, cards] = await Promise.all([listVaultAgents(sessionToken), listVaultCards(sessionToken)])
      setVaultAgents(agents)
      setOwnerCards(cards)
    } catch (e: any) {
      if (!String(e?.message || '').includes('401')) setError(e?.message || t('plugin.vaultAgentsLoadFailed'))
    }
  }

  const refreshAgentDetails = async (agentKey: string) => {
    if (!sessionToken) return
    try {
      const [activityRows, cards] = await Promise.all([getAgentActivity(agentKey, sessionToken), getAgentCards(agentKey, sessionToken)])
      setAgentDetails(prev => ({ ...prev, [agentKey]: { activity: activityRows, cards } }))
      setAgentCardDrafts(prev => {
        if (prev[agentKey]) return prev
        const first = ownerCards.find(card => !cards.some(link => link.cardId === card.cardId)) || ownerCards[0]
        return {
          ...prev,
          [agentKey]: {
            cardId: first?.cardId || '',
            maxPerTx: String(first?.maxPerTx || ''),
            daily: String(first?.daily || ''),
          },
        }
      })
    } catch (e: any) {
      setError(e?.message || t('plugin.vaultAgentsLoadFailed'))
    }
  }

  const toggleAgentDetails = (agentKey: string) => {
    const next = expandedAgentKey === agentKey ? null : agentKey
    setExpandedAgentKey(next)
    if (next && !agentDetails[next]) void refreshAgentDetails(next)
  }

  const updateAgentCardDraft = (agentKey: string, patch: Partial<AgentCardDraft>) => {
    setAgentCardDrafts(prev => ({ ...prev, [agentKey]: { ...(prev[agentKey] || { cardId: '', maxPerTx: '', daily: '' }), ...patch } }))
  }

  const linkAgentCard = async (agent: VaultAgent) => {
    const draft = agentCardDrafts[agent.agentKey]
    if (!draft?.cardId || !sessionToken) return
    setAgentAction(`link:${agent.agentKey}`)
    try {
      await linkCardToAgent(agent.agentKey, { cardId: draft.cardId, maxPerTx: draft.maxPerTx, daily: draft.daily }, sessionToken)
      await refreshAgentDetails(agent.agentKey)
      await refreshVaultAgents()
    } catch (e: any) {
      setError(e?.message || t('plugin.vaultAgentsLoadFailed'))
    } finally {
      setAgentAction(null)
    }
  }

  const unlinkAgentCard = async (agent: VaultAgent, cardId: string) => {
    if (!sessionToken) return
    setAgentAction(`unlink:${agent.agentKey}:${cardId}`)
    try {
      await unlinkCardFromAgent(cardId, sessionToken)
      await refreshAgentDetails(agent.agentKey)
    } catch (e: any) {
      setError(e?.message || t('plugin.vaultAgentsLoadFailed'))
    } finally {
      setAgentAction(null)
    }
  }

  const createConnectionToken = async (agent: VaultAgent) => {
    if (!agent.agentKey || !sessionToken) return
    setAgentAction(`token:${agent.agentKey}`)
    setConnectionToken(null)
    setError(null)
    try {
      const issued = await createAgentConnectionToken(agent.agentKey, 90, sessionToken)
      const agentName = issued.agentName || agent.clientName || t('plugin.mcpAgent')
      const token = issued.token || ''
      setConnectionToken({
        ...issued,
        setupMessage: `Hubungkan Hermes ke Agent Wallet ${agentName} saya.\nURL MCP: ${MCP_URL}\nToken akses Hermes: ${token}\nToken ini hanya memberi akses ke agent/wallet ini dan berlaku sampai: ${issued.expiresAt || ''}\nDi Hermes jalankan: hermes mcp add arcox --url ${MCP_URL} --auth header\nSaat diminta, tempel Token akses Hermes ini. Lalu jalankan: hermes mcp test arcox\nJangan gunakan token ini untuk agent lain.`,
      })
    } catch (e: any) {
      setError(e?.message || t('plugin.vaultAgentsLoadFailed'))
    } finally {
      setAgentAction(null)
    }
  }

  const createBootstrapToken = async () => {
    if (!sessionToken) return
    const clientName = bootstrapAgentName.trim() || 'Hermes Agent'
    setAgentAction('bootstrap-token')
    setConnectionToken(null)
    setError(null)
    try {
      const issued = await createBootstrapConnectionToken(clientName, 90, sessionToken)
      setConnectionToken({
        ...issued,
        setupMessage: `Hubungkan Hermes ke Agent Wallet saya (${clientName}).\nURL MCP: ${MCP_URL}\nToken akses Hermes: ${issued.token}\nToken ini hanya memberi akses ke agent/wallet ini dan berlaku sampai: ${issued.expiresAt || ''}\nDi Hermes jalankan: hermes mcp add arcox --url ${MCP_URL} --auth header\nSaat diminta, tempel Token akses Hermes ini. Lalu jalankan: hermes mcp test arcox\nJangan gunakan token ini untuk agent lain.`,
      })
      await refreshVaultAgents()
    } catch (e: any) {
      setError(e?.message || t('plugin.vaultAgentsLoadFailed'))
    } finally {
      setAgentAction(null)
    }
  }

  const loginAgent = async (agent: VaultAgent) => {
    if (!agent.agentKey) return
    setAgentAction(`login:${agent.agentKey}`)
    setError(null)
    try {
      const result = await loginPasskey(agent.agentKey)
      setSessionToken(result.sessionToken)
      localStorage.setItem('arx_vault_token', result.sessionToken)
      localStorage.setItem('arx_passkey_vault_token', result.sessionToken)
      setMscaState(prev => ({ ...prev, walletAddress: result.walletAddress, sessionActive: false }))
      await autoActivateSession(result.walletAddress, address ?? undefined, result.sessionToken)
      await refreshVaultAgents()
    } catch (e: any) {
      setError(e?.message || t('plugin.vaultLoginFailed'))
    } finally {
      setAgentAction(null)
    }
  }

  const revokeAgent = async (agent: VaultAgent) => {
    if (!agent.agentKey || !sessionToken) return
    if (!window.confirm(`${t('plugin.agentRevokeConfirm')}\n\n${agent.clientName || t('plugin.mcpAgent')}`)) return
    setAgentAction(`revoke:${agent.agentKey}`)
    setError(null)
    try {
      await revokeVaultAgent(agent.agentKey, sessionToken)
      // Revoke is scoped to the selected agent. If this browser is currently
      // using that exact Agent Wallet, clear its local session too so the UI
      // cannot appear active after the backend has revoked it.
      if (agent.walletAddress && mscaState.walletAddress && agent.walletAddress.toLowerCase() === mscaState.walletAddress.toLowerCase()) {
        localStorage.removeItem('arx_vault_token')
        localStorage.removeItem('arx_passkey_vault_token')
        setSessionToken(null)
        setMscaState(prev => ({ ...prev, sessionActive: false, delegateAddress: '' }))
      }
      if (expandedAgentKey === agent.agentKey) setExpandedAgentKey(null)
      if (connectionToken) setConnectionToken(null)
      await refreshVaultAgents()
    } catch (e: any) {
      setError(e?.message || t('plugin.vaultAgentsLoadFailed'))
    } finally {
      setAgentAction(null)
    }
  }

  useEffect(() => {
    if (sessionToken) refreshVaultAgents()
    else {
      setVaultAgents([])
      setOwnerCards([])
      setAgentDetails({})
      setAgentCardDrafts({})
      setExpandedAgentKey(null)
      setConnectionToken(null)
    }
  }, [sessionToken])

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
          vaultFetch('/api/vault/activity?limit=5'),
          vaultFetch('/api/pending-txs').catch(() => ({ txs: [] })),
        ])
        setMcpSessions(s.sessions || [])
        setApprovals(appr.approvals || [])
        setActivity((act.activity || []).slice(0, 5))
        setPendingTxs((txs.txs || []).filter((t: PendingTx) => t.status === 'pending'))
      } catch {}
    }, 8000)
    return () => clearInterval(poll)
  }, [sessionToken])

  const doLogin = async () => {
    if (!address) return
    const token = await siweLogin(address, t)
    if (token) {
      setSessionToken(token)
      localStorage.setItem('arx_vault_token', token)
      // Keep a separate EOA proof; passkey/MSCA login may replace arx_vault_token.
      localStorage.setItem('arx_eoa_vault_token', token)
    }
  }

  // Persist server-confirmed state as well as React state. The backend is the
  // authority after a browser restart, while localStorage keeps the Plugin UI
  // from showing stale destination authorization between polls.
  const persistMscaState = (patch: Record<string, unknown> | ((prev: any) => Record<string, unknown>)) => {
    setMscaState(prev => {
      const resolved = typeof patch === 'function' ? patch(prev) : patch
      const next = { ...prev, ...resolved }
      try {
        const stored: Record<string, any> = JSON.parse(localStorage.getItem('arx_msca_state') || '{}')
        // React state can legitimately lag a just-completed passkey operation.
        // Never let an undefined field erase a newer persisted value, and
        // merge per-chain maps so status polling cannot erase deployment data.
        const definedPatch: Record<string, any> = Object.fromEntries(Object.entries(next).filter(([, value]) => value !== undefined))
        const merged = {
          ...stored,
          ...definedPatch,
          ...(definedPatch.deploymentStatus || stored.deploymentStatus ? {
            deploymentStatus: { ...(stored.deploymentStatus || {}), ...(definedPatch.deploymentStatus || {}) },
          } : {}),
          ...(definedPatch.chainAuthorizationStatus || stored.chainAuthorizationStatus ? {
            chainAuthorizationStatus: { ...(stored.chainAuthorizationStatus || {}), ...(definedPatch.chainAuthorizationStatus || {}) },
          } : {}),
        }
        localStorage.setItem('arx_msca_state', JSON.stringify(merged))
      } catch { /* localStorage is best effort; API remains authoritative */ }
      return next
    })
  }

  // Poll backend session-key status so the indicator reflects the server truth,
  // not just the last local saveState (localStorage can be stale after a failed
  // setup or a backend-side revoke).
  const refreshSessionStatus = async (tokenOverride?: string) => {
    const token = tokenOverride || sessionToken
    if (!token) return
    try {
      const r = await fetch(`${API}/api/session/status`, { headers: { Authorization: `Bearer ${token}` } })
      if (r.status === 401) { clearStaleSession(token); return }
      const data = await r.json()
      const info = data?.session || null
      const active = Boolean(info && info.active)
      persistMscaState(prev => ({
        delegateAddress: info?.delegateAddress || prev.delegateAddress || '',
        sessionActive: active,
        sessionStatusReason: info?.statusReason || (active ? 'active' : 'inactive'),
        deployed: active || prev.deployed,
        deploymentStatus: {
          ...(prev.deploymentStatus || {}),
          'arc-testnet': {
            ...(prev.deploymentStatus?.['arc-testnet'] || {}),
            status: active ? 'deployed' : (prev.deploymentStatus?.['arc-testnet']?.status || 'failed'),
            authorizationStatus: active ? 'authorized' : (prev.deploymentStatus?.['arc-testnet']?.authorizationStatus || 'failed'),
            updatedAt: Date.now(),
          },
          'ethereum-sepolia': {
            ...(prev.deploymentStatus?.['ethereum-sepolia'] || {}),
            status: 'unsupported',
            error: 'Circle saat ini tidak mendukung MSCA di Ethereum Sepolia.',
            updatedAt: Date.now(),
          },
        },
        chainAuthorizationStatus: {
          ...(prev.chainAuthorizationStatus || {}),
          'arc-testnet': active ? 'authorized' : (prev.chainAuthorizationStatus?.['arc-testnet'] || 'failed'),
        },
      }))
    } catch { /* ignore transient network errors */ }
  }
  const refreshDestinationStatus = async () => {
    if (!sessionToken || !mscaState.walletAddress) return
    try {
      const statuses = await Promise.all(['base-sepolia', 'arbitrum-sepolia'].map(async chainKey => {
        const response = await fetch(`${API}/api/session/destination-status?chainKey=${chainKey}&walletAddress=${encodeURIComponent(mscaState.walletAddress!)}`, { headers: authHeaders() })
        if (!response.ok) return { chainKey, deployed: false, authorized: false }
        const data = await response.json()
        return { chainKey, deployed: data.deployed === true, authorized: data.authorized === true }
      }))
      const chainAuthorizationStatus = Object.fromEntries(statuses.map(item => [item.chainKey, item.deployed && item.authorized ? 'authorized' : 'failed']))
      persistMscaState(prev => ({
        chainAuthorizationStatus,
        deploymentStatus: {
          ...(prev.deploymentStatus || {}),
          ...Object.fromEntries(statuses.map(item => [item.chainKey, {
            ...(prev.deploymentStatus?.[item.chainKey] || {}),
            status: item.deployed ? 'deployed' : 'failed',
            authorizationStatus: item.authorized ? 'authorized' : 'failed',
            authorizationError: item.authorized ? undefined : 'Backend belum mengonfirmasi authorization chain.',
            updatedAt: Date.now(),
          }])),
        },
      }))
      setDestinationReady(chainAuthorizationStatus['base-sepolia'] === 'authorized')
    } catch { /* ignore transient destination RPC errors */ }
  }
  useEffect(() => {
    if (!sessionToken) return
    refreshSessionStatus()
    refreshDestinationStatus()
    const poll = setInterval(() => { refreshSessionStatus(); refreshDestinationStatus() }, 8000)
    return () => clearInterval(poll)
  }, [sessionToken, mscaState.walletAddress])

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
      // This ref intentionally gates one auto-login attempt per deep-link.
      // eslint-disable-next-line react-hooks/immutability
      autoLoginTried.current = true
      doLogin()
    }
  }, [deepLink, sessionToken, address, oauthParams])

  // Fetch data when token changes
  useEffect(() => { if (sessionToken) fetchAll() }, [sessionToken])

  async function syncWalletCredentials() {
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

  // Auto-register wallet credentials after login
  const hasSynced = useRef(false)
  useEffect(() => {
    if (!hasSynced.current && sessionToken && address) {
      hasSynced.current = true
      syncWalletCredentials()
    }
  }, [sessionToken, address, circleWallet, solanaAddress])

  const limitsTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const updateLimits = async (patch: Partial<Limits>) => {
    const next = { ...limits, ...patch }
    setLimits(next)
    if (limitsTimer.current) clearTimeout(limitsTimer.current)
    limitsTimer.current = setTimeout(async () => {
      try { await fetch(`${API}/api/vault/limits`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(next) }) } catch (e: any) { setError(e?.message || t('plugin.updateLimitsFailed')) }
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
    if (!address) { setError(t('plugin.walletRequired')); return }
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
      window.location.assign(`/arc-dex/bridge?${params.toString()}`)
      return
    }

    setSigningId(a.id)
    try {
      let txHash = ''
      let explorerUrl = ''
      if (a.action === 'send') {
        if (!a.to) throw new Error(t('plugin.destinationMissing'))
        const res = await sendTokenFromEoa({ from: address, to: a.to, token: a.token || 'USDC', amount: a.amount })
        txHash = res.txHash || ''
        explorerUrl = res.explorerUrl || ''
      } else if (a.action === 'swap') {
        const tokenOut = details.tokenOut || 'USDC'
        const res = await swapFromEoa({ metamaskAddress: address, tokenIn: a.token || 'USDC', tokenOut, amountIn: a.amount })
        txHash = res?.txHash || res?.transactionHash || ''
        explorerUrl = res?.explorerUrl || ''
      } else {
        throw new Error(t('plugin.unknownAction', { action: a.action }))
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
      const msg = e?.code === 4001 ? t('plugin.signatureCancelled') : (e?.message || t('plugin.transactionFailed'))
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
  // Onboarding progress: brand-new users need wallet first, then an agent,
  // then live MCP traffic — same three states drive the stepper card.
  const walletReady = Boolean(mscaState.walletAddress)
  const agentsReady = vaultAgents.length > 0
  const scrollToAgentConnect = () => document.getElementById('arx-agent-connect')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  // ── OAuth approve flow: passkey → sign SIWE → get auth code → redirect ──
  // The caller chooses Login for an existing user or Register for a new user;
  // WebAuthn must never guess which browser ceremony the user intended.
  /* Legacy OAuth callback handler retained for protocol compatibility; user-facing Hermes onboarding uses Agent Terhubung tokens. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const approveOAuth = async (passkeyMode: 'Login' | 'Register' = 'Login') => {
    setOauthPasskeyMode(passkeyMode)
    if (!address || !oauthParams) return
    const attempt = ++oauthAttempt.current
    // Do not open a wallet tab before WebAuthn. On mobile Chrome that new tab
    // can take focus while the Passkey prompt belongs to the OAuth page, making
    // the required first approval appear to be skipped.
    setOauthStatus('checking')
    setError(null)
    try {
      // Claude may open this approval page in a separate browser context from
      // Plugin, so its localStorage can lack the passkey/MSCA binding. Never
      // issue an unbound OAuth token in that case: authenticate the selected
      // Agent Wallet in this context first and verify that its session is active.
      let oauthMscaWalletAddress = mscaState.walletAddress || ''
      let oauthMscaSessionToken = localStorage.getItem('arx_passkey_vault_token') || ''
      let hydratedPasskey = false
      let sessionData: any = null
      let sessionVerified = false
      for (let passkeyAttempt = 0; passkeyAttempt < 2 && !sessionVerified; passkeyAttempt++) {
        // Every new MCP authorization must freshly prove control of the Agent
        // Wallet. Do not trust a persisted MSCA address/token pair here: Claude
        // may reuse the OAuth page while localStorage still contains an older
        // session, which previously skipped WebAuthn and jumped straight to
        // the EOA wallet signature.
        const needsPasskey = true
        if (needsPasskey) {
          // Render this phase before opening WebAuthn. The previous code used a
          // single `signing` state for both WebAuthn and SIWE, so the page kept
          // displaying "Menunggu persetujuan wallet" while the passkey prompt
          // was the active request.
          setOauthStatus('passkey')
          if (passkeyAttempt > 0) {
            // A stale token/address pair must not block the one allowed retry.
            localStorage.removeItem('arx_vault_token')
            localStorage.removeItem('arx_passkey_vault_token')
            oauthMscaWalletAddress = ''
            oauthMscaSessionToken = ''
          }
          const passkey = await withTimeout(
            passkeyMode === 'Register' ? registerPasskey() : loginPasskey(),
            60_000,passkeyMode === 'Register' ? t('plugin.passkeyCreateTimeout') : t('plugin.passkeyTimeout'),
          )
          oauthMscaWalletAddress = passkey.walletAddress
          oauthMscaSessionToken = passkey.sessionToken
          hydratedPasskey = true
          // A new user has no delegate/session yet. The same explicit passkey
          // flow can safely initialize it; existing users take the idempotent
          // active/reconcile path and do not receive a duplicate owner.
          await autoActivateSession(oauthMscaWalletAddress, address ?? undefined, oauthMscaSessionToken)
          // WebAuthn/session setup is complete; status lookup is a separate
          // network phase before the SIWE wallet signature.
          setOauthStatus('checking')
        }
        // Always verify the exact token/address pair, including when storage was
        // present. This prevents stale localStorage from producing an OAuth token
        // bound to an inactive or different MSCA.
        const sessionResponse = await withTimeout(
          fetch(`${API}/api/session/status`, { headers: { Authorization: `Bearer ${oauthMscaSessionToken}` } }),
          20_000,
          t('plugin.passkeySessionTimeout'),
        )
        sessionData = await sessionResponse.json().catch(() => ({}))
        const verifiedWallet = String(sessionData?.session?.walletAddress || '').toLowerCase()
        sessionVerified = sessionResponse.ok
          && sessionData?.session?.active === true
          && Boolean(oauthMscaWalletAddress)
          && verifiedWallet === oauthMscaWalletAddress.toLowerCase()
      }
      if (!sessionVerified) {
        if (sessionData?.session?.active !== true) {
          throw new Error(t('plugin.agentWalletInactive'))
        }
        throw new Error(t('plugin.passkeySessionMismatch'))
      }
      if (hydratedPasskey) {
        localStorage.setItem('arx_vault_token', oauthMscaSessionToken)
        localStorage.setItem('arx_passkey_vault_token', oauthMscaSessionToken)
        setSessionToken(oauthMscaSessionToken)
        setMscaState(prev => ({
          ...prev,
          walletAddress: oauthMscaWalletAddress,
          delegateAddress: sessionData.session.delegateAddress || prev.delegateAddress,
          sessionActive: true,
        }))
      }

      // 1. Get SIWE challenge from MCP server. Every network/provider step is
      // bounded so a suspended mobile tab cannot leave the button stuck forever.
      const msgResp = await withTimeout(
        fetch(`${API}/api/auth/siwe-message?address=${encodeURIComponent(address)}&client_id=${encodeURIComponent(oauthParams.client_id)}&request_id=${encodeURIComponent(oauthParams.request_id)}`, { headers: authHeaders() }),
        20_000,
        t('plugin.challengeTimeout'),
      )
      if (!msgResp.ok) throw new Error(`Gagal mendapat challenge (${msgResp.status})`)
      const msgData = await withTimeout(msgResp.json(), 10_000, t('plugin.challengeResponseTimeout'))
      if (!msgData.message) throw new Error(t('plugin.challengeFailed'))

      // 2. Sign with the already-connected wallet provider. This is a separate
      // SIWE proof from the passkey step above; it proves control of the EOA
      // identity used by the MCP OAuth client.
      // Do not use window.ethereum: on mobile it can trigger an unintended app switch.
      setOauthStatus('wallet')
      let provider = await withTimeout(
        findConnectedWalletProvider(address),
        20_000,
        t('plugin.providerTimeout'),
      )
      // Claude can open OAuth in a separate mobile browser context where the
      // injected provider from the original Plugin tab is unavailable. Start
      // a fresh WalletConnect pairing instead of waiting for a request with no
      // provider transport to deliver it.
      if (!provider && isMobile() && isWalletConnectAvailable()) {
        const connectedAddress = await withTimeout(
          connectWalletConnect(),
          180_000,
          t('plugin.walletConnectTimeout'),
        )
        if (!connectedAddress || connectedAddress.toLowerCase() !== address.toLowerCase()) {
          throw new Error(t('plugin.walletConnectMismatch'))
        }
        const connectedProvider = getWalletConnectProviderSync()
        if (connectedProvider) {
          ;(window as any).ethereum = connectedProvider
          provider = await findConnectedWalletProvider(address)
        }
      }
      if (!provider) throw new Error(t('plugin.walletMainMissing'))
      const from = address
      const messageHex = `0x${Array.from(new TextEncoder().encode(msgData.message)).map(byte => byte.toString(16).padStart(2, '0')).join('')}`
      // Re-open the relay before creating the request. The approval helper
      // opens the wallet universal link in a separate tab after the request is
      // queued, keeping this page alive to receive the relay response.
      const walletConnectProvider = getWalletConnectProviderSync()
      const usingWalletConnect = Boolean(walletConnectProvider && provider === walletConnectProvider)
      if (isMobile() && usingWalletConnect) {
        // Opening the relay is asynchronous. Starting personal_sign before it
        // is open creates a request that can be delivered to the wallet but
        // whose response has no live transport to return through, leaving this
        // card on "Menunggu persetujuan wallet app" after the user approved.
        const relayReady = await withTimeout(
          resumeWalletConnect(),
          8_000,
          t('plugin.relayTimeout'),
        )
        if (!relayReady) throw new Error(t('plugin.relayUnavailable'))
      }
      const signPromise = provider.request({ method: 'personal_sign', params: [messageHex, from] }) as Promise<string>
      // Attach a rejection handler immediately. If the relay dies after the
      // wallet has displayed/approved the request, the underlying provider
      // promise may settle later than our timeout; it must not create an
      // unhandled rejection or keep the UI in a stale signing state.
      signPromise.catch(() => {})
      // WalletConnect sends the request through the relay, but mobile Chrome
      // does not always foreground the connected wallet app for a later
      // personal_sign. Open the wallet's universal link in a new tab after the
      // request is queued; the approval page remains alive to receive the
      // relay response when the user returns from the wallet app.
      if (isMobile() && usingWalletConnect) redirectToWalletForSign()
      let timeoutId: ReturnType<typeof setTimeout> | null = null
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Wallet signature response timeout. Jika sudah menekan Approve di app, kembali ke browser; koneksi WalletConnect akan dipulihkan saat mencoba lagi.')), 90_000)
      })
      let signature: string
      try {
        signature = await Promise.race([signPromise, timeoutPromise])
      } finally {
        if (timeoutId) clearTimeout(timeoutId)
      }
      if (attempt !== oauthAttempt.current) return
      setOauthStatus('approving')

      // Send only the token issued by passkey registration/login. The backend
      // re-validates this token against the exact MSCA and active session before
      // creating the EOA alias, so no client-side status preflight is needed.
      // In particular, do not fall back to the EOA/SIWE token: that would bind
      // an identity without proof of control of the selected Agent Wallet.
      const mscaBinding: Record<string, string> = {}
      if (oauthMscaSessionToken && oauthMscaWalletAddress) {
        mscaBinding.mscaWalletAddress = oauthMscaWalletAddress
        mscaBinding.mscaSessionToken = oauthMscaSessionToken
      }

      // 3. Verify → get auth code → redirect
      const codeResp = await withTimeout(fetch(`${API}/api/auth/siwe-verify`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: from, message: msgData.message, signature,
          requestId: oauthParams.request_id, clientId: oauthParams.client_id, redirectUri: oauthParams.redirect_uri,
          state: oauthParams.state, codeChallenge: oauthParams.code_challenge,
          ...mscaBinding,
        }),
      }), 20_000, t('plugin.verifyTimeout'))
      const codeData = await withTimeout(codeResp.json(), 10_000, t('plugin.verificationIncomplete'))
      if (attempt !== oauthAttempt.current) return
      if (codeData.redirect) {
        setOauthStatus('done')
        window.location.href = codeData.redirect
        return
      }
      throw new Error(codeData.error || t('plugin.authorizationCodeFailed'))
    } catch (e: any) {
      if (attempt !== oauthAttempt.current) return
      // Update React state before relay cleanup. A dead WalletConnect socket
      // must never block the error/retry state from rendering.
      setOauthStatus('error')
      setError(e?.message || t('plugin.oauthFailed'))
      // Reset only the WC transport so the next retry starts cleanly; injected
      // desktop providers are left untouched. Cleanup is deliberately
      // fire-and-forget and bounded because disconnect() may hang on a dead
      // relay after the wallet already accepted the signature.
      cleanupWalletConnectInBackground(t)
    }
  }

  // ── Device pairing approval: same identity proof as approveOAuth, but the
  // grant is approved server-side by user_code and no redirect happens. ──
  const approveDevice = async (passkeyMode: 'Login' | 'Register' = 'Login') => {
    if (!address || !deviceUserCode) return
    setOauthStatus('checking')
    setError(null)
    try {
      // Fresh WebAuthn ceremony every pairing — never trust stale localStorage.
      let oauthMscaWalletAddress = ''
      let oauthMscaSessionToken = ''
      let deviceSessionData: any = null
      let sessionVerified = false
      for (let passkeyAttempt = 0; passkeyAttempt < 2 && !sessionVerified; passkeyAttempt++) {
        setOauthStatus('passkey')
        if (passkeyAttempt > 0) {
          localStorage.removeItem('arx_vault_token')
          localStorage.removeItem('arx_passkey_vault_token')
        }
        const passkey = await withTimeout(
          passkeyMode === 'Register' ? registerPasskey() : loginPasskey(),
          60_000,
          passkeyMode === 'Register' ? t('plugin.passkeyCreateTimeout') : t('plugin.passkeyTimeout'),
        )
        oauthMscaWalletAddress = passkey.walletAddress
        oauthMscaSessionToken = passkey.sessionToken
        const selectedWallet = deviceWalletChoice !== 'new' ? deviceWalletChoice.toLowerCase() : ''
        if (selectedWallet && oauthMscaWalletAddress.toLowerCase() !== selectedWallet) {
          throw new Error(`Passkey memilih wallet ${oauthMscaWalletAddress.slice(0, 10)}...${oauthMscaWalletAddress.slice(-6)}, bukan wallet yang dipilih.`)
        }
        await autoActivateSession(oauthMscaWalletAddress, address ?? undefined, oauthMscaSessionToken)
        setOauthStatus('checking')
        const sessionResponse = await withTimeout(
          fetch(`${API}/api/session/status`, { headers: { Authorization: `Bearer ${oauthMscaSessionToken}` } }),
          20_000,
          t('plugin.passkeySessionTimeout'),
        )
        const sessionData = await sessionResponse.json().catch(() => ({}))
        deviceSessionData = sessionData
        sessionVerified = sessionResponse.ok
          && sessionData?.session?.active === true
          && String(sessionData?.session?.walletAddress || '').toLowerCase() === oauthMscaWalletAddress.toLowerCase()
      }
      if (!sessionVerified) throw new Error(t('plugin.agentWalletInactive'))

      // Device approval is a full Agent Wallet login too. Persist the exact
      // passkey/MSCA token before completing SIWE so the owner page can reload,
      // list the new binding, and manage it after the approval card disappears.
      localStorage.setItem('arx_vault_token', oauthMscaSessionToken)
      localStorage.setItem('arx_passkey_vault_token', oauthMscaSessionToken)
      setSessionToken(oauthMscaSessionToken)
      persistMscaState(prev => ({
        walletAddress: oauthMscaWalletAddress,
        delegateAddress: deviceSessionData?.session?.delegateAddress || prev.delegateAddress || '',
        sessionActive: true,
        deployed: true,
      }))

      // SIWE challenge bound to the device grant.
      const msgResp = await withTimeout(fetch(`${API}/api/auth/device/message`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, user_code: deviceUserCode }),
      }), 20_000, t('plugin.challengeTimeout'))
      if (!msgResp.ok) throw new Error(`Gagal mendapat challenge (${msgResp.status})`)
      const msgData = await withTimeout(msgResp.json(), 10_000, t('plugin.challengeResponseTimeout'))
      if (!msgData.message) throw new Error(t('plugin.challengeFailed'))

      // Keep the SIWE challenge + MSCA binding in refs so the recovery button
      // can re-finish the exact same approval without re-running passkey.
      deviceMessageRef.current = msgData.message
      deviceMessageHexRef.current = `0x${Array.from(new TextEncoder().encode(msgData.message)).map(byte => byte.toString(16).padStart(2, '0')).join('')}`
      deviceMscaWalletRef.current = oauthMscaWalletAddress
      deviceMscaTokenRef.current = oauthMscaSessionToken
      await signAndApproveDevice()
    } catch (e: any) {
      setOauthStatus('error')
      setError(e?.message || t('plugin.oauthFailed'))
    }
  }

  // Wallet signature for device pairing. WalletConnect relays routinely drop
  // the response right after the wallet signs, leaving the request promise
  // pending forever (UI stuck at "Menunggu tanda tangan wallet…"). Rebuild
  // the connection between attempts and cap each try so it can never hang.
  const requestWalletSignature = async (): Promise<string> => {
    if (!address || !deviceMessageHexRef.current) throw new Error(t('plugin.walletMainMissing'))
    const messageHex = deviceMessageHexRef.current
    let lastError: unknown = null
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const provider = await withTimeout(findConnectedWalletProvider(address), 20_000, t('plugin.providerTimeout'))
        if (!provider) throw new Error(t('plugin.walletMainMissing'))
        const signature = await Promise.race([
          provider.request({ method: 'personal_sign', params: [messageHex, address] }) as Promise<string>,
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Wallet signature response timeout')), 60_000)),
        ])
        if (typeof signature === 'string' && /^0x[0-9a-fA-F]+$/.test(signature)) return signature
        throw new Error('Wallet signature tidak valid')
      } catch (e: any) {
        lastError = e
        if (attempt < 2) {
          // WalletConnect relay is usually the part that hung; disconnect it so
          // the next attempt starts with a fresh session.
          cleanupWalletConnectInBackground(t)
          await new Promise(resolve => setTimeout(resolve, 800))
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Wallet signature gagal')
  }

  // Finishes device pairing: signature → backend approve. Also callable from
  // the recovery button once the user has already signed in the wallet.
  const signAndApproveDevice = async (): Promise<void> => {
    if (!address || !deviceUserCode || !deviceMscaWalletRef.current || !deviceMscaTokenRef.current || !deviceMessageRef.current) {
      throw new Error(t('plugin.agentWalletInactive'))
    }
    setOauthStatus('wallet')
    setError(null)
    try {
      const signature = await requestWalletSignature()
      setOauthStatus('approving')
      const approveResp = await withTimeout(fetch(`${API}/api/auth/device/approve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address,
          message: deviceMessageRef.current,
          signature,
          user_code: deviceUserCode,
          mscaWalletAddress: deviceMscaWalletRef.current,
          mscaSessionToken: deviceMscaTokenRef.current,
          approve: true,
        }),
      }), 20_000, t('plugin.verifyTimeout'))
      const approveData = await withTimeout(approveResp.json().catch(() => ({})), 10_000, t('plugin.verificationIncomplete'))
      if (!approveResp.ok || !approveData.ok) throw new Error(approveData.error_description || approveData.error || t('plugin.oauthFailed'))
      setOauthStatus('done')
    } catch (e: any) {
      setOauthStatus('error')
      setError(e?.message || t('plugin.oauthFailed'))
    }
  }

  const approveSelectedDevice = () => {
    const selectedOption = deviceWalletChoice === 'new'
      ? null
      : deviceWalletOptions.find(option => option.walletAddress.toLowerCase() === deviceWalletChoice.toLowerCase())
    const usedBy = selectedOption?.agents.map(agent => agent.clientName || t('plugin.mcpAgent')).filter(Boolean) || []
    const target = deviceWalletChoice === 'new'
      ? 'Agent Wallet baru dengan Passkey baru'
      : `Agent Wallet ${deviceWalletChoice.slice(0, 10)}...${deviceWalletChoice.slice(-6)}`
    const warning = usedBy.length ? `\nWallet ini sudah dipakai oleh: ${usedBy.join(', ')}.` : ''
    if (!window.confirm(`Setujui ${deviceClientName || t('plugin.mcpAgent')} memakai ${target}?${warning}\n\nPastikan kode device berasal dari agent yang Anda minta.`)) return
    void approveDevice(deviceWalletChoice === 'new' ? 'Register' : 'Login')
  }

  // Wallet utama adalah identitas Plugin. Tidak ada login kedua di sini.
  if (!address) return (
    <div className='glass' style={{ borderRadius: 12, padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
      {t('plugin.noWalletForPlugin')}
    </div>
  )

  if (loading) return <div style={{ color: '#64748b', textAlign: 'center', padding: 40 }}>{t('plugin.pluginLoading')}</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {error && <div style={{ color: '#f87171', fontSize: 12, padding: 10, background: 'rgba(239,68,68,0.1)', borderRadius: 8 }}>{error}</div>}

      {/* Onboarding stepper — guides a brand-new user until the first live MCP session */}
      {!anyConnected && (
        <div className='glass' style={{ borderRadius: 12, padding: 16, marginBottom: 14, border: '1px solid rgba(99,102,241,0.35)', background: 'rgba(99,102,241,0.06)', order: -50 }}>
          <div style={{ color: '#e2e8f0', fontSize: 15, fontWeight: 700 }}>{t('plugin.onboardingTitle')}</div>
          <div style={{ color: '#94a3b8', fontSize: 12, margin: '4px 0 12px' }}>{t('plugin.onboardingSub')}</div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '9px 10px', background: 'rgba(18,18,26,0.55)', borderRadius: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 14 }}>{walletReady ? '✅' : '1️⃣'}</span>
            <div style={{ flex: 1 }}>
              <div style={{ color: '#e2e8f0', fontSize: 12, fontWeight: 600 }}>{t('plugin.stepWalletTitle')}</div>
              <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 2 }}>
                {walletReady
                  ? <>{t('plugin.stepWalletReady', { addr: `${mscaState.walletAddress?.slice(0, 10)}…${mscaState.walletAddress?.slice(-6)}` })}</>
                  : t('plugin.stepWalletCopy')}
              </div>
            </div>
            {!walletReady && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button className='btn btn-primary' disabled={busy === 'register'} onClick={() => run('register', registerMsca)}>{t('plugin.stepCreateWallet')}</button>
                <button className='btn' disabled={busy === 'login'} onClick={() => run('login', loginMsca)}>{t('plugin.stepLoginPasskey')}</button>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '9px 10px', background: 'rgba(18,18,26,0.55)', borderRadius: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 14 }}>{agentsReady ? '✅' : '2️⃣'}</span>
            <div style={{ flex: 1 }}>
              <div style={{ color: '#e2e8f0', fontSize: 12, fontWeight: 600 }}>{t('plugin.stepAgentTitle')}</div>
              <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 2 }}>
                {agentsReady
                  ? t('plugin.stepAgentCopyReady', { count: vaultAgents.length })
                  : t('plugin.stepAgentCopyEmpty')}
              </div>
            </div>
            <button type='button' onClick={scrollToAgentConnect} style={{ alignSelf: 'center', padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(99,102,241,0.35)', background: 'rgba(99,102,241,0.1)', color: '#a5b4fc', cursor: 'pointer', fontSize: 11 }}>{t('plugin.openAgentList')}</button>
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '9px 10px', background: 'rgba(18,18,26,0.55)', borderRadius: 8 }}>
            <span style={{ fontSize: 14 }}>3️⃣</span>
            <div style={{ flex: 1 }}>
              <div style={{ color: '#e2e8f0', fontSize: 12, fontWeight: 600 }}>{t('plugin.stepMcpTitle')}</div>
              <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 2 }}>{t('plugin.stepMcpCopy')}</div>
            </div>
          </div>
        </div>
      )}

      {/* Claude/ChatGPT OAuth approval remains available only for an OAuth callback. */}
      {oauthParams ? <div className='glass' style={{ borderRadius: 12, padding: 20, marginBottom: 14, border: '1px solid rgba(99,102,241,0.3)', background: 'rgba(99,102,241,0.05)', order: -69 }}>
        <div style={{ color: '#e2e8f0', fontSize: 16, fontWeight: 700, marginBottom: 8 }}>🔐 Otorisasi Claude / ChatGPT</div>
        <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 12 }}>Setujui koneksi yang diminta oleh Claude atau ChatGPT. Flow ini terpisah dari token koneksi Hermes.</div>
        {(oauthStatus === 'idle' || oauthStatus === 'error') && (
          <>
            <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 8 }}>{t('plugin.oauthWalletChoiceCopy')}</div>
            <button type='button' onClick={() => void approveOAuth('Register')} style={{ width: '100%', padding: 12, borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', fontWeight: 600, cursor: 'pointer', marginBottom: 8 }}>{t('plugin.oauthApproveNewWallet')}</button>
            <button type='button' onClick={() => void approveOAuth('Login')} style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid rgba(99,102,241,0.4)', background: 'transparent', color: '#a5b4fc', fontWeight: 600, cursor: 'pointer' }}>{t('plugin.oauthApproveExistingWallet')}</button>
          </>
        )}
        {oauthStatus === 'passkey' && <div style={{ color: '#94a3b8', fontSize: 12 }}>Menunggu Passkey…</div>}
        {oauthStatus === 'checking' && <div style={{ color: '#94a3b8', fontSize: 12 }}>Memeriksa sesi Agent Wallet…</div>}
        {oauthStatus === 'wallet' && <div style={{ color: '#94a3b8', fontSize: 12 }}>Menunggu tanda tangan wallet…</div>}
        {oauthStatus === 'approving' && <div style={{ color: '#94a3b8', fontSize: 12 }}>Menyetujui…</div>}
        {oauthStatus === 'done' && <div style={{ color: '#4ade80', fontSize: 13, fontWeight: 600 }}>✓ Claude/ChatGPT terhubung. Kembali ke aplikasi agent.</div>}
      </div> : null}

      {/* Legacy device authorization UI disabled. */}
      {deviceUserCode ? <div className='glass' style={{ borderRadius: 12, padding: 20, marginBottom: 14, border: '1px solid rgba(99,102,241,0.3)', background: 'rgba(99,102,241,0.05)', order: -70 }}>
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>🖥️</div>
            <div style={{ color: '#e2e8f0', fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Hubungkan Agent (Device Code)</div>
            <div style={{ color: '#94a3b8', fontSize: 12 }}>Perangkat lain ingin terhubung ke ARCOX Anda</div>
          </div>
          <div style={{ background: 'rgba(18,18,26,0.6)', borderRadius: 8, padding: 10, marginBottom: 12 }}>
            <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>Kode perangkat:</div>
            <div style={{ color: '#e2e8f0', fontSize: 18, fontWeight: 700, letterSpacing: 2 }}>{deviceUserCode}</div>
            {deviceClientName && (
              <>
                <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 10, marginBottom: 4 }}>Agent:</div>
                <div style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>{deviceClientName}</div>
              </>
            )}
          </div>
          <div style={{ color: '#f59e0b', fontSize: 11, marginBottom: 12, padding: '6px 10px', background: 'rgba(245,158,11,0.1)', borderRadius: 6 }}>
            ⚠️ Setujui hanya jika Anda sendiri yang meminta kode ini di terminal.
          </div>
          {error && <div style={{ color: '#f87171', fontSize: 12, marginBottom: 10 }}>{error}</div>}
          {(oauthStatus === 'idle' || oauthStatus === 'error') && (
            <>
              <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 6 }}>Pilih Agent Wallet untuk agent ini:</div>
              <div style={{ display: 'grid', gap: 6, marginBottom: 10 }}>
                {deviceWalletOptions.map(option => {
                  const usedBy = option.agents.map(agent => agent.clientName || t('plugin.mcpAgent')).filter(Boolean)
                  const selected = deviceWalletChoice.toLowerCase() === option.walletAddress.toLowerCase()
                  return (
                    <label key={option.walletAddress} style={{ display: 'block', padding: 8, borderRadius: 7, border: `1px solid ${selected ? 'rgba(99,102,241,0.7)' : '#1e1e2e'}`, background: selected ? 'rgba(99,102,241,0.12)' : 'rgba(18,18,26,0.45)', cursor: 'pointer' }}>
                      <input type='radio' name='device-agent-wallet' checked={selected} onChange={() => setDeviceWalletChoice(option.walletAddress)} />
                      <span style={{ marginLeft: 6, color: '#e2e8f0', fontSize: 11 }}>Agent Wallet {option.walletAddress.slice(0, 10)}...{option.walletAddress.slice(-6)}</span>
                      <span style={{ display: 'block', color: '#64748b', fontSize: 10, margin: '3px 0 0 22px', fontFamily: 'monospace' }}>{usedBy.length ? `Dipakai oleh: ${usedBy.join(', ')}` : 'Belum dipakai agent lain'}</span>
                    </label>
                  )
                })}
                <label style={{ display: 'block', padding: 8, borderRadius: 7, border: `1px solid ${deviceWalletChoice === 'new' ? 'rgba(16,185,129,0.7)' : '#1e1e2e'}`, background: deviceWalletChoice === 'new' ? 'rgba(16,185,129,0.1)' : 'rgba(18,18,26,0.45)', cursor: 'pointer' }}>
                  <input type='radio' name='device-agent-wallet' checked={deviceWalletChoice === 'new'} onChange={() => setDeviceWalletChoice('new')} />
                  <span style={{ marginLeft: 6, color: '#e2e8f0', fontSize: 11 }}>Buat Agent Wallet baru</span>
                  <span style={{ display: 'block', color: '#64748b', fontSize: 10, margin: '3px 0 0 22px' }}>Passkey baru, alamat baru, dana tidak berpindah otomatis.</span>
                </label>
              </div>
              {deviceWalletChoice !== 'new' && deviceWalletOptions.find(option => option.walletAddress.toLowerCase() === deviceWalletChoice.toLowerCase())?.agents.length ? (
                <div style={{ color: '#f59e0b', fontSize: 10, marginBottom: 10, padding: '6px 8px', background: 'rgba(245,158,11,0.1)', borderRadius: 6 }}>Wallet ini sudah dipakai agent lain. Pastikan itu memang pilihan Anda.</div>
              ) : null}
              <button type='button' onClick={approveSelectedDevice} style={{ width: '100%', padding: 12, borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
                {deviceWalletChoice === 'new' ? 'Buat Agent Wallet baru + Setujui' : 'Setujui wallet terpilih dengan Passkey'}
              </button>
            </>
          )}
          {oauthStatus === 'passkey' && <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>Menunggu Passkey…</div>}
          {oauthStatus === 'checking' && <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>Memeriksa sesi Agent Wallet…</div>}
          {oauthStatus === 'wallet' && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 10 }}>Menunggu tanda tangan wallet…</div>
              <div style={{ color: '#64748b', fontSize: 11, marginBottom: 10 }}>Sudah menandatangani di aplikasi wallet? Jika layar masih menggantung, lanjutkan untuk meminta tanda tangan sekali lagi.</div>
              <button type='button' onClick={() => void signAndApproveDevice()} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #6366f1', background: 'transparent', color: '#a5b4fc', fontWeight: 600, cursor: 'pointer' }}>
                Sudah tanda tangan — Lanjutkan
              </button>
            </div>
          )}
          {oauthStatus === 'approving' && <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>Menyetujui…</div>}
          {oauthStatus === 'done' && (
            <div style={{ textAlign: 'center', color: '#4ade80', fontSize: 13, fontWeight: 600 }}>
              ✓ Perangkat terhubung. Kembali ke terminal Hermes.
            </div>
          )}
        </div> : null}

      {/* Connection methods: the two flows run in opposite order and must
          never be mixed. Hermes provisions the wallet first, then connects
          with a token. Claude/ChatGPT connect first via OAuth and get their
          own Agent Wallet created during approval (1 agent = 1 wallet). */}
      <div style={{ display: 'grid', gap: 10, marginBottom: 14 }}>
        <div className='glass' style={{ borderRadius: 12, padding: 16, border: '1px solid rgba(99,102,241,0.3)', background: 'rgba(99,102,241,0.05)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
            <div style={{ color: '#e2e8f0', fontSize: 15, fontWeight: 700 }}>🤖 Hermes</div>
            <div style={{ color: '#818cf8', fontSize: 10, fontWeight: 600 }}>{t('plugin.flowHermesBadge')}</div>
          </div>
          <div style={{ color: '#94a3b8', fontSize: 12, lineHeight: 1.5 }}>1. {t('plugin.flowHermesStep1')}</div>
          <div style={{ color: '#94a3b8', fontSize: 12, lineHeight: 1.5 }}>2. {t('plugin.flowHermesStep2')}</div>
          <div style={{ color: '#94a3b8', fontSize: 12, lineHeight: 1.5 }}>3. {t('plugin.flowHermesStep3')}</div>
          <div style={{ color: '#f59e0b', fontSize: 11, marginTop: 8 }}>{t('plugin.flowHermesNote')}</div>
        </div>
        <div className='glass' style={{ borderRadius: 12, padding: 16, border: '1px solid rgba(16,185,129,0.3)', background: 'rgba(16,185,129,0.05)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
            <div style={{ color: '#e2e8f0', fontSize: 15, fontWeight: 700 }}>💬 Claude / ChatGPT</div>
            <div style={{ color: '#4ade80', fontSize: 10, fontWeight: 600 }}>{t('plugin.flowClaudeBadge')}</div>
          </div>
          <div style={{ color: '#94a3b8', fontSize: 12, lineHeight: 1.5 }}>1. {t('plugin.flowClaudeStep1')}</div>
          <div style={{ color: '#94a3b8', fontSize: 12, lineHeight: 1.5 }}>2. {t('plugin.flowClaudeStep2')}</div>
          <div style={{ color: '#94a3b8', fontSize: 12, lineHeight: 1.5 }}>3. {t('plugin.flowClaudeStep3')}</div>
          <div style={{ color: '#4ade80', fontSize: 11, marginTop: 8 }}>{t('plugin.flowClaudeNote')}</div>
        </div>
      </div>

      {/* Connection status bar */}
      <div className='glass' style={{ borderRadius: 12, padding: 10, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <StatusDot on={chatgptConnected} label="ChatGPT" />
          <StatusDot on={claudeConnected} label="Claude" />
          <StatusDot on={anyConnected} label={anyConnected ? t('plugin.agentActive') : t('plugin.noAgent')} />
        </div>
        <button onClick={() => { localStorage.removeItem('arx_vault_token'); localStorage.removeItem('arx_passkey_vault_token'); localStorage.removeItem('arx_eoa_vault_token'); setSessionToken(null) }} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.1)', color: '#f87171', cursor: 'pointer' }}>{t('plugin.logout')}</button>
      </div>

      <Section title={t('plugin.mcpUrlTitle')} badge={anyConnected ? <StatusDot on={true} label={t('plugin.connected')} /> : undefined}>
        <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 10 }}>{t('plugin.mcpUrlCopy')}</div>
        <Row label='MCP URL' value={
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <code style={{ background: 'rgba(99,102,241,0.1)', padding: '4px 8px', borderRadius: 6, color: '#818cf8' }}>{MCP_URL}</code>
            <button onClick={() => navigator.clipboard.writeText(MCP_URL)} style={{ background: 'rgba(99,102,241,0.2)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 6, padding: '3px 8px', fontSize: 11, cursor: 'pointer' }}>{t('plugin.copy')}</button>
          </div>
        } />
        <div style={{ color: '#64748b', fontSize: 11, marginTop: 8 }}>{t('plugin.mcpUrlHint')}</div>
      </Section>

      {/* Credentials */}
      <Section title={t('plugin.credentials')}>
        <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 10 }}>{t('plugin.credentialsCopy')}</div>
        {credentials.length === 0 ? (
          <div style={{ color: '#64748b', fontSize: 12 }}>{t('plugin.noCredentials')}</div>
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
            const label = prompt(t('plugin.credentialName'))
            const value = prompt(t('plugin.credentialValue'))
            if (label && value) fetch(`${API}/api/vault/credentials`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ type: 'api_key', label, value }) }).then(() => fetchAll()).catch((e: any) => setError(e?.message || t('plugin.addCredentialFailed')))
          }} style={{ width: '100%', background: 'rgba(99,102,241,0.1)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)', padding: 8, borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>{t('plugin.addApiKey')}</button>
        </div>
      </Section>

      {/* Agents */}
      <Section title={t('plugin.agents')} badge={anyConnected ? <StatusDot on={true} label={t('plugin.activeCount', { count: mcpSessions.filter(s => s.active).length })} /> : undefined}>
        {mcpSessions.length === 0 ? (
          <div style={{ color: '#64748b', fontSize: 12 }}>{t('plugin.noAgents')}</div>
        ) : (
          mcpSessions.map((s, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px', background: 'rgba(18,18,26,0.6)', borderRadius: 8, marginBottom: 6 }}>
              <div>
                <div style={{ color: '#e2e8f0', fontSize: 12, fontWeight: 600 }}>{s.agent || t('plugin.mcpAgent')}</div>
                <div style={{ color: '#64748b', fontSize: 10 }}>ID: {s.clientId?.slice(0, 20)}... · Last: {fmtTime(s.lastActivity)}</div>
              </div>
              <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: s.active ? 'rgba(16,185,129,0.15)' : 'rgba(100,116,139,0.1)', color: s.active ? '#10b981' : '#64748b' }}>{s.active ? t('plugin.active') : t('plugin.idle')}</span>
            </div>
          ))
        )}
      </Section>

      {/* Per-agent wallet connections: owner-only controls for token issuance and revoke. */}
      <Section title={t('plugin.agentConnections')} badge={vaultAgents.length > 0 ? <StatusDot on={true} label={t('plugin.activeCount', { count: vaultAgents.length })} /> : undefined}>
        <div id='arx-agent-connect'></div>
        <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 10 }}>{t('plugin.agentConnectionsCopy')}</div>
        {vaultAgents.length === 0 ? (
          !walletReady ? (
            <div>
              <div style={{ color: '#fbbf24', fontSize: 12, lineHeight: 1.5, padding: 10, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 8, marginBottom: 10 }}>
                Belum ada Agent Wallet aktif. Selesaikan langkah 1 dulu — tanpa wallet aktif, token koneksi tidak bisa dibuat.
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className='btn btn-primary' style={{ flex: 1 }} disabled={busy === 'register'} onClick={() => run('register', registerMsca)}>🆕 Buat Agent Wallet</button>
                <button className='btn' style={{ flex: 1 }} disabled={busy === 'login'} onClick={() => run('login', loginMsca)}>🔑 Masuk Passkey</button>
              </div>
            </div>
          ) : (
          <div>
            <div style={{ color: '#64748b', fontSize: 12, marginBottom: 10 }}>{t('plugin.noVaultAgents')}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={bootstrapAgentName} onChange={e => setBootstrapAgentName(e.target.value)} placeholder='Nama agent' aria-label='Nama agent' style={{ flex: 1, minWidth: 0, background: 'rgba(18,18,26,0.8)', border: '1px solid #1e1e2e', color: '#e2e8f0', borderRadius: 6, padding: '8px', fontSize: 11 }} />
              <button type='button' onClick={() => void createBootstrapToken()} disabled={agentAction !== null} style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid rgba(99,102,241,0.4)', background: 'rgba(99,102,241,0.12)', color: '#a5b4fc', cursor: agentAction ? 'wait' : 'pointer', fontSize: 11 }}>
                {agentAction === 'bootstrap-token' ? t('plugin.agentCreatingToken') : t('plugin.agentCreateToken')}
              </button>
            </div>
          </div>
          )
        ) : ([
          <AgentWalletList key='arx-wallet-list' wallets={agentWalletEntries} />,
          ...vaultAgents.map(agent => {
            const clientId = agent.agentKey.split('|')[0]
            const live = mcpSessions.some(session => session.active && session.clientId === clientId)
            const expanded = expandedAgentKey === agent.agentKey
            return (
              <div key={agent.agentKey} style={{ padding: 10, background: 'rgba(18,18,26,0.6)', borderRadius: 8, marginBottom: 8, border: expanded ? '1px solid rgba(99,102,241,0.45)' : '1px solid transparent' }}>
                <button type='button' onClick={() => toggleAgentDetails(agent.agentKey)} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', textAlign: 'left', background: 'transparent', border: 'none', color: '#e2e8f0', padding: 0, cursor: 'pointer' }}>
                  <span>
                    <span style={{ display: 'block', fontSize: 12, fontWeight: 600 }}>{agent.clientName || t('plugin.mcpAgent')}</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 3 }}>
                      <span style={{ color: '#94a3b8', fontSize: 10, fontFamily: 'monospace' }}>{agent.walletAddress?.slice(0, 8)}…{agent.walletAddress?.slice(-6)}</span>
                      <span role='button' aria-label='Salin alamat wallet agent' onClick={e => { e.stopPropagation(); navigator.clipboard?.writeText(agent.walletAddress || '').catch(() => {}) }} style={{ cursor: 'pointer', fontSize: 10, opacity: 0.75 }}>📋</span>
                    </span>
                  </span>
                  <StatusDot on={live} label={live ? t('plugin.agentStatusConnected') : t('plugin.idle')} />
                </button>
                {expanded && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #1e1e2e' }}>
                    <Row label='Agent Wallet' value={<span style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>{agent.walletAddress}</span>} />
                    <Row label={t('plugin.agentLastUsed')} value={agent.lastUsedAt ? fmtTime(Number(agent.lastUsedAt)) : '-'} />
                    <Row label={t('plugin.agentSpentToday')} value={agent.spentToday ?? '-'} />
                    {agentDetails[agent.agentKey] ? (
                      <>
                        <div style={{ marginTop: 10 }}>
                          <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 5 }}>{t('plugin.agentActivityTitle')}</div>
                          {agentDetails[agent.agentKey].activity.length === 0 ? (
                            <div style={{ color: '#64748b', fontSize: 11 }}>{t('plugin.agentNoActivity')}</div>
                          ) : agentDetails[agent.agentKey].activity.map((entry, index) => (
                            <div key={entry.id || `${entry.at}-${index}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '5px 0', borderBottom: '1px solid rgba(30,30,46,0.7)', fontSize: 10 }}>
                              <span style={{ color: '#cbd5e1' }}>{entry.type}{entry.detail ? ` · ${entry.detail}` : ''}</span>
                              <span style={{ color: '#64748b', whiteSpace: 'nowrap' }}>{entry.amount ? `${entry.amount} USDC · ` : ''}{fmtTime(Number(entry.at))}</span>
                            </div>
                          ))}
                        </div>
                        <div style={{ marginTop: 10 }}>
                          <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 5 }}>{t('plugin.agentLinkedCardsTitle')}</div>
                          {agentDetails[agent.agentKey].cards.length === 0 ? (
                            <div style={{ color: '#64748b', fontSize: 11 }}>{t('plugin.agentNoLinkedCards')}</div>
                          ) : agentDetails[agent.agentKey].cards.map(card => (
                            <div key={card.cardId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '5px 0', fontSize: 10 }}>
                              <span style={{ color: '#cbd5e1' }}>{card.label || t('plugin.agentCardsTitle')} ···· {card.last4 || '????'}<br /><small style={{ color: '#64748b' }}>{card.maxPerTx || '∞'} / tx · {card.daily || '∞'} / day</small></span>
                              <button type='button' className='mini-button' disabled={agentAction !== null} onClick={() => void unlinkAgentCard(agent, card.cardId)}>{agentAction === `unlink:${agent.agentKey}:${card.cardId}` ? '…' : t('plugin.unlink')}</button>
                            </div>
                          ))}
                          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', gap: 5, marginTop: 6 }}>
                            <select value={agentCardDrafts[agent.agentKey]?.cardId || ''} onChange={e => updateAgentCardDraft(agent.agentKey, { cardId: e.target.value })} style={{ minWidth: 0, background: 'rgba(18,18,26,0.8)', border: '1px solid #1e1e2e', color: '#e2e8f0', borderRadius: 6, padding: '4px', fontSize: 10 }}>
                              <option value=''>{t('plugin.agentPickCard')}</option>
                              {ownerCards.map(card => <option key={card.cardId} value={card.cardId}>{card.label || t('plugin.agentCardsTitle')} ···· {card.last4 || '????'}</option>)}
                            </select>
                            <input value={agentCardDrafts[agent.agentKey]?.maxPerTx || ''} onChange={e => updateAgentCardDraft(agent.agentKey, { maxPerTx: e.target.value })} placeholder={t('plugin.agentMaxPerTxInput')} inputMode='decimal' style={{ minWidth: 0, background: 'rgba(18,18,26,0.8)', border: '1px solid #1e1e2e', color: '#e2e8f0', borderRadius: 6, padding: '4px', fontSize: 10 }} />
                            <input value={agentCardDrafts[agent.agentKey]?.daily || ''} onChange={e => updateAgentCardDraft(agent.agentKey, { daily: e.target.value })} placeholder={t('plugin.agentDailyInput')} inputMode='decimal' style={{ minWidth: 0, background: 'rgba(18,18,26,0.8)', border: '1px solid #1e1e2e', color: '#e2e8f0', borderRadius: 6, padding: '4px', fontSize: 10 }} />
                          </div>
                          {ownerCards.length === 0 && <div style={{ color: '#64748b', fontSize: 10, marginTop: 5 }}>{t('plugin.agentNoOwnerCards')}</div>}
                          <button type='button' onClick={() => void linkAgentCard(agent)} disabled={agentAction !== null || !agentCardDrafts[agent.agentKey]?.cardId} style={{ width: '100%', marginTop: 6, padding: 6, borderRadius: 6, border: '1px solid rgba(99,102,241,0.35)', background: 'rgba(99,102,241,0.1)', color: '#a5b4fc', cursor: agentAction ? 'wait' : 'pointer', fontSize: 10 }}>
                            {agentAction === `link:${agent.agentKey}` ? t('plugin.agentLinkingCard') : t('plugin.agentLinkCardBtn')}
                          </button>
                        </div>
                      </>
                    ) : (
                      <div style={{ color: '#64748b', fontSize: 10, marginTop: 8 }}>{t('plugin.pluginLoading')}</div>
                    )}
                    <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                      <button type='button' onClick={() => void createConnectionToken(agent)} disabled={agentAction !== null} style={{ flex: 1, padding: 8, borderRadius: 6, border: '1px solid rgba(99,102,241,0.4)', background: 'rgba(99,102,241,0.12)', color: '#a5b4fc', cursor: agentAction ? 'wait' : 'pointer', fontSize: 11 }}>
                        {agentAction === `token:${agent.agentKey}` ? t('plugin.agentCreatingToken') : t('plugin.agentCreateToken')}
                      </button>
                      <button type='button' onClick={() => void loginAgent(agent)} disabled={agentAction !== null} style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid rgba(16,185,129,0.35)', background: 'rgba(16,185,129,0.1)', color: '#86efac', cursor: agentAction ? 'wait' : 'pointer', fontSize: 11 }}>
                        {agentAction === `login:${agent.agentKey}` ? '…' : 'Login Passkey'}
                      </button>
                      <button type='button' onClick={() => void revokeAgent(agent)} disabled={agentAction !== null} style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.1)', color: '#fca5a5', cursor: agentAction ? 'wait' : 'pointer', fontSize: 11 }}>
                        {agentAction === `revoke:${agent.agentKey}` ? t('plugin.agentRevoking') : t('plugin.agentRevoke')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          }),
          ])}
      </Section>

      {connectionToken && (
        <div role='dialog' aria-label={t('plugin.agentCreateToken')} className='glass' style={{ borderRadius: 12, padding: 14, marginBottom: 14, border: '1px solid rgba(16,185,129,0.4)', background: 'rgba(16,185,129,0.06)' }}>
          <div style={{ color: '#4ade80', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Token akses Hermes</div>
          <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 8 }}>Ini adalah kredensial akses MCP untuk agent yang dipilih — bukan Passkey dan bukan token login website. Token hanya berlaku untuk satu Agent Wallet, tampil sekali, dan harus ditempel saat Hermes meminta autentikasi header.</div>
          <div style={{ color: '#94a3b8', fontSize: 10, marginBottom: 4 }}>Token yang ditempel ke Hermes:</div>
          <code style={{ display: 'block', color: '#e2e8f0', background: 'rgba(18,18,26,0.8)', padding: 8, borderRadius: 6, fontSize: 10, wordBreak: 'break-all', marginBottom: 8 }}>{connectionToken.token}</code>
          <textarea readOnly value={connectionToken.setupMessage || ''} rows={5} style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', color: '#e2e8f0', background: 'rgba(18,18,26,0.8)', border: '1px solid #1e1e2e', borderRadius: 6, padding: 8, fontSize: 11, lineHeight: 1.4 }} />
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button type='button' onClick={() => navigator.clipboard?.writeText(connectionToken.setupMessage || '').catch(() => setError(t('plugin.agentCopyFailed')))} style={{ flex: 2, padding: 8, borderRadius: 6, border: 'none', background: '#10b981', color: '#052e16', fontWeight: 700, cursor: 'pointer', fontSize: 11 }}>{t('plugin.agentCopySetup')}</button>
            <button type='button' onClick={() => navigator.clipboard?.writeText(connectionToken.token || '').catch(() => setError(t('plugin.agentCopyFailed')))} style={{ flex: 1, padding: 8, borderRadius: 6, border: '1px solid rgba(16,185,129,0.4)', background: 'transparent', color: '#4ade80', fontWeight: 600, cursor: 'pointer', fontSize: 11 }}>{t('plugin.agentCopyTokenOnly')}</button>
            <button type='button' onClick={() => setConnectionToken(null)} style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #334155', background: 'transparent', color: '#cbd5e1', cursor: 'pointer', fontSize: 11 }}>{t('plugin.agentTokenDone')}</button>
          </div>
          {connectionToken.expiresAt && <div style={{ color: '#64748b', fontSize: 10, marginTop: 8 }}>{t('plugin.agentTokenExpires', { date: fmtTime(new Date(connectionToken.expiresAt).getTime()) })}</div>}
        </div>
      )}

      {/* Approvals — pending only */}
      <Section title={t('plugin.approvals')} badge={approvals.filter(a => a.status === 'pending').length > 0 ? <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}>{t('plugin.waitingCount', { count: approvals.filter(a => a.status === 'pending').length })}</span> : undefined}>
        {approvals.filter(a => a.status === 'pending').length === 0 ? (
          <div style={{ color: '#64748b', fontSize: 12 }}>{t('plugin.noApproval')}</div>
        ) : (
          approvals.filter(a => a.status === 'pending').map(a => (
            <div key={a.id} style={{ padding: '8px', background: a.id === highlightApproval ? 'rgba(245,158,11,0.12)' : 'rgba(18,18,26,0.6)', borderRadius: 8, marginBottom: 6, border: a.id === highlightApproval ? '1px solid rgba(245,158,11,0.6)' : '1px solid rgba(245,158,11,0.25)' }}>
              <div style={{ color: '#e2e8f0', fontSize: 12 }}>{a.agent}: {a.action} {a.amount} {a.token} {a.to ? `→ ${a.to.slice(0, 10)}...` : ''}</div>
              <div style={{ color: '#64748b', fontSize: 10 }}>Source: {a.source} · {fmtTime(a.createdAt)}</div>
              {a.action === 'bridge' && <div style={{ color: '#818cf8', fontSize: 10, marginTop: 4 }}>{t('plugin.bridgeHint')}</div>}
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <button onClick={() => approve(a)} disabled={signingId === a.id} style={{ flex: 1, background: 'rgba(16,185,129,0.15)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)', padding: '5px', borderRadius: 6, fontSize: 11, cursor: signingId === a.id ? 'wait' : 'pointer' }}>{signingId === a.id ? `⏳ ${t('plugin.approvalWaitingMetaMask')}` : a.action === 'bridge' ? t('plugin.approveBridge') : t('plugin.approveSign')}</button>
                <button onClick={() => reject(a.id)} disabled={signingId === a.id} style={{ flex: 1, background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)', padding: '5px', borderRadius: 6, fontSize: 11, cursor: 'pointer' }}>{t('plugin.reject')}</button>
              </div>
            </div>
          ))
        )}
      </Section>

      {/* Approval History — approved / rejected */}
      <Section title={t('plugin.approvalHistory')} badge={approvals.filter(a => a.status !== 'pending').length > 0 ? <span style={{ fontSize: 11, color: '#64748b' }}>{approvals.filter(a => a.status !== 'pending').length}</span> : undefined}>
        {approvals.filter(a => a.status !== 'pending').length === 0 ? (
          <div style={{ color: '#64748b', fontSize: 12 }}>{t('plugin.noHistory')}</div>
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
                    <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: ok ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)', color: ok ? '#10b981' : '#f87171' }}>{a.status === 'auto_approved' ? t('plugin.auto') : a.status === 'approved' ? t('plugin.approved') : t('plugin.rejected')}</span>
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
      <Section title={t('plugin.limits')}>
        <Row label={t('plugin.maxPerTx')} value={
          <input type='number' value={limits.maxPerTx} onChange={e => updateLimits({ maxPerTx: Number(e.target.value) })} style={{ width: 80, background: 'rgba(18,18,26,0.8)', border: '1px solid #1e1e2e', color: '#e2e8f0', borderRadius: 6, padding: '4px 8px', fontSize: 12 }} />
        } />
        <Row label={t('plugin.dailyLimit')} value={
          <input type='number' value={limits.dailyLimit} onChange={e => updateLimits({ dailyLimit: Number(e.target.value) })} style={{ width: 80, background: 'rgba(18,18,26,0.8)', border: '1px solid #1e1e2e', color: '#e2e8f0', borderRadius: 6, padding: '4px 8px', fontSize: 12 }} />
        } />
        <Row label={t('plugin.autoApprove')} value={
          <input type='checkbox' checked={limits.autoApprove} onChange={e => updateLimits({ autoApprove: e.target.checked })} style={{ cursor: 'pointer' }} />
        } />
        <div style={{ marginTop: 8 }}>
          <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>{t('plugin.whitelist')}</div>
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
      <Section title={t('plugin.agentWallet')} style={{ order: -40 }} badge={
        mscaState.walletAddress
          ? (mscaState.sessionActive ? <StatusDot on={true} label={mscaState.deployed ? t('plugin.deployedActive') : t('plugin.sessionActive')} /> : <StatusDot on={false} label={t('plugin.sessionInactive')} />)
          : undefined
      }>
        {!mscaState.walletAddress ? (
          <div>
            <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 8 }}>
              {t('plugin.mscaDescription')}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className='btn btn-primary' style={{ flex: 1 }} disabled={busy === 'login'} onClick={() => run('login', loginMsca)}>
                {t('plugin.loginPasskey')}
              </button>
              <button className='btn' style={{ flex: 1, border: '1px solid #1e1e2e' }} disabled={busy === 'register'} onClick={() => run('register', registerMsca)}>
                {t('plugin.newWallet')}
              </button>
            </div>
          </div>
        ) : (
          <div>
            <Row label={t('plugin.mscaAddress')} value={<span style={{ fontFamily: 'monospace', fontSize: 11 }}>{mscaState.walletAddress?.slice(0, 10)}...{mscaState.walletAddress?.slice(-6)}</span>} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, margin: '8px 0' }}>
              {[
                ['arc-testnet', 'Arc Testnet'], ['ethereum-sepolia', 'Ethereum Sepolia'],
                ['base-sepolia', 'Base Sepolia'], ['arbitrum-sepolia', 'Arbitrum Sepolia'],
              ].map(([key, label]) => {
                const status = mscaState.deploymentStatus?.[key]
                const color = status?.status === 'deployed' ? '#10b981' : status?.status === 'unsupported' ? '#f59e0b' : status?.status === 'failed' ? '#f87171' : '#64748b'
                const text = status?.status === 'deployed' ? t('plugin.deployed') : status?.status === 'unsupported' ? t('plugin.mscaUnsupported') : status?.status === 'failed' ? t('plugin.failed') : t('plugin.notChecked')
                const authorizationFailed = mscaState.chainAuthorizationStatus?.[key] === 'failed'
                return <div key={key} style={{ padding: '6px 8px', borderRadius: 6, background: 'rgba(18,18,26,0.6)', border: `1px solid ${color}33`, fontSize: 10 }}><div style={{ color: '#cbd5e1' }}>{label}</div><div style={{ color }}>{text}</div>{authorizationFailed && <div style={{ color: '#f87171', marginTop: 2 }}>{t('plugin.authorizationPending')}</div>}{status?.error && <div title={status.error} style={{ color: '#94a3b8', marginTop: 2, lineHeight: 1.2 }}>{status.error.slice(0, 180)}</div>}</div>
              })}
            </div>
            {Object.values(mscaState.deploymentStatus || {}).some(status => status.status === 'failed') && <button className='btn' style={{ width: '100%', marginBottom: 8, fontSize: 11 }} disabled={busy === 'deployments'} onClick={() => run('deployments', retryMscaDeployments)}>↻ {t('plugin.retryDeployment')}</button>}
            <Row label={t('plugin.passkeyLabel')} value={<span style={{ color: '#4ade80' }}>{t('plugin.passkeyRegistered')}</span>} />
            <Row label={t('plugin.contract')} value={mscaState.deployed
              ? <span style={{ color: '#4ade80' }}>{t('plugin.deployed')}</span>
              : <span style={{ color: '#f59e0b' }}>{t('plugin.notDeployed')}</span>
            } />
            {mscaState.delegateAddress ? (
              <>
                <Row label={t('plugin.delegateKey')} value={<span style={{ fontFamily: 'monospace', fontSize: 11 }}>{mscaState.delegateAddress?.slice(0, 10)}...{mscaState.delegateAddress?.slice(-6)}</span>} />
                <Row label={t('common.status')} value={mscaState.sessionActive
                  ? <span style={{ color: '#4ade80' }}>{t('plugin.sessionActiveWithLimit')}</span>
                  : <span style={{ color: '#f59e0b' }}>{t('plugin.sessionInactiveLabel')}</span>
                } />
                {!mscaState.sessionActive && (
                  <div style={{ marginTop: 8, color: '#94a3b8', fontSize: 12 }}>
                    {t('plugin.sessionKeyInactiveHint')}
                  </div>
                )}
              </>
            ) : (
              <div style={{ marginTop: 8, color: '#94a3b8', fontSize: 12 }}>
                {t('plugin.loginPasskey')} untuk mengaktifkan session key otomatis. Session key hanya dapat dimatikan melalui {t('plugin.revoke')}.
              </div>
            )}
            {mscaState.sessionActive && (
              <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: destinationReady ? 'rgba(16,185,129,0.08)' : 'rgba(99,102,241,0.08)', border: `1px solid ${destinationReady ? 'rgba(16,185,129,0.3)' : 'rgba(99,102,241,0.3)'}` }}>
                <div style={{ color: destinationReady ? '#4ade80' : '#a5b4fc', fontSize: 11, marginBottom: 7 }}>
                  {destinationReady ? t('plugin.baseSepoliaReady') : t('plugin.destinationBridgeHint')}
                </div>
                {!destinationReady && <button className='btn btn-primary' style={{ width: '100%', fontSize: 11 }} disabled={busy === 'destination'} onClick={() => run('destination', prepareBaseSepoliaBridge)}>
                  🛡️ {t('plugin.deployBaseBridge')}
                </button>}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              {mscaState.sessionActive && (
                <button className='btn' style={{ flex: 1, background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' }} disabled={busy === 'revoke'} onClick={() => run('revoke', revokeSession)}>
                  {t('plugin.revoke')}
                </button>
              )}
              <button className='btn' style={{ flex: 1 }} disabled={busy === 'login'} onClick={() => run('login', loginMsca)}>
                {t('plugin.loginPasskey')}
              </button>
            </div>
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #1e1e2e' }}>
              <div style={{ color: '#64748b', fontSize: 11, marginBottom: 6 }}>
                {t('plugin.newWalletWarning')}
              </div>
              <button className='btn' style={{ width: '100%', border: '1px solid rgba(239,68,68,0.4)', color: '#fca5a5', background: 'rgba(239,68,68,0.08)' }} disabled={busy === 'register'} onClick={async () => {
                if (!window.confirm(t('plugin.newWalletConfirm'))) return
                run('register', forceRegisterMsca)
              }}>
                🆕 {t('plugin.newWalletButton')}
              </button>
            </div>
          </div>
        )}
      </Section>

      {/* Multi-chain Agent Wallet Balances */}
      {mscaState.walletAddress && (
        <Section title={t('plugin.multiBalances')} style={{ order: -39 }}>
          <MultiChainBalances walletAddress={mscaState.walletAddress} />
        </Section>
      )}

      {/* Pending Transactions (passkey approval) */}
      {pendingTxs.length > 0 && (
        <Section title={t('plugin.pending')} badge={<span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}>{pendingTxs.length}</span>}>
          {pendingTxs.map(tx => (
            <div key={tx.txId} style={{ padding: '8px 0', borderBottom: '1px solid #1e1e2e' }}>
              <div style={{ fontSize: 12, color: '#e2e8f0', marginBottom: 4 }}>
                <span style={{ color: '#f59e0b' }}>{t('plugin.agentRequests')}</span>
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
                    if (result.txHash) alert(`${t('plugin.txSuccess')}\n${result.explorerUrl}`)
                  } catch (e: any) {
                    setError(e?.message || t('plugin.signFailed'))
                  } finally { setBusy(null) }
                }}
              >
                {busy === `pending-${tx.txId}` ? t('plugin.signing') : t('plugin.approvePasskey')}
              </button>
            </div>
          ))}
        </Section>
      )}

      {/* Activity */}
      <Section title={t('plugin.activityAgent')} badge={<span style={{ fontSize: 11, color: '#64748b' }}>{t('plugin.latestFive')}</span>}>
        {activity.length === 0 ? (
          <div style={{ color: '#64748b', fontSize: 12 }}>{t('plugin.noActivity')}</div>
        ) : (
          activity.slice(0, 5).map(a => (
            <div key={a.id} style={{ fontSize: 11, color: '#94a3b8', padding: '4px 0', borderBottom: '1px solid #1e1e2e' }}>
              <span style={{ color: '#e2e8f0' }}>{a.type.replace(/_/g, ' ')}</span>
              {a.data?.amount && <span> · {String(a.data.amount)} {String(a.data.token || 'USDC')}</span>}
              {a.data?.txHash && <span style={{ fontFamily: 'monospace' }}> · tx {String(a.data.txHash).slice(0, 10)}…</span>}
              <span> · {fmtTime(a.ts)}</span>
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
