import { safePost } from './api'
import { getAddress } from 'viem'
import { findConnectedWalletProvider } from './walletProvider'

const STORAGE_KEY = 'arc-dex-auth'
// Re-auth window: any JWT older than this is treated as expired even if the
// server returns a longer token. Defense in depth against C-001.
const MAX_TOKEN_AGE_MS = 12 * 60 * 60 * 1000 // 12 hours
// ≥16 random bytes (128 bits) → cryptographically strong nonce.
const NONCE_BYTES = 16

type AuthSession = {
  address: string
  token: string
  issuedAt: number
}

function generateNonceHex(): string {
  const buf = new Uint8Array(NONCE_BYTES)
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(buf)
  } else {
    // Fallback to Math.random ONLY if Web Crypto is unavailable.
    // This branch is exceptional and only triggered in non-secure-context
    // browsers. Browsers running on https:// always have getRandomValues.
    for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256)
  }
  let hex = ''
  for (const b of buf) hex += b.toString(16).padStart(2, '0')
  return hex
}

// Backwards-compatible legacy message format used by the current
// /api/auth/session backend. We deliberately do NOT change the message
// shape here because the backend reconstructs the same 5-line body to
// verify the personal_sign signature; changing it on the client alone
// would reject every login. Server-side cooperates via `nonce` and
// `expiresAt` in the JSON body (see C-002 replay fix).
function buildAuthMessage(address: string, issuedAt: string) {
  return [
    'ARCOX DEX login',
    'Only sign this message on the official ARCOX DEX website.',
    `Address: ${address}`,
    `Issued At: ${issuedAt}`,
    'Network: Arc Testnet',
  ].join('\n')
}

function readSession(): AuthSession | null {
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
function readTokenExp(token: string): number | null {
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
  return readSession()?.token || ''
}

export function clearAuthSession() {
  localStorage.removeItem(STORAGE_KEY)
}

export async function ensureAuthSession(address: string, forceNew = false) {
  const checksumAddress = getAddress(address)
  const normalized = checksumAddress.toLowerCase()
  const existing = readSession()
  if (!forceNew && existing?.token && existing.address.toLowerCase() === normalized) return existing.token
  const provider = await findConnectedWalletProvider(checksumAddress)
  if (!provider) throw new Error('Wallet EVM tidak terdeteksi')
  const issuedAt = new Date().toISOString()
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString()
  const nonce = generateNonceHex()
  const message = buildAuthMessage(checksumAddress, issuedAt)
  const signature = await provider.request({
    method: 'personal_sign',
    params: [message, checksumAddress],
  })
  // Nonce + expiresAt are sent as separate JSON claims. The existing backend
  // will simply ignore any claim it does not understand; once it is updated
  // to reject used nonces and expired issuedAt, the field set is ready.
  const result = await safePost('', '/api/auth/session', {
    address: checksumAddress,
    issuedAt,
    expiresAt,
    nonce,
    signature,
  })
  const session: AuthSession = {
    address: result.address || checksumAddress,
    token: result.token,
    issuedAt: Date.now(),
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  return session.token
}
