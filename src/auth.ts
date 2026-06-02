import { safePost } from './api'

const STORAGE_KEY = 'arc-dex-auth'

type AuthSession = {
  address: string
  token: string
}

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
    return raw ? JSON.parse(raw) : null
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

export async function ensureAuthSession(address: string) {
  const normalized = address.toLowerCase()
  const existing = readSession()
  if (existing?.token && existing.address.toLowerCase() === normalized) return existing.token
  if (!window.ethereum) throw new Error('MetaMask tidak terdeteksi')
  const issuedAt = new Date().toISOString()
  const message = buildAuthMessage(address, issuedAt)
  const signature = await window.ethereum.request({
    method: 'personal_sign',
    params: [message, address],
  })
  const result = await safePost('', '/api/auth/session', { address, issuedAt, signature })
  const session = { address: result.address || address, token: result.token }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  return session.token
}
