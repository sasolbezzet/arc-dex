import { safePost } from '../api'
import { swapEoaWithAppKit } from '../appKit'

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
