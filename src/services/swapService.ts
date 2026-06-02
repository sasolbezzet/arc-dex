import { safePost } from '../api'
import { estimateEoaSwapWithAppKit, swapEoaWithAppKit } from '../appKit'

const API = ''

let kitKeyCache = ''

export async function getKitKey() {
  if (kitKeyCache) return kitKeyCache
  const r = await fetch(`${API}/api/config`)
  const d = await r.json()
  kitKeyCache = d.kitKey || ''
  return kitKeyCache
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
  return fees.reduce((sum, fee: any) => sum + Number(fee?.amount || fee?.fee || 0), 0)
}

export async function quoteEoaSwap(args: { tokenIn: string; tokenOut: string; amountIn: string }) {
  const estimate = await estimateEoaSwapWithAppKit({ ...args, kitKey: await getKitKey() })
  const amountOut = estimate?.estimatedOutput?.amount || estimate?.amountOut || '0'
  return {
    available: true,
    amountOut,
    fee: sumFees(estimate?.fees).toFixed(6),
    rate: Number(amountOut || 0) / Number(args.amountIn || 1),
    estimate,
  }
}
