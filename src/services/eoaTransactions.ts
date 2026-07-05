import { encodeFunctionData, erc20Abi, parseUnits } from 'viem'
import { ARC_TESTNET_EXPLORER_TX, switchToArcTestnet } from '../domain/arcNetwork'
import { getArcToken } from '../domain/tokens'
import { findConnectedWalletProvider, normalizeWalletProvider } from '../walletProvider'
import { rpcUint } from '../utils/rpcQuantity'

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
  const ethereum = await connectedProvider(args.from)
  const token = getArcToken(args.token)
  if (!token) throw new Error('Token tidak didukung: ' + args.token)

  await switchToArcTestnet()
  const value = parseUnits(args.amount, token.decimals)
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'transfer',
    args: [args.to as `0x${string}`, value],
  })
  const txHash = await ethereum.request({
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
  const ethereum = await connectedProvider(args.from)
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
    ethereum.request({
      method: 'eth_estimateGas',
      params: [{ from: args.from, to: token.address, data }],
    }),
    ethereum.request({ method: 'eth_gasPrice' }),
  ])
  const gas = rpcUint(gasHex, 'estimated gas')
  const gasPrice = rpcUint(gasPriceHex, 'gas price')
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
  const ethereum = await connectedProvider(args.from)
  const token = getArcToken(args.token)
  if (!token) throw new Error('Token tidak didukung: ' + args.token)

  await switchToArcTestnet()
  const value = parseUnits(args.amount, token.decimals)
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'approve',
    args: [args.spender, value],
  })
  const txHash = await ethereum.request({
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

async function connectedProvider(expectedAddress: string) {
  const provider = await findConnectedWalletProvider(expectedAddress)
  if (!provider) throw new Error('Wallet EVM tidak terdeteksi.')
  return normalizeWalletProvider(provider)
}
