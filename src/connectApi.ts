import { getAuthToken } from './auth'

const HEADERS = (extra?: Record<string, string>) => ({
  'Content-Type': 'application/json',
  ...(getAuthToken() ? { Authorization: `Bearer ${getAuthToken()}` } : {}),
  ...extra,
})

async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(path, {
    ...init,
    headers: HEADERS(init?.headers as Record<string, string> | undefined),
  })
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
export function getConnectAccount(): Promise<{ ok: boolean; account: ConnectAccount | null }> {
  return api('/api/connect/account')
}
export function onboardConnect(input: { displayName?: string; contactEmail?: string }) {
  return api('/api/connect/onboard', { method: 'POST', body: JSON.stringify(input) })
}
export function getConnectStatus() {
  return api('/api/connect/status')
}
export function createConnectProduct(input: { name: string; description?: string; priceCents: number; currency?: string }) {
  return api('/api/connect/products', { method: 'POST', body: JSON.stringify(input) })
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
export function subscribeConnect() {
  return api('/api/connect/subscribe', { method: 'POST', body: JSON.stringify({}) })
}
export function openConnectPortal() {
  return api('/api/connect/portal', { method: 'POST', body: JSON.stringify({}) })
}
