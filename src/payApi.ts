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

export type NowpaymentsSandboxPayment = {
  id: string
  payment_id: string
  provider_payment_id?: string | null
  order_id: string
  amount: string
  price_amount: string
  price_currency: string
  pay_currency: string
  pay_amount?: string | null
  pay_address?: string | null
  payment_status: string
  internal_status: string
  arc_treasury_address?: string | null
  base_treasury_address?: string | null
  nowpayments_destination_address?: string | null
  arc_tx_hash?: string | null
  bridge_tx_hash?: string | null
  base_tx_hash?: string | null
  invoice_url?: string | null
  payment_url?: string | null
  raw_provider_response?: unknown
  metadata_json?: any
  created_at: string
  updated_at: string
}

export function createNowpaymentsSandboxPayment(input: Record<string, unknown>): Promise<{ ok: boolean; mockMode: boolean; payment: NowpaymentsSandboxPayment }> {
  return request('/api/payments/nowpayments/create', { method: 'POST', body: JSON.stringify(input) })
}

export function getNowpaymentsPaymentStatus(paymentId: string): Promise<{ ok: boolean; payment: NowpaymentsSandboxPayment }> {
  return request(`/api/payments/nowpayments/${encodeURIComponent(paymentId)}/status`)
}

export function simulateNowpaymentsStep(path: string, input: Record<string, unknown>): Promise<{ ok: boolean; payment?: NowpaymentsSandboxPayment; event?: unknown }> {
  return request(`/api/payments/nowpayments/simulate/${path}`, { method: 'POST', body: JSON.stringify(input) })
}

export function simulateNowpaymentsStatus(input: Record<string, unknown>): Promise<{ ok: boolean; payment?: NowpaymentsSandboxPayment; event?: unknown }> {
  return request('/api/payments/nowpayments/simulate', { method: 'POST', body: JSON.stringify(input) })
}
