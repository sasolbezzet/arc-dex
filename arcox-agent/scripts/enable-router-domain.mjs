#!/usr/bin/env node
import { existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { createPublicClient, createWalletClient, defineChain, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = dirname(__dirname)
const envPath = join(root, '.env')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue
    const idx = trimmed.indexOf('=')
    const key = trimmed.slice(0, idx).trim()
    let value = trimmed.slice(idx + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    if (!process.env[key]) process.env[key] = value
  }
}

const pk = process.env.AGENT_PRIVATE_KEY
if (!pk) throw new Error('AGENT_PRIVATE_KEY is required')
const account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`)
const targetDomain = Number(process.argv[2] || '5')
const artifact = JSON.parse(readFileSync(join(root, 'artifacts', 'ArcoxRouter.json'), 'utf8'))
const deployments = JSON.parse(readFileSync(join(root, 'deployments', 'arcox-router.testnet.json'), 'utf8')).deployments

const chains = {
  Arc_Testnet: defineChain({ id: 5042002, name: 'Arc Testnet', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [process.env.ARC_RPC || 'https://rpc.testnet.arc.network/'] } } }),
  Ethereum_Sepolia: defineChain({ id: 11155111, name: 'Ethereum Sepolia', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [process.env.ETHEREUM_SEPOLIA_RPC || 'https://ethereum-sepolia-rpc.publicnode.com'] } } }),
  Base_Sepolia: defineChain({ id: 84532, name: 'Base Sepolia', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [process.env.BASE_SEPOLIA_RPC || 'https://sepolia.base.org'] } } }),
  Arbitrum_Sepolia: defineChain({ id: 421614, name: 'Arbitrum Sepolia', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [process.env.ARBITRUM_SEPOLIA_RPC || 'https://arbitrum-sepolia.publicnode.com'] } } }),
}

for (const [name, chain] of Object.entries(chains)) {
  const router = deployments[name]?.address
  if (!router) {
    console.log(`[${name}] skipped, no router`)
    continue
  }
  const transport = http(chain.rpcUrls.default.http[0], { timeout: 12000 })
  const publicClient = createPublicClient({ chain, transport })
  const walletClient = createWalletClient({ account, chain, transport })
  const supported = await publicClient.readContract({ address: router, abi: artifact.abi, functionName: 'supportedDestinationDomains', args: [targetDomain] })
  if (supported) {
    console.log(`[${name}] domain ${targetDomain} already enabled`)
    continue
  }
  const owner = await publicClient.readContract({ address: router, abi: artifact.abi, functionName: 'owner' })
  if (owner.toLowerCase() !== account.address.toLowerCase()) throw new Error(`[${name}] signer is not router owner`)
  const hash = await walletClient.writeContract({ address: router, abi: artifact.abi, functionName: 'setSupportedDestinationDomain', args: [targetDomain, true] })
  await publicClient.waitForTransactionReceipt({ hash })
  console.log(`[${name}] domain ${targetDomain} enabled tx=${hash}`)
}
