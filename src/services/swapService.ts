import { safePost } from '../api'
import { estimateEoaSwapWithAppKit, swapEoaWithAppKit } from '../appKit'

const API = ''

let kitKeyCache: { value: string; expiresAt: number } | null = null
const KIT_KEY_CACHE_TTL_MS = 5 * 60 * 1000

export async function getKitKey() {
  if (kitKeyCache && Date.now() < kitKeyCache.expiresAt) return kitKeyCache.value
  const r = await fetchWithTimeout(`${API}/api/config`)
  const d = await r.json()
  kitKeyCache = { value: d.kitKey || '', expiresAt: Date.now() + KIT_KEY_CACHE_TTL_MS }
  return kitKeyCache.value
}

async function fetchWithTimeout(url: string, timeoutMs = 10000) {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(id)
  }
}

export async function quoteCircleSwap(args: {
  metamaskAddress: string | null
  tokenIn: string
  tokenOut: string
  amountIn: string
}) {
  return safePost(API, '/api/quote', args)
}

export async function swapFromCircleWallet(args: {
  metamaskAddress: string
  tokenIn: string
  tokenOut: string
  amountIn: string
}) {
  return safePost(API, '/api/swap', args)
}

export async function swapFromEoa(args: { tokenIn: string; tokenOut: string; amountIn: string }) {
  return swapEoaWithAppKit({ ...args, kitKey: await getKitKey() })
}

function sumFees(fees: unknown): number {
  if (!Array.isArray(fees)) return 0
  return fees.reduce((sum, fee) => {
    if (!fee || typeof fee !== 'object') return sum
    const item = fee as { amount?: string | number; fee?: string | number }
    return sum + Number(item.amount || item.fee || 0)
  }, 0)
}

function getTokenAmount(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (!value || typeof value !== 'object') return ''
  const item = value as { amount?: unknown; value?: unknown; uiAmount?: unknown; uiAmountString?: unknown }
  return getTokenAmount(item.amount ?? item.value ?? item.uiAmountString ?? item.uiAmount)
}

export async function quoteEoaSwap(args: { tokenIn: string; tokenOut: string; amountIn: string }) {
  const estimate = await estimateEoaSwapWithAppKit({ ...args, kitKey: await getKitKey() })
  const amountOut = getTokenAmount(estimate?.estimatedOutput) || getTokenAmount(estimate?.amountOut) || getTokenAmount(estimate?.stopLimit)
  if (!amountOut || Number(amountOut) <= 0) {
    return {
      available: false,
      error: 'Estimasi swap EOA belum tersedia dari App Kit untuk route ini.',
      estimate,
    }
  }
  return {
    available: true,
    amountOut,
    fee: sumFees(estimate?.fees).toFixed(6),
    rate: Number(amountOut || 0) / Number(args.amountIn || 1),
    estimate,
  }
}
