#!/usr/bin/env node
import { createHash } from 'crypto'
import { existsSync, readFileSync } from 'fs'
import { createServer } from 'http'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  erc20Abi,
  formatUnits,
  getAddress,
  http,
  keccak256,
  parseUnits,
  toHex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import bs58 from 'bs58'
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
} from '@solana/spl-token'

const __dirname = dirname(fileURLToPath(import.meta.url))
const AGENT_HOME = dirname(__dirname)

loadLocalEnv()

const ARC_RPC = process.env.ARC_RPC || 'https://rpc.testnet.arc.network/'
const EXPLORER_TX = 'https://testnet.arcscan.app/tx/'
const AGENTIC_COMMERCE_CONTRACT = '0x0747EEf0706327138c69792bF28Cd525089e4583'
const IDENTITY_REGISTRY = '0x8004A818BFB912233c491871b3d84c89A494BD9e'
const ARC_USDC = '0x3600000000000000000000000000000000000000'
const TOKEN_MESSENGER_V2_EVM = '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA'
const MESSAGE_TRANSMITTER_V2_EVM = '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275'
const IRIS = 'https://iris-api-sandbox.circle.com'
const SOLANA_DEVNET_RPC = process.env.SOLANA_DEVNET_RPC || 'https://api.devnet.solana.com'
const SOLANA_USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
const SOLANA_TOKEN_MESSENGER_PROGRAM = 'CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe'
const SOLANA_MESSAGE_TRANSMITTER_PROGRAM = 'CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC'
const ARCOX_WEB_URL = process.env.ARCOX_WEB_URL || process.env.ARCOX_API_URL || 'https://arc-dex-bice.vercel.app'
const ARCOX_BACKEND_URL = process.env.ARCOX_BACKEND_URL || 'https://43.163.98.128.nip.io'
const DEFAULT_AGENT_NAME = process.env.AGENT_NAME || 'ARCOX Codex Retail Agent'
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const JOB_STATUS = ['Open', 'Funded', 'Submitted', 'Completed', 'Rejected', 'Expired']
const ARC_TOKENS = {
  USDC: { address: ARC_USDC, decimals: 6 },
  EURC: { address: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a', decimals: 6 },
  USYC: { address: '0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C', decimals: 6 },
  CIRBTC: { address: '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF', decimals: 8 },
}

const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC] } },
  blockExplorers: { default: { name: 'ArcScan', url: 'https://testnet.arcscan.app' } },
})

const publicClient = createPublicClient({ chain: arcTestnet, transport: http(ARC_RPC) })
const routerDeployments = loadRouterDeployments()

const cctpChains = {
  Arc_Testnet: {
    id: 'Arc_Testnet',
    aliases: ['arc', 'arc testnet', 'arc_testnet'],
    domain: 26,
    usdc: ARC_USDC,
    tokenMessenger: TOKEN_MESSENGER_V2_EVM,
    messageTransmitter: MESSAGE_TRANSMITTER_V2_EVM,
    explorer: 'https://testnet.arcscan.app/tx/',
    rpc: ARC_RPC,
    chain: arcTestnet,
    fast: true,
  },
  Ethereum_Sepolia: {
    id: 'Ethereum_Sepolia',
    aliases: ['ethereum', 'ethereum sepolia', 'eth sepolia', 'sepolia'],
    domain: 0,
    usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    tokenMessenger: TOKEN_MESSENGER_V2_EVM,
    messageTransmitter: MESSAGE_TRANSMITTER_V2_EVM,
    explorer: 'https://sepolia.etherscan.io/tx/',
    rpc: process.env.ETHEREUM_SEPOLIA_RPC || 'https://ethereum-sepolia-rpc.publicnode.com',
    chain: defineChain({ id: 11155111, name: 'Ethereum Sepolia', nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [process.env.ETHEREUM_SEPOLIA_RPC || 'https://ethereum-sepolia-rpc.publicnode.com'] } }, blockExplorers: { default: { name: 'Etherscan', url: 'https://sepolia.etherscan.io' } } }),
    fast: false,
  },
  Base_Sepolia: {
    id: 'Base_Sepolia',
    aliases: ['base', 'base sepolia'],
    domain: 6,
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    tokenMessenger: TOKEN_MESSENGER_V2_EVM,
    messageTransmitter: MESSAGE_TRANSMITTER_V2_EVM,
    explorer: 'https://sepolia.basescan.org/tx/',
    rpc: process.env.BASE_SEPOLIA_RPC || 'https://sepolia.base.org',
    chain: defineChain({ id: 84532, name: 'Base Sepolia', nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [process.env.BASE_SEPOLIA_RPC || 'https://sepolia.base.org'] } }, blockExplorers: { default: { name: 'BaseScan', url: 'https://sepolia.basescan.org' } } }),
    fast: false,
  },
  Arbitrum_Sepolia: {
    id: 'Arbitrum_Sepolia',
    aliases: ['arbitrum', 'arbitrum sepolia', 'arb sepolia'],
    domain: 3,
    usdc: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
    tokenMessenger: TOKEN_MESSENGER_V2_EVM,
    messageTransmitter: MESSAGE_TRANSMITTER_V2_EVM,
    explorer: 'https://sepolia.arbiscan.io/tx/',
    rpc: process.env.ARBITRUM_SEPOLIA_RPC || 'https://arbitrum-sepolia.publicnode.com',
    chain: defineChain({ id: 421614, name: 'Arbitrum Sepolia', nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [process.env.ARBITRUM_SEPOLIA_RPC || 'https://arbitrum-sepolia.publicnode.com'] } }, blockExplorers: { default: { name: 'Arbiscan', url: 'https://sepolia.arbiscan.io' } } }),
    fast: false,
  },
  HyperEVM_Testnet: {
    id: 'HyperEVM_Testnet',
    aliases: ['hyperevm', 'hyper evm', 'hypevm', 'hype', 'hyperevm testnet'],
    domain: 19,
    usdc: '0x2B3370eE501B4a559b57D449569354196457D8Ab',
    tokenMessenger: TOKEN_MESSENGER_V2_EVM,
    messageTransmitter: MESSAGE_TRANSMITTER_V2_EVM,
    explorer: 'https://app.hyperliquid-testnet.xyz/explorer/tx/',
    rpc: process.env.HYPEREVM_TESTNET_RPC || 'https://rpc.hyperliquid-testnet.xyz/evm',
    chain: defineChain({ id: 998, name: 'HyperEVM Testnet', nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 }, rpcUrls: { default: { http: [process.env.HYPEREVM_TESTNET_RPC || 'https://rpc.hyperliquid-testnet.xyz/evm'] } }, blockExplorers: { default: { name: 'Hyperliquid', url: 'https://app.hyperliquid-testnet.xyz/explorer' } } }),
    fast: false,
  },
  Solana_Devnet: {
    id: 'Solana_Devnet',
    aliases: ['solana', 'solana devnet', 'solana_devnet', 'sol'],
    domain: 5,
    usdc: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    explorer: 'https://explorer.solana.com/tx/',
    rpc: process.env.SOLANA_DEVNET_RPC || 'https://api.devnet.solana.com',
    fast: true,
    solana: true,
  },
}

const tokenMessengerAbi = [{
  type: 'function',
  name: 'depositForBurn',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'amount', type: 'uint256' },
    { name: 'destinationDomain', type: 'uint32' },
    { name: 'mintRecipient', type: 'bytes32' },
    { name: 'burnToken', type: 'address' },
    { name: 'destinationCaller', type: 'bytes32' },
    { name: 'maxFee', type: 'uint256' },
    { name: 'minFinalityThreshold', type: 'uint32' },
  ],
  outputs: [],
}]

const messageTransmitterAbi = [{
  type: 'function',
  name: 'receiveMessage',
  stateMutability: 'nonpayable',
  inputs: [{ name: 'message', type: 'bytes' }, { name: 'attestation', type: 'bytes' }],
  outputs: [{ name: 'success', type: 'bool' }],
}]

const arcoxRouterAbi = [
  {
    type: 'function',
    name: 'bridgeUsdcWithFee',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'destinationDomain', type: 'uint32' },
      { name: 'mintRecipient', type: 'bytes32' },
      { name: 'destinationCaller', type: 'bytes32' },
      { name: 'maxFee', type: 'uint256' },
      { name: 'minFinalityThreshold', type: 'uint32' },
    ],
    outputs: [{ name: 'fee', type: 'uint256' }, { name: 'netAmount', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'sendTokenWithFee',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'token', type: 'address' }, { name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ name: 'fee', type: 'uint256' }, { name: 'netAmount', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'quoteFee',
    stateMutability: 'view',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [{ name: 'fee', type: 'uint256' }, { name: 'netAmount', type: 'uint256' }],
  },
]

const agenticCommerceAbi = [
  {
    type: 'function',
    name: 'createJob',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'provider', type: 'address' },
      { name: 'evaluator', type: 'address' },
      { name: 'expiredAt', type: 'uint256' },
      { name: 'description', type: 'string' },
      { name: 'hook', type: 'address' },
    ],
    outputs: [{ name: 'jobId', type: 'uint256' }],
  },
  { type: 'function', name: 'setBudget', stateMutability: 'nonpayable', inputs: [{ name: 'jobId', type: 'uint256' }, { name: 'amount', type: 'uint256' }, { name: 'optParams', type: 'bytes' }], outputs: [] },
  { type: 'function', name: 'fund', stateMutability: 'nonpayable', inputs: [{ name: 'jobId', type: 'uint256' }, { name: 'optParams', type: 'bytes' }], outputs: [] },
  { type: 'function', name: 'submit', stateMutability: 'nonpayable', inputs: [{ name: 'jobId', type: 'uint256' }, { name: 'deliverable', type: 'bytes32' }, { name: 'optParams', type: 'bytes' }], outputs: [] },
  { type: 'function', name: 'complete', stateMutability: 'nonpayable', inputs: [{ name: 'jobId', type: 'uint256' }, { name: 'reason', type: 'bytes32' }, { name: 'optParams', type: 'bytes' }], outputs: [] },
  {
    type: 'function',
    name: 'getJob',
    stateMutability: 'view',
    inputs: [{ name: 'jobId', type: 'uint256' }],
    outputs: [{
      type: 'tuple',
      components: [
        { name: 'id', type: 'uint256' },
        { name: 'client', type: 'address' },
        { name: 'provider', type: 'address' },
        { name: 'evaluator', type: 'address' },
        { name: 'description', type: 'string' },
        { name: 'budget', type: 'uint256' },
        { name: 'expiredAt', type: 'uint256' },
        { name: 'status', type: 'uint8' },
        { name: 'hook', type: 'address' },
      ],
    }],
  },
  {
    type: 'event',
    name: 'JobCreated',
    inputs: [
      { indexed: true, name: 'jobId', type: 'uint256' },
      { indexed: true, name: 'client', type: 'address' },
      { indexed: true, name: 'provider', type: 'address' },
      { indexed: false, name: 'evaluator', type: 'address' },
      { indexed: false, name: 'expiredAt', type: 'uint256' },
      { indexed: false, name: 'hook', type: 'address' },
    ],
    anonymous: false,
  },
]

const identityAbi = [
  { type: 'function', name: 'register', stateMutability: 'nonpayable', inputs: [{ name: 'metadataURI', type: 'string' }], outputs: [] },
  { type: 'function', name: 'ownerOf', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'tokenURI', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: '', type: 'string' }] },
  { type: 'event', name: 'Transfer', inputs: [{ indexed: true, name: 'from', type: 'address' }, { indexed: true, name: 'to', type: 'address' }, { indexed: true, name: 'tokenId', type: 'uint256' }], anonymous: false },
]

function help() {
  console.log(`ARCOX terminal AI agent

Usage:
  npm run agent -- help
  npm run agent -- env-template
  npm run agent -- identity
  npm run agent -- connect
  npm run agent -- run --prompt "send 1 USDC to 0x..." --yes
  npm run agent -- run --prompt "bridge 5 USDC from Arbitrum Sepolia to Arc"
  npm run agent -- run --prompt "retry bridge 0xBURN_TX from Arc to Arbitrum Sepolia" --yes
  npm run agent -- run --prompt "swap 10 USDC to EURC"
  npm run agent -- serve --port 8787
  npm run agent -- ask --prompt "Create escrow job for 1 USDC"
  npm run agent -- status
  npm run agent -- register --metadata-uri ipfs://...
  npm run agent -- read-agent --agent-id 1
  npm run agent -- create-job --provider 0x... --evaluator 0x... --description "..." --hours 24
  npm run agent -- read-job --job-id 1
  npm run agent -- retry-bridge --burn-tx 0x... --from-chain Arc_Testnet --to-chain Arbitrum_Sepolia
  npm run agent -- set-budget --job-id 1 --amount 1
  npm run agent -- fund --job-id 1 --amount 1
  npm run agent -- submit --job-id 1 --deliverable "proof text"
  npm run agent -- complete --job-id 1 --reason "approved"

Required for onchain commands:
  Copy .env.example to .env and set AGENT_PRIVATE_KEY=0x...

Local endpoint for ARCOX DEX UI:
  npm run agent -- serve --port 8787
  Use endpoint: http://127.0.0.1:8787/agent

Safety:
  Retail payment commands show a preview first. Add --yes only after checking the route.
  The agent never needs the user's browser-wallet private key.
`)
}

function loadLocalEnv() {
  const agentEnv = join(AGENT_HOME, '.env')
  const fallbackEnv = join(process.cwd(), '.env')
  const envPath = existsSync(agentEnv) ? agentEnv : fallbackEnv
  if (!existsSync(envPath)) return
  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue
    const [key, ...rest] = trimmed.split('=')
    if (process.env[key]) continue
    process.env[key] = rest.join('=').replace(/^['"]|['"]$/g, '')
  }
}

function loadRouterDeployments() {
  const path = join(AGENT_HOME, 'deployments', 'arcox-router.testnet.json')
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf8')).deployments || {}
  } catch {
    return {}
  }
}

function envRouterName(chainId) {
  return `ARCOX_ROUTER_${String(chainId).toUpperCase()}`
}

export function routerFor(chainId) {
  const envValue = process.env[envRouterName(chainId)]
  if (envValue && /^0x[0-9a-fA-F]{40}$/.test(envValue)) return getAddress(envValue)
  const deployed = routerDeployments[chainId]?.address
  if (deployed && /^0x[0-9a-fA-F]{40}$/.test(deployed)) return getAddress(deployed)
  return ''
}

function arg(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  return process.argv[index + 1] || fallback
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`)
}

function command() {
  return process.argv[2] || 'help'
}

function privateKey() {
  const key = process.env.AGENT_PRIVATE_KEY || ''
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error('Set AGENT_PRIVATE_KEY=0x... for onchain agent commands.')
  return key
}

function wallet() {
  const account = privateKeyToAccount(privateKey())
  const walletClient = createWalletClient({ account, chain: arcTestnet, transport: http(ARC_RPC) })
  return { account, walletClient }
}

function solanaKeypair() {
  const raw = process.env.SOLANA_PRIVATE_KEY || ''
  if (!raw) throw new Error('Set SOLANA_PRIVATE_KEY in arcox-agent/.env for Solana bridge execution.')
  try {
    const bytes = raw.trim().startsWith('[')
      ? Uint8Array.from(JSON.parse(raw))
      : bs58.decode(raw.trim())
    return Keypair.fromSecretKey(bytes)
  } catch {
    throw new Error('Invalid SOLANA_PRIVATE_KEY. Use a base58 Solana secret key or JSON byte array.')
  }
}

function solanaConnection() {
  return new Connection(SOLANA_DEVNET_RPC, 'confirmed')
}

function hexToU8(hex) {
  const clean = String(hex || '').replace(/^0x/i, '')
  if (clean.length % 2 !== 0) throw new Error('Invalid hex length.')
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return out
}

function concatU8(...arrays) {
  const len = arrays.reduce((sum, arr) => sum + arr.length, 0)
  const out = new Uint8Array(len)
  let offset = 0
  for (const arr of arrays) {
    out.set(arr, offset)
    offset += arr.length
  }
  return out
}

function u32LE(n) {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, Number(n), true)
  return out
}

function u64LE(n) {
  const out = new Uint8Array(8)
  new DataView(out.buffer).setBigUint64(0, BigInt(n), true)
  return out
}

function enc(s) {
  return new TextEncoder().encode(s)
}

function localAgentId(owner) {
  if (process.env.AGENT_ID) return process.env.AGENT_ID
  const digest = createHash('sha256').update(`arcox:${owner}:${ARC_RPC}`).digest('hex').slice(0, 16)
  return `arcox-codex-${digest}`
}

export function metadataFor(owner) {
  return {
    name: DEFAULT_AGENT_NAME,
    description: 'Local-first ARCOX agent for retail swap, bridge, send, and Arc ERC-8183 job workflows.',
    agent_type: 'retail_payment_agent',
    owner,
    local_agent_id: localAgentId(owner),
    arc_agent_id: process.env.ARC_AGENT_ID || process.env.AGENT_ID || '',
    endpoint: `http://127.0.0.1:${process.env.AGENT_PORT || '8787'}/agent`,
    arcox_web_url: ARCOX_WEB_URL,
    arcox_backend_url: ARCOX_BACKEND_URL,
    capabilities: [
      'send_usdc_on_arc',
      'swap_circle_wallet_on_arc',
      'bridge_usdc_evm_cctp',
      'retry_bridge_mint',
      'create_erc8183_job',
      'submit_erc8183_deliverable',
      'complete_erc8183_job',
    ],
    chain: {
      name: arcTestnet.name,
      id: arcTestnet.id,
      rpc: ARC_RPC,
      identity_registry: IDENTITY_REGISTRY,
      agentic_commerce: AGENTIC_COMMERCE_CONTRACT,
    },
    signing: 'local_private_key_env_only',
    version: '1.1.0',
  }
}

function hashTextBytes32(text) {
  return keccak256(toHex(text || 'arcox-agent-deliverable'))
}

function extractFirstAddress(text) {
  const match = String(text || '').match(/0x[a-fA-F0-9]{40}/)
  return match ? getAddress(match[0]) : ''
}

function extractAmountToken(text) {
  const match = String(text || '').match(/(\d+(?:\.\d+)?)\s*(USDC|EURC|USYC|cirBTC)/i)
  if (!match) return { amount: '', token: 'USDC' }
  return { amount: match[1], token: match[2].toUpperCase() === 'CIRBTC' ? 'CIRBTC' : match[2].toUpperCase() }
}

export function normalizeChainName(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
  if (!normalized) return ''
  for (const chain of Object.values(cctpChains)) {
    if (chain.id.toLowerCase().replace(/_/g, ' ') === normalized) return chain.id
    if (chain.aliases.includes(normalized)) return chain.id
  }
  return ''
}

function extractBridgeRoute(text) {
  const value = String(text || '')
  const fromMatch = value.match(/\bfrom\s+(.+?)\s+to\s+(.+?)(?:\s+for\s+|\s+with\s+|$)/i)
  if (!fromMatch) return { fromChain: 'Arc_Testnet', toChain: 'Ethereum_Sepolia' }
  return {
    fromChain: normalizeChainName(fromMatch[1]),
    toChain: normalizeChainName(fromMatch[2]),
  }
}

export function classifyPrompt(prompt) {
  const text = String(prompt || '').trim()
  const lower = text.toLowerCase()
  const { amount, token } = extractAmountToken(text)
  const to = extractFirstAddress(text)
  if (lower.includes('send') || lower.includes('transfer') || lower.includes('kirim')) return { action: 'send', amount, token, to }
  if (lower.includes('swap') || lower.includes('tukar')) {
    const tokenOut = (text.match(/\bto\s+(USDC|EURC|USYC|cirBTC)\b/i)?.[1] || '').toUpperCase()
    return { action: 'swap', amount, tokenIn: token, tokenOut: tokenOut === 'CIRBTC' ? 'CIRBTC' : tokenOut }
  }
  if (lower.includes('retry') && lower.includes('bridge')) return { action: 'retry-bridge', burnTx: text.match(/0x[a-fA-F0-9]{64}/)?.[0] || '', ...extractBridgeRoute(text) }
  if (lower.includes('bridge')) return { action: 'bridge', amount, token, to, ...extractBridgeRoute(text) }
  if (lower.includes('create job') || lower.includes('buat job')) return { action: 'create-job', amount, token, provider: arg('provider') || to, evaluator: arg('evaluator') || to }
  if (lower.includes('accept job') || lower.includes('terima job')) return { action: 'accept-job', jobId: arg('job-id') || (text.match(/\bjob\s*#?(\d+)/i)?.[1] || '') }
  return { action: 'plan', amount, token }
}

function authMessage(address, issuedAt) {
  return [
    'ARCOX DEX login',
    'Only sign this message on the official ARCOX DEX website.',
    `Address: ${getAddress(address)}`,
    `Issued At: ${issuedAt}`,
    'Network: Arc Testnet',
  ].join('\n')
}

async function postJson(path, body, token = '') {
  const response = await fetch(`${ARCOX_BACKEND_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`)
  return data
}

export async function backendSession(account) {
  const issuedAt = new Date().toISOString()
  const signature = await account.signMessage({ message: authMessage(account.address, issuedAt) })
  const session = await postJson('/api/auth/session', { address: account.address, issuedAt, signature })
  return session.token
}

function bytes32Address(address) {
  return `0x${address.slice(2).toLowerCase().padStart(64, '0')}`
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function clientFor(chainInfo) {
  return createPublicClient({ chain: chainInfo.chain, transport: http(chainInfo.rpc) })
}

function walletFor(chainInfo) {
  const account = privateKeyToAccount(privateKey())
  const walletClient = createWalletClient({ account, chain: chainInfo.chain, transport: http(chainInfo.rpc) })
  return { account, walletClient }
}

async function bufferedFees(client, multiplier = 3n) {
  try {
    const block = await client.getBlock()
    const baseFee = block.baseFeePerGas || 0n
    if (baseFee > 0n) {
      let tip = 0n
      try { tip = await client.estimateMaxPriorityFeePerGas() } catch {}
      const minTip = 1_500_000n
      if (tip < minTip) tip = minTip
      return { maxPriorityFeePerGas: tip, maxFeePerGas: baseFee * multiplier + tip * 2n }
    }
  } catch {}
  try {
    const gasPrice = await client.getGasPrice()
    return { gasPrice: gasPrice * multiplier }
  } catch {
    return {}
  }
}

async function writeContractBuffered({ chainInfo, address, abi, functionName, args }) {
  const sourceClient = clientFor(chainInfo)
  const { walletClient } = walletFor(chainInfo)
  const fees = await bufferedFees(sourceClient, 3n)
  try {
    return await walletClient.writeContract({ address, abi, functionName, args, ...fees })
  } catch (error) {
    const msg = error?.message || ''
    if (!/max fee per gas less than block base fee|underpriced|fee/i.test(msg)) throw error
    await sleep(1200)
    const retryFees = await bufferedFees(sourceClient, 6n)
    return walletClient.writeContract({ address, abi, functionName, args, ...retryFees })
  }
}

async function pollAttestation(domain, txHash, chainInfo) {
  const maxPolls = chainInfo.fast ? 90 : Number(process.env.BRIDGE_ATTESTATION_POLLS || '700')
  const url = `${IRIS}/v2/messages/${domain}?transactionHash=${txHash}`
  let lastStatus = ''
  for (let i = 0; i < maxPolls; i++) {
    const delay = chainInfo.fast ? 1000 : i < 20 ? 1000 : 3000
    await sleep(delay)
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json' } })
      if (!response.ok) continue
      const data = await response.json()
      const message = data?.messages?.[0]
      const status = message?.status || 'pending'
      if (status !== lastStatus || i % 10 === 0) {
        console.error(`[bridge] attestation ${i + 1}/${maxPolls}: ${status}`)
        lastStatus = status
      }
      if (status === 'complete' && message.attestation && message.message) {
        return { attestation: message.attestation, message: message.message }
      }
    } catch (error) {
      if (i % 10 === 0) console.error(`[bridge] attestation error: ${error.message}`)
    }
  }
  throw new Error(`Attestation timeout for ${chainInfo.id}. Burn completed, retry mint later with burn tx ${txHash}.`)
}

async function signSolanaReceiveMessage(attestationHex, messageHex, payer) {
  const conn = solanaConnection()
  const payerKey = payer.publicKey
  const mint = new PublicKey(SOLANA_USDC_MINT)
  const recipientAta = await getAssociatedTokenAddress(mint, payerKey)
  const msgBytes = hexToU8(messageHex)
  const attBytes = hexToU8(attestationHex)
  const messageTransmitterProgram = new PublicKey(SOLANA_MESSAGE_TRANSMITTER_PROGRAM)
  const tokenMessengerProgram = new PublicKey(SOLANA_TOKEN_MESSENGER_PROGRAM)
  const sourceDomain = new DataView(msgBytes.buffer, msgBytes.byteOffset + 4, 4).getUint32(0, false)
  const [messageTransmitterAccount] = PublicKey.findProgramAddressSync([enc('message_transmitter')], messageTransmitterProgram)
  const nonceBuf = new Uint8Array(32)
  nonceBuf.set(msgBytes.slice(12, 44), 0)
  const [usedNoncePda] = PublicKey.findProgramAddressSync([enc('used_nonce'), nonceBuf], messageTransmitterProgram)
  const [authorityPda] = PublicKey.findProgramAddressSync([enc('message_transmitter_authority'), tokenMessengerProgram.toBytes()], messageTransmitterProgram)
  const [eventAuthority] = PublicKey.findProgramAddressSync([enc('__event_authority')], messageTransmitterProgram)
  const [tokenMessenger] = PublicKey.findProgramAddressSync([enc('token_messenger')], tokenMessengerProgram)
  const remoteDomainSeed = enc(sourceDomain.toString())
  const [remoteTokenMessenger] = PublicKey.findProgramAddressSync([enc('remote_token_messenger'), remoteDomainSeed], tokenMessengerProgram)
  const [localToken] = PublicKey.findProgramAddressSync([enc('local_token'), mint.toBytes()], tokenMessengerProgram)
  const [tokenMinter] = PublicKey.findProgramAddressSync([enc('token_minter')], tokenMessengerProgram)
  const sourceTokenBytes = msgBytes.slice(152, 184)
  const [tokenPair] = PublicKey.findProgramAddressSync([enc('token_pair'), remoteDomainSeed, sourceTokenBytes], tokenMessengerProgram)
  const [custodyTokenAccount] = PublicKey.findProgramAddressSync([enc('custody'), mint.toBytes()], tokenMessengerProgram)
  const [tokenProgramEventAuthority] = PublicKey.findProgramAddressSync([enc('__event_authority')], tokenMessengerProgram)
  const tokenMessengerInfo = await conn.getAccountInfo(tokenMessenger)
  if (!tokenMessengerInfo?.data || tokenMessengerInfo.data.length < 141) throw new Error('Invalid Solana TokenMessenger account.')
  const feeRecipient = new PublicKey(tokenMessengerInfo.data.slice(109, 141))
  const feeRecipientAta = await getAssociatedTokenAddress(mint, feeRecipient, true)
  const discriminator = new Uint8Array([38, 144, 127, 225, 31, 225, 238, 25])
  const data = concatU8(discriminator, u32LE(msgBytes.length), msgBytes, u32LE(attBytes.length), attBytes)

  let latest = await conn.getLatestBlockhash('confirmed')
  if (!await conn.getAccountInfo(recipientAta)) {
    const ataIx = createAssociatedTokenAccountInstruction(payerKey, recipientAta, payerKey, mint, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID)
    const ataMsg = new TransactionMessage({ payerKey, recentBlockhash: latest.blockhash, instructions: [ataIx] }).compileToV0Message()
    const ataTx = new VersionedTransaction(ataMsg)
    ataTx.sign([payer])
    const ataSig = await conn.sendRawTransaction(ataTx.serialize(), { skipPreflight: true, preflightCommitment: 'confirmed' })
    await conn.confirmTransaction({ signature: ataSig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, 'confirmed')
    latest = await conn.getLatestBlockhash('confirmed')
  }

  const recvIx = new TransactionInstruction({
    programId: messageTransmitterProgram,
    keys: [
      { pubkey: payerKey, isSigner: true, isWritable: true },
      { pubkey: payerKey, isSigner: true, isWritable: false },
      { pubkey: authorityPda, isSigner: false, isWritable: false },
      { pubkey: messageTransmitterAccount, isSigner: false, isWritable: false },
      { pubkey: usedNoncePda, isSigner: false, isWritable: true },
      { pubkey: tokenMessengerProgram, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: eventAuthority, isSigner: false, isWritable: false },
      { pubkey: messageTransmitterProgram, isSigner: false, isWritable: false },
      { pubkey: tokenMessenger, isSigner: false, isWritable: false },
      { pubkey: remoteTokenMessenger, isSigner: false, isWritable: false },
      { pubkey: tokenMinter, isSigner: false, isWritable: true },
      { pubkey: localToken, isSigner: false, isWritable: true },
      { pubkey: tokenPair, isSigner: false, isWritable: false },
      { pubkey: feeRecipientAta, isSigner: false, isWritable: true },
      { pubkey: recipientAta, isSigner: false, isWritable: true },
      { pubkey: custodyTokenAccount, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: tokenProgramEventAuthority, isSigner: false, isWritable: false },
      { pubkey: tokenMessengerProgram, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  })
  const recvMsg = new TransactionMessage({ payerKey, recentBlockhash: latest.blockhash, instructions: [recvIx] }).compileToV0Message()
  const recvTx = new VersionedTransaction(recvMsg)
  recvTx.sign([payer])
  const sig = await conn.sendRawTransaction(recvTx.serialize(), { skipPreflight: false, preflightCommitment: 'confirmed' })
  const conf = await conn.confirmTransaction({ signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, 'confirmed')
  if (conf.value.err) throw new Error('Solana receiveMessage failed: ' + JSON.stringify(conf.value.err))
  return sig
}

async function burnSolanaUsdc(amount, mintRecipientEvm, payer) {
  const conn = solanaConnection()
  const owner = payer.publicKey
  const mint = new PublicKey(SOLANA_USDC_MINT)
  const senderAta = await getAssociatedTokenAddress(mint, owner)
  const mintRecipientBytes = hexToU8(mintRecipientEvm.slice(2).toLowerCase().padStart(64, '0'))
  const amountLamports = parseUnits(String(amount), 6)
  const discriminator = new Uint8Array([215, 60, 61, 46, 114, 55, 128, 176])
  const data = concatU8(discriminator, u64LE(amountLamports), u32LE(26), mintRecipientBytes, new Uint8Array(32), u64LE(10n), u32LE(2000))
  const tmProgram = new PublicKey(SOLANA_TOKEN_MESSENGER_PROGRAM)
  const mtProgram = new PublicKey(SOLANA_MESSAGE_TRANSMITTER_PROGRAM)
  const [tokenMessengerPda] = PublicKey.findProgramAddressSync([enc('token_messenger')], tmProgram)
  const [senderAuthorityPda] = PublicKey.findProgramAddressSync([enc('sender_authority')], tmProgram)
  const [remoteTokenMsgPda] = PublicKey.findProgramAddressSync([enc('remote_token_messenger'), enc('26')], tmProgram)
  const [tokenMinterPda] = PublicKey.findProgramAddressSync([enc('token_minter')], tmProgram)
  const [localTokenPda] = PublicKey.findProgramAddressSync([enc('local_token'), mint.toBytes()], tmProgram)
  const [denylistAccountPda] = PublicKey.findProgramAddressSync([enc('denylist_account'), owner.toBytes()], tmProgram)
  const [mtPda] = PublicKey.findProgramAddressSync([enc('message_transmitter')], mtProgram)
  const [tokenMessengerEventAuthority] = PublicKey.findProgramAddressSync([enc('__event_authority')], tmProgram)
  const messageSentEventData = Keypair.generate()
  const ix = new TransactionInstruction({
    programId: tmProgram,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: senderAuthorityPda, isSigner: false, isWritable: false },
      { pubkey: senderAta, isSigner: false, isWritable: true },
      { pubkey: denylistAccountPda, isSigner: false, isWritable: false },
      { pubkey: mtPda, isSigner: false, isWritable: true },
      { pubkey: tokenMessengerPda, isSigner: false, isWritable: false },
      { pubkey: remoteTokenMsgPda, isSigner: false, isWritable: false },
      { pubkey: tokenMinterPda, isSigner: false, isWritable: false },
      { pubkey: localTokenPda, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: messageSentEventData.publicKey, isSigner: true, isWritable: true },
      { pubkey: mtProgram, isSigner: false, isWritable: false },
      { pubkey: tmProgram, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: tokenMessengerEventAuthority, isSigner: false, isWritable: false },
      { pubkey: tmProgram, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  })
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash()
  const tx = new Transaction({ blockhash, lastValidBlockHeight, feePayer: owner })
  tx.add(ix)
  tx.partialSign(messageSentEventData, payer)
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, preflightCommitment: 'confirmed' })
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')
  return sig
}

async function solanaUsdcBalance(owner = solanaKeypair().publicKey) {
  const conn = solanaConnection()
  const mint = new PublicKey(SOLANA_USDC_MINT)
  const ata = await getAssociatedTokenAddress(mint, owner)
  const bal = await conn.getTokenAccountBalance(ata).catch(() => null)
  return { ata: ata.toBase58(), amount: bal?.value?.uiAmountString || '0' }
}

export async function executeBridge(intent, owner) {
  if ((intent.token || 'USDC') !== 'USDC') throw new Error('CLI bridge adapter currently supports USDC only.')
  if (!intent.amount || Number(intent.amount) <= 0) throw new Error('Bridge command needs amount, example: bridge 5 USDC from Arbitrum Sepolia to Arc')
  const fromInfo = cctpChains[intent.fromChain]
  const toInfo = cctpChains[intent.toChain]
  if (!fromInfo || !toInfo) throw new Error('Unsupported bridge route. Use Arc, Ethereum Sepolia, Base Sepolia, Arbitrum Sepolia, or HyperEVM Testnet.')
  if (fromInfo.id === toInfo.id) throw new Error('Bridge source and destination must be different.')
  if (fromInfo.solana) return executeSolanaToEvm(intent, owner, fromInfo, toInfo)
  if (toInfo.solana) return executeEvmToSolana(intent, owner, fromInfo, toInfo)

  const amount = parseUnits(intent.amount, 6)
  const sourceClient = clientFor(fromInfo)
  const destinationClient = clientFor(toInfo)
  const tokenBalance = await sourceClient.readContract({ address: fromInfo.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [owner] })
  if (tokenBalance < amount) {
    throw new Error(`Insufficient USDC on ${fromInfo.id}. Balance ${formatUnits(tokenBalance, 6)} USDC, need ${intent.amount}.`)
  }

  const router = routerFor(fromInfo.id)
  const spender = router || fromInfo.tokenMessenger

  console.error(`[bridge] route ${fromInfo.id} -> ${toInfo.id}`)
  console.error(`[bridge] approve ${intent.amount} USDC to ${router ? 'ArcoxRouter' : 'CCTP TokenMessenger'}`)
  const approveHash = await writeContractBuffered({
    chainInfo: fromInfo,
    address: fromInfo.usdc,
    abi: erc20Abi,
    functionName: 'approve',
    args: [spender, amount],
  })
  await sourceClient.waitForTransactionReceipt({ hash: approveHash })

  console.error(`[bridge] burn ${intent.amount} USDC ${router ? 'via ArcoxRouter fee route' : 'direct CCTP fallback'}`)
  const maxFee = 10n
  const minFinalityThreshold = 1000
  const burnHash = router
    ? await writeContractBuffered({
      chainInfo: fromInfo,
      address: router,
      abi: arcoxRouterAbi,
      functionName: 'bridgeUsdcWithFee',
      args: [amount, toInfo.domain, bytes32Address(owner), `0x${'0'.repeat(64)}`, maxFee, minFinalityThreshold],
    })
    : await writeContractBuffered({
      chainInfo: fromInfo,
      address: fromInfo.tokenMessenger,
      abi: tokenMessengerAbi,
      functionName: 'depositForBurn',
      args: [amount, toInfo.domain, bytes32Address(owner), fromInfo.usdc, `0x${'0'.repeat(64)}`, maxFee, minFinalityThreshold],
    })
  await sourceClient.waitForTransactionReceipt({ hash: burnHash })

  console.error(`[bridge] wait attestation from Circle Iris`)
  const attestation = await pollAttestation(fromInfo.domain, burnHash, fromInfo)

  console.error(`[bridge] mint on ${toInfo.id}`)
  const mintHash = await writeContractBuffered({
    chainInfo: toInfo,
    address: toInfo.messageTransmitter,
    abi: messageTransmitterAbi,
    functionName: 'receiveMessage',
    args: [attestation.message, attestation.attestation],
  })
  await destinationClient.waitForTransactionReceipt({ hash: mintHash })

  return {
    status: 'submitted',
    action: 'bridge',
    route: router ? 'arcox-router' : 'direct-cctp-fallback',
    router: router || null,
    from: fromInfo.id,
    to: toInfo.id,
    owner,
    amount: intent.amount,
    token: 'USDC',
    approveTx: approveHash,
    burnTx: burnHash,
    mintTx: mintHash,
    approveExplorer: fromInfo.explorer + approveHash,
    burnExplorer: fromInfo.explorer + burnHash,
    mintExplorer: toInfo.explorer + mintHash,
  }
}

async function executeEvmToSolana(intent, owner, fromInfo, toInfo) {
  const solana = solanaKeypair()
  const conn = solanaConnection()
  const mint = new PublicKey(SOLANA_USDC_MINT)
  const recipientAta = await getAssociatedTokenAddress(mint, solana.publicKey)
  const amount = parseUnits(intent.amount, 6)
  const sourceClient = clientFor(fromInfo)
  const tokenBalance = await sourceClient.readContract({ address: fromInfo.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [owner] })
  if (tokenBalance < amount) throw new Error(`Insufficient USDC on ${fromInfo.id}. Balance ${formatUnits(tokenBalance, 6)} USDC, need ${intent.amount}.`)
  const router = routerFor(fromInfo.id)
  const spender = router || fromInfo.tokenMessenger
  const mintRecipient = `0x${Buffer.from(recipientAta.toBuffer()).toString('hex')}`

  const approveHash = await writeContractBuffered({
    chainInfo: fromInfo,
    address: fromInfo.usdc,
    abi: erc20Abi,
    functionName: 'approve',
    args: [spender, amount],
  })
  await sourceClient.waitForTransactionReceipt({ hash: approveHash })
  const burnHash = router
    ? await writeContractBuffered({
      chainInfo: fromInfo,
      address: router,
      abi: arcoxRouterAbi,
      functionName: 'bridgeUsdcWithFee',
      args: [amount, toInfo.domain, mintRecipient, `0x${'0'.repeat(64)}`, 10n, 1000],
    })
    : await writeContractBuffered({
      chainInfo: fromInfo,
      address: fromInfo.tokenMessenger,
      abi: tokenMessengerAbi,
      functionName: 'depositForBurn',
      args: [amount, toInfo.domain, mintRecipient, fromInfo.usdc, `0x${'0'.repeat(64)}`, 10n, 1000],
    })
  await sourceClient.waitForTransactionReceipt({ hash: burnHash })
  const attestation = await pollAttestation(fromInfo.domain, burnHash, fromInfo)
  const mintTx = await signSolanaReceiveMessage(attestation.attestation, attestation.message, solana)
  const solanaBalance = await conn.getBalance(solana.publicKey).catch(() => 0)
  return {
    status: 'submitted',
    action: 'bridge',
    route: router ? 'arcox-router-solana' : 'direct-cctp-solana',
    router: router || null,
    from: fromInfo.id,
    to: toInfo.id,
    owner,
    solanaRecipient: solana.publicKey.toBase58(),
    solanaRecipientAta: recipientAta.toBase58(),
    solanaLamports: solanaBalance,
    amount: intent.amount,
    token: 'USDC',
    approveTx: approveHash,
    burnTx: burnHash,
    mintTx,
    approveExplorer: fromInfo.explorer + approveHash,
    burnExplorer: fromInfo.explorer + burnHash,
    mintExplorer: `https://explorer.solana.com/tx/${mintTx}?cluster=devnet`,
  }
}

async function executeSolanaToEvm(intent, owner, fromInfo, toInfo) {
  if (toInfo.solana) throw new Error('Solana to Solana bridge is not supported.')
  const solana = solanaKeypair()
  const destinationClient = clientFor(toInfo)
  const burnHash = await burnSolanaUsdc(intent.amount, owner, solana)
  const attestation = await pollAttestation(fromInfo.domain, burnHash, fromInfo)
  const mintHash = await writeContractBuffered({
    chainInfo: toInfo,
    address: toInfo.messageTransmitter,
    abi: messageTransmitterAbi,
    functionName: 'receiveMessage',
    args: [attestation.message, attestation.attestation],
  })
  await destinationClient.waitForTransactionReceipt({ hash: mintHash })
  return {
    status: 'submitted',
    action: 'bridge',
    route: 'solana-cctp',
    from: fromInfo.id,
    to: toInfo.id,
    owner,
    solanaSender: solana.publicKey.toBase58(),
    amount: intent.amount,
    token: 'USDC',
    burnTx: burnHash,
    mintTx: mintHash,
    burnExplorer: `https://explorer.solana.com/tx/${burnHash}?cluster=devnet`,
    mintExplorer: toInfo.explorer + mintHash,
  }
}

export async function retryBridgeMint({ burnTx, fromChain, toChain }, owner) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(burnTx || '')) throw new Error('Missing valid --burn-tx 0x...')
  const fromInfo = cctpChains[fromChain]
  const toInfo = cctpChains[toChain]
  if (!fromInfo || !toInfo) throw new Error('Unsupported retry route. Use Arc, Ethereum Sepolia, Base Sepolia, Arbitrum Sepolia, or HyperEVM Testnet.')
  if (fromInfo.id === toInfo.id) throw new Error('Retry source and destination must be different.')

  const destinationClient = clientFor(toInfo)
  console.error(`[retry-bridge] poll attestation for ${burnTx}`)
  const attestation = await pollAttestation(fromInfo.domain, burnTx, fromInfo)

  console.error(`[retry-bridge] mint on ${toInfo.id}`)
  const mintHash = await writeContractBuffered({
    chainInfo: toInfo,
    address: toInfo.messageTransmitter,
    abi: messageTransmitterAbi,
    functionName: 'receiveMessage',
    args: [attestation.message, attestation.attestation],
  })
  await destinationClient.waitForTransactionReceipt({ hash: mintHash })

  return {
    status: 'submitted',
    action: 'retry-bridge',
    owner,
    from: fromInfo.id,
    to: toInfo.id,
    burnTx,
    mintTx: mintHash,
    mintExplorer: toInfo.explorer + mintHash,
  }
}

export async function executeSend(intent, owner) {
  if (!intent.amount || !intent.to) throw new Error('Send command needs amount and recipient address, example: send 1 USDC to 0x...')
  const token = ARC_TOKENS[intent.token]
  if (!token) throw new Error(`Unsupported Arc token: ${intent.token}`)
  const value = parseUnits(intent.amount, token.decimals)
  const router = routerFor('Arc_Testnet')
  const { walletClient } = wallet()
  let approveTx = ''
  let hash
  if (router) {
    approveTx = await walletClient.writeContract({ address: token.address, abi: erc20Abi, functionName: 'approve', args: [router, value] })
    await publicClient.waitForTransactionReceipt({ hash: approveTx })
    hash = await walletClient.writeContract({
      address: router,
      abi: arcoxRouterAbi,
      functionName: 'sendTokenWithFee',
      args: [token.address, intent.to, value],
    })
  } else {
    hash = await walletClient.writeContract({
      address: token.address,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [intent.to, value],
    })
  }
  await publicClient.waitForTransactionReceipt({ hash })
  return {
    status: 'submitted',
    action: 'send',
    route: router ? 'arcox-router' : 'direct-token-transfer',
    router: router || null,
    from: owner,
    to: intent.to,
    amount: intent.amount,
    token: intent.token,
    approveTx: approveTx || undefined,
    tx: hash,
    explorer: EXPLORER_TX + hash,
  }
}

export async function executeSwap(intent, owner) {
  const tokenIn = intent.tokenIn || 'USDC'
  const tokenOut = intent.tokenOut || ''
  if (!intent.amount || Number(intent.amount) <= 0) throw new Error('Swap command needs amount, example: swap 10 USDC to EURC')
  if (!ARC_TOKENS[tokenIn]) throw new Error(`Unsupported swap input token: ${tokenIn}`)
  if (!ARC_TOKENS[tokenOut]) throw new Error('Swap command needs output token, example: swap 10 USDC to EURC')
  if (tokenIn === tokenOut) throw new Error('Swap input and output token must be different.')

  const account = privateKeyToAccount(privateKey())
  const token = await backendSession(account)
  const walletData = await postJson('/api/wallet', { metamaskAddress: owner }, token)
  const quote = await postJson('/api/quote', { metamaskAddress: owner, tokenIn, tokenOut, amountIn: intent.amount }, token)
  if (quote.available === false) {
    return {
      status: 'route_unavailable',
      action: 'swap',
      source: 'circle-wallet-proxy',
      owner,
      wallet: walletData.wallet,
      quote,
    }
  }
  const swap = await postJson('/api/swap', { metamaskAddress: owner, tokenIn, tokenOut, amountIn: intent.amount }, token)
  return {
    status: 'submitted',
    action: 'swap',
    source: 'circle-wallet-proxy',
    owner,
    wallet: walletData.wallet,
    quote,
    result: swap.result,
    note: 'Circle wallet swap is executed by backend proxy wallet after local agent signs ARCOX login message.',
  }
}

async function runPrompt() {
  const prompt = arg('prompt')
  if (!prompt) throw new Error('Missing --prompt')
  const { account } = wallet()
  const intent = classifyPrompt(prompt)
  const preview = {
    agent: metadataFor(account.address),
    prompt,
    intent,
    approval_required: true,
    approval_mode: 'CLI --yes confirmation with local AGENT_PRIVATE_KEY signer',
    note: 'Private key stays in the local .env file. ARCOX DEX only receives status/metadata if you choose to report it.',
  }
  if (!hasFlag('yes')) {
    console.log(JSON.stringify({ ...preview, status: 'preview_only', next: 'Review this plan. Re-run with --yes to execute supported onchain actions.' }, null, 2))
    return
  }
  if (intent.action === 'send') {
    console.log(JSON.stringify(await executeSend(intent, account.address), null, 2))
    return
  }
  if (intent.action === 'bridge') {
    console.log(JSON.stringify(await executeBridge(intent, account.address), null, 2))
    return
  }
  if (intent.action === 'retry-bridge') {
    console.log(JSON.stringify(await retryBridgeMint(intent, account.address), null, 2))
    return
  }
  if (intent.action === 'swap') {
    console.log(JSON.stringify(await executeSwap(intent, account.address), null, 2))
    return
  }
  if (intent.action === 'create-job') {
    const provider = getAddress(intent.provider || arg('provider') || account.address)
    const evaluator = getAddress(intent.evaluator || arg('evaluator') || account.address)
    const description = prompt
    const expiredAt = BigInt(Math.floor(Date.now() / 1000) + (Number(arg('hours', '24')) || 24) * 3600)
    const { walletClient } = wallet()
    const hash = await walletClient.writeContract({ address: AGENTIC_COMMERCE_CONTRACT, abi: agenticCommerceAbi, functionName: 'createJob', args: [provider, evaluator, expiredAt, description, ZERO_ADDRESS] })
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    console.log(JSON.stringify({ status: 'submitted', action: 'create-job', tx: hash, explorer: EXPLORER_TX + hash, jobId: parseJobId(receipt.logs), provider, evaluator }, null, 2))
    return
  }
  console.log(JSON.stringify({
    ...preview,
    status: 'route_adapter_required',
    reason: 'This command is recognized, but autonomous execution is disabled until a concrete quote/bridge adapter is wired for this CLI route.',
    safe_next_step: 'Use ARCOX DEX web UI for swap/bridge signing, or add a CLI adapter that returns quote, allowance, gas, route, and destination before execution.',
  }, null, 2))
}

function parseJobId(logs) {
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({ abi: agenticCommerceAbi, data: log.data, topics: log.topics })
      if (decoded.eventName === 'JobCreated') return decoded.args.jobId.toString()
    } catch {}
  }
  throw new Error('JobCreated event not found.')
}

function parseAgentId(logs, owner) {
  const normalized = getAddress(owner)
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({ abi: identityAbi, data: log.data, topics: log.topics })
      if (decoded.eventName === 'Transfer' && getAddress(decoded.args.to) === normalized) return decoded.args.tokenId.toString()
    } catch {}
  }
  throw new Error('Agent Transfer event not found.')
}

export function makeAgentResponse({ prompt = '', jobId = '', agentId = '', owner = '' }) {
  const normalizedPrompt = String(prompt || '').trim()
  const budgetMatch = normalizedPrompt.match(/(\d+(?:\.\d+)?)\s*(?:USDC|usd)/i)
  const suggestedBudget = budgetMatch?.[1] || '1'
  const digest = createHash('sha256').update(`${agentId}:${owner}:${jobId}:${normalizedPrompt}:${Date.now()}`).digest('hex')
  const deliverableText = [
    `ARCOX agent response`,
    `Prompt: ${normalizedPrompt || 'No prompt provided'}`,
    jobId ? `Job: ${jobId}` : 'Job: new',
    `Decision: accepted`,
    `Budget: ${suggestedBudget} USDC`,
    `Digest: ${digest}`,
  ].join('\n')
  return {
    requestId: `agent-${Date.now()}`,
    agentId: agentId || process.env.AGENT_ID || 'terminal-agent',
    status: 'accepted',
    summary: normalizedPrompt
      ? `Terminal AI agent accepted: ${normalizedPrompt}`
      : 'Terminal AI agent is ready for ARCOX DEX job planning.',
    suggestedProvider: owner || '',
    suggestedEvaluator: owner || '',
    suggestedBudget,
    deliverable: deliverableText,
    deliverableHash: hashTextBytes32(deliverableText),
    nextSteps: [
      'Create or open the ERC-8183 job in ARCOX DEX.',
      'Set budget and fund escrow with USDC.',
      'Run terminal agent submit for provider deliverable.',
      'Run terminal agent complete from evaluator wallet after validation.',
    ],
  }
}

export async function readAgent(agentId) {
  const id = BigInt(agentId)
  const [owner, metadataUri] = await Promise.all([
    publicClient.readContract({ address: IDENTITY_REGISTRY, abi: identityAbi, functionName: 'ownerOf', args: [id] }),
    publicClient.readContract({ address: IDENTITY_REGISTRY, abi: identityAbi, functionName: 'tokenURI', args: [id] }),
  ])
  return { agentId, owner, metadataUri }
}

export async function readJob(jobId) {
  const job = await publicClient.readContract({
    address: AGENTIC_COMMERCE_CONTRACT,
    abi: agenticCommerceAbi,
    functionName: 'getJob',
    args: [BigInt(jobId)],
  })
  const statusIndex = Number(job.status ?? job[7] ?? 0)
  return {
    id: String(job.id ?? job[0] ?? jobId),
    client: String(job.client ?? job[1]),
    provider: String(job.provider ?? job[2]),
    evaluator: String(job.evaluator ?? job[3]),
    description: String(job.description ?? job[4] ?? ''),
    budget: formatUnits(BigInt(job.budget ?? job[5] ?? 0), 6),
    expiredAt: Number(job.expiredAt ?? job[6] ?? 0),
    status: JOB_STATUS[statusIndex] || `Status ${statusIndex}`,
    hook: String(job.hook ?? job[8] ?? ZERO_ADDRESS),
  }
}

export function agentAccount() {
  return wallet().account
}

export async function agentStatus() {
  const { account } = wallet()
  const [nativeBalance, usdcBalance] = await Promise.all([
    publicClient.getBalance({ address: account.address }),
    publicClient.readContract({ address: ARC_USDC, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] }).catch(() => 0n),
  ])
  return { address: account.address, arcGasUsdc: formatUnits(nativeBalance, 18), usdc: formatUnits(usdcBalance, 6), rpc: ARC_RPC }
}

export async function quoteBridge(intent) {
  const { account } = wallet()
  const fromChain = normalizeChainName(intent.fromChain) || intent.fromChain
  const toChain = normalizeChainName(intent.toChain) || intent.toChain
  const token = String(intent.token || 'USDC').toUpperCase() === 'CIRBTC' ? 'CIRBTC' : String(intent.token || 'USDC').toUpperCase()
  if (token !== 'USDC') throw new Error('MCP bridge currently supports USDC only.')
  if (!intent.amount || Number(intent.amount) <= 0) throw new Error('Bridge quote needs a positive amount.')
  const fromInfo = cctpChains[fromChain]
  const toInfo = cctpChains[toChain]
  if (!fromInfo || !toInfo) throw new Error('Unsupported bridge route.')
  if (fromInfo.id === toInfo.id) throw new Error('Bridge source and destination must be different.')
  if (fromInfo.solana) {
    const solana = solanaKeypair()
    const balance = await solanaUsdcBalance(solana.publicKey)
    return {
      status: 'quote',
      action: 'bridge',
      owner: account.address,
      solanaOwner: solana.publicKey.toBase58(),
      solanaSourceAta: balance.ata,
      from: fromInfo.id,
      to: toInfo.id,
      token: 'USDC',
      amount: String(intent.amount),
      balance: balance.amount,
      platformFee: '0',
      estimatedReceive: String(intent.amount),
      supported: Number(balance.amount) >= Number(intent.amount),
      terminalExecution: 'supported_with_local_solana_signer',
      approvalRequired: true,
      safeNextStep: 'Ask the user to confirm before calling arcox_execute_bridge with confirmed=true.',
    }
  }
  const amount = parseUnits(String(intent.amount), 6)
  const sourceClient = clientFor(fromInfo)
  const router = routerFor(fromInfo.id)
  const [balance, routerQuote] = await Promise.all([
    sourceClient.readContract({ address: fromInfo.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] }).catch(() => 0n),
    router
      ? sourceClient.readContract({ address: router, abi: arcoxRouterAbi, functionName: 'quoteFee', args: [amount] }).catch(() => null)
      : Promise.resolve(null),
  ])
  const fee = routerQuote ? BigInt(routerQuote[0] ?? 0) : 0n
  const netAmount = routerQuote ? BigInt(routerQuote[1] ?? amount) : amount
  return {
    status: 'quote',
    action: 'bridge',
    owner: account.address,
    from: fromInfo.id,
    to: toInfo.id,
    token: 'USDC',
    amount: String(intent.amount),
    balance: formatUnits(balance, 6),
    router: router || null,
    platformFee: formatUnits(fee, 6),
    estimatedReceive: formatUnits(netAmount, 6),
    supported: balance >= amount,
    terminalExecution: toInfo.solana ? 'supported_with_local_solana_signer' : 'supported',
    solanaRecipientRequired: Boolean(toInfo.solana),
    approvalRequired: true,
    safeNextStep: toInfo.solana
      ? 'Ask the user to confirm before calling arcox_execute_bridge with confirmed=true. Mint will use SOLANA_PRIVATE_KEY local signer.'
      : 'Ask the user to confirm before calling arcox_execute_bridge with confirmed=true.',
  }
}

export async function quoteSend(intent) {
  const { account } = wallet()
  const tokenKey = String(intent.token || 'USDC').toUpperCase() === 'CIRBTC' ? 'CIRBTC' : String(intent.token || 'USDC').toUpperCase()
  const token = ARC_TOKENS[tokenKey]
  if (!token) throw new Error(`Unsupported Arc token: ${tokenKey}`)
  if (!intent.amount || Number(intent.amount) <= 0) throw new Error('Send quote needs a positive amount.')
  if (!intent.to || !/^0x[0-9a-fA-F]{40}$/.test(intent.to)) throw new Error('Send quote needs a valid EVM recipient.')
  const amount = parseUnits(String(intent.amount), token.decimals)
  const router = routerFor('Arc_Testnet')
  const [balance, routerQuote] = await Promise.all([
    publicClient.readContract({ address: token.address, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] }).catch(() => 0n),
    router
      ? publicClient.readContract({ address: router, abi: arcoxRouterAbi, functionName: 'quoteFee', args: [amount] }).catch(() => null)
      : Promise.resolve(null),
  ])
  const fee = routerQuote ? BigInt(routerQuote[0] ?? 0) : 0n
  const netAmount = routerQuote ? BigInt(routerQuote[1] ?? amount) : amount
  return {
    status: 'quote',
    action: 'send',
    owner: account.address,
    to: getAddress(intent.to),
    token: tokenKey,
    amount: String(intent.amount),
    balance: formatUnits(balance, token.decimals),
    router: router || null,
    platformFee: formatUnits(fee, token.decimals),
    recipientReceives: formatUnits(netAmount, token.decimals),
    supported: balance >= amount,
    approvalRequired: true,
    safeNextStep: 'Ask the user to confirm before calling arcox_execute_send with confirmed=true.',
  }
}

export async function quoteSwap(intent) {
  const tokenIn = String(intent.tokenIn || 'USDC').toUpperCase() === 'CIRBTC' ? 'CIRBTC' : String(intent.tokenIn || 'USDC').toUpperCase()
  const tokenOut = String(intent.tokenOut || '').toUpperCase() === 'CIRBTC' ? 'CIRBTC' : String(intent.tokenOut || '').toUpperCase()
  const amountIn = String(intent.amountIn || intent.amount || '')
  if (!amountIn) throw new Error('Swap quote needs amountIn.')
  if (!ARC_TOKENS[tokenIn]) throw new Error(`Unsupported swap input token: ${tokenIn}`)
  if (!ARC_TOKENS[tokenOut]) throw new Error(`Unsupported swap output token: ${tokenOut}`)
  const { account } = wallet()
  const token = await backendSession(account)
  const quote = await postJson('/api/quote', { metamaskAddress: account.address, tokenIn, tokenOut, amountIn }, token)
  return {
    status: 'quote',
    action: 'swap',
    source: 'circle-wallet-proxy',
    owner: account.address,
    tokenIn,
    tokenOut,
    amountIn,
    quote,
    approvalRequired: true,
    safeNextStep: 'Ask the user to confirm before calling arcox_execute_swap with confirmed=true.',
  }
}

export async function executeConfirmedBridge(intent) {
  if (intent.confirmed !== true) return quoteBridge(intent)
  const fromChain = normalizeChainName(intent.fromChain) || intent.fromChain
  const toChain = normalizeChainName(intent.toChain) || intent.toChain
  const { account } = wallet()
  return executeBridge({
    ...intent,
    token: String(intent.token || 'USDC').toUpperCase(),
    fromChain,
    toChain,
  }, account.address)
}

export async function executeConfirmedSend(intent) {
  if (intent.confirmed !== true) return quoteSend(intent)
  const { account } = wallet()
  return executeSend({
    ...intent,
    token: String(intent.token || 'USDC').toUpperCase() === 'CIRBTC' ? 'CIRBTC' : String(intent.token || 'USDC').toUpperCase(),
    to: getAddress(intent.to),
  }, account.address)
}

export async function executeConfirmedSwap(intent) {
  if (intent.confirmed !== true) return quoteSwap(intent)
  const { account } = wallet()
  return executeSwap({
    ...intent,
    amount: String(intent.amountIn || intent.amount),
    tokenIn: String(intent.tokenIn || 'USDC').toUpperCase() === 'CIRBTC' ? 'CIRBTC' : String(intent.tokenIn || 'USDC').toUpperCase(),
    tokenOut: String(intent.tokenOut || '').toUpperCase() === 'CIRBTC' ? 'CIRBTC' : String(intent.tokenOut || '').toUpperCase(),
  }, account.address)
}

export async function retryConfirmedBridge(intent) {
  if (intent.confirmed !== true) {
    return {
      status: 'preview_only',
      action: 'retry-bridge',
      burnTx: intent.burnTx || '',
      from: normalizeChainName(intent.fromChain) || intent.fromChain || '',
      to: normalizeChainName(intent.toChain) || intent.toChain || '',
      approvalRequired: true,
      safeNextStep: 'Ask the user to confirm before calling arcox_retry_bridge with confirmed=true.',
    }
  }
  const { account } = wallet()
  return retryBridgeMint({
    burnTx: intent.burnTx,
    fromChain: normalizeChainName(intent.fromChain) || intent.fromChain,
    toChain: normalizeChainName(intent.toChain) || intent.toChain,
  }, account.address)
}

export async function registerAgentIdentity({ metadataUri }) {
  const { account, walletClient } = wallet()
  if (!metadataUri) throw new Error('Missing metadataUri.')
  const hash = await walletClient.writeContract({ address: IDENTITY_REGISTRY, abi: identityAbi, functionName: 'register', args: [metadataUri] })
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  return { status: 'submitted', action: 'register-agent', tx: hash, explorer: EXPLORER_TX + hash, agentId: parseAgentId(receipt.logs, account.address), owner: account.address }
}

export async function createAgentJob({ provider, evaluator, description = 'ARCOX terminal agent job', hours = 24 }) {
  const { walletClient } = wallet()
  const normalizedProvider = getAddress(provider)
  const normalizedEvaluator = getAddress(evaluator)
  const expiredAt = BigInt(Math.floor(Date.now() / 1000) + (Number(hours) || 24) * 3600)
  const hash = await walletClient.writeContract({ address: AGENTIC_COMMERCE_CONTRACT, abi: agenticCommerceAbi, functionName: 'createJob', args: [normalizedProvider, normalizedEvaluator, expiredAt, description, ZERO_ADDRESS] })
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  return { status: 'submitted', action: 'create-job', tx: hash, explorer: EXPLORER_TX + hash, jobId: parseJobId(receipt.logs), provider: normalizedProvider, evaluator: normalizedEvaluator }
}

export async function setAgentJobBudget({ jobId, amount }) {
  const { walletClient } = wallet()
  const hash = await walletClient.writeContract({ address: AGENTIC_COMMERCE_CONTRACT, abi: agenticCommerceAbi, functionName: 'setBudget', args: [BigInt(jobId), parseUnits(String(amount), 6), '0x'] })
  await publicClient.waitForTransactionReceipt({ hash })
  return { status: 'submitted', action: 'set-budget', jobId: String(jobId), amount: String(amount), tx: hash, explorer: EXPLORER_TX + hash }
}

export async function fundAgentJob({ jobId, amount }) {
  const { walletClient } = wallet()
  const parsedAmount = parseUnits(String(amount), 6)
  const parsedJobId = BigInt(jobId)
  const approveHash = await walletClient.writeContract({ address: ARC_USDC, abi: erc20Abi, functionName: 'approve', args: [AGENTIC_COMMERCE_CONTRACT, parsedAmount] })
  await publicClient.waitForTransactionReceipt({ hash: approveHash })
  const fundHash = await walletClient.writeContract({ address: AGENTIC_COMMERCE_CONTRACT, abi: agenticCommerceAbi, functionName: 'fund', args: [parsedJobId, '0x'] })
  await publicClient.waitForTransactionReceipt({ hash: fundHash })
  return { status: 'submitted', action: 'fund-job', jobId: String(jobId), amount: String(amount), approveTx: approveHash, fundTx: fundHash, explorer: EXPLORER_TX + fundHash }
}

export async function submitAgentJob({ jobId, deliverable = 'terminal-agent-deliverable' }) {
  const { walletClient } = wallet()
  const deliverableHash = hashTextBytes32(deliverable)
  const hash = await walletClient.writeContract({ address: AGENTIC_COMMERCE_CONTRACT, abi: agenticCommerceAbi, functionName: 'submit', args: [BigInt(jobId), deliverableHash, '0x'] })
  await publicClient.waitForTransactionReceipt({ hash })
  return { status: 'submitted', action: 'submit-job', jobId: String(jobId), tx: hash, explorer: EXPLORER_TX + hash, deliverableHash }
}

export async function completeAgentJob({ jobId, reason = 'deliverable-approved' }) {
  const { walletClient } = wallet()
  const reasonHash = hashTextBytes32(reason)
  const hash = await walletClient.writeContract({ address: AGENTIC_COMMERCE_CONTRACT, abi: agenticCommerceAbi, functionName: 'complete', args: [BigInt(jobId), reasonHash, '0x'] })
  await publicClient.waitForTransactionReceipt({ hash })
  return { status: 'submitted', action: 'complete-job', jobId: String(jobId), tx: hash, explorer: EXPLORER_TX + hash, reasonHash }
}

async function serve() {
  const port = Number(arg('port', process.env.AGENT_PORT || '8787'))
  let owner = ''
  try {
    owner = wallet().account.address
  } catch {
    owner = process.env.AGENT_OWNER || ''
  }
  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      return res.end()
    }
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ ok: true, name: 'ARCOX Terminal AI Agent', owner }))
    }
    if (req.method === 'GET' && req.url === '/metadata') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify(metadataFor(owner), null, 2))
    }
    if (req.method === 'POST' && req.url === '/agent') {
      let body = ''
      req.on('data', chunk => { body += chunk })
      req.on('end', () => {
        try {
          const payload = body ? JSON.parse(body) : {}
          const response = makeAgentResponse({ ...payload, owner: owner || payload.owner })
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(response, null, 2))
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: e.message }))
        }
      })
      return
    }
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not found' }))
  })
  server.listen(port, '127.0.0.1', () => {
    console.log(`ARCOX Terminal AI Agent listening on http://127.0.0.1:${port}/agent`)
    console.log(`Owner: ${owner || 'not set. Set AGENT_PRIVATE_KEY for onchain actions.'}`)
  })
}

async function main() {
  const cmd = command()
  if (cmd === 'help') return help()
  if (cmd === 'env-template') {
    console.log(`# ARCOX local agent env. Keep this file on the user's computer only.
AGENT_PRIVATE_KEY=0xYOUR_LOCAL_AGENT_PRIVATE_KEY
AGENT_NAME=ARCOX Codex Retail Agent
AGENT_PORT=8787
ARC_RPC=https://rpc.testnet.arc.network/
ARCOX_API_URL=https://arc-dex-bice.vercel.app
ARCOX_WEB_URL=https://arc-dex-bice.vercel.app
ARCOX_BACKEND_URL=https://43.163.98.128.nip.io

# Optional: set after onchain register returns an Arc ERC-8004 token id.
ARC_AGENT_ID=
`)
    return
  }
  if (cmd === 'identity') {
    const { account } = wallet()
    console.log(JSON.stringify(metadataFor(account.address), null, 2))
    return
  }
  if (cmd === 'connect') {
    const { account } = wallet()
    const metadata = metadataFor(account.address)
    console.log(JSON.stringify({
      status: 'ready_to_link',
      owner: account.address,
      localAgentId: metadata.local_agent_id,
      arcAgentId: metadata.arc_agent_id || null,
      endpoint: metadata.endpoint,
      ui: `${ARCOX_WEB_URL}/`,
      backend: ARCOX_BACKEND_URL,
      instructions: [
        'Run: npm run agent -- serve --port 8787',
        'Open ARCOX DEX Agent Jobs -> AI Link.',
        'Register/read your Arc Agent ID, then set endpoint to the local endpoint above.',
        'Sign the link message with the same owner wallet.',
      ],
      metadata,
    }, null, 2))
    return
  }
  if (cmd === 'run') return runPrompt()
  if (cmd === 'serve') return serve()
  if (cmd === 'ask') {
    const result = makeAgentResponse({ prompt: arg('prompt'), jobId: arg('job-id'), agentId: process.env.AGENT_ID, owner: process.env.AGENT_OWNER })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (cmd === 'status') {
    const { account } = wallet()
    const [nativeBalance, usdcBalance] = await Promise.all([
      publicClient.getBalance({ address: account.address }),
      publicClient.readContract({ address: ARC_USDC, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] }).catch(() => 0n),
    ])
    console.log(JSON.stringify({ address: account.address, arcGasUsdc: formatUnits(nativeBalance, 18), usdc: formatUnits(usdcBalance, 6), rpc: ARC_RPC }, null, 2))
    return
  }
  if (cmd === 'register') {
    const { account, walletClient } = wallet()
    const metadataUri = arg('metadata-uri')
    if (!metadataUri) throw new Error('Missing --metadata-uri')
    const hash = await walletClient.writeContract({ address: IDENTITY_REGISTRY, abi: identityAbi, functionName: 'register', args: [metadataUri] })
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    console.log(JSON.stringify({ tx: hash, explorer: EXPLORER_TX + hash, agentId: parseAgentId(receipt.logs, account.address), owner: account.address }, null, 2))
    return
  }
  if (cmd === 'read-agent') {
    console.log(JSON.stringify(await readAgent(arg('agent-id')), null, 2))
    return
  }
  if (cmd === 'create-job') {
    const { walletClient } = wallet()
    const provider = getAddress(arg('provider'))
    const evaluator = getAddress(arg('evaluator'))
    const description = arg('description', 'ARCOX terminal agent job')
    const hours = Number(arg('hours', '24')) || 24
    const expiredAt = BigInt(Math.floor(Date.now() / 1000) + hours * 3600)
    const hash = await walletClient.writeContract({ address: AGENTIC_COMMERCE_CONTRACT, abi: agenticCommerceAbi, functionName: 'createJob', args: [provider, evaluator, expiredAt, description, ZERO_ADDRESS] })
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    console.log(JSON.stringify({ tx: hash, explorer: EXPLORER_TX + hash, jobId: parseJobId(receipt.logs) }, null, 2))
    return
  }
  if (cmd === 'read-job') {
    console.log(JSON.stringify(await readJob(arg('job-id')), null, 2))
    return
  }
  if (cmd === 'retry-bridge') {
    const { account } = wallet()
    const fromChain = normalizeChainName(arg('from-chain')) || arg('from-chain')
    const toChain = normalizeChainName(arg('to-chain')) || arg('to-chain')
    console.log(JSON.stringify(await retryBridgeMint({ burnTx: arg('burn-tx'), fromChain, toChain }, account.address), null, 2))
    return
  }
  if (cmd === 'set-budget') {
    const { walletClient } = wallet()
    const hash = await walletClient.writeContract({ address: AGENTIC_COMMERCE_CONTRACT, abi: agenticCommerceAbi, functionName: 'setBudget', args: [BigInt(arg('job-id')), parseUnits(arg('amount'), 6), '0x'] })
    await publicClient.waitForTransactionReceipt({ hash })
    console.log(JSON.stringify({ tx: hash, explorer: EXPLORER_TX + hash }, null, 2))
    return
  }
  if (cmd === 'fund') {
    const { walletClient } = wallet()
    const amount = parseUnits(arg('amount'), 6)
    const jobId = BigInt(arg('job-id'))
    const approveHash = await walletClient.writeContract({ address: ARC_USDC, abi: erc20Abi, functionName: 'approve', args: [AGENTIC_COMMERCE_CONTRACT, amount] })
    await publicClient.waitForTransactionReceipt({ hash: approveHash })
    const fundHash = await walletClient.writeContract({ address: AGENTIC_COMMERCE_CONTRACT, abi: agenticCommerceAbi, functionName: 'fund', args: [jobId, '0x'] })
    await publicClient.waitForTransactionReceipt({ hash: fundHash })
    console.log(JSON.stringify({ approveTx: approveHash, fundTx: fundHash, explorer: EXPLORER_TX + fundHash }, null, 2))
    return
  }
  if (cmd === 'submit') {
    const { walletClient } = wallet()
    const deliverable = arg('deliverable', 'terminal-agent-deliverable')
    const deliverableHash = hashTextBytes32(deliverable)
    const hash = await walletClient.writeContract({ address: AGENTIC_COMMERCE_CONTRACT, abi: agenticCommerceAbi, functionName: 'submit', args: [BigInt(arg('job-id')), deliverableHash, '0x'] })
    await publicClient.waitForTransactionReceipt({ hash })
    console.log(JSON.stringify({ tx: hash, explorer: EXPLORER_TX + hash, deliverableHash }, null, 2))
    return
  }
  if (cmd === 'complete') {
    const { walletClient } = wallet()
    const reasonHash = hashTextBytes32(arg('reason', 'deliverable-approved'))
    const hash = await walletClient.writeContract({ address: AGENTIC_COMMERCE_CONTRACT, abi: agenticCommerceAbi, functionName: 'complete', args: [BigInt(arg('job-id')), reasonHash, '0x'] })
    await publicClient.waitForTransactionReceipt({ hash })
    console.log(JSON.stringify({ tx: hash, explorer: EXPLORER_TX + hash, reasonHash }, null, 2))
    return
  }
  throw new Error(`Unknown command: ${cmd}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    console.error(error.message)
    process.exit(1)
  })
}
