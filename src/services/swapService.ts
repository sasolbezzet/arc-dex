import { safePost } from '../api'
import { swapEoaWithAppKit } from '../appKit'
import { getArcToken } from '../domain/tokens'
import { parseUnits } from 'viem'

const API = ''
const EVM_FEE_TREASURY = import.meta.env.VITE_ARCOX_FEE_TREASURY || '0xE34FF1D2C925DDafB28C95C2396fC49A6f64569e'
const PLATFORM_FEE_BPS = Number(import.meta.env.VITE_ARCOX_SWAP_FEE_BPS || '30')

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

export async function swapFromEoa(args: { metamaskAddress: string; tokenIn: string; tokenOut: string; amountIn: string }) {
  const ethereum = window.ethereum
  if (!ethereum) throw new Error('MetaMask tidak terdeteksi.')
  const accounts = await ethereum.request({ method: 'eth_requestAccounts' })
  const from = accounts?.[0]
  if (!from) throw new Error('Wallet EOA belum terhubung.')
  if (from.toLowerCase() !== args.metamaskAddress.toLowerCase()) throw new Error('Wallet aktif berbeda dengan wallet login.')
  const [{ kitKey }, quote] = await Promise.all([
    fetch(`${API}/api/config`, { cache: 'no-store' }).then(r => r.json()),
    quoteEoaSwap({ metamaskAddress: args.metamaskAddress, tokenIn: args.tokenIn, tokenOut: args.tokenOut, amountIn: args.amountIn }),
  ])
  if (!kitKey) throw new Error('KIT_KEY belum tersedia dari API.')
  if (quote?.available === false) throw new Error(quote.error || 'Route swap belum tersedia.')
  const result = await swapEoaWithAppKit({
    tokenIn: args.tokenIn,
    tokenOut: args.tokenOut,
    amountIn: args.amountIn,
    kitKey,
    customFeeBps: PLATFORM_FEE_BPS,
    feeRecipient: EVM_FEE_TREASURY,
  })
  const txHash = result?.txHash || result?.transactionHash || result?.steps?.find?.((step: any) => step?.txHash)?.txHash || ''
  const feeToken = getArcToken(args.tokenIn)
  const feeAmount = quote?.platformFee?.amount || '0'
  const feeUnits = feeToken ? parseUnits(feeAmount, feeToken.decimals) : 0n
  return {
    success: true,
    source: 'appkit-browser-wallet',
    route: 'appkit-swap',
    tokenIn: args.tokenIn,
    tokenOut: args.tokenOut,
    amountIn: quote?.platformFee?.swapAmountIn || args.amountIn,
    grossAmountIn: args.amountIn,
    amountOut: result?.amountOut || result?.estimatedOutput?.amount || quote?.amountOut || '',
    txHash,
    transactionHash: txHash,
    explorerUrl: result?.explorerUrl || (txHash ? `https://testnet.arcscan.app/tx/${txHash}` : ''),
    raw: result,
    platformFee: {
      ...quote?.platformFee,
      bps: PLATFORM_FEE_BPS,
      token: args.tokenIn,
      treasury: EVM_FEE_TREASURY,
      amountBaseUnits: feeUnits.toString(),
      collectedBy: 'appkit-custom-fee',
    },
  }
}

export async function quoteEoaSwap(args: { metamaskAddress: string | null; tokenIn: string; tokenOut: string; amountIn: string }) {
  return safePost(API, '/api/eoa-swap-quote', args)
}
