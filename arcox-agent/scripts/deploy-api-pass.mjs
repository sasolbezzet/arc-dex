#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { createPublicClient, createWalletClient, defineChain, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
loadEnv(join(root, '.env'))
const rpc = process.env.ARC_RPC || process.env.ARC_RPC_URL || process.env.RPC || 'https://rpc.testnet.arc.network/'
const account = privateKeyToAccount(required('AGENT_PRIVATE_KEY'))
const chain = defineChain({ id: 5042002, name: 'Arc Testnet', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } })
const artifact = JSON.parse(readFileSync(join(root, 'artifacts', 'ArcoxApiPass.json'), 'utf8'))
const publicClient = createPublicClient({ chain, transport: http(rpc) })
const walletClient = createWalletClient({ account, chain, transport: http(rpc) })
const hash = await walletClient.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode })
const receipt = await publicClient.waitForTransactionReceipt({ hash })
if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error('ARCOX API Pass deployment reverted')
const outDir = join(root, 'deployments')
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'arcox-api-pass.arc-testnet.json'), JSON.stringify({
  chainId: 5042002,
  address: receipt.contractAddress,
  deployer: account.address,
  deployTxHash: hash,
  deployedAt: new Date().toISOString(),
}, null, 2))
console.log(JSON.stringify({ address: receipt.contractAddress, deployTxHash: hash }))

function loadEnv(path) {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const value = line.trim()
    if (!value || value.startsWith('#') || !value.includes('=')) continue
    const [key, ...rest] = value.split('=')
    if (!process.env[key]) process.env[key] = rest.join('=').replace(/^['"]|['"]$/g, '')
  }
}
function required(name) {
  const value = process.env[name] || ''
  if (!value) throw new Error(`Missing ${name}`)
  return value.startsWith('0x') ? value : `0x${value}`
}
