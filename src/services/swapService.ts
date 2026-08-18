import { safePost } from '../api'
import { ARC_TESTNET_ADD_PARAMS, ARC_TESTNET_CHAIN_ID, ARC_TESTNET_EXPLORER_TX } from '../domain/arcNetwork'
import { encodeAbiParameters, encodeFunctionData, erc20Abi, parseAbiParameters, parseSignature, parseUnits } from 'viem'
import { findConnectedWalletProvider, normalizeWalletProvider, type Eip1193Provider } from '../walletProvider'
import { isEmptyContractCode, isEmptyRpcData, requiredPositiveUint, rpcUint } from '../utils/rpcQuantity'

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
  const connectedProvider = await findConnectedWalletProvider(args.metamaskAddress)
  if (!connectedProvider) throw new Error('Wallet EOA tidak terdeteksi.')
  const ethereum = normalizeWalletProvider(connectedProvider)
  const accounts = await ethereum.request({ method: 'eth_requestAccounts' })
  const from = accounts?.[0]
  if (!from) throw new Error('Wallet EOA belum terhubung.')
  if (from.toLowerCase() !== args.metamaskAddress.toLowerCase()) throw new Error('Wallet aktif berbeda dengan wallet login.')
  await ensureArcChain(ethereum)
  const prepared = await safePost(API, '/api/eoa-swap-prepare', args)
  if ((prepared?.source === 'arcox-amm-router' || prepared?.source === 'arcox-amm-router-2leg') && prepared?.ammRouter) {
    const tokenMap: Record<string, { address: `0x${string}`; decimals: number }> = {
      USDC: { address: '0x3600000000000000000000000000000000000000', decimals: 6 },
      EURC: { address: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a', decimals: 6 },
      cirBTC: { address: '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF', decimals: 8 },
    }
    // Single-leg AMM swap (USDC↔cirBTC). The deployed router's swapWithFee
    // double-pulls from the caller, so execute against its registered pool.
    if (prepared?.source === 'arcox-amm-router') {
      const token = tokenMap[args.tokenIn]
      const outToken = tokenMap[args.tokenOut]
      if (!token || !outToken) throw new Error('Token cirBTC swap tidak dikenal.')
      const amountUnits = parseUnits(String(args.amountIn), token.decimals)
      const swapAmountUnits = parseUnits(String(prepared.ammSwapAmount || prepared.platformFee?.swapAmountIn || args.amountIn), token.decimals)
      const feeUnits = prepared.platformFee?.amount ? parseUnits(String(prepared.platformFee.amount), token.decimals) : 0n
      const actualBalance = await readTokenBalance(ethereum, from, token.address)
      if (actualBalance < amountUnits) throw new Error(`Saldo ${args.tokenIn} tidak mencukupi untuk swap dan fee.`)
      if (swapAmountUnits <= 0n || swapAmountUnits > amountUnits) throw new Error('Jumlah swap AMM dari quote tidak valid.')
      const feeTx = feeUnits > 0n
        ? await transferToken(ethereum, from, token.address, prepared.platformFee.treasury, feeUnits)
        : ''
      const minAmountOut = computeMinAmountOut(prepared.amountOut, outToken.decimals)
      const approveTx = await approveToken(ethereum, from, token.address, prepared.ammPool, swapAmountUnits)
      const swapTx = await swapAmmLeg(ethereum, from, prepared.ammPool, token.address, swapAmountUnits, minAmountOut)
      return {
        success: true,
        source: 'browser-arcox-amm-router',
        route: prepared.route || `${args.tokenIn} → ${args.tokenOut}`,
        tokenIn: args.tokenIn, tokenOut: args.tokenOut, amountIn: args.amountIn,
        grossAmountIn: args.amountIn, amountOut: prepared.amountOut || '',
        txHash: swapTx, transactionHash: swapTx,
        explorerUrl: `${ARC_TESTNET_EXPLORER_TX}${swapTx}`,
        approveTx, feeTx, platformFee: prepared.platformFee,
        raw: { ...prepared, approveTx, feeTx, swapTx },
      }
    }
    // Two-leg AMM route (EURC↔cirBTC via USDC)
    const steps: any[] = []
    const firstToken = tokenMap[args.tokenIn]
    const feeUnits = prepared.platformFee?.amount && firstToken
      ? parseUnits(String(prepared.platformFee.amount), firstToken.decimals)
      : 0n
    if (feeUnits > 0n) {
      const feeTx = await transferToken(ethereum, from, firstToken.address, prepared.platformFee.treasury, feeUnits)
      steps.push({ name: `Platform fee ${args.tokenIn}`, state: 'success', txHash: feeTx })
    }
    for (const leg of prepared.legs || []) {
      if (leg.executionParams && leg.signature && prepared.adapterContract) {
        // Stablecoin service leg: approve + execute adapter
        const tokenInput = await buildTokenInput({
          ethereum,
          owner: from,
          spender: prepared.adapterContract,
          token: leg.tokenInAddress,
          tokenSymbol: leg.tokenIn,
          amount: requiredPositiveUint(leg.amountBaseUnits, 'swap amount'),
        })
        if (tokenInput.approvalTx) steps.push({ name: `Approve ${leg.tokenIn}`, state: 'success', txHash: tokenInput.approvalTx })
        if (tokenInput.permitType === 1) steps.push({ name: `Permit ${leg.tokenIn}`, state: 'success' })
        const executeData = encodeFunctionData({
          abi: ADAPTER_EXECUTE_ABI,
          functionName: 'execute',
          args: [normalizeExecutionParams(leg.executionParams), [{
            permitType: tokenInput.permitType,
            token: leg.tokenInAddress,
            amount: requiredPositiveUint(leg.amountBaseUnits, 'swap amount'),
            permitCalldata: tokenInput.permitCalldata,
          }], leg.signature],
        })
        const swapTx = await sendBufferedTx(ethereum, { from, to: prepared.adapterContract, data: executeData, value: '0x0' })
        await waitForReceipt(ethereum, swapTx)
        steps.push({ name: `${leg.tokenIn} → ${leg.tokenOut}`, state: 'success', txHash: swapTx, amountOut: leg.amountOut })
      } else if (leg.provider === 'arcox-amm') {
        // AMM leg: approve the registered pool, then call pool.swap directly.
        const tokenInInfo = tokenMap[leg.tokenIn]
        const tokenOutInfo = tokenMap[leg.tokenOut]
        if (!tokenInInfo || !tokenOutInfo || !prepared.ammPool) throw new Error(`Token atau AMM pool ${leg.tokenIn}/${leg.tokenOut} tidak dikenal.`)
        const quotedAmountUnits = parseUnits(String(leg.amountIn), tokenInInfo.decimals)
        // Use the actual token balance in case the previous leg produced slightly less (fees, rounding).
        const actualBalance = await readTokenBalance(ethereum, from, tokenInInfo.address)
        const amountUnits = actualBalance < quotedAmountUnits ? actualBalance : quotedAmountUnits
        if (amountUnits <= 0n) throw new Error(`Saldo ${leg.tokenIn} tidak mencukupi untuk melanjutkan swap.`)
        // Scale minAmountOut proportionally when we use less than the quoted input.
        const quotedOutUnits = parseUnits(String(leg.estimatedAmount), tokenOutInfo.decimals)
        const scaledMinAmountOut = (quotedOutUnits * 99n * amountUnits) / (100n * quotedAmountUnits)
        const approveTx = await approveToken(ethereum, from, tokenInInfo.address, prepared.ammPool, amountUnits)
        if (approveTx) steps.push({ name: `Approve ${leg.tokenIn}`, state: 'success', txHash: approveTx })
        const swapTx = await swapAmmLeg(ethereum, from, prepared.ammPool, tokenInInfo.address, amountUnits, scaledMinAmountOut)
        steps.push({ name: `${leg.tokenIn} → ${leg.tokenOut}`, state: 'success', txHash: swapTx, amountOut: leg.estimatedAmount })
      }
    }
    const lastTx = steps.filter(step => step.name.includes('→')).at(-1)?.txHash || ''
    return {
      success: true,
      source: 'browser-arcox-amm-router-2leg',
      route: prepared.route || `${args.tokenIn} → ${args.tokenOut}`,
      tokenIn: args.tokenIn, tokenOut: args.tokenOut, amountIn: args.amountIn,
      grossAmountIn: args.amountIn, amountOut: prepared.amountOut || '',
      txHash: lastTx, transactionHash: lastTx,
      explorerUrl: lastTx ? `${ARC_TESTNET_EXPLORER_TX}${lastTx}` : '',
      platformFee: prepared.platformFee,
      raw: { ...prepared, steps },
    }
  }
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
      amount: requiredPositiveUint(leg.amountBaseUnits, 'swap amount'),
    })
    if (tokenInput.approvalTx) steps.push({ name: `Approve ${leg.tokenIn}`, state: 'success', txHash: tokenInput.approvalTx })
    if (tokenInput.permitType === 1) steps.push({ name: `Permit ${leg.tokenIn}`, state: 'success' })

    const executeData = encodeFunctionData({
      abi: ADAPTER_EXECUTE_ABI,
      functionName: 'execute',
      args: [normalizeExecutionParams(leg.executionParams), [{
        permitType: tokenInput.permitType,
        token: leg.tokenInAddress,
        amount: requiredPositiveUint(leg.amountBaseUnits, 'swap amount'),
        permitCalldata: tokenInput.permitCalldata,
      }], leg.signature],
    })
    const swapTx = await sendBufferedTx(ethereum, { from, to: prepared.adapterContract, data: executeData, value: '0x0' })
    await waitForReceipt(ethereum, swapTx)
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
      const nonce = rpcUint(await args.ethereum.request({ method: 'eth_call', params: [{ to: args.token, data: nonceData }, 'latest'] }), 'permit nonce')
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
  const allowanceResult = await args.ethereum.request({ method: 'eth_call', params: [{ to: args.token, data: allowanceData }, 'latest'] })
  let allowance: bigint
  if (isEmptyRpcData(allowanceResult)) {
    const code = await args.ethereum.request({ method: 'eth_getCode', params: [args.token, 'latest'] })
    if (isEmptyContractCode(code)) throw new Error('Token contract is unavailable on the active Arc network.')
    // OKX Mobile can return empty data for a zero allowance. With verified
    // contract bytecode, treating it as zero only causes a safe approval.
    allowance = 0n
  } else {
    allowance = rpcUint(allowanceResult, 'token allowance')
  }
  if (allowance >= args.amount) return { permitType: 0, permitCalldata: '0x' as const, approvalTx: '' }
  const approveData = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'approve',
    args: [args.spender as `0x${string}`, args.amount],
  })
  const approvalTx = await sendBufferedTx(args.ethereum, { from: args.owner, to: args.token, data: approveData, value: '0x0' })
  await waitForReceipt(args.ethereum, approvalTx)
  return { permitType: 0, permitCalldata: '0x' as const, approvalTx }
}

async function readAllowance(ethereum: Eip1193Provider, from: string, token: `0x${string}`, spender: string): Promise<bigint> {
  const allowanceData = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'allowance',
    args: [from as `0x${string}`, spender as `0x${string}`],
  })
  const allowanceResult = await ethereum.request({ method: 'eth_call', params: [{ to: token, data: allowanceData }, 'latest'] })
  if (isEmptyRpcData(allowanceResult)) {
    const code = await ethereum.request({ method: 'eth_getCode', params: [token, 'latest'] })
    if (isEmptyContractCode(code)) throw new Error('Token contract is unavailable on the active Arc network.')
    return 0n
  }
  return rpcUint(allowanceResult, 'token allowance')
}

async function approveToken(ethereum: Eip1193Provider, from: string, token: `0x${string}`, spender: string, amount: bigint): Promise<string> {
  let allowance = await readAllowance(ethereum, from, token, spender)
  if (allowance >= amount) return ''
  const approveData = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'approve',
    args: [spender as `0x${string}`, amount],
  })
  const tx = await sendBufferedTx(ethereum, { from, to: token, data: approveData, value: '0x0' })
  await waitForReceipt(ethereum, tx)
  // Some wallets/RPCs may return an old allowance immediately after the approval.
  // Re-read and retry once to avoid a subsequent "transfer amount exceeds allowance" revert.
  allowance = await readAllowance(ethereum, from, token, spender)
  if (allowance < amount) {
    await new Promise(resolve => setTimeout(resolve, 1500))
    allowance = await readAllowance(ethereum, from, token, spender)
  }
  if (allowance < amount) {
    throw new Error(`Approval tidak berhasil: allowance ${allowance.toString()} masih kurang dari ${amount.toString()}.`)
  }
  return tx
}

async function swapAmmLeg(ethereum: Eip1193Provider, from: string, pool: string, tokenIn: `0x${string}`, amountIn: bigint, minAmountOut: bigint): Promise<string> {
  const swapData = encodeFunctionData({
    abi: [{ type: 'function', name: 'swap', stateMutability: 'nonpayable', inputs: [
      { name: 'tokenIn', type: 'address' },
      { name: 'amountIn', type: 'uint256' }, { name: 'minAmountOut', type: 'uint256' },
    ], outputs: [{ name: 'amountOut', type: 'uint256' }] }],
    functionName: 'swap',
    args: [tokenIn, amountIn, minAmountOut],
  })
  const tx = await sendBufferedTx(ethereum, { from, to: pool, data: swapData, value: '0x0' })
  await waitForReceipt(ethereum, tx)
  return tx
}

function computeMinAmountOut(amountOutDecimal: string | undefined | number, decimals: number): bigint {
  if (!amountOutDecimal) return 0n
  const amountOut = typeof amountOutDecimal === 'number' ? amountOutDecimal : Number(amountOutDecimal)
  if (!Number.isFinite(amountOut) || amountOut <= 0) return 0n
  const units = BigInt(Math.round(amountOut * 10 ** decimals))
  // 1% slippage tolerance
  return (units * 99n) / 100n
}

async function transferToken(ethereum: Eip1193Provider, from: string, token: `0x${string}`, to: string, amount: bigint): Promise<string> {
  if (!to) throw new Error('Treasury fee address tidak tersedia.')
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'transfer',
    args: [to as `0x${string}`, amount],
  })
  const tx = await sendBufferedTx(ethereum, { from, to: token, data, value: '0x0' })
  await waitForReceipt(ethereum, tx)
  return tx
}

async function readTokenBalance(ethereum: Eip1193Provider, owner: string, token: `0x${string}`): Promise<bigint> {
  const balanceData = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [owner as `0x${string}`],
  })
  const result = await ethereum.request({ method: 'eth_call', params: [{ to: token, data: balanceData }, 'latest'] })
  if (isEmptyRpcData(result)) return 0n
  return rpcUint(result, 'token balance')
}

function normalizeExecutionParams(params: any) {
  return {
    instructions: (params?.instructions || []).map((instruction: any) => ({
      target: instruction.target,
      data: instruction.data,
      value: rpcUint(instruction.value, 'instruction value', true),
      tokenIn: instruction.tokenIn,
      amountToApprove: rpcUint(instruction.amountToApprove, 'instruction approval amount', true),
      tokenOut: instruction.tokenOut,
      minTokenOut: rpcUint(instruction.minTokenOut, 'minimum token output', true),
    })),
    tokens: (params?.tokens || []).map((token: any) => ({ token: token.token, beneficiary: token.beneficiary })),
    execId: rpcUint(params.execId, 'execution ID'),
    deadline: rpcUint(params.deadline, 'execution deadline'),
    metadata: params.metadata,
  }
}

function toHex(value: bigint) {
  return `0x${value.toString(16)}`
}

async function sendBufferedTx(ethereum: Eip1193Provider, tx: any): Promise<string> {
  const first = await bufferedFees(ethereum, tx, 3n)
  try {
    return await ethereum.request({ method: 'eth_sendTransaction', params: [{ ...tx, ...first }] })
  } catch (error: any) {
    const msg = error?.message || ''
    if (!/max fee per gas less than block base fee|replacement transaction underpriced|fee/i.test(msg)) throw error
    await new Promise(resolve => setTimeout(resolve, 1200))
    const retry = await bufferedFees(ethereum, tx, 6n)
    return await ethereum.request({ method: 'eth_sendTransaction', params: [{ ...tx, ...retry }] })
  }
}

async function bufferedFees(ethereum: Eip1193Provider, tx: any, multiplier: bigint) {
  const out: any = {}
  try {
    const gasHex = await ethereum.request({ method: 'eth_estimateGas', params: [tx] })
    out.gas = toHex((rpcUint(gasHex, 'estimated gas') * 13n) / 10n + 10_000n)
  } catch {}
  try {
    const block = await ethereum.request({ method: 'eth_getBlockByNumber', params: ['latest', false] })
    const baseFee = block?.baseFeePerGas ? rpcUint(block.baseFeePerGas, 'base fee', true) : 0n
    if (baseFee > 0n) {
      let tip = 0n
      try { tip = rpcUint(await ethereum.request({ method: 'eth_maxPriorityFeePerGas' }), 'priority fee', true) } catch {}
      if (tip < 1_500_000n) tip = 1_500_000n
      out.maxPriorityFeePerGas = toHex(tip)
      out.maxFeePerGas = toHex(baseFee * multiplier + tip * 2n)
      return out
    }
  } catch {}
  try {
    const gasPrice = rpcUint(await ethereum.request({ method: 'eth_gasPrice' }), 'gas price')
    out.gasPrice = toHex(gasPrice * multiplier)
  } catch {}
  return out
}

async function waitForReceipt(ethereum: Eip1193Provider, hash: string) {
  for (let i = 0; i < 45; i++) {
    const receipt = await ethereum.request({ method: 'eth_getTransactionReceipt', params: [hash] }).catch(() => null)
    if (receipt?.status === '0x1') return receipt
    if (receipt?.status === '0x0') throw new Error(`Transaction reverted: ${hash}`)
    await new Promise(resolve => setTimeout(resolve, 1500))
  }
  throw new Error(`Transaction submitted but not confirmed: ${hash}`)
}

async function ensureArcChain(ethereum: Eip1193Provider) {
  const current = String(await ethereum.request({ method: 'eth_chainId' })).toLowerCase()
  if (current !== ARC_TESTNET_CHAIN_ID) {
    try {
      await ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: ARC_TESTNET_CHAIN_ID }] })
    } catch (error: any) {
      if (error?.code !== 4902 && error?.code !== -32603) throw error
      await ethereum.request({ method: 'wallet_addEthereumChain', params: [ARC_TESTNET_ADD_PARAMS] })
    }
  }
  const active = String(await ethereum.request({ method: 'eth_chainId' })).toLowerCase()
  if (active !== ARC_TESTNET_CHAIN_ID) throw new Error(`Wallet chain ${active} is not Arc Testnet ${ARC_TESTNET_CHAIN_ID}.`)
}
