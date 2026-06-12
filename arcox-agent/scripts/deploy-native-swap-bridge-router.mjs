#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { createPublicClient, createWalletClient, defineChain, encodeFunctionData, getAddress, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = dirname(__dirname)
const repoRoot = dirname(root)
loadEnv(join(repoRoot, '.env'))
loadEnv(join(repoRoot, '.env.local'))
loadEnv(join(repoRoot, '.env.production'))
loadEnv(join(repoRoot, '.vercel', '.env.production.local'))
loadEnv(join(root, '.env'))

const artifact = JSON.parse(readFileSync(join(root, 'artifacts', 'ArcoxNativeSwapBridgeRouter.json'), 'utf8'))
const account = privateKeyToAccount(requiredEnv('AGENT_PRIVATE_KEY'))
const feeBps = Number(process.env.ARCOX_ROUTER_FEE_BPS || '30')
const treasury = getAddress(process.env.ARCOX_FEE_TREASURY || account.address)
const TOKEN_MESSENGER = '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA'

const chains = {
  Ethereum_Sepolia: {
    domain: 0,
    usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    wrappedNative: firstEnv('ETHEREUM_SEPOLIA_WRAPPED_NATIVE', 'ETHEREUM_SEPOLIA_WETH', 'ETHEREUM_SEPOLIA_WETH9') || '0xfff9976782d46cc05630d1f6ebab18b2324d6b14',
    swapRouter: firstEnv('ETHEREUM_SEPOLIA_UNIVERSAL_ROUTER', 'ETHEREUM_SEPOLIA_UNISWAP_UNIVERSAL_ROUTER', 'ETHEREUM_SEPOLIA_UNISWAP_SWAP_ROUTER') || '0x3a9d48ab9751398bbfa63ad67599bb04e4bdf98b',
    rpc: process.env.ETHEREUM_SEPOLIA_RPC || 'https://ethereum-sepolia-rpc.publicnode.com',
    chain: defineChain({ id: 11155111, name: 'Ethereum Sepolia', nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [process.env.ETHEREUM_SEPOLIA_RPC || 'https://ethereum-sepolia-rpc.publicnode.com'] } } }),
  },
  Base_Sepolia: {
    domain: 6,
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    wrappedNative: firstEnv('BASE_SEPOLIA_WRAPPED_NATIVE', 'BASE_SEPOLIA_WETH', 'BASE_SEPOLIA_WETH9') || '0x4200000000000000000000000000000000000006',
    swapRouter: firstEnv('BASE_SEPOLIA_UNIVERSAL_ROUTER', 'BASE_SEPOLIA_UNISWAP_UNIVERSAL_ROUTER', 'BASE_SEPOLIA_UNISWAP_SWAP_ROUTER') || '0x95273d871c8156636e114b63797d78D7E1720d81',
    rpc: process.env.BASE_SEPOLIA_RPC || 'https://sepolia.base.org',
    chain: defineChain({ id: 84532, name: 'Base Sepolia', nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [process.env.BASE_SEPOLIA_RPC || 'https://sepolia.base.org'] } } }),
  },
  Arbitrum_Sepolia: {
    domain: 3,
    usdc: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
    wrappedNative: firstEnv('ARBITRUM_SEPOLIA_WRAPPED_NATIVE', 'ARBITRUM_SEPOLIA_WETH', 'ARBITRUM_SEPOLIA_WETH9') || '0xE591bf0A0CF924A0674d7792db046B23CEbF5f34',
    swapRouter: firstEnv('ARBITRUM_SEPOLIA_UNIVERSAL_ROUTER', 'ARBITRUM_SEPOLIA_UNISWAP_UNIVERSAL_ROUTER', 'ARBITRUM_SEPOLIA_UNISWAP_SWAP_ROUTER'),
    rpc: process.env.ARBITRUM_SEPOLIA_RPC || 'https://arbitrum-sepolia.publicnode.com',
    chain: defineChain({ id: 421614, name: 'Arbitrum Sepolia', nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [process.env.ARBITRUM_SEPOLIA_RPC || 'https://arbitrum-sepolia.publicnode.com'] } } }),
  },
  HyperEVM_Testnet: {
    domain: 19,
    usdc: '0x2B3370eE501B4a559b57D449569354196457D8Ab',
    wrappedNative: firstEnv('HYPEREVM_TESTNET_WRAPPED_NATIVE', 'HYPEREVM_TESTNET_WHYPE', 'HYPEREVM_TESTNET_WETH'),
    swapRouter: firstEnv('HYPEREVM_TESTNET_UNIVERSAL_ROUTER', 'HYPEREVM_TESTNET_UNISWAP_UNIVERSAL_ROUTER', 'HYPEREVM_TESTNET_UNISWAP_SWAP_ROUTER'),
    rpc: process.env.HYPEREVM_TESTNET_RPC || 'https://rpc.hyperliquid-testnet.xyz/evm',
    chain: defineChain({ id: 998, name: 'HyperEVM Testnet', nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 }, rpcUrls: { default: { http: [process.env.HYPEREVM_TESTNET_RPC || 'https://rpc.hyperliquid-testnet.xyz/evm'] } } }),
  },
}

function firstEnv(...names) {
  for (const name of names) {
    const value = process.env[name]
    if (value) return value
  }
  return ''
}

function loadEnv(path) {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue
    const [key, ...rest] = trimmed.split('=')
    if (!process.env[key]) process.env[key] = rest.join('=').replace(/^['"]|['"]$/g, '')
  }
}

function requiredEnv(name) {
  const value = process.env[name] || ''
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

function requireAddress(value, name, chainName) {
  if (!value) throw new Error(`[${chainName}] missing ${name}`)
  return getAddress(value)
}

async function deployOne(name, cfg) {
  const wrappedNative = requireAddress(cfg.wrappedNative, 'WRAPPED_NATIVE env', name)
  const swapRouter = requireAddress(cfg.swapRouter, 'UNIVERSAL_ROUTER env', name)
  const publicClient = createPublicClient({ chain: cfg.chain, transport: http(cfg.rpc) })
  const walletClient = createWalletClient({ account, chain: cfg.chain, transport: http(cfg.rpc) })
  await requireContractCode(publicClient, wrappedNative, 'wrapped native', name)
  await requireContractCode(publicClient, swapRouter, 'Universal Router', name)
  const nativeBalance = await publicClient.getBalance({ address: account.address })
  console.log(`[${name}] deployer=${account.address} native=${nativeBalance}`)
  if (nativeBalance === 0n) throw new Error(`[${name}] no native gas`)

  const hash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args: [account.address, treasury, wrappedNative, cfg.usdc, swapRouter, TOKEN_MESSENGER, cfg.domain, feeBps],
  })
  console.log(`[${name}] deploy tx=${hash}`)
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`[${name}] deployment reverted`)
  const address = getAddress(receipt.contractAddress)
  console.log(`[${name}] nativeSwapBridgeRouter=${address}`)

  const data = encodeFunctionData({ abi: artifact.abi, functionName: 'setSupportedDestinationDomain', args: [26, true] })
  const setHash = await walletClient.sendTransaction({ to: address, data })
  await publicClient.waitForTransactionReceipt({ hash: setHash })
  console.log(`[${name}] Arc domain 26 enabled tx=${setHash}`)

  return { address, deployTx: hash, chainId: cfg.chain.id, domain: cfg.domain, usdc: cfg.usdc, wrappedNative, swapRouter, tokenMessenger: TOKEN_MESSENGER }
}

const outDir = join(root, 'deployments')
mkdirSync(outDir, { recursive: true })
const outPath = join(outDir, 'arcox-native-swap-bridge-router.testnet.json')
const previous = existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf8')) : {}
const selected = (process.env.DEPLOY_CHAINS || 'Ethereum_Sepolia,Base_Sepolia').split(',').map(item => item.trim()).filter(Boolean)
const deployments = { ...(previous.deployments || {}) }
const errors = { ...(previous.errors || {}) }
const forceRedeploy = process.env.FORCE_REDEPLOY_NATIVE_ROUTER === 'true'
for (const name of selected) {
  const cfg = chains[name]
  if (!cfg) {
    errors[name] = 'unknown chain'
    continue
  }
  if (deployments[name]?.address && !forceRedeploy) {
    console.log(`[${name}] skipped existing nativeSwapBridgeRouter=${deployments[name].address}`)
    delete errors[name]
    continue
  }
  try {
    deployments[name] = await deployOne(name, cfg)
    delete errors[name]
  } catch (error) {
    errors[name] = summarizeError(error.message)
    console.error(`[${name}] ERROR ${error.message}`)
  }
}

writeFileSync(outPath, JSON.stringify({
  deployer: account.address,
  treasury,
  feeBps,
  createdAt: new Date().toISOString(),
  deployments,
  errors,
}, null, 2))
console.log(`Wrote ${outPath}`)

function summarizeError(message = '') {
  const firstLine = String(message).split('\n').find(Boolean) || String(message)
  if (/exceeds the balance|insufficient funds|contract creation code storage out of gas/i.test(message)) return 'insufficient native gas for deployment'
  if (/no native gas|missing/i.test(message)) return firstLine
  return firstLine.slice(0, 300)
}

async function requireContractCode(publicClient, address, label, chainName) {
  const code = await publicClient.getBytecode({ address })
  if (!code || code === '0x') throw new Error(`[${chainName}] ${label} has no bytecode at ${address}`)
}
