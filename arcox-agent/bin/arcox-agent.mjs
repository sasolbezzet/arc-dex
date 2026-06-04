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
const ARCOX_API_URL = process.env.ARCOX_API_URL || 'https://arc-dex-bice.vercel.app'
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
  npm run agent -- run --prompt "swap 10 USDC to EURC"
  npm run agent -- serve --port 8787
  npm run agent -- ask --prompt "Create escrow job for 1 USDC"
  npm run agent -- status
  npm run agent -- register --metadata-uri ipfs://...
  npm run agent -- read-agent --agent-id 1
  npm run agent -- create-job --provider 0x... --evaluator 0x... --description "..." --hours 24
  npm run agent -- read-job --job-id 1
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

function localAgentId(owner) {
  if (process.env.AGENT_ID) return process.env.AGENT_ID
  const digest = createHash('sha256').update(`arcox:${owner}:${ARC_RPC}`).digest('hex').slice(0, 16)
  return `arcox-codex-${digest}`
}

function metadataFor(owner) {
  return {
    name: DEFAULT_AGENT_NAME,
    description: 'Local-first ARCOX agent for retail swap, bridge, send, and Arc ERC-8183 job workflows.',
    agent_type: 'retail_payment_agent',
    owner,
    local_agent_id: localAgentId(owner),
    arc_agent_id: process.env.ARC_AGENT_ID || process.env.AGENT_ID || '',
    endpoint: `http://127.0.0.1:${process.env.AGENT_PORT || '8787'}/agent`,
    arcox_api_url: ARCOX_API_URL,
    capabilities: [
      'send_usdc_on_arc',
      'plan_swap',
      'bridge_usdc_evm_cctp',
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

function normalizeChainName(value) {
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

function classifyPrompt(prompt) {
  const text = String(prompt || '').trim()
  const lower = text.toLowerCase()
  const { amount, token } = extractAmountToken(text)
  const to = extractFirstAddress(text)
  if (lower.includes('send') || lower.includes('transfer') || lower.includes('kirim')) return { action: 'send', amount, token, to }
  if (lower.includes('swap') || lower.includes('tukar')) {
    const tokenOut = (text.match(/\bto\s+(USDC|EURC|USYC|cirBTC)\b/i)?.[1] || '').toUpperCase()
    return { action: 'swap', amount, tokenIn: token, tokenOut: tokenOut === 'CIRBTC' ? 'CIRBTC' : tokenOut }
  }
  if (lower.includes('bridge')) return { action: 'bridge', amount, token, to, ...extractBridgeRoute(text) }
  if (lower.includes('create job') || lower.includes('buat job')) return { action: 'create-job', amount, token, provider: arg('provider') || to, evaluator: arg('evaluator') || to }
  if (lower.includes('accept job') || lower.includes('terima job')) return { action: 'accept-job', jobId: arg('job-id') || (text.match(/\bjob\s*#?(\d+)/i)?.[1] || '') }
  return { action: 'plan', amount, token }
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

async function executeBridge(intent, owner) {
  if ((intent.token || 'USDC') !== 'USDC') throw new Error('CLI bridge adapter currently supports USDC only.')
  if (!intent.amount || Number(intent.amount) <= 0) throw new Error('Bridge command needs amount, example: bridge 5 USDC from Arbitrum Sepolia to Arc')
  const fromInfo = cctpChains[intent.fromChain]
  const toInfo = cctpChains[intent.toChain]
  if (!fromInfo || !toInfo) throw new Error('Unsupported bridge route. Use Arc, Ethereum Sepolia, Base Sepolia, Arbitrum Sepolia, or HyperEVM Testnet.')
  if (fromInfo.id === toInfo.id) throw new Error('Bridge source and destination must be different.')

  const amount = parseUnits(intent.amount, 6)
  const sourceClient = clientFor(fromInfo)
  const destinationClient = clientFor(toInfo)
  const tokenBalance = await sourceClient.readContract({ address: fromInfo.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [owner] })
  if (tokenBalance < amount) {
    throw new Error(`Insufficient USDC on ${fromInfo.id}. Balance ${formatUnits(tokenBalance, 6)} USDC, need ${intent.amount}.`)
  }

  console.error(`[bridge] route ${fromInfo.id} -> ${toInfo.id}`)
  console.error(`[bridge] approve ${intent.amount} USDC`)
  const approveHash = await writeContractBuffered({
    chainInfo: fromInfo,
    address: fromInfo.usdc,
    abi: erc20Abi,
    functionName: 'approve',
    args: [fromInfo.tokenMessenger, amount],
  })
  await sourceClient.waitForTransactionReceipt({ hash: approveHash })

  console.error(`[bridge] burn ${intent.amount} USDC`)
  const maxFee = 10n
  const minFinalityThreshold = 1000
  const burnHash = await writeContractBuffered({
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

async function executeSend(intent, owner) {
  if (!intent.amount || !intent.to) throw new Error('Send command needs amount and recipient address, example: send 1 USDC to 0x...')
  const token = ARC_TOKENS[intent.token]
  if (!token) throw new Error(`Unsupported Arc token: ${intent.token}`)
  const { walletClient } = wallet()
  const value = parseUnits(intent.amount, token.decimals)
  const hash = await walletClient.writeContract({
    address: token.address,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [intent.to, value],
  })
  await publicClient.waitForTransactionReceipt({ hash })
  return {
    status: 'submitted',
    action: 'send',
    from: owner,
    to: intent.to,
    amount: intent.amount,
    token: intent.token,
    tx: hash,
    explorer: EXPLORER_TX + hash,
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

function makeAgentResponse({ prompt = '', jobId = '', agentId = '', owner = '' }) {
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

async function readAgent(agentId) {
  const id = BigInt(agentId)
  const [owner, metadataUri] = await Promise.all([
    publicClient.readContract({ address: IDENTITY_REGISTRY, abi: identityAbi, functionName: 'ownerOf', args: [id] }),
    publicClient.readContract({ address: IDENTITY_REGISTRY, abi: identityAbi, functionName: 'tokenURI', args: [id] }),
  ])
  return { agentId, owner, metadataUri }
}

async function readJob(jobId) {
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
      ui: `${ARCOX_API_URL}/`,
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

main().catch(error => {
  console.error(error.message)
  process.exit(1)
})
