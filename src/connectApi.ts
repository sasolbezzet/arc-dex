import { getAuthToken } from './auth'

function getPasskeyToken() {
  try { return localStorage.getItem('arx_passkey_vault_token') || '' } catch { return '' }
}

function getConnectAuthToken() {
  return getPasskeyToken() || getAuthToken()
}

const HEADERS = (extra?: Record<string, string>, token = getConnectAuthToken()) => ({
  'Content-Type': 'application/json',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
  ...extra,
})

async function api<T = any>(path: string, init?: RequestInit, authToken?: string): Promise<T> {
  const primaryToken = authToken || getConnectAuthToken()
  let resp = await fetch(path, {
    ...init,
    headers: HEADERS(init?.headers as Record<string, string> | undefined, primaryToken),
  })
  const fallbackToken = getAuthToken()
  if (!authToken && resp.status === 401 && fallbackToken && fallbackToken !== primaryToken) {
    resp = await fetch(path, {
      ...init,
      headers: HEADERS(init?.headers as Record<string, string> | undefined, fallbackToken),
    })
  }
  const text = await resp.text()
  let data: any = {}
  try { data = text ? JSON.parse(text) : {} } catch { data = { raw: text } }
  if (!resp.ok) throw new Error(data?.error || `HTTP ${resp.status}`)
  return data as T
}

export type ConnectConfig = {
  configured: boolean
  testMode: boolean
  publicKey: string
  appFeeBasisPoints: number
  subscriptionPriceId: string
  currency: string
}

export type ConnectAccount = {
  owner: string
  accountId: string
  displayName: string
  contactEmail: string
  cardPayments: string
  readyToProcessPayments: boolean
  requirementsStatus: string
  onboardingComplete: boolean
}

export type ConnectProduct = {
  id: string
  name: string
  description: string | null
  default_price?: { id: string; unit_amount: number; currency: string } | null
}

export function getConnectConfig(): Promise<{ ok: boolean } & ConnectConfig> {
  return api('/api/connect/config')
}
export type ConnectAccess = {
  ok: boolean
  active: boolean
  walletAddress?: string | null
  statusReason?: string
  requiresPasskey?: boolean
}

export function getConnectAccess(): Promise<ConnectAccess> {
  return api('/api/connect/access')
}
export function getConnectAccount(): Promise<{ ok: boolean; account: ConnectAccount | null }> {
  return api('/api/connect/account')
}
export function onboardConnect(input: { displayName?: string; contactEmail?: string }, authToken?: string) {
  return api('/api/connect/onboard', { method: 'POST', body: JSON.stringify(input) }, authToken)
}
export function getConnectStatus() {
  return api('/api/connect/status')
}
export function createConnectProduct(input: { name: string; description?: string; priceCents: number; currency?: string }, authToken?: string) {
  return api('/api/connect/products', { method: 'POST', body: JSON.stringify(input) }, authToken)
}
export function getConnectProducts(): Promise<{ ok: boolean; products: ConnectProduct[] }> {
  return api('/api/connect/products')
}
export function getStorefrontProducts(accountId: string): Promise<{ ok: boolean; products: ConnectProduct[] }> {
  return api(`/api/connect/store/${encodeURIComponent(accountId)}/products`)
}
export function checkoutStoreProduct(accountId: string, productId: string, quantity: number) {
  return api(`/api/connect/store/${encodeURIComponent(accountId)}/checkout`, {
    method: 'POST',
    body: JSON.stringify({ productId, quantity }),
  })
}
export function subscribeConnect(authToken?: string) {
  return api('/api/connect/subscribe', { method: 'POST', body: JSON.stringify({}) }, authToken)
}
export function openConnectPortal(authToken?: string) {
  return api('/api/connect/portal', { method: 'POST', body: JSON.stringify({}) }, authToken)
}
