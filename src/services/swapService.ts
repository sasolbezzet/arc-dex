import { safePost } from '../api'
import { switchToArcTestnet } from '../appKit'
import { getArcToken } from '../domain/tokens'
import { encodeFunctionData, parseUnits, toHex } from 'viem'

const API = ''
const EVM_FEE_TREASURY = import.meta.env.VITE_ARCOX_FEE_TREASURY || '0xE34FF1D2C925DDafB28C95C2396fC49A6f64569e'
const ARC_APPKIT_ADAPTER = '0xBBD70b01a1CAbc96d5b7b129Ae1AAabdf50dd40b'

const erc20ApproveAbi = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

const adapterExecuteAbi = [
  {
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
  },
] as const

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
  await switchToArcTestnet()
  const ethereum = window.ethereum
  if (!ethereum) throw new Error('MetaMask tidak terdeteksi.')
  const accounts = await ethereum.request({ method: 'eth_requestAccounts' })
  const from = accounts?.[0]
  if (!from) throw new Error('Wallet EOA belum terhubung.')
  if (from.toLowerCase() !== args.metamaskAddress.toLowerCase()) throw new Error('Wallet aktif berbeda dengan wallet login.')
  const prepared = await safePost(API, '/api/eoa-swap-prepare', args)
  if (!prepared?.success) throw new Error(prepared?.error || 'Gagal menyiapkan swap EOA.')
  const adapterContract = prepared.adapterContract || ARC_APPKIT_ADAPTER
  const approveTxHash = await approveEoaSwapToken(prepared.tokenInAddress, adapterContract, BigInt(prepared.amountBaseUnits), from)
  await waitForEvmReceipt(approveTxHash)
  const swapTxHash = await executeEoaSwap(prepared, adapterContract, from)
  await waitForEvmReceipt(swapTxHash)
  let feeTxHash = ''
  let feeError = ''
  const feeToken = getArcToken(args.tokenIn)
  const feeAmount = prepared?.platformFee?.amount || '0'
  const feeUnits = feeToken ? parseUnits(feeAmount, feeToken.decimals) : 0n
  if (feeUnits > 0n) {
    try {
      feeTxHash = await sendEoaTokenFee(args.tokenIn, feeUnits)
    } catch (error) {
      feeError = error instanceof Error ? error.message : 'Platform fee transaction failed.'
    }
  }
  return {
    ...prepared,
    txHash: swapTxHash,
    transactionHash: swapTxHash,
    approveTxHash,
    explorerUrl: `https://testnet.arcscan.app/tx/${swapTxHash}`,
    platformFee: {
      ...prepared.platformFee,
      token: args.tokenIn,
      treasury: EVM_FEE_TREASURY,
      txHash: feeTxHash,
      error: feeError,
    },
  }
}

async function approveEoaSwapToken(tokenAddress: string, spender: string, amount: bigint, from: string) {
  const data = encodeFunctionData({ abi: erc20ApproveAbi, functionName: 'approve', args: [spender as `0x${string}`, amount] })
  return window.ethereum.request({
    method: 'eth_sendTransaction',
    params: [{ from, to: tokenAddress, data }],
  })
}

async function executeEoaSwap(prepared: any, adapterContract: string, from: string) {
  const executionParams = {
    instructions: (prepared.executionParams?.instructions || []).map((item: any) => ({
      target: item.target,
      data: item.data,
      value: BigInt(item.value),
      tokenIn: item.tokenIn,
      amountToApprove: BigInt(item.amountToApprove),
      tokenOut: item.tokenOut,
      minTokenOut: BigInt(item.minTokenOut),
    })),
    tokens: (prepared.executionParams?.tokens || []).map((item: any) => ({
      token: item.token,
      beneficiary: item.beneficiary,
    })),
    execId: BigInt(prepared.executionParams?.execId),
    deadline: BigInt(prepared.executionParams?.deadline),
    metadata: prepared.executionParams?.metadata,
  }
  const tokenInputs = [{
    permitType: 0,
    token: prepared.tokenInAddress as `0x${string}`,
    amount: BigInt(prepared.amountBaseUnits),
    permitCalldata: '0x' as `0x${string}`,
  }]
  const data = encodeFunctionData({
    abi: adapterExecuteAbi,
    functionName: 'execute',
    args: [executionParams, tokenInputs, prepared.signature],
  })
  const gasLimit = prepared.gasLimit ? (BigInt(prepared.gasLimit) * 120n) / 100n : 0n
  const tx: Record<string, unknown> = { from, to: adapterContract, data }
  if (gasLimit > 0n) tx.gas = toHex(gasLimit)
  return window.ethereum.request({ method: 'eth_sendTransaction', params: [tx] })
}

async function waitForEvmReceipt(txHash: string, timeoutMs = 90000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const receipt = await window.ethereum.request({ method: 'eth_getTransactionReceipt', params: [txHash] })
    if (receipt) {
      if (receipt.status === '0x0') throw new Error(`Transaction reverted: ${txHash}`)
      return receipt
    }
    await new Promise(resolve => setTimeout(resolve, 2500))
  }
  throw new Error(`Transaction belum confirmed: ${txHash}`)
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

export async function quoteEoaSwap(args: { metamaskAddress: string | null; tokenIn: string; tokenOut: string; amountIn: string }) {
  return safePost(API, '/api/eoa-swap-quote', args)
}
