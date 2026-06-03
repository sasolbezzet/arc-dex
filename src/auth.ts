import { safePost } from './api'
import { getAddress } from 'viem'

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
    const session = raw ? JSON.parse(raw) : null
    if (!session?.token || !session?.address) return null
    const exp = readTokenExp(session.token)
    if (exp && Date.now() > exp) {
      localStorage.removeItem(STORAGE_KEY)
      return null
    }
    return session
  } catch {
    return null
  }
}

function readTokenExp(token: string): number | null {
  try {
    const payload = token.split('.')[0]
    if (!payload) return null
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - payload.length % 4) % 4)
    const data = JSON.parse(atob(padded))
    return typeof data?.exp === 'number' ? data.exp : null
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
  if (!window.ethereum) throw new Error('MetaMask tidak terdeteksi')
  const issuedAt = new Date().toISOString()
  const message = buildAuthMessage(checksumAddress, issuedAt)
  const signature = await window.ethereum.request({
    method: 'personal_sign',
    params: [message, checksumAddress],
  })
  const result = await safePost('', '/api/auth/session', { address: checksumAddress, issuedAt, signature })
  const session = { address: result.address || checksumAddress, token: result.token }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  return session.token
}
