#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { createPublicClient, createWalletClient, defineChain, encodeFunctionData, getAddress, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = dirname(__dirname)
loadEnv(join(root, '.env'))

const artifact = JSON.parse(readFileSync(join(root, 'artifacts', 'ArcoxRouter.json'), 'utf8'))
const account = privateKeyToAccount(requiredEnv('AGENT_PRIVATE_KEY'))
const feeBps = Number(process.env.ARCOX_ROUTER_FEE_BPS || '30')
const treasury = getAddress(process.env.ARCOX_FEE_TREASURY || account.address)
const TOKEN_MESSENGER = '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA'

const chains = {
  Arc_Testnet: {
    domain: 26,
    usdc: '0x3600000000000000000000000000000000000000',
    rpc: process.env.ARC_RPC || 'https://rpc.testnet.arc.network/',
    chain: defineChain({ id: 5042002, name: 'Arc Testnet', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [process.env.ARC_RPC || 'https://rpc.testnet.arc.network/'] } } }),
  },
  Ethereum_Sepolia: {
    domain: 0,
    usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    rpc: process.env.ETHEREUM_SEPOLIA_RPC || 'https://ethereum-sepolia-rpc.publicnode.com',
    chain: defineChain({ id: 11155111, name: 'Ethereum Sepolia', nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [process.env.ETHEREUM_SEPOLIA_RPC || 'https://ethereum-sepolia-rpc.publicnode.com'] } } }),
  },
  Base_Sepolia: {
    domain: 6,
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    rpc: process.env.BASE_SEPOLIA_RPC || 'https://sepolia.base.org',
    chain: defineChain({ id: 84532, name: 'Base Sepolia', nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [process.env.BASE_SEPOLIA_RPC || 'https://sepolia.base.org'] } } }),
  },
  Arbitrum_Sepolia: {
    domain: 3,
    usdc: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
    rpc: process.env.ARBITRUM_SEPOLIA_RPC || 'https://arbitrum-sepolia.publicnode.com',
    chain: defineChain({ id: 421614, name: 'Arbitrum Sepolia', nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [process.env.ARBITRUM_SEPOLIA_RPC || 'https://arbitrum-sepolia.publicnode.com'] } } }),
  },
  HyperEVM_Testnet: {
    domain: 19,
    usdc: '0x2B3370eE501B4a559b57D449569354196457D8Ab',
    rpc: process.env.HYPEREVM_TESTNET_RPC || 'https://rpc.hyperliquid-testnet.xyz/evm',
    chain: defineChain({ id: 998, name: 'HyperEVM Testnet', nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 }, rpcUrls: { default: { http: [process.env.HYPEREVM_TESTNET_RPC || 'https://rpc.hyperliquid-testnet.xyz/evm'] } } }),
  },
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

async function deployOne(name, cfg) {
  const publicClient = createPublicClient({ chain: cfg.chain, transport: http(cfg.rpc) })
  const walletClient = createWalletClient({ account, chain: cfg.chain, transport: http(cfg.rpc) })
  const nativeBalance = await publicClient.getBalance({ address: account.address })
  console.log(`[${name}] deployer=${account.address} native=${nativeBalance}`)
  if (nativeBalance === 0n) throw new Error(`[${name}] no native gas`)

  const hash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args: [account.address, treasury, cfg.usdc, TOKEN_MESSENGER, cfg.domain, feeBps],
  })
  console.log(`[${name}] deploy tx=${hash}`)
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`[${name}] deployment reverted`)
  const address = getAddress(receipt.contractAddress)
  console.log(`[${name}] router=${address}`)

  for (const domain of Object.values(chains).map(chain => chain.domain).filter(domain => domain !== cfg.domain)) {
    const data = encodeFunctionData({ abi: artifact.abi, functionName: 'setSupportedDestinationDomain', args: [domain, true] })
    const setHash = await walletClient.sendTransaction({ to: address, data })
    await publicClient.waitForTransactionReceipt({ hash: setHash })
    console.log(`[${name}] domain ${domain} enabled tx=${setHash}`)
  }
  return { address, deployTx: hash, chainId: cfg.chain.id, domain: cfg.domain, usdc: cfg.usdc, tokenMessenger: TOKEN_MESSENGER }
}

const outDir = join(root, 'deployments')
mkdirSync(outDir, { recursive: true })
const outPath = join(outDir, 'arcox-router.testnet.json')
const previous = existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf8')) : {}
const defaultDeployChains = ['Arc_Testnet', 'Ethereum_Sepolia', 'Base_Sepolia', 'Arbitrum_Sepolia']
const selected = (process.env.DEPLOY_CHAINS || defaultDeployChains.join(',')).split(',').map(item => item.trim()).filter(Boolean)
const deployments = { ...(previous.deployments || {}) }
const errors = { ...(previous.errors || {}) }
for (const name of selected) {
  const cfg = chains[name]
  if (!cfg) {
    errors[name] = 'unknown chain'
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
  if (/exceeds the balance|insufficient funds/i.test(message)) return 'insufficient native gas for deployment'
  if (/no native gas/i.test(message)) return firstLine
  return firstLine.slice(0, 300)
}
