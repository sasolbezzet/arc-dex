import { safePost } from '../api'
import { ARC_TESTNET_EXPLORER_TX } from '../domain/arcNetwork'
import { getArcToken } from '../domain/tokens'
import { encodeFunctionData, erc20Abi, parseUnits } from 'viem'
import { estimateEoaSwapWithAppKit, swapEoaWithAppKit } from '../appKit'

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
  const config = await getSwapConfig()
  const result = await swapEoaWithAppKit({
    tokenIn: args.tokenIn,
    tokenOut: args.tokenOut,
    amountIn: args.amountIn,
    kitKey: config.kitKey,
    customFeeBps: PLATFORM_FEE_BPS,
    feeRecipient: EVM_FEE_TREASURY,
  })
  const txHash = result?.txHash || result?.transactionHash || result?.steps?.find?.((step: any) => step?.txHash)?.txHash || ''
  let feeTx = ''
  let feeError = ''
  const feeToken = getArcToken(args.tokenIn)
  const feeAmount = calculateInputFee(args.amountIn, feeToken?.decimals ?? 6)
  const feeUnits = feeToken ? parseUnits(feeAmount, feeToken.decimals) : 0n
  const appKitFeeRequested = PLATFORM_FEE_BPS > 0
  if (!appKitFeeRequested && feeUnits > 0n && feeToken) {
    try {
      const feeData = encodeFunctionData({
        abi: erc20Abi,
        functionName: 'transfer',
        args: [EVM_FEE_TREASURY as `0x${string}`, feeUnits],
      })
      feeTx = await sendBufferedTx({ from, to: feeToken.address, data: feeData, value: '0x0' })
      await waitForReceipt(feeTx)
    } catch (error) {
      feeError = error instanceof Error ? error.message : String(error)
    }
  }
  return {
    success: true,
    source: 'browser-prepared-adapter',
    route: 'circle-appkit-browser-wallet',
    tokenIn: args.tokenIn,
    tokenOut: args.tokenOut,
    amountIn: args.amountIn,
    grossAmountIn: args.amountIn,
    amountOut: result?.estimatedOutput?.amount || result?.amountOut || '',
    txHash,
    transactionHash: txHash,
    explorerUrl: txHash ? `${ARC_TESTNET_EXPLORER_TX}${txHash}` : '',
    raw: result,
    platformFee: {
      bps: PLATFORM_FEE_BPS,
      token: args.tokenIn,
      treasury: EVM_FEE_TREASURY,
      amount: feeAmount,
      amountBaseUnits: feeUnits.toString(),
      collectedBy: appKitFeeRequested ? 'circle-appkit-custom-fee' : 'post-swap-browser-transfer',
      txHash: feeTx || undefined,
      error: feeError || undefined,
    },
  }
}

export async function quoteEoaSwap(args: { metamaskAddress: string | null; tokenIn: string; tokenOut: string; amountIn: string }) {
  try {
    const config = await getSwapConfig()
    const estimate = await estimateEoaSwapWithAppKit({
      tokenIn: args.tokenIn,
      tokenOut: args.tokenOut,
      amountIn: args.amountIn,
      kitKey: config.kitKey,
      customFeeBps: PLATFORM_FEE_BPS,
      feeRecipient: EVM_FEE_TREASURY,
    })
    const amountOut = estimate?.estimatedOutput?.amount || '0'
    const fee = (estimate?.fees || []).reduce((sum: number, item: any) => sum + Number(item?.amount || 0), 0)
    const feeAmount = calculateInputFee(args.amountIn, getArcToken(args.tokenIn)?.decimals ?? 6)
    return {
      available: true,
      source: 'circle-appkit-browser-wallet',
      amountOut,
      fee: fee.toFixed(6),
      platformFee: {
        bps: PLATFORM_FEE_BPS,
        amount: feeAmount,
        token: args.tokenIn,
        treasury: EVM_FEE_TREASURY,
        swapAmountIn: args.amountIn,
      },
      rate: Number(amountOut || 0) / Number(args.amountIn || 1),
      raw: estimate,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/No route available|Route or resource not found|Swap route not found|route is not supported/i.test(message)) {
      return { available: false, code: 'NO_SWAP_ROUTE', error: 'Route swap belum tersedia dari Circle AppKit untuk pasangan/jumlah ini.', details: message }
    }
    throw error
  }
}

async function getSwapConfig(): Promise<{ kitKey: string }> {
  const response = await fetch(`${API}/api/config`, { cache: 'no-store' })
  if (!response.ok) throw new Error('Gagal mengambil konfigurasi swap.')
  const data = await response.json()
  if (!data?.kitKey) throw new Error('Kit key belum tersedia dari API.')
  return { kitKey: data.kitKey }
}

function calculateInputFee(amount: string, decimals: number) {
  const units = parseUnits(amount || '0', decimals)
  return formatTokenUnits((units * BigInt(Math.max(0, Math.floor(PLATFORM_FEE_BPS)))) / 10_000n, decimals)
}

function formatTokenUnits(units: bigint, decimals: number) {
  const base = 10n ** BigInt(decimals)
  const whole = units / base
  const frac = (units % base).toString().padStart(decimals, '0').replace(/0+$/, '')
  return `${whole.toString()}${frac ? `.${frac}` : ''}`
}

function toHex(value: bigint) {
  return `0x${value.toString(16)}`
}

async function sendBufferedTx(tx: any): Promise<string> {
  const first = await bufferedFees(tx, 3n)
  try {
    return await window.ethereum.request({ method: 'eth_sendTransaction', params: [{ ...tx, ...first }] })
  } catch (error: any) {
    const msg = error?.message || ''
    if (!/max fee per gas less than block base fee|replacement transaction underpriced|fee/i.test(msg)) throw error
    await new Promise(resolve => setTimeout(resolve, 1200))
    const retry = await bufferedFees(tx, 6n)
    return await window.ethereum.request({ method: 'eth_sendTransaction', params: [{ ...tx, ...retry }] })
  }
}

async function bufferedFees(tx: any, multiplier: bigint) {
  const out: any = {}
  try {
    const gasHex = await window.ethereum.request({ method: 'eth_estimateGas', params: [tx] })
    out.gas = toHex((BigInt(gasHex) * 13n) / 10n + 10_000n)
  } catch {}
  try {
    const block = await window.ethereum.request({ method: 'eth_getBlockByNumber', params: ['latest', false] })
    const baseFee = block?.baseFeePerGas ? BigInt(block.baseFeePerGas) : 0n
    if (baseFee > 0n) {
      let tip = 0n
      try { tip = BigInt(await window.ethereum.request({ method: 'eth_maxPriorityFeePerGas' })) } catch {}
      if (tip < 1_500_000n) tip = 1_500_000n
      out.maxPriorityFeePerGas = toHex(tip)
      out.maxFeePerGas = toHex(baseFee * multiplier + tip * 2n)
      return out
    }
  } catch {}
  try {
    const gasPrice = BigInt(await window.ethereum.request({ method: 'eth_gasPrice' }))
    out.gasPrice = toHex(gasPrice * multiplier)
  } catch {}
  return out
}

async function waitForReceipt(hash: string) {
  for (let i = 0; i < 45; i++) {
    const receipt = await window.ethereum.request({ method: 'eth_getTransactionReceipt', params: [hash] }).catch(() => null)
    if (receipt?.status === '0x1') return receipt
    if (receipt?.status === '0x0') throw new Error(`Transaction reverted: ${hash}`)
    await new Promise(resolve => setTimeout(resolve, 1500))
  }
  throw new Error(`Transaction submitted but not confirmed: ${hash}`)
}
