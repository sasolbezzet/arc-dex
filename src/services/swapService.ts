import { safePost } from '../api'
import { ARC_TESTNET_EXPLORER_TX } from '../domain/arcNetwork'
import { getArcToken } from '../domain/tokens'
import { encodeFunctionData, erc20Abi, parseUnits } from 'viem'

const API = ''
const EVM_FEE_TREASURY = import.meta.env.VITE_ARCOX_FEE_TREASURY || '0xE34FF1D2C925DDafB28C95C2396fC49A6f64569e'
const PLATFORM_FEE_BPS = Number(import.meta.env.VITE_ARCOX_SWAP_FEE_BPS || '30')
const ADAPTER_EXECUTE_ABI = [{
  type: 'function',
  name: 'execute',
  stateMutability: 'payable',
  inputs: [
    {
      name: 'params',
      type: 'tuple',
      components: [
        {
          name: 'instructions',
          type: 'tuple[]',
          components: [
            { name: 'target', type: 'address' },
            { name: 'data', type: 'bytes' },
            { name: 'value', type: 'uint256' },
            { name: 'tokenIn', type: 'address' },
            { name: 'amountToApprove', type: 'uint256' },
            { name: 'tokenOut', type: 'address' },
            { name: 'minTokenOut', type: 'uint256' },
          ],
        },
        {
          name: 'tokens',
          type: 'tuple[]',
          components: [
            { name: 'token', type: 'address' },
            { name: 'beneficiary', type: 'address' },
          ],
        },
        { name: 'execId', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
        { name: 'metadata', type: 'bytes' },
      ],
    },
    {
      name: 'tokenInputs',
      type: 'tuple[]',
      components: [
        { name: 'permitType', type: 'uint8' },
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint256' },
        { name: 'permitCalldata', type: 'bytes' },
      ],
    },
    { name: 'signature', type: 'bytes' },
  ],
  outputs: [],
}] as const

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
  const prepared = await safePost(API, '/api/eoa-swap-prepare', args)
  if (!prepared?.adapterContract || !Array.isArray(prepared?.legs) || prepared.legs.length === 0) {
    throw new Error('Backend tidak mengembalikan route EOA swap yang valid.')
  }
  const steps: any[] = []
  for (const leg of prepared.legs) {
    const approveData = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'approve',
      args: [prepared.adapterContract as `0x${string}`, BigInt(leg.amountBaseUnits)],
    })
    const approvalTx = await sendBufferedTx({ from, to: leg.tokenInAddress, data: approveData, value: '0x0' })
    await waitForReceipt(approvalTx)
    steps.push({ name: `Approve ${leg.tokenIn}`, state: 'success', txHash: approvalTx })

    const executeData = encodeFunctionData({
      abi: ADAPTER_EXECUTE_ABI,
      functionName: 'execute',
      args: [normalizeExecutionParams(leg.executionParams), [{
        permitType: 0,
        token: leg.tokenInAddress,
        amount: BigInt(leg.amountBaseUnits),
        permitCalldata: '0x',
      }], leg.signature],
    })
    const swapTx = await sendBufferedTx({ from, to: prepared.adapterContract, data: executeData, value: '0x0' })
    await waitForReceipt(swapTx)
    steps.push({ name: `${leg.tokenIn} → ${leg.tokenOut}`, state: 'success', txHash: swapTx, amountOut: leg.amountOut })
  }
  const txHash = steps.filter(step => step.name.includes('→')).at(-1)?.txHash || ''
  let feeTx = ''
  let feeError = ''
  const feeToken = getArcToken(args.tokenIn)
  const feeAmount = calculateInputFee(args.amountIn, feeToken?.decimals ?? 6)
  const feeUnits = feeToken ? parseUnits(feeAmount, feeToken.decimals) : 0n
  if (feeUnits > 0n && feeToken) {
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
    route: prepared.route || `${args.tokenIn} → ${args.tokenOut}`,
    tokenIn: args.tokenIn,
    tokenOut: args.tokenOut,
    amountIn: args.amountIn,
    grossAmountIn: args.amountIn,
    amountOut: prepared.amountOut || '',
    txHash,
    transactionHash: txHash,
    explorerUrl: txHash ? `${ARC_TESTNET_EXPLORER_TX}${txHash}` : '',
    raw: { ...prepared, steps },
    platformFee: {
      bps: PLATFORM_FEE_BPS,
      token: args.tokenIn,
      treasury: EVM_FEE_TREASURY,
      amount: feeAmount,
      amountBaseUnits: feeUnits.toString(),
      collectedBy: 'post-swap-browser-transfer',
      txHash: feeTx || undefined,
      error: feeError || undefined,
    },
  }
}

export async function quoteEoaSwap(args: { metamaskAddress: string | null; tokenIn: string; tokenOut: string; amountIn: string }) {
  try {
    return await safePost(API, '/api/eoa-swap-quote', args)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/No route available|Route or resource not found|Swap route not found|route is not supported/i.test(message)) {
      return { available: false, code: 'NO_SWAP_ROUTE', error: 'Route swap belum tersedia dari Circle AppKit untuk pasangan/jumlah ini.', details: message }
    }
    throw error
  }
}

function calculateInputFee(amount: string, decimals: number) {
  const units = parseUnits(amount || '0', decimals)
  return formatTokenUnits((units * BigInt(Math.max(0, Math.floor(PLATFORM_FEE_BPS)))) / 10_000n, decimals)
}

function normalizeExecutionParams(params: any) {
  return {
    instructions: (params?.instructions || []).map((instruction: any) => ({
      target: instruction.target,
      data: instruction.data,
      value: BigInt(instruction.value),
      tokenIn: instruction.tokenIn,
      amountToApprove: BigInt(instruction.amountToApprove),
      tokenOut: instruction.tokenOut,
      minTokenOut: BigInt(instruction.minTokenOut),
    })),
    tokens: (params?.tokens || []).map((token: any) => ({ token: token.token, beneficiary: token.beneficiary })),
    execId: BigInt(params.execId),
    deadline: BigInt(params.deadline),
    metadata: params.metadata,
  }
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
