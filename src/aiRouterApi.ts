import { safePost } from './api'

const API = ''

export async function getAiRouterStatus(ownerAddress: string) {
  const res = await fetch(`${API}/api/ai-router/status?ownerAddress=${encodeURIComponent(ownerAddress)}`)
  if (!res.ok) throw new Error(await responseError(res))
  return res.json()
}

export async function setAiRouterAutoPay(input: { ownerAddress: string; enabled: boolean; maxPerRequest?: string; dailyLimit?: string; monthlyLimit?: string }) {
  return safePost(API, '/api/ai-router/auto-pay', input)
}

export async function createAiRouterApiKey(input: { ownerAddress: string; label?: string }) {
  return safePost(API, '/api/ai-router/api-keys', input)
}

export async function revokeAiRouterApiKey(input: { ownerAddress: string; keyId: string }) {
  return safePost(API, `/api/ai-router/api-keys/${encodeURIComponent(input.keyId)}/revoke`, { ownerAddress: input.ownerAddress })
}

export async function rotateAiRouterApiKey(input: { ownerAddress: string; keyId: string }) {
  return safePost(API, `/api/ai-router/api-keys/${encodeURIComponent(input.keyId)}/rotate`, { ownerAddress: input.ownerAddress })
}

export async function prepareAiRouterTopUp(input: { ownerAddress: string; amount: string }) {
  return safePost(API, '/api/ai-router/payments/prepare', input)
}

export async function settleAiRouterTopUp(input: { paymentId: string; txHash: string }) {
  return safePost(API, `/api/ai-router/payments/${encodeURIComponent(input.paymentId)}/settle`, { txHash: input.txHash })
}

export async function getAiRouterModels() {
  const res = await fetch(`${API}/api/ai-router/models`)
  if (!res.ok) throw new Error(await responseError(res))
  return res.json()
}

async function responseError(res: Response) {
  const text = await res.text().catch(() => '')
  try {
    const data = JSON.parse(text)
    return data.error || data.message || `HTTP ${res.status}`
  } catch {
    return text || `HTTP ${res.status}`
  }
}
