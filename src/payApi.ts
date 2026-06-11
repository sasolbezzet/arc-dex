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
