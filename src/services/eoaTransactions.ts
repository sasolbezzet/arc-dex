import { encodeFunctionData, erc20Abi, parseUnits } from 'viem'
import { ARC_TESTNET_EXPLORER_TX, switchToArcTestnet } from '../domain/arcNetwork'
import { getArcToken } from '../domain/tokens'

declare global {
  interface Window {
    ethereum?: any
  }
}

export async function sendTokenFromEoa(args: {
  from: string
  to: string
  token: string
  amount: string
}) {
  if (!window.ethereum) throw new Error('MetaMask tidak terdeteksi.')
  const token = getArcToken(args.token)
  if (!token) throw new Error('Token tidak didukung: ' + args.token)

  await switchToArcTestnet()
  const value = parseUnits(args.amount, token.decimals)
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'transfer',
    args: [args.to as `0x${string}`, value],
  })
  const txHash = await window.ethereum.request({
    method: 'eth_sendTransaction',
    params: [{ from: args.from, to: token.address, data }],
  })
  return {
    name: 'transfer',
    state: 'success',
    txHash,
    explorerUrl: ARC_TESTNET_EXPLORER_TX + txHash,
  }
}

export async function estimateSendTokenFromEoa(args: {
  from: string
  to: string
  token: string
  amount: string
}) {
  if (!window.ethereum) throw new Error('MetaMask tidak terdeteksi.')
  const token = getArcToken(args.token)
  if (!token) throw new Error('Token tidak didukung: ' + args.token)

  await switchToArcTestnet()
  const value = parseUnits(args.amount, token.decimals)
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'transfer',
    args: [args.to as `0x${string}`, value],
  })
  const [gasHex, gasPriceHex] = await Promise.all([
    window.ethereum.request({
      method: 'eth_estimateGas',
      params: [{ from: args.from, to: token.address, data }],
    }),
    window.ethereum.request({ method: 'eth_gasPrice' }),
  ])
  const gas = BigInt(gasHex)
  const gasPrice = BigInt(gasPriceHex)
  const fee = Number(gas * gasPrice) / 1e18
  return {
    gas: gas.toString(),
    gasPrice: gasPrice.toString(),
    fee: fee.toFixed(6),
    token: 'USDC',
  }
}

export async function approveTokenSpenderFromEoa(args: {
  from: string
  token: string
  spender: `0x${string}`
  amount: string
}) {
  if (!window.ethereum) throw new Error('MetaMask tidak terdeteksi.')
  const token = getArcToken(args.token)
  if (!token) throw new Error('Token tidak didukung: ' + args.token)

  await switchToArcTestnet()
  const value = parseUnits(args.amount, token.decimals)
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'approve',
    args: [args.spender, value],
  })
  const txHash = await window.ethereum.request({
    method: 'eth_sendTransaction',
    params: [{ from: args.from, to: token.address, data }],
  })
  return {
    name: 'approve',
    state: 'success',
    txHash,
    explorerUrl: ARC_TESTNET_EXPLORER_TX + txHash,
  }
}
