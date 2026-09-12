import { safePost, HttpError } from './api'
import { getAddress } from 'viem'
import { findConnectedWalletProvider, setWalletProvider, type Eip1193Provider } from './walletProvider'
import { openWalletConnectAppForSigning, resumeWalletConnect, restoreWalletConnect, getWalletConnectProviderSync } from './services/walletConnect'

const STORAGE_KEY = 'arc-dex-auth'
const BACKEND_PREFERENCE_KEY = 'arc-dex-auth-backend-pref'
// Keep the first owner connection alive for the same 24-hour window as the
// backend owner session. Refreshing the page may restore UI state silently,
// but once this window expires an explicit wallet signature is required.
const MAX_TOKEN_AGE_MS = 24 * 60 * 60 * 1000 // 24 hours
// ≥16 random bytes (128 bits) → cryptographically strong nonce.
const NONCE_BYTES = 16
// Arc Testnet chainId (decimal). Hex value is 0x4cef52.
const ARC_TESTNET_CHAIN_ID = 5042002
const ARC_TESTNET_CHAIN_ID_HEX = '0x4cef52'
// The backend verifies EIP-4361 SIWE. Owner authorization after passkey must
// always be an explicit domain/chain/nonce-bound wallet signature. Do not let a
// stale Vercel env flag or browser preference silently downgrade this flow.
const SIWE_ENABLED = true
// Optional override for the domain/origin bound in the SIWE message. Useful
// for preview deployments or local development where the backend expects a
// specific domain.
const SIWE_DOMAIN = import.meta.env?.VITE_SIWE_DOMAIN || undefined

const SIWE_ORIGIN = SIWE_DOMAIN ? `https://${SIWE_DOMAIN}` : undefined

type AuthMode = 'siwe' | 'legacy'
type AuthSession = {
  address: string
  token: string
  issuedAt: number
}

export function generateNonceHex(): string {
  const buf = new Uint8Array(NONCE_BYTES)
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(buf)
  } else {
    // Non-secure contexts should not be used for wallet signing. Web Crypto is
    // available in every modern browser served over HTTPS, so refusing to
    // proceed here is the safest behaviour.
    throw new Error('Web Crypto API is unavailable; cannot generate a secure SIWE nonce.')
  }
  let hex = ''
  for (const b of buf) hex += b.toString(16).padStart(2, '0')
  return hex
}

function setBackendPreference(supportsSiwe: boolean) {
  try {
    localStorage.setItem(BACKEND_PREFERENCE_KEY, JSON.stringify({ supportsSiwe, updatedAt: Date.now() }))
  } catch {
    // ignore storage errors
  }
}

// Backwards-compatible legacy message format used by the current
// /api/auth/session backend. We deliberately keep the legacy shape here so
// that the server can continue to verify `personal_sign` signatures during a
// transitional period. Once the backend no longer accepts legacy messages this
// branch can be removed.
function buildLegacyAuthMessage(address: string, issuedAt: string) {
  return [
    'ARCOX DEX login',
    'Only sign this message on the official ARCOX DEX website.',
    `Address: ${address}`,
    `Issued At: ${issuedAt}`,
    'Network: Arc Testnet',
  ].join('\n')
}

async function getActiveChainId(provider: Eip1193Provider): Promise<number> {
  try {
    const chainIdHex = await provider.request({ method: 'eth_chainId' })
    const chainId = Number(chainIdHex)
    return Number.isSafeInteger(chainId) && chainId > 0 ? chainId : ARC_TESTNET_CHAIN_ID
  } catch {
    return ARC_TESTNET_CHAIN_ID
  }
}

async function isArcTestnetActive(provider: Eip1193Provider) {
  try {
    const chainId = await provider.request({ method: 'eth_chainId' })
    return chainId === ARC_TESTNET_CHAIN_ID_HEX || Number(chainId) === ARC_TESTNET_CHAIN_ID
  } catch {
    return false
  }
}

async function switchToArcTestnet(provider: Eip1193Provider) {
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: ARC_TESTNET_CHAIN_ID_HEX }],
    })
    return true
  } catch (switchError: any) {
    if (switchError?.code === 4902) {
      try {
        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: ARC_TESTNET_CHAIN_ID_HEX,
            chainName: 'Arc Testnet',
            nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
            rpcUrls: ['https://rpc.testnet.arc.io', 'https://arc-testnet.drpc.org'],
            blockExplorerUrls: ['https://testnet.arcscan.app'],
          }],
        })
        // Adding the chain does not automatically switch to it. Retry the switch.
        await provider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: ARC_TESTNET_CHAIN_ID_HEX }],
        })
        return true
      } catch {
        return false
      }
    }
    return false
  }
}

async function tryAuthenticateSiwe(provider: Eip1193Provider, address: string): Promise<{ token: string; address?: string } | null> {
  try {
    const result = await authenticate(provider, address, 'siwe')
    setBackendPreference(true)
    return result
  } catch (error) {
    if (isSiweUnsupportedError(error)) {
      setBackendPreference(false)
      return null
    }
    throw error
  }
}

async function ensureArcTestnetAndAuthenticate(provider: Eip1193Provider, address: string): Promise<{ token: string; address?: string }> {
  const onArcTestnet = await isArcTestnetActive(provider)
  if (onArcTestnet) {
    const result = await tryAuthenticateSiwe(provider, address)
    if (result) return result
  } else {
    const switched = await switchToArcTestnet(provider)
    if (switched && await isArcTestnetActive(provider)) {
      const result = await tryAuthenticateSiwe(provider, address)
      if (result) return result
    }
  }
  return authenticate(provider, address, 'legacy')
}

export async function buildSiweMessage(
  address: string,
  nonce: string,
  issuedAt: string,
  expiresAt: string,
  provider: Eip1193Provider,
): Promise<string> {
  const host = SIWE_DOMAIN || (typeof window !== 'undefined' ? window.location.host : 'arcoxdex.vercel.app')
  const origin = SIWE_ORIGIN || (typeof window !== 'undefined' ? window.location.origin : `https://${host}`)
  const chainId = await getActiveChainId(provider)
  // Dynamic import keeps the siwe/ethers chunk out of the main bundle when
  // SIWE is disabled (the default). It is only loaded when a user enables
  // VITE_SIWE_ENABLED=true and attempts to log in.
  const { SiweMessage } = await import('siwe')
  const message = new SiweMessage({
    domain: host,
    address,
    statement: 'Only sign this message on the official ARCOX DEX website.',
    uri: origin,
    version: '1',
    chainId,
    nonce,
    issuedAt,
    expirationTime: expiresAt,
  })
  return message.prepareMessage()
}

export function getAuthSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const session = raw ? JSON.parse(raw) : null
    if (!session?.token || !session?.address) return null
    const exp = readTokenExp(session.token)
    if (exp && Date.now() > exp) {
      localStorage.removeItem(STORAGE_KEY)
      return null
    }
    if (session.issuedAt && Date.now() - session.issuedAt > MAX_TOKEN_AGE_MS) {
      localStorage.removeItem(STORAGE_KEY)
      return null
    }
    return session
  } catch {
    return null
  }
}

// The app accepts both normal JWTs (header.payload.signature) and the
// two-part HMAC owner tokens minted by this backend (payload.signature).
// Read the segment that contains the JSON payload in either format.
export function readTokenExp(token: string): number | null {
  try {
    const parts = String(token || '').split('.')
    const payload = parts.length === 2 ? parts[0] : parts[1]
    if (!payload) return null
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - payload.length % 4) % 4)
    const data = JSON.parse(atob(padded))
    if (typeof data?.exp !== 'number') return null
    // JWT exp is seconds; the backend's two-part HMAC owner token uses epoch
    // milliseconds. Accept both formats so a persisted owner session does not
    // survive beyond its real 24-hour TTL or expire immediately on refresh.
    return data.exp > 1_000_000_000_000 ? data.exp : data.exp * 1000
  } catch {
    return null
  }
}

export function getAuthToken() {
  return getAuthSession()?.token || ''
}

export async function requireConnectedOwnerWallet(): Promise<{ address: string; provider: Eip1193Provider }> {
  // WalletConnect sessions are persisted independently from the injected
  // provider. Restore them passively before searching providers so a mobile
  // Chrome refresh does not turn an already-connected owner into an apparent
  // disconnected wallet. `restoreWalletConnect` only calls eth_accounts; it
  // never opens the QR modal, requests accounts, or asks for SIWE.
  let provider = await findConnectedWalletProvider()
  let accounts = provider ? await provider.request({ method: 'eth_accounts' }).catch(() => []) : []
  let address = String(accounts?.[0] || '').trim()
  if (!address) {
    try {
      const restoredAddress = await restoreWalletConnect()
      const restoredProvider = getWalletConnectProviderSync()
      if (restoredAddress && restoredProvider) {
        provider = await findConnectedWalletProvider(restoredAddress) || restoredProvider
        if (!provider) throw new Error('WalletConnect provider tidak tersedia setelah restore.')
        setWalletProvider(provider)
        accounts = await provider.request({ method: 'eth_accounts' }).catch(() => [])
        address = String(accounts?.[0] || restoredAddress).trim()
      }
    } catch { /* explicit connect/signature below remains the recovery path */ }
  }
  if (!provider || !address) throw new Error('Hubungkan wallet utama terlebih dahulu sebelum Login passkey Agent Wallet.')
  return { address: getAddress(address), provider }
}

/**
 * Return a session for the wallet that is actually connected in this browser.
 * A cached SIWE token alone is intentionally insufficient for agent linking:
 * passkey ownership must be attached to the currently connected owner EOA,
 * never to an address left in an environment variable or stale localStorage.
 */
export async function ensureConnectedOwnerSession(): Promise<{ address: string; token: string }> {
  const { address: normalizedAddress } = await requireConnectedOwnerWallet()
  let ownerSessionIsValid = false

  // The connected EOA session is the owner proof. Reuse it for every agent
  // operation while it is still valid; do not ask the owner to sign SIWE again
  // merely because a passkey flow (Hermes/Claude/GPT) starts. A new SIWE is
  // required only on the first owner connection, after expiry, or after the
  // user switches to a different EOA.
  const existing = getAuthSession()
  if (existing?.token && existing.address.toLowerCase() === normalizedAddress.toLowerCase()) {
    // Confirm the owner token against the live backend before using it for
    // agent binding. A stale local token can have the right address but belong
    // to a different API worker/session store after deployment.
    try {
      const probe = await fetch('/api/vault/limits', {
        headers: { Authorization: `Bearer ${existing.token}` },
        signal: AbortSignal.timeout(10_000),
      })
      if (probe.ok) {
        ownerSessionIsValid = true
        try {
          localStorage.setItem('arx_owner_vault_token', existing.token)
          localStorage.setItem('arx_eoa_vault_token', existing.token)
        } catch { /* ignore */ }
        const ownerToken = localStorage.getItem('arx_owner_vault_token') || ''
        if (ownerToken) return { address: normalizedAddress, token: ownerToken }
        // The connected-wallet session itself is still valid. Reuse it for
        // agent actions on deployments whose backend does not mint a separate
        // owner vault token; do not trigger another SIWE ceremony.
        if (existing.token) {
          localStorage.setItem('arx_owner_vault_token', existing.token)
          localStorage.setItem('arx_eoa_vault_token', existing.token)
          return { address: normalizedAddress, token: existing.token }
        }
        localStorage.removeItem(STORAGE_KEY)
      }
    } catch { /* re-authenticate below */ }
  }
  // `ensureAuthSession()` normally reuses a matching cached token. That is
  // exactly the wrong behavior after the live probe rejected an expired or
  // worker-local session: it would loop back with the same dead token and never
  // open the SIWE prompt. Force a fresh owner signature only in that case.
  if (!ownerSessionIsValid) {
    try {
      localStorage.removeItem('arx_owner_vault_token')
      localStorage.removeItem('arx_eoa_vault_token')
    } catch { /* ignore */ }
  }
  await ensureAuthSession(normalizedAddress, !ownerSessionIsValid)
  // `ensureAuthSession` stores the HMAC dapp token. The owner vault token is
  // returned separately by `/api/auth/session` and is copied above by
  // authenticate(); do not confuse the two token namespaces.
  const ownerToken = (() => {
    try { return localStorage.getItem('arx_owner_vault_token') || '' } catch { return '' }
  })()
  if (!ownerToken) {
    // Older backend responses may only return the authenticated dapp token.
    // Reuse it when the live wallet session is already verified; forcing SIWE
    // here would make every Agent Wallet button sign again.
    const fallbackToken = getAuthSession()?.token || ''
    if (!fallbackToken) throw new Error('Owner vault session tidak diterbitkan oleh backend. Silakan login wallet utama lagi.')
    try {
      localStorage.setItem('arx_owner_vault_token', fallbackToken)
      localStorage.setItem('arx_eoa_vault_token', fallbackToken)
    } catch { /* ignore */ }
    return { address: normalizedAddress, token: fallbackToken }
  }
  try { localStorage.setItem('arx_eoa_vault_token', ownerToken) } catch { /* ignore */ }
  return { address: normalizedAddress, token: ownerToken }
}

export function clearAuthSession() {
  localStorage.removeItem(STORAGE_KEY)
}

// Determine whether a backend rejection is an explicit signal that the server
// does not yet understand SIWE. We deliberately do NOT fall back for generic
// errors such as "Invalid SIWE signature" because that would silently downgrade
// a real security failure.
export function isSiweUnsupportedError(error: unknown): boolean {
  if (!error) return false
  if (error instanceof HttpError) {
    if (error.status === 501) return true
    const code = error.body?.code
    if (code === 'SIWE_NOT_SUPPORTED' || code === 'UNSUPPORTED_AUTH_MODE') return true
  }
  return false
}

async function authenticate(
  provider: Eip1193Provider,
  address: string,
  mode: AuthMode,
): Promise<{ token: string; address?: string }> {
  const issuedAt = new Date().toISOString()
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString()
  const nonce = generateNonceHex()
  const message = mode === 'siwe'
    ? await buildSiweMessage(address, nonce, issuedAt, expiresAt, provider)
    : buildLegacyAuthMessage(address, issuedAt)
  // WalletConnect mobile can leave the relay socket dormant after the browser
  // returns from the passkey prompt. Re-open the relay immediately before the
  // owner signature request so the request is delivered to the connected wallet
  // app instead of leaving the UI waiting forever. This is a transport wake-up,
  // not a signature and never bypasses the wallet confirmation screen.
  if ((provider as Eip1193Provider & { isWalletConnect?: boolean }).isWalletConnect) {
    await resumeWalletConnect()
  }
  const signatureRequest = provider.request({
    method: 'personal_sign',
    params: [message, address],
  })
  // Create the request first so WalletConnect queues it, then foreground the
  // connected wallet app through the peer's advertised redirect. Returning to
  // ARCOX resolves this same request; no second signature is generated.
  if ((provider as Eip1193Provider & { isWalletConnect?: boolean }).isWalletConnect) {
    void openWalletConnectAppForSigning()
  }
  const signature = await Promise.race([
    signatureRequest,
    new Promise<never>((_, reject) => {
      window.setTimeout(() => reject(new Error('Permintaan SIWE belum dijawab wallet. Buka aplikasi wallet, setujui signature, lalu kembali ke ARCOX.')), 180_000)
    }),
  ])
  const result = await safePost('', '/api/auth/session', {
    address,
    issuedAt,
    expiresAt,
    nonce,
    signature,
    mode,
    ...(mode === 'siwe' ? { message } : {}),
  })
  // Prefer the durable owner-session token returned by the backend. The HMAC
  // token remains the dapp auth token; arx_vs_* is the token accepted by vault
  // and session-key middleware across API workers.
  if (result?.ownerSessionToken) {
    try { localStorage.setItem('arx_owner_vault_token', result.ownerSessionToken) } catch { /* ignore */ }
  }
  return result
}

export async function ensureAuthSession(address: string, forceNew = false) {
  const checksumAddress = getAddress(address)
  const normalized = checksumAddress.toLowerCase()
  const existing = getAuthSession()
  if (!forceNew && existing?.token && existing.address.toLowerCase() === normalized) return existing.token
  const provider = await findConnectedWalletProvider(checksumAddress)
  if (!provider) throw new Error('Wallet EVM tidak terdeteksi')

  // The backend verifies SIWE and owner authorization after passkey must use
  // an explicit domain/chain/nonce-bound wallet signature.
  const backendPrefersSiwe = SIWE_ENABLED

  let result: { token: string; address?: string }

  if (SIWE_ENABLED && backendPrefersSiwe) {
    result = await ensureArcTestnetAndAuthenticate(provider, checksumAddress)
  } else {
    result = await authenticate(provider, checksumAddress, 'legacy')
  }

  const session: AuthSession = {
    address: result.address || checksumAddress,
    token: result.token,
    issuedAt: Date.now(),
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  return session.token
}
