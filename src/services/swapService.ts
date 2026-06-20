import { safePost } from '../api'
import { switchToArcTestnet, ARC_TESTNET_EXPLORER_TX } from '../domain/arcNetwork'
import { getArcToken } from '../domain/tokens'
import { encodeFunctionData, erc20Abi, parseUnits } from 'viem'

const API = ''
const EVM_FEE_TREASURY = import.meta.env.VITE_ARCOX_FEE_TREASURY || '0xE34FF1D2C925DDafB28C95C2396fC49A6f64569e'
const PLATFORM_FEE_BPS = Number(import.meta.env.VITE_ARCOX_SWAP_FEE_BPS || '30')

const adapterExecuteAbi = [{
  type: 'function',
  name: 'execute',
  stateMutability: 'payable',
  inputs: [
    {
      name: 'params',
      type: 'tuple',
      components: [
        { name: 'instructions', type: 'tuple[]', components: [
          { name: 'target', type: 'address' },
          { name: 'data', type: 'bytes' },
          { name: 'value', type: 'uint256' },
          { name: 'tokenIn', type: 'address' },
          { name: 'amountToApprove', type: 'uint256' },
          { name: 'tokenOut', type: 'address' },
          { name: 'minTokenOut', type: 'uint256' },
        ] },
        { name: 'tokens', type: 'tuple[]', components: [
          { name: 'token', type: 'address' },
          { name: 'beneficiary', type: 'address' },
        ] },
        { name: 'execId', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
        { name: 'metadata', type: 'bytes' },
      ],
    },
    { name: 'tokenInputs', type: 'tuple[]', components: [
      { name: 'permitType', type: 'uint8' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'permitCalldata', type: 'bytes' },
    ] },
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
  await switchToArcTestnet()
  const quote = await quoteEoaSwap({ metamaskAddress: args.metamaskAddress, tokenIn: args.tokenIn, tokenOut: args.tokenOut, amountIn: args.amountIn })
  if (quote?.available === false) throw new Error(quote.error || 'Route swap belum tersedia.')
  const prepared = await safePost(API, '/api/eoa-swap-prepare', {
    metamaskAddress: args.metamaskAddress,
    tokenIn: args.tokenIn,
    tokenOut: args.tokenOut,
    amountIn: args.amountIn
  })
  if (!prepared?.success) throw new Error(prepared?.error || 'Swap prepare failed.')
  const token = getArcToken(args.tokenIn)
  if (!token) throw new Error('Token tidak didukung: ' + args.tokenIn)
  const amountBaseUnits = BigInt(prepared.amountBaseUnits)
  const approveData = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'approve',
    args: [prepared.adapterContract as `0x${string}`, amountBaseUnits],
  })
  const approveTx = await sendBufferedTx({ from, to: prepared.tokenInAddress || token.address, data: approveData, value: '0x0' })
  await waitForReceipt(approveTx)
  const executionParams = normalizeAdapterExecutionParams(prepared.executionParams)
  const tokenInputs = [{
    permitType: 0,
    token: (prepared.tokenInAddress || token.address) as `0x${string}`,
    amount: amountBaseUnits,
    permitCalldata: '0x' as `0x${string}`,
  }]
  const executeData = encodeFunctionData({
    abi: adapterExecuteAbi,
    functionName: 'execute',
    args: [executionParams, tokenInputs, prepared.signature],
  })
  const tx: any = { from, to: prepared.adapterContract, data: executeData, value: '0x0' }
  if (prepared.gasLimit) tx.gas = toHex((BigInt(prepared.gasLimit) * 13n) / 10n + 10_000n)
  const txHash = await sendBufferedTx(tx)
  await waitForReceipt(txHash)
  let feeTx = ''
  let feeError = ''
  const feeToken = getArcToken(args.tokenIn)
  const feeAmount = prepared?.platformFee?.amount || quote?.platformFee?.amount || '0'
  const feeUnits = feeToken ? parseUnits(feeAmount, feeToken.decimals) : 0n
  if (feeUnits > 0n && feeToken) {
    try {
      const feeData = encodeFunctionData({
        abi: erc20Abi,
        functionName: 'transfer',
        args: [(prepared.platformFee?.treasury || EVM_FEE_TREASURY) as `0x${string}`, feeUnits],
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
    route: 'circle-stablecoin-service-adapter',
    tokenIn: args.tokenIn,
    tokenOut: args.tokenOut,
    amountIn: prepared.amountIn || quote?.platformFee?.swapAmountIn || args.amountIn,
    grossAmountIn: args.amountIn,
    amountOut: prepared.amountOut || quote?.amountOut || '',
    txHash,
    transactionHash: txHash,
    explorerUrl: txHash ? `${ARC_TESTNET_EXPLORER_TX}${txHash}` : '',
    approveTx,
    raw: prepared,
    platformFee: {
      ...prepared.platformFee,
      bps: PLATFORM_FEE_BPS,
      token: args.tokenIn,
      treasury: prepared.platformFee?.treasury || EVM_FEE_TREASURY,
      amountBaseUnits: feeUnits.toString(),
      collectedBy: 'post-swap-browser-transfer',
      txHash: feeTx || undefined,
      error: feeError || undefined,
    },
  }
}

export async function quoteEoaSwap(args: { metamaskAddress: string | null; tokenIn: string; tokenOut: string; amountIn: string }) {
  return safePost(API, '/api/eoa-swap-quote', args)
}

function normalizeAdapterExecutionParams(params: any = {}) {
  return {
    instructions: (params.instructions || []).map((item: any) => ({
      target: item.target,
      data: item.data,
      value: BigInt(item.value || 0),
      tokenIn: item.tokenIn,
      amountToApprove: BigInt(item.amountToApprove || 0),
      tokenOut: item.tokenOut,
      minTokenOut: BigInt(item.minTokenOut || 0),
    })),
    tokens: (params.tokens || []).map((item: any) => ({
      token: item.token,
      beneficiary: item.beneficiary,
    })),
    execId: BigInt(params.execId || 0),
    deadline: BigInt(params.deadline || 0),
    metadata: params.metadata || '0x',
  }
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
