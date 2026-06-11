import { safePost } from '../api'
import { estimateEoaSwapWithAppKit, swapEoaWithAppKit } from '../appKit'
import { getArcToken } from '../domain/tokens'
import { formatUnits, parseUnits } from 'viem'

const API = ''
const PLATFORM_FEE_BPS = Number(import.meta.env.VITE_ARCOX_ROUTER_FEE_BPS || 30)
const EVM_FEE_TREASURY = import.meta.env.VITE_ARCOX_FEE_TREASURY || '0xE34FF1D2C925DDafB28C95C2396fC49A6f64569e'

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
  const split = splitEoaPlatformFee(args.tokenIn, args.amountIn)
  let feeTxHash = ''
  let feeError = ''
  const result = await swapEoaWithAppKit({ ...args, amountIn: split.netAmount, kitKey: await getKitKey() })
  if (split.feeUnits > 0n) {
    try {
      feeTxHash = await sendEoaTokenFee(args.tokenIn, split.feeUnits)
    } catch (error) {
      feeError = error instanceof Error ? error.message : 'Platform fee transaction failed.'
    }
  }
  return {
    ...result,
    grossAmountIn: args.amountIn,
    amountIn: split.netAmount,
    platformFee: {
      bps: split.bps,
      amount: split.feeAmount,
      token: args.tokenIn,
      treasury: EVM_FEE_TREASURY,
      txHash: feeTxHash,
      error: feeError,
    },
  }
}

function splitEoaPlatformFee(tokenSymbol: string, amount: string) {
  const token = getArcToken(tokenSymbol)
  if (!token) throw new Error(`Unsupported token: ${tokenSymbol}`)
  const amountUnits = parseUnits(amount, token.decimals)
  const bps = Number.isFinite(PLATFORM_FEE_BPS) && PLATFORM_FEE_BPS > 0 ? Math.floor(PLATFORM_FEE_BPS) : 0
  const feeUnits = (amountUnits * BigInt(bps)) / 10000n
  const netUnits = amountUnits - feeUnits
  if (netUnits <= 0n) throw new Error('Amount terlalu kecil setelah platform fee.')
  return {
    bps,
    feeUnits,
    netUnits,
    feeAmount: formatUnits(feeUnits, token.decimals),
    netAmount: formatUnits(netUnits, token.decimals),
  }
}

async function sendEoaTokenFee(tokenSymbol: string, feeUnits: bigint) {
  const token = getArcToken(tokenSymbol)
  if (!token) throw new Error(`Unsupported token: ${tokenSymbol}`)
  const ethereum = window.ethereum
  if (!ethereum) throw new Error('MetaMask tidak terdeteksi.')
  const accounts = await ethereum.request({ method: 'eth_requestAccounts' })
  const from = accounts?.[0]
  if (!from) throw new Error('Wallet EOA belum terhubung.')
  const data = '0xa9059cbb'
    + EVM_FEE_TREASURY.slice(2).toLowerCase().padStart(64, '0')
    + feeUnits.toString(16).padStart(64, '0')
  return ethereum.request({ method: 'eth_sendTransaction', params: [{ from, to: token.address, data }] })
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
  const split = splitEoaPlatformFee(args.tokenIn, args.amountIn)
  const estimate = await estimateEoaSwapWithAppKit({ ...args, amountIn: split.netAmount, kitKey: await getKitKey() })
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
    platformFee: { amount: split.feeAmount, token: args.tokenIn, swapAmountIn: split.netAmount, bps: split.bps },
    estimate,
  }
}
