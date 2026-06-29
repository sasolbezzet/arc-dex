import { safePost } from '../api'
import { ARC_TESTNET_EXPLORER_TX } from '../domain/arcNetwork'
import { encodeAbiParameters, encodeFunctionData, erc20Abi, parseAbiParameters, parseSignature } from 'viem'

const API = ''
const ARC_CHAIN_ID = 5042002
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
    const tokenInput = await buildTokenInput({
      ethereum,
      owner: from,
      spender: prepared.adapterContract,
      token: leg.tokenInAddress,
      tokenSymbol: leg.tokenIn,
      amount: BigInt(leg.amountBaseUnits),
    })
    if (tokenInput.approvalTx) steps.push({ name: `Approve ${leg.tokenIn}`, state: 'success', txHash: tokenInput.approvalTx })
    if (tokenInput.permitType === 1) steps.push({ name: `Permit ${leg.tokenIn}`, state: 'success' })

    const executeData = encodeFunctionData({
      abi: ADAPTER_EXECUTE_ABI,
      functionName: 'execute',
      args: [normalizeExecutionParams(leg.executionParams), [{
        permitType: tokenInput.permitType,
        token: leg.tokenInAddress,
        amount: BigInt(leg.amountBaseUnits),
        permitCalldata: tokenInput.permitCalldata,
      }], leg.signature],
    })
    const swapTx = await sendBufferedTx({ from, to: prepared.adapterContract, data: executeData, value: '0x0' })
    await waitForReceipt(swapTx)
    steps.push({ name: `${leg.tokenIn} → ${leg.tokenOut}`, state: 'success', txHash: swapTx, amountOut: leg.amountOut })
  }
  const txHash = steps.filter(step => step.name.includes('→')).at(-1)?.txHash || ''
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
    platformFee: prepared.platformFee,
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

async function buildTokenInput(args: {
  ethereum: any
  owner: string
  spender: string
  token: string
  tokenSymbol: string
  amount: bigint
}) {
  if (args.tokenSymbol === 'USDC') {
    try {
      const nonceData = encodeFunctionData({
        abi: [{ type: 'function', name: 'nonces', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] }],
        functionName: 'nonces',
        args: [args.owner as `0x${string}`],
      })
      const nonce = BigInt(await args.ethereum.request({ method: 'eth_call', params: [{ to: args.token, data: nonceData }, 'latest'] }))
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
      const typedData = {
        types: {
          EIP712Domain: [
            { name: 'name', type: 'string' },
            { name: 'version', type: 'string' },
            { name: 'chainId', type: 'uint256' },
            { name: 'verifyingContract', type: 'address' },
          ],
          Permit: [
            { name: 'owner', type: 'address' },
            { name: 'spender', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
          ],
        },
        primaryType: 'Permit',
        domain: { name: 'USDC', version: '2', chainId: ARC_CHAIN_ID, verifyingContract: args.token },
        message: { owner: args.owner, spender: args.spender, value: args.amount.toString(), nonce: nonce.toString(), deadline: deadline.toString() },
      }
      const rawSignature = await args.ethereum.request({ method: 'eth_signTypedData_v4', params: [args.owner, JSON.stringify(typedData)] })
      const signature = parseSignature(rawSignature)
      const v = signature.v ?? BigInt((signature.yParity || 0) + 27)
      return {
        permitType: 1,
        permitCalldata: encodeAbiParameters(
          parseAbiParameters('uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s'),
          [args.amount, deadline, Number(v), signature.r, signature.s],
        ),
      }
    } catch (error: any) {
      if (error?.code === 4001 || /reject|cancel/i.test(error?.message || '')) throw error
    }
  }

  const allowanceData = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'allowance',
    args: [args.owner as `0x${string}`, args.spender as `0x${string}`],
  })
  const allowance = BigInt(await args.ethereum.request({ method: 'eth_call', params: [{ to: args.token, data: allowanceData }, 'latest'] }))
  if (allowance >= args.amount) return { permitType: 0, permitCalldata: '0x' as const, approvalTx: '' }
  const approveData = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'approve',
    args: [args.spender as `0x${string}`, args.amount],
  })
  const approvalTx = await sendBufferedTx({ from: args.owner, to: args.token, data: approveData, value: '0x0' })
  await waitForReceipt(approvalTx)
  return { permitType: 0, permitCalldata: '0x' as const, approvalTx }
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
