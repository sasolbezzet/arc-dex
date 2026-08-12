import { safePost, HttpError } from './api'
import { getAddress } from 'viem'
import { findConnectedWalletProvider, type Eip1193Provider } from './walletProvider'

const STORAGE_KEY = 'arc-dex-auth'
const BACKEND_PREFERENCE_KEY = 'arc-dex-auth-backend-pref'
// Re-auth window: any JWT older than this is treated as expired even if the
// server returns a longer token. Defense in depth against C-001.
const MAX_TOKEN_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
// ≥16 random bytes (128 bits) → cryptographically strong nonce.
const NONCE_BYTES = 16
// Arc Testnet chainId (decimal). Hex value is 0x4cef52.
const ARC_TESTNET_CHAIN_ID = 5042002
const ARC_TESTNET_CHAIN_ID_HEX = '0x4cef52'
// SIWE is disabled by default for safety. Set VITE_SIWE_ENABLED=true in your
// Vercel/project environment once the backend has been migrated to verify SIWE
// messages. Until then the legacy 5-line message keeps the site working.
const SIWE_ENABLED = import.meta.env?.VITE_SIWE_ENABLED === 'true'
// Optional override for the domain/origin bound in the SIWE message. Useful
// for preview deployments or local development where the backend expects a
// specific domain.
const SIWE_DOMAIN = import.meta.env?.VITE_SIWE_DOMAIN || undefined

const SIWE_ORIGIN = SIWE_DOMAIN ? `https://${SIWE_DOMAIN}` : undefined

type AuthMode = 'siwe' | 'legacy'
type BackendPreference = { supportsSiwe: boolean; updatedAt: number }
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

function readBackendPreference(): BackendPreference | null {
  try {
    const raw = localStorage.getItem(BACKEND_PREFERENCE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (typeof parsed?.supportsSiwe !== 'boolean') return null
    return parsed as BackendPreference
  } catch {
    return null
  }
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

// JWT layout is header.payload.signature. Read the PAYLOAD segment (index 1),
// not the header (index 0). The exp claim is in seconds, so multiply by 1000.
export function readTokenExp(token: string): number | null {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - payload.length % 4) % 4)
    const data = JSON.parse(atob(padded))
    return typeof data?.exp === 'number' ? data.exp * 1000 : null
  } catch {
    return null
  }
}

export function getAuthToken() {
  return getAuthSession()?.token || ''
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
  const signature = await provider.request({
    method: 'personal_sign',
    params: [message, address],
  })
  return safePost('', '/api/auth/session', {
    address,
    issuedAt,
    expiresAt,
    nonce,
    signature,
    mode,
    ...(mode === 'siwe' ? { message } : {}),
  })
}

export async function ensureAuthSession(address: string, forceNew = false) {
  const checksumAddress = getAddress(address)
  const normalized = checksumAddress.toLowerCase()
  const existing = getAuthSession()
  if (!forceNew && existing?.token && existing.address.toLowerCase() === normalized) return existing.token
  const provider = await findConnectedWalletProvider(checksumAddress)
  if (!provider) throw new Error('Wallet EVM tidak terdeteksi')

  const preference = readBackendPreference()
  const backendPrefersSiwe = preference ? preference.supportsSiwe : true

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
