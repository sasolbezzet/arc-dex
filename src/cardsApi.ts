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
  provider?: string
  providerCardId?: string | null
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

function getPasskeyToken() {
  try { return localStorage.getItem('arx_passkey_vault_token') || '' } catch { return '' }
}

function getCardAuthToken() {
  // Card endpoints are MSCA-gated. The normal DEX login token proves EOA
  // ownership, while the Passkey vault token proves an active MSCA session.
  return getPasskeyToken() || getAuthToken()
}

const HEADERS = (extra?: Record<string, string>, token = getCardAuthToken()) => ({
  'Content-Type': 'application/json',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
  ...extra,
})

async function api<T = any>(path: string, init?: RequestInit, authToken?: string): Promise<T> {
  const primaryToken = authToken || getCardAuthToken()
  let resp = await fetch(path, {
    ...init,
    headers: HEADERS(init?.headers as Record<string, string> | undefined, primaryToken),
  })
  // A stale Passkey token can survive a browser restart while the regular
  // wallet login token is still valid. Retry the read/mutation with that token;
  // the backend will still enforce active MSCA access, but the UI can now
  // receive the structured `setup_required` preflight instead of a blind 401.
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

export function getCardConfig() {
  return api('/api/cards/config')
}

export type CardAccess = {
  ok: boolean
  active: boolean
  walletAddress?: string | null
  statusReason?: string
  requiresPasskey?: boolean
}

export function getCardAccess(): Promise<CardAccess> {
  return api('/api/cards/access')
}
export function getMerchants(): Promise<{ ok: boolean; merchants: SimMerchant[] }> {
  return api('/api/cards/merchants')
}
export type CardBalance = {
  owner: string
  balance: string
  source: 'onchain' | 'simulated'
  mscaAddress?: string
  syncedAt?: string | null
}

export function getCardBalance(): Promise<{ ok: boolean } & CardBalance> {
  return api('/api/cards/balance')
}
export function syncCardBalance(): Promise<{ ok: boolean } & CardBalance> {
  return api('/api/cards/sync', { method: 'POST', body: JSON.stringify({}) })
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

export type ProvisionedCard = SimCard & {
  pan: string
  cvv?: string | null
}

export function provisionCard(cardId: string, label?: string): Promise<{
  ok: boolean
  card: SimCard
  provider: string
  providerCardId: string
  sensitive: boolean
}> {
  return api(`/api/cards/${encodeURIComponent(cardId)}/provision`, {
    method: 'POST',
    body: JSON.stringify({ label }),
  })
}

/**
 * Reveal PAN/CVV only after the caller has completed a fresh WebAuthn
 * assertion. The short-lived token is intentionally passed explicitly so a
 * stale browser session cannot be used for a card-details request.
 */
export function revealCardDetails(cardId: string, freshPasskeyToken: string): Promise<{
  ok: boolean
  sensitive: true
  card: ProvisionedCard
}> {
  return api(`/api/cards/${encodeURIComponent(cardId)}/reveal`, undefined, freshPasskeyToken)
}
export function updateCardLimits(cardId: string, input: Record<string, unknown>) {
  return api(`/api/cards/${encodeURIComponent(cardId)}/limits`, { method: 'PATCH', body: JSON.stringify(input) })
}
export function setCardStatus(cardId: string, status: CardStatus) {
  return api(`/api/cards/${encodeURIComponent(cardId)}/status`, { method: 'POST', body: JSON.stringify({ status }) })
}
export function spendWithCard(cardId: string, input: Record<string, unknown>, freshPasskeyToken: string) {
  return api(`/api/cards/${encodeURIComponent(cardId)}/spend`, { method: 'POST', body: JSON.stringify(input) }, freshPasskeyToken)
}
export function refundCardTx(cardId: string, txId: string) {
  return api(`/api/cards/${encodeURIComponent(cardId)}/refund`, { method: 'POST', body: JSON.stringify({ txId }) })
}
export function listMyCardTransactions(): Promise<{ ok: boolean; transactions: CardTx[] }> {
  return api('/api/cards/my-transactions')
}
export type CardConfig = {
  mode: string
  onchain: boolean
  merchantSettlementWallet?: string
  brand: string
  network: string
  asset: string
  chain: string
  maxCardsPerOwner: number
  defaultBalance: string
}
