import { safePost } from './api'

export type InvoiceStatus = 'unpaid' | 'pending' | 'paid' | 'expired' | 'failed' | 'cancelled'

export type InvoiceTimelineItem = {
  type: string
  message: string
  txHash?: string
  createdAt: string
}

export type ArcoxInvoice = {
  invoiceId: string
  orderId?: string
  merchantAddress: string
  amount: string
  token: 'USDC'
  network: 'arc-testnet'
  memo?: string
  status: InvoiceStatus
  paymentUrl: string
  txHash?: string
  payerAddress?: string
  createdAt: string
  expiresAt: string
  paidAt?: string
  timeline: InvoiceTimelineItem[]
}

async function request(path: string, init?: RequestInit) {
  const resp = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  })
  const text = await resp.text()
  let data: any = {}
  try { data = text ? JSON.parse(text) : {} } catch { data = { raw: text } }
  if (!resp.ok || data?.error) throw new Error(data?.error || `HTTP ${resp.status}`)
  return data
}

export function createInvoice(input: Record<string, unknown>): Promise<ArcoxInvoice> {
  return request('/api/invoices', { method: 'POST', body: JSON.stringify(input) })
}

export function getInvoice(invoiceId: string): Promise<ArcoxInvoice> {
  return request(`/api/invoices/${encodeURIComponent(invoiceId)}`)
}

export function patchInvoice(invoiceId: string, input: Record<string, unknown>): Promise<ArcoxInvoice> {
  return request(`/api/invoices/${encodeURIComponent(invoiceId)}`, { method: 'PATCH', body: JSON.stringify(input) })
}

export function getInvoiceStatus(invoiceId: string) {
  return request(`/api/invoices/${encodeURIComponent(invoiceId)}/status`)
}

export function markInvoicePaid(invoiceId: string, input: Record<string, unknown>): Promise<ArcoxInvoice> {
  return request(`/api/invoices/${encodeURIComponent(invoiceId)}/mark-paid`, { method: 'POST', body: JSON.stringify(input) })
}

export function simulateCircleWebhook(input: Record<string, unknown>) {
  return request('/api/dev/simulate-webhook', { method: 'POST', body: JSON.stringify(input) })
}

export function quoteEcoRoute(input: Record<string, unknown>) {
  return request('/api/eco/route-preview', { method: 'POST', body: JSON.stringify(input) })
}

export function getNanopaymentsCapabilities() {
  return request('/api/nanopayments/capabilities')
}

export type X402Invoice = {
  invoiceId: string
  paymentId: string
  service: string
  resource: string
  status: 'created' | 'payment_required' | 'estimate_ready' | 'awaiting_signature' | 'spend_submitted' | 'settlement_pending' | 'paid' | 'service_unlocked' | 'recovery_required' | 'expired' | 'failed' | 'pending'
  asset: string
  network: string
  chainId?: number
  usdcAddress?: string
  circleEnvironment: string
  circleTreasuryWalletId?: string
  recipient: string
  baseAmount: string
  uniqueAmount: string
  amount: string
  amountBaseUnits?: string
  decimals?: number
  memoContract?: string
  memoId?: string
  memoData?: string
  paymentMethod?: string
  paymentMethods?: string[]
  settlementStatus?: string
  route?: any
  fee?: any
  unifiedBalanceEstimate?: any
  spendTxHash?: string
  transferId?: string
  createdAt: string
  expiresAt: string
  expiresInSeconds: number
  txHash?: string
  paidAt?: string
  serviceStatus?: string
  serviceUnlockedAt?: string
}

export function createX402Invoice(input: Record<string, unknown>): Promise<{ ok: boolean; x402: X402Invoice; invoice: X402Invoice; config: unknown }> {
  return request('/api/x402/invoices/create', { method: 'POST', body: JSON.stringify(input) })
}

export function getX402InvoiceStatus(invoiceId: string): Promise<{ ok: boolean; x402: X402Invoice; invoice: X402Invoice }> {
  return request(`/api/x402/invoices/${encodeURIComponent(invoiceId)}/status`)
}

export function estimateX402UnifiedBalance(invoiceId: string, input: Record<string, unknown>): Promise<{ ok: boolean; x402: X402Invoice; invoice: X402Invoice }> {
  return request(`/api/x402/invoices/${encodeURIComponent(invoiceId)}/estimate-unified-balance`, { method: 'POST', body: JSON.stringify(input) })
}

export function markX402UnifiedBalanceSpendSubmitted(invoiceId: string, input: Record<string, unknown>): Promise<{ ok: boolean; x402: X402Invoice; invoice: X402Invoice }> {
  return request(`/api/x402/invoices/${encodeURIComponent(invoiceId)}/spend-submitted`, { method: 'POST', body: JSON.stringify(input) })
}

export function getTreasuryStatus() {
  return request('/api/treasury/status')
}

export function estimateDelegatedUnifiedBalance(input: Record<string, unknown>) {
  return safePost('', '/api/unified-balance/delegated/estimate', input)
}

export function spendDelegatedUnifiedBalance(input: Record<string, unknown>) {
  return safePost('', '/api/unified-balance/delegated/spend', input)
}
