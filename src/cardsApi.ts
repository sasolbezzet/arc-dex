import { getAuthToken } from './auth'

export type CardStatus = 'active' | 'frozen' | 'closed'

export type SimCard = {
  cardId: string
  owner: string
  label: string
  brand: string
  network: string
  last4: string
  pan: string
  cvv?: string
  expMonth: string
  expYear: string
  status: CardStatus
  blockedCategories: string[]
  limits: { perTx: string; daily: string; monthly: string }
  usage: { today: string; month: string }
  createdAt: string
}

export type SimMerchant = {
  merchantId: string
  name: string
  category: string
  emoji: string
  description: string
}

export type CardTx = {
  id: string
  cardId: string
  owner: string
  merchantId: string
  merchantName: string
  category: string
  description: string
  amount: string
  status: 'authorized' | 'settled' | 'refunded' | 'declined'
  authCode: string
  createdAt: string
  settledAt: string | null
  refundedAt: string | null
  declineReason?: string
}

export function cardConfigPublic() {
  return {
    mode: 'simulator',
    brand: 'Visa Test',
    network: 'visa',
    asset: 'USDC',
    chain: 'arc-testnet',
    simulated: true,
  }
}

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

export function getCardConfig() {
  return api('/api/cards/config')
}
export function getMerchants(): Promise<{ ok: boolean; merchants: SimMerchant[] }> {
  return api('/api/cards/merchants')
}
export function getCardBalance() {
  return api('/api/cards/balance')
}
export function fundCardBalance(amount: string) {
  return api('/api/cards/balance/fund', { method: 'POST', body: JSON.stringify({ amount }) })
}
export function listCards(): Promise<{ ok: boolean; cards: SimCard[] }> {
  return api('/api/cards')
}
export function createCard(input: Record<string, unknown>): Promise<{ ok: boolean; card: SimCard }> {
  return api('/api/cards', { method: 'POST', body: JSON.stringify(input) })
}
export function updateCardLimits(cardId: string, input: Record<string, unknown>) {
  return api(`/api/cards/${encodeURIComponent(cardId)}/limits`, { method: 'PATCH', body: JSON.stringify(input) })
}
export function setCardStatus(cardId: string, status: CardStatus) {
  return api(`/api/cards/${encodeURIComponent(cardId)}/status`, { method: 'POST', body: JSON.stringify({ status }) })
}
export function spendWithCard(cardId: string, input: Record<string, unknown>) {
  return api(`/api/cards/${encodeURIComponent(cardId)}/spend`, { method: 'POST', body: JSON.stringify(input) })
}
export function refundCardTx(cardId: string, txId: string) {
  return api(`/api/cards/${encodeURIComponent(cardId)}/refund`, { method: 'POST', body: JSON.stringify({ txId }) })
}
export function listMyCardTransactions(): Promise<{ ok: boolean; transactions: CardTx[] }> {
  return api('/api/cards/my-transactions')
}