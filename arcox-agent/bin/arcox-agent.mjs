#!/usr/bin/env node
import { createHash } from 'crypto'
import { existsSync, readFileSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'fs'
import { createServer } from 'http'
import { spawn } from 'child_process'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { homedir } from 'os'
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  decodeFunctionResult,
  defineChain,
  erc20Abi,
  formatUnits,
  getAddress,
  http,
  keccak256,
  parseUnits,
  toHex,
  encodeFunctionData,
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
  createTransferInstruction,
  getAssociatedTokenAddress,
} from '@solana/spl-token'

const __dirname = dirname(fileURLToPath(import.meta.url))
const AGENT_HOME = dirname(__dirname)
const loadedEnvFiles = []

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
const ARCOX_PAY_API_URL = process.env.ARCOX_PAY_API_URL || ARCOX_WEB_URL
const ARCOX_API_BASE_URL = process.env.ARCOX_API_BASE_URL || ARCOX_BACKEND_URL
const DEFAULT_AGENT_NAME = process.env.AGENT_NAME || 'ARCOX Codex Retail Agent'
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const JOB_STATUS = ['Open', 'Funded', 'Submitted', 'Completed', 'Rejected', 'Expired']
const BRIDGE_RECEIPT_WAIT_MS = Number(process.env.BRIDGE_RECEIPT_WAIT_MS || '45000')
const MCP_FAST_ATTESTATION_WAIT_MS = Number(process.env.MCP_FAST_ATTESTATION_WAIT_MS || '30000')
const AUTO_MINT_GRACE_WAIT_MS = Number(process.env.AUTO_MINT_GRACE_WAIT_MS || '20000')
const MCP_MINT_RECEIPT_WAIT_MS = Number(process.env.MCP_MINT_RECEIPT_WAIT_MS || '30000')
const BACKEND_FETCH_TIMEOUT_MS = Number(process.env.BACKEND_FETCH_TIMEOUT_MS || '8000')
const SWAP_EXECUTION_TIMEOUT_MS = Number(process.env.SWAP_EXECUTION_TIMEOUT_MS || '45000')
const SEND_EXECUTION_TIMEOUT_MS = Number(process.env.SEND_EXECUTION_TIMEOUT_MS || '60000')
const SEND_ESTIMATE_TIMEOUT_MS = Number(process.env.SEND_ESTIMATE_TIMEOUT_MS || '15000')
const RPC_TIMEOUT_MS = Number(process.env.RPC_TIMEOUT_MS || '8000')
const SOLANA_CONFIRM_TIMEOUT_MS = Number(process.env.SOLANA_CONFIRM_TIMEOUT_MS || '45000')
const PLATFORM_FEE_BPS = Number(process.env.ARCOX_ROUTER_FEE_BPS || '30')
const ARC_APPKIT_ADAPTER = '0xBBD70b01a1CAbc96d5b7b129Ae1AAabdf50dd40b'
const SOLANA_FEE_TREASURY = process.env.SOLANA_FEE_TREASURY || '4kAf2Qxf9KnbnKo7ukPMMu8q1UButJYNik4yQtvWhExw'
const AUTO_MINT_DIR = join(AGENT_HOME, '.arcox-auto-mint')
const TX_HISTORY_FILE = join(AGENT_HOME, '.arcox-agent-history.json')
const AUTO_MINT_STALE_MS = Number(process.env.AUTO_MINT_STALE_MS || 5 * 60 * 1000)
const AUTO_MINT_MAX_RECOVERIES = Number(process.env.AUTO_MINT_MAX_RECOVERIES || 3)
const ARC_TOKENS = {
  USDC: { address: ARC_USDC, decimals: 6 },
  EURC: { address: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a', decimals: 6 },
  USYC: { address: '0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C', decimals: 6 },
  CIRBTC: { address: '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF', decimals: 8 },
}

const adapterExecuteAbi = [
  {
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
  },
]

const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC] } },
  blockExplorers: { default: { name: 'ArcScan', url: 'https://testnet.arcscan.app' } },
})

function rpcTransport(rpcUrl) {
  return http(rpcUrl, { timeout: RPC_TIMEOUT_MS })
}

const publicClient = createPublicClient({ chain: arcTestnet, transport: rpcTransport(ARC_RPC) })
const routerDeployments = loadRouterDeployments()
const nativeSwapBridgeDeployments = loadNativeSwapBridgeDeployments()

function readAgentHistory() {
  try {
    if (!existsSync(TX_HISTORY_FILE)) return []
    const items = JSON.parse(readFileSync(TX_HISTORY_FILE, 'utf8'))
    return Array.isArray(items) ? items : []
  } catch { return [] }
}

function writeAgentHistory(items) {
  writeFileSync(TX_HISTORY_FILE, JSON.stringify(items.slice(0, 100), null, 2))
}

function recordAgentHistory(record, owner = '') {
  const rec = {
    id: record.id || `${record.action || 'tx'}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    ts: record.ts || Date.now(),
    owner,
    source: 'agent-mcp',
    status: record.status === 'error' ? 'error' : record.status === 'pending' ? 'pending' : 'success',
    ...record,
  }
  writeAgentHistory([rec, ...readAgentHistory().filter(item => item.id !== rec.id)])
  return rec
}

function normalizeArcTokenKey(value, fallback = 'USDC') {
  const upper = String(value || fallback).trim().toUpperCase()
  if (upper === 'CIRBTC' || upper === 'CIR-BTC' || upper === 'CIRCLEBTC') return 'CIRBTC'
  return upper || fallback
}

function apiArcTokenKey(value, fallback = 'USDC') {
  const tokenKey = normalizeArcTokenKey(value, fallback)
  return tokenKey === 'CIRBTC' ? 'cirBTC' : tokenKey
}

function swapRouteUnavailableQuote(error) {
  const message = error?.message || String(error || '')
  if (!/NO_SWAP_ROUTE|Route swap belum tersedia|No route available|Route or resource not found|Swap route not found|route is not supported/i.test(message)) return null
  return {
    available: false,
    code: 'NO_SWAP_ROUTE',
    error: 'Route swap belum tersedia dari Circle Stablecoin Service untuk pasangan/jumlah ini. Coba jumlah lebih besar, atau ulangi beberapa menit lagi.',
    details: message,
  }
}

function shortAddress(value = '') {
  const raw = String(value || '')
  if (raw.length <= 12) return raw
  return `${raw.slice(0, 6)}...${raw.slice(-4)}`
}

function sendPreviewDetails({ source, owner, from, to, token, amount, balance, platformFee, recipientReceives, networkFee, estimate, supported }) {
  const warnings = []
  if (!supported) warnings.push(`Saldo ${source} tidak cukup untuk mengirim ${amount} ${token}.`)
  if (estimate?.error) warnings.push(`Estimasi fee gagal: ${estimate.error}`)
  return {
    title: `Send ${amount} ${token}`,
    summary: `${source === 'circle' ? 'Circle Wallet proxy' : 'EOA agent wallet'} will send ${recipientReceives} ${token} to ${shortAddress(to)} after platform fee ${platformFee} ${token}.`,
    sourceWallet: source,
    owner,
    fromAddress: typeof from === 'string' ? from : from?.address,
    fromWalletId: typeof from === 'object' ? from?.id : undefined,
    toAddress: to,
    token,
    grossAmount: amount,
    platformFee,
    recipientReceives,
    balanceBefore: balance,
    estimatedNetworkFee: networkFee,
    supported: Boolean(supported),
    warnings,
    userMustCheck: [
      'Recipient address is correct.',
      'Token and amount are correct.',
      'Platform fee and receive amount are acceptable.',
      'This action moves funds and cannot be reversed after execution.',
    ],
  }
}

function splitPlatformFeeUnits(amountUnits) {
  const feeBps = Number.isFinite(PLATFORM_FEE_BPS) && PLATFORM_FEE_BPS > 0 ? Math.floor(PLATFORM_FEE_BPS) : 0
  const feeUnits = (amountUnits * BigInt(feeBps)) / 10_000n
  const netUnits = amountUnits - feeUnits
  if (netUnits <= 0n) throw new Error('Amount too small after platform fee')
  return { feeBps, feeUnits, netUnits }
}

function updateAgentHistoryByBurnTx(burnTx, patch, owner = '') {
  const items = readAgentHistory()
  let updated = null
  const next = items.map(item => {
    if (!burnTx || String(item.burnTx || '').toLowerCase() !== String(burnTx).toLowerCase()) return item
    updated = { ...item, ...patch, owner: item.owner || owner, ts: item.ts || Date.now() }
    return updated
  })
  if (!updated) {
    updated = {
      id: `bridge-${Date.now()}-${String(burnTx || '').slice(-6)}`,
      ts: Date.now(),
      owner,
      source: 'agent-mcp',
      action: 'bridge',
      burnTx,
      ...patch,
    }
    next.unshift(updated)
  }
  writeAgentHistory(next)
  return updated
}

async function pushBackendHistory(owner, record) {
  try {
    const account = privateKeyToAccount(privateKey())
    const token = await backendSession(account)
    await postJson('/api/tx-history', { metamaskAddress: owner, record: { ...record, owner, source: 'agent-mcp' } }, token)
  } catch (error) {
    console.error('[history] backend sync skipped:', error.message)
  }
}

async function pullBackendHistory(owner) {
  try {
    if (!owner) return []
    const account = privateKeyToAccount(privateKey())
    const token = await backendSession(account)
    const response = await fetch(`${ARCOX_BACKEND_URL}/api/tx-history`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(BACKEND_FETCH_TIMEOUT_MS),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`)
    return Array.isArray(data.history) ? data.history : []
  } catch (error) {
    console.error('[history] backend pull skipped:', error.message)
    return []
  }
}

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
    fast: true,
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
    fast: true,
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
    fast: true,
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
    fast: true,
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

const nativeSwapBridgeRouterAbi = [
  {
    type: 'function',
    name: 'swapNativeAndBridgeUsdc',
    stateMutability: 'payable',
    inputs: [
      { name: 'destinationDomain', type: 'uint32' },
      { name: 'mintRecipient', type: 'bytes32' },
      { name: 'destinationCaller', type: 'bytes32' },
      { name: 'poolFee', type: 'uint24' },
      { name: 'amountOutMinimum', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'maxFee', type: 'uint256' },
      { name: 'minFinalityThreshold', type: 'uint32' },
    ],
    outputs: [
      { name: 'usdcOut', type: 'uint256' },
      { name: 'platformFee', type: 'uint256' },
      { name: 'netUsdc', type: 'uint256' },
    ],
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
  const envPaths = [
    process.env.ARCOX_AGENT_ENV,
    join(process.cwd(), '.env'),
    join(homedir(), '.arcox', '.env'),
    join(AGENT_HOME, '.env'),
  ].filter(Boolean)
  for (const envPath of envPaths) {
    if (!existsSync(envPath)) continue
    loadedEnvFiles.push(envPath)
    const lines = readFileSync(envPath, 'utf8').split(/\r?\n/)
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue
      const [key, ...rest] = trimmed.split('=')
      if (process.env[key]) continue
      process.env[key] = rest.join('=').replace(/^['"]|['"]$/g, '')
    }
  }
}

function envSecurityWarnings() {
  const warnings = []
  for (const envPath of loadedEnvFiles) {
    try {
      const mode = statSync(envPath).mode & 0o777
      if ((mode & 0o077) !== 0) {
        warnings.push(`${envPath} permissions are ${mode.toString(8)}. Run: chmod 600 ${envPath}`)
      }
    } catch {}
  }
  return warnings
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

function loadNativeSwapBridgeDeployments() {
  const path = join(AGENT_HOME, 'deployments', 'arcox-native-swap-bridge-router.testnet.json')
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

function envNativeSwapBridgeRouterName(chainId) {
  return `ARCOX_NATIVE_SWAP_BRIDGE_ROUTER_${String(chainId).toUpperCase()}`
}

export function routerFor(chainId) {
  const envValue = process.env[envRouterName(chainId)]
  if (envValue && /^0x[0-9a-fA-F]{40}$/.test(envValue)) return getAddress(envValue)
  const deployed = routerDeployments[chainId]?.address
  if (deployed && /^0x[0-9a-fA-F]{40}$/.test(deployed)) return getAddress(deployed)
  return ''
}

export function nativeSwapBridgeRouterFor(chainId) {
  const envValue = process.env[envNativeSwapBridgeRouterName(chainId)]
  if (envValue && /^0x[0-9a-fA-F]{40}$/.test(envValue)) return getAddress(envValue)
  const deployed = nativeSwapBridgeDeployments[chainId]?.address
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

function writeAutoMintStatus(jobId, data) {
  mkdirSync(AUTO_MINT_DIR, { recursive: true })
  const saved = { ...data, updatedAt: new Date().toISOString() }
  writeFileSync(join(AUTO_MINT_DIR, `${jobId}.json`), JSON.stringify(saved, null, 2))
  return saved
}

function readAutoMintStatus(jobId) {
  try {
    return JSON.parse(readFileSync(join(AUTO_MINT_DIR, `${jobId}.json`), 'utf8'))
  } catch {
    return null
  }
}

function autoMintJobId(burnTx) {
  return String(burnTx || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 72)
}

function spawnAutoMintWorker({ burnTx, from, to, owner, delayMs = 0 }) {
  const args = [
    fileURLToPath(import.meta.url),
    'auto-mint-bridge',
    '--burn-tx', burnTx,
    '--from-chain', from,
    '--to-chain', to,
    '--owner', owner,
  ]
  if (delayMs > 0) args.push('--delay-ms', String(delayMs))
  const child = spawn(process.execPath, args, {
    cwd: AGENT_HOME,
    env: process.env,
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
  return child.pid
}

function isRecoverableAutoMintError(error) {
  const message = String(error?.message || error || '').toLowerCase()
  return [
    'attestation timeout',
    'timeout',
    'timed out',
    'fetch failed',
    'network',
    'rate limit',
    '429',
    '503',
    '502',
    'econnreset',
    'etimedout',
    'pending_confirmations',
  ].some(part => message.includes(part))
}

function rescheduleAutoMintAfterFailure({ jobId, burnTx, fromChain, toChain, owner, error }) {
  const previous = readAutoMintStatus(jobId) || {}
  const recoveries = Number(previous.recoveries || 0)
  if (recoveries >= AUTO_MINT_MAX_RECOVERIES) {
    return writeAutoMintStatus(jobId, {
      ...previous,
      status: 'error',
      action: 'auto-mint-bridge',
      owner,
      burnTx,
      from: fromChain,
      to: toChain,
      recoveries,
      error: error.message,
      safeNextStep: 'Auto-mint worker reached recovery limit. Use retry bridge with the burn tx.',
    })
  }
  const delayMs = Math.min(120000, 30000 * (recoveries + 1))
  const pid = spawnAutoMintWorker({ burnTx, from: fromChain, to: toChain, owner, delayMs })
  return writeAutoMintStatus(jobId, {
    ...previous,
    status: 'rescheduled',
    action: 'auto-mint-bridge',
    owner,
    burnTx,
    from: fromChain,
    to: toChain,
    recoveries: recoveries + 1,
    retryDelayMs: delayMs,
    pid,
    lastError: error.message,
    safeNextStep: `Temporary auto-mint error. Worker rescheduled in ${Math.round(delayMs / 1000)}s.`,
  })
}

function scheduleAutoMint({ burnTx, fromInfo, toInfo, owner }) {
  if (!burnTx) return null
  const jobId = autoMintJobId(burnTx)
  writeAutoMintStatus(jobId, {
    status: 'scheduled',
    action: 'auto-mint-bridge',
    owner,
    burnTx,
    from: fromInfo.id,
    to: toInfo.id,
  })
  const pid = spawnAutoMintWorker({ burnTx, from: fromInfo.id, to: toInfo.id, owner })
  return {
    jobId,
    pid,
    statusFile: join(AUTO_MINT_DIR, `${jobId}.json`),
  }
}

function privateKey() {
  const key = process.env.AGENT_PRIVATE_KEY || ''
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error('Set AGENT_PRIVATE_KEY=0x... for onchain agent commands.')
  return key
}

function wallet() {
  const account = privateKeyToAccount(privateKey())
  const walletClient = createWalletClient({ account, chain: arcTestnet, transport: rpcTransport(ARC_RPC) })
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
  const match = String(text || '').match(/(\d+(?:\.\d+)?)\s*(USDC|EURC|USYC|cirBTC|ETH|HYPE|SOL)/i)
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

async function postJson(path, body, token = '', timeoutMs = BACKEND_FETCH_TIMEOUT_MS) {
  const response = await fetch(`${ARCOX_BACKEND_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`)
  return data
}

async function patchJson(path, body, token = '', timeoutMs = BACKEND_FETCH_TIMEOUT_MS) {
  const response = await fetch(`${ARCOX_BACKEND_URL}${path}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`)
  return data
}

async function backendGet(path, token = '', timeoutMs = BACKEND_FETCH_TIMEOUT_MS) {
  const response = await fetch(`${ARCOX_BACKEND_URL}${path}`, {
    headers: {
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`)
  return data
}

async function payPostJson(path, body, timeoutMs = BACKEND_FETCH_TIMEOUT_MS) {
  const response = await fetch(`${ARCOX_PAY_API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`)
  return data
}

async function payGetJson(path, timeoutMs = BACKEND_FETCH_TIMEOUT_MS) {
  const response = await fetch(`${ARCOX_PAY_API_URL}${path}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`)
  return data
}

async function arcoxApiGetJson(path, options = {}, timeoutMs = BACKEND_FETCH_TIMEOUT_MS) {
  const response = await fetch(`${ARCOX_API_BASE_URL}${path}`, {
    headers: {
      Accept: 'application/json',
      ...(options.mockPaid ? { 'X-PAYMENT': 'mock-paid' } : {}),
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  })
  const data = await response.json().catch(() => ({}))
  if (response.status === 402) return { paymentRequired: true, ...data }
  if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`)
  return data
}

async function getJson(url) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(BACKEND_FETCH_TIMEOUT_MS),
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

async function withTimeout(promise, timeoutMs, message) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function clientFor(chainInfo) {
  return createPublicClient({ chain: chainInfo.chain, transport: rpcTransport(chainInfo.rpc) })
}

function walletFor(chainInfo) {
  const account = privateKeyToAccount(privateKey())
  const walletClient = createWalletClient({ account, chain: chainInfo.chain, transport: rpcTransport(chainInfo.rpc) })
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
    const retryFees = await bufferedFees(sourceClient, 4n)
    return walletClient.writeContract({ address, abi, functionName, args, ...retryFees })
  }
}

async function sendTransactionBuffered({ chainInfo, to, data, value = 0n }) {
  const sourceClient = clientFor(chainInfo)
  const { walletClient, account } = walletFor(chainInfo)
  const fees = await bufferedFees(sourceClient, 3n)
  try {
    return await walletClient.sendTransaction({ account, to, data, value, ...fees })
  } catch (error) {
    const msg = error?.message || ''
    if (!/max fee per gas less than block base fee|underpriced|fee/i.test(msg)) throw error
    await sleep(1200)
    const retryFees = await bufferedFees(sourceClient, 4n)
    return walletClient.sendTransaction({ account, to, data, value, ...retryFees })
  }
}

async function waitForReceipt(client, hash, timeoutMs = 0) {
  if (!timeoutMs) return client.waitForTransactionReceipt({ hash })
  return Promise.race([
    client.waitForTransactionReceipt({ hash }),
    sleep(timeoutMs).then(() => null),
  ])
}

async function confirmSolanaTransaction(conn, params, commitment = 'confirmed', timeoutMs = SOLANA_CONFIRM_TIMEOUT_MS) {
  return Promise.race([
    conn.confirmTransaction(params, commitment),
    sleep(timeoutMs).then(() => null),
  ])
}

async function ensureAllowance({ sourceClient, fromInfo, owner, tokenAddress, spender, amount, deferMint }) {
  const allowance = await sourceClient.readContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [owner, spender],
  }).catch(() => 0n)
  if (allowance >= amount) return { approveHash: null, confirmed: true, skipped: true }

  const approveHash = await writeContractBuffered({
    chainInfo: fromInfo,
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'approve',
    args: [spender, amount],
  })
  const receipt = await waitForReceipt(sourceClient, approveHash, deferMint ? BRIDGE_RECEIPT_WAIT_MS : 0)
  return { approveHash, confirmed: Boolean(receipt), skipped: false }
}

async function pollAttestation(domain, txHash, chainInfo, options = {}) {
  const maxPolls = chainInfo.fast ? 90 : Number(process.env.BRIDGE_ATTESTATION_POLLS || '700')
  const deadline = options.maxWaitMs ? Date.now() + Number(options.maxWaitMs) : 0
  const url = `${IRIS}/v2/messages/${domain}?transactionHash=${txHash}`
  let lastStatus = ''
  for (let i = 0; i < maxPolls; i++) {
    if (deadline && Date.now() >= deadline) {
      if (options.returnNullOnTimeout) return null
      break
    }
    const delay = chainInfo.fast ? 1000 : i < 20 ? 1000 : 3000
    await sleep(deadline ? Math.min(delay, Math.max(0, deadline - Date.now())) : delay)
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

async function waitAttestationBeforeAutoMint(fromInfo, burnHash) {
  return pollAttestation(fromInfo.domain, burnHash, fromInfo, {
    maxWaitMs: AUTO_MINT_GRACE_WAIT_MS,
    returnNullOnTimeout: true,
  })
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
    const ataConf = await confirmSolanaTransaction(conn, { signature: ataSig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, 'confirmed')
    if (!ataConf) throw new Error(`Solana ATA transaction submitted but not confirmed before timeout: ${ataSig}`)
    if (ataConf.value.err) throw new Error('Solana ATA creation failed: ' + JSON.stringify(ataConf.value.err))
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
  const conf = await confirmSolanaTransaction(conn, { signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, 'confirmed')
  if (!conf) return sig
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
  const platformFee = splitPlatformFeeUnits(amountLamports)
  const treasury = new PublicKey(SOLANA_FEE_TREASURY)
  const treasuryAta = await getAssociatedTokenAddress(mint, treasury)
  const discriminator = new Uint8Array([215, 60, 61, 46, 114, 55, 128, 176])
  const data = concatU8(discriminator, u64LE(platformFee.netUnits), u32LE(26), mintRecipientBytes, new Uint8Array(32), u64LE(10n), u32LE(2000))
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
  const treasuryAtaExists = await conn.getAccountInfo(treasuryAta).catch(() => null)
  if (!treasuryAtaExists) {
    tx.add(createAssociatedTokenAccountInstruction(owner, treasuryAta, treasury, mint))
  }
  if (platformFee.feeUnits > 0n) {
    tx.add(createTransferInstruction(senderAta, treasuryAta, owner, platformFee.feeUnits))
  }
  tx.add(ix)
  tx.partialSign(messageSentEventData, payer)
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, preflightCommitment: 'confirmed' })
  const conf = await confirmSolanaTransaction(conn, { signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')
  if (!conf) throw new Error(`Solana burn submitted but not confirmed before timeout: ${sig}`)
  if (conf.value.err) throw new Error('Solana burn failed: ' + JSON.stringify(conf.value.err))
  return {
    sig,
    platformFee: formatUnits(platformFee.feeUnits, 6),
    netAmount: formatUnits(platformFee.netUnits, 6),
    feeBps: platformFee.feeBps,
    treasury: treasury.toBase58(),
  }
}

async function solanaUsdcBalance(owner = solanaKeypair().publicKey) {
  const conn = solanaConnection()
  const mint = new PublicKey(SOLANA_USDC_MINT)
  const ata = await getAssociatedTokenAddress(mint, owner)
  const bal = await conn.getTokenAccountBalance(ata).catch(() => null)
  return { ata: ata.toBase58(), amount: bal?.value?.uiAmountString || '0' }
}

function normalizeBridgeTokenKey(value, fallback = 'USDC') {
  const upper = String(value || fallback).trim().toUpperCase()
  if (upper === 'ETH_NATIVE') return 'ETH'
  if (upper === 'HYPE_NATIVE') return 'HYPE'
  if (upper === 'SOL_NATIVE') return 'SOL'
  return normalizeArcTokenKey(upper || fallback)
}

function nativeTokenForChain(chainInfo) {
  return String(chainInfo?.chain?.nativeCurrency?.symbol || (chainInfo?.solana ? 'SOL' : '')).toUpperCase()
}

function isNativeBridgeIntent(token, fromInfo, toInfo) {
  if (!fromInfo || !toInfo || toInfo.id !== 'Arc_Testnet') return false
  const bridgeToken = normalizeBridgeTokenKey(token)
  if (!['ETH', 'HYPE', 'SOL'].includes(bridgeToken)) return false
  return bridgeToken === nativeTokenForChain(fromInfo)
}

function assertNativeBridgeSupported({ token, source, fromInfo, toInfo }) {
  const bridgeToken = normalizeBridgeTokenKey(token)
  if (source === 'circle') throw new Error('Native bridge is only supported from the local EOA agent wallet. Circle Wallet source supports USDC only.')
  if (!isNativeBridgeIntent(bridgeToken, fromInfo, toInfo)) {
    throw new Error(`Native ${bridgeToken} bridge is only supported from its source chain to Arc Testnet.`)
  }
  if (fromInfo.solana) throw new Error('SOL-native bridge is not enabled in MCP. Current Solana route supports USDC only.')
  const router = nativeSwapBridgeRouterFor(fromInfo.id)
  if (!router) throw new Error(`Native ${bridgeToken} bridge router is not deployed for ${fromInfo.id}.`)
  return router
}

async function quoteNativeBridgeRoute(intent, owner, fromInfo, toInfo, source = 'eoa') {
  const token = normalizeBridgeTokenKey(intent.token)
  const router = assertNativeBridgeSupported({ token, source, fromInfo, toInfo })
  if (!intent.amount || Number(intent.amount) <= 0) throw new Error(`Native ${token} bridge quote needs a positive amount.`)
  const nativeAmount = parseUnits(String(intent.amount), 18)
  const sourceClient = clientFor(fromInfo)
  const nativeBalance = await sourceClient.getBalance({ address: owner }).catch(() => 0n)
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 900)
  const quotes = []
  for (const poolFee of [500, 3000, 10000]) {
    try {
      const data = encodeFunctionData({
        abi: nativeSwapBridgeRouterAbi,
        functionName: 'swapNativeAndBridgeUsdc',
        args: [toInfo.domain, bytes32Address(owner), `0x${'0'.repeat(64)}`, poolFee, 1n, deadline, 10n, 1000],
      })
      const result = await sourceClient.call({ account: owner, to: router, data, value: nativeAmount })
      const decoded = decodeFunctionResult({ abi: nativeSwapBridgeRouterAbi, functionName: 'swapNativeAndBridgeUsdc', data: result.data })
      quotes.push({ poolFee, usdcOut: decoded[0], platformFee: decoded[1], netUsdc: decoded[2], deadline })
    } catch {}
  }
  quotes.sort((a, b) => a.netUsdc === b.netUsdc ? 0 : a.netUsdc > b.netUsdc ? -1 : 1)
  const best = quotes[0]
  if (!best || best.netUsdc <= 0n) throw new Error(`No native ${token} route quote succeeded on ${fromInfo.id}. Pool liquidity may be unavailable.`)
  return {
    status: 'quote',
    action: 'bridge',
    route: 'native-swap-bridge-router',
    source: 'eoa-agent-wallet',
    owner,
    from: fromInfo.id,
    to: toInfo.id,
    token,
    outputToken: 'USDC',
    amount: String(intent.amount),
    nativeBalance: formatUnits(nativeBalance, 18),
    router,
    poolFee: best.poolFee,
    quotedUsdcOut: formatUnits(best.usdcOut, 6),
    platformFee: formatUnits(best.platformFee, 6),
    estimatedReceive: formatUnits(best.netUsdc, 6),
    feeBps: PLATFORM_FEE_BPS,
    approvalRequired: false,
    supported: nativeBalance > nativeAmount,
    terminalExecution: 'supported_native_swap_bridge',
    safeNextStep: 'Ask the user to confirm before calling arcox_execute_bridge with confirmed=true. The agent will send native token to the router, swap to USDC, burn via CCTP, then mint USDC on Arc.',
  }
}

async function executeNativeBridge(intent, owner, fromInfo, toInfo) {
  const quote = await quoteNativeBridgeRoute(intent, owner, fromInfo, toInfo, 'eoa')
  if (!quote.supported) throw new Error(`Insufficient ${quote.token} on ${fromInfo.id}. Balance ${quote.nativeBalance}, need ${intent.amount} plus gas.`)
  const nativeAmount = parseUnits(String(intent.amount), 18)
  const sourceClient = clientFor(fromInfo)
  const destinationClient = clientFor(toInfo)
  const minOut = (parseUnits(quote.quotedUsdcOut, 6) * 9950n) / 10000n
  const data = encodeFunctionData({
    abi: nativeSwapBridgeRouterAbi,
    functionName: 'swapNativeAndBridgeUsdc',
    args: [toInfo.domain, bytes32Address(owner), `0x${'0'.repeat(64)}`, quote.poolFee, minOut, BigInt(Math.floor(Date.now() / 1000) + 900), 10n, 1000],
  })
  console.error(`[bridge:native] route ${fromInfo.id} ${quote.token} -> USDC -> ${toInfo.id}`)
  const burnHash = await sendTransactionBuffered({ chainInfo: fromInfo, to: quote.router, data, value: nativeAmount })
  const burnReceipt = await waitForReceipt(sourceClient, burnHash, intent.deferMint ? BRIDGE_RECEIPT_WAIT_MS : 0)
  if (!burnReceipt) {
    return pendingBridgeStepResult({
      status: 'pending_burn',
      route: 'native-swap-bridge-router',
      router: quote.router,
      fromInfo,
      toInfo,
      owner,
      amount: quote.estimatedReceive,
      burnHash,
      safeNextStep: `Native swap+burn belum confirmed sebelum timeout MCP. Cek tx ${burnHash}, lalu retry mint jika burn sudah confirmed.`,
    })
  }
  if (intent.deferMint) {
    const attestation = await waitAttestationBeforeAutoMint(fromInfo, burnHash)
    if (!attestation) {
      return pendingBridgeMintResult({
        route: 'native-swap-bridge-router',
        router: quote.router,
        fromInfo,
        toInfo,
        owner,
        amount: quote.estimatedReceive,
        burnHash,
        safeNextStep: `Native swap+burn selesai. Attestation belum siap setelah ${Math.round(AUTO_MINT_GRACE_WAIT_MS / 1000)} detik; agent auto-mint worker dijadwalkan.`,
      })
    }
    const mintHash = await writeContractBuffered({
      chainInfo: toInfo,
      address: toInfo.messageTransmitter,
      abi: messageTransmitterAbi,
      functionName: 'receiveMessage',
      args: [attestation.message, attestation.attestation],
    })
    const mintReceipt = await waitForReceipt(destinationClient, mintHash, MCP_MINT_RECEIPT_WAIT_MS)
    return {
      status: mintReceipt ? 'submitted' : 'pending_mint_receipt',
      action: 'bridge',
      route: 'native-swap-bridge-router',
      router: quote.router,
      from: fromInfo.id,
      to: toInfo.id,
      owner,
      amount: String(intent.amount),
      token: quote.token,
      outputToken: 'USDC',
      estimatedReceive: quote.estimatedReceive,
      platformFee: quote.platformFee,
      burnTx: burnHash,
      mintTx: mintHash,
      burnExplorer: fromInfo.explorer + burnHash,
      mintExplorer: toInfo.explorer + mintHash,
      safeNextStep: mintReceipt ? 'Attestation siap dalam grace wait; mint USDC di Arc selesai.' : 'Mint transaction submitted, but receipt was not confirmed before MCP timeout.',
    }
  }
  const attestation = await pollAttestation(fromInfo.domain, burnHash, fromInfo, {
    maxWaitMs: intent.maxAttestationWaitMs,
    returnNullOnTimeout: Boolean(intent.maxAttestationWaitMs),
  })
  if (!attestation) {
    return pendingBridgeMintResult({
      route: 'native-swap-bridge-router',
      router: quote.router,
      fromInfo,
      toInfo,
      owner,
      amount: quote.estimatedReceive,
      burnHash,
      safeNextStep: 'Attestation belum siap sebelum batas waktu MCP. Agent auto-mint worker dijadwalkan.',
    })
  }
  const mintHash = await writeContractBuffered({
    chainInfo: toInfo,
    address: toInfo.messageTransmitter,
    abi: messageTransmitterAbi,
    functionName: 'receiveMessage',
    args: [attestation.message, attestation.attestation],
  })
  const mintReceipt = await waitForReceipt(destinationClient, mintHash, MCP_MINT_RECEIPT_WAIT_MS)
  return {
    status: mintReceipt ? 'submitted' : 'pending_mint_receipt',
    action: 'bridge',
    route: 'native-swap-bridge-router',
    router: quote.router,
    from: fromInfo.id,
    to: toInfo.id,
    owner,
    amount: String(intent.amount),
    token: quote.token,
    outputToken: 'USDC',
    estimatedReceive: quote.estimatedReceive,
    platformFee: quote.platformFee,
    burnTx: burnHash,
    mintTx: mintHash,
    burnExplorer: fromInfo.explorer + burnHash,
    mintExplorer: toInfo.explorer + mintHash,
  }
}

export async function executeBridge(intent, owner) {
  if (!intent.amount || Number(intent.amount) <= 0) throw new Error('Bridge command needs amount, example: bridge 5 USDC from Arbitrum Sepolia to Arc')
  const fromInfo = cctpChains[intent.fromChain]
  const toInfo = cctpChains[intent.toChain]
  if (!fromInfo || !toInfo) throw new Error('Unsupported bridge route. Use Arc, Ethereum Sepolia, Base Sepolia, Arbitrum Sepolia, or HyperEVM Testnet.')
  if (fromInfo.id === toInfo.id) throw new Error('Bridge source and destination must be different.')
  const bridgeToken = normalizeBridgeTokenKey(intent.token)
  if (isNativeBridgeIntent(bridgeToken, fromInfo, toInfo)) return executeNativeBridge({ ...intent, token: bridgeToken }, owner, fromInfo, toInfo)
  if (bridgeToken !== 'USDC') throw new Error('MCP bridge supports USDC, plus native ETH from Ethereum/Base Sepolia to Arc when a native router is deployed.')
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
  if (!router) throw new Error(`ArcoxRouter is not deployed for ${fromInfo.id}; refusing direct bridge without platform fee.`)
  const spender = router || fromInfo.tokenMessenger

  console.error(`[bridge] route ${fromInfo.id} -> ${toInfo.id}`)
  console.error(`[bridge] check allowance for ${router ? 'ArcoxRouter' : 'CCTP TokenMessenger'}`)
  const approval = await ensureAllowance({
    sourceClient,
    fromInfo,
    owner,
    tokenAddress: fromInfo.usdc,
    spender,
    amount,
    deferMint: intent.deferMint,
  })
  if (!approval.confirmed) {
    return pendingBridgeStepResult({
      status: 'pending_approve',
      route: router ? 'arcox-router' : 'direct-cctp-fallback',
      router,
      fromInfo,
      toInfo,
      owner,
      amount: intent.amount,
      approveHash: approval.approveHash,
      safeNextStep: `Approve belum confirmed sebelum timeout MCP. Jalankan ulang bridge setelah approve tx ${approval.approveHash} confirmed.`,
    })
  }

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
  const burnReceipt = await waitForReceipt(sourceClient, burnHash, intent.deferMint ? BRIDGE_RECEIPT_WAIT_MS : 0)
  if (!burnReceipt) {
    return pendingBridgeStepResult({
      status: 'pending_burn',
      route: router ? 'arcox-router' : 'direct-cctp-fallback',
      router,
      fromInfo,
      toInfo,
      owner,
      amount: intent.amount,
      approveHash: approval.approveHash,
      burnHash,
      safeNextStep: `Burn belum confirmed sebelum timeout MCP. Jalankan ulang status/retry setelah burn confirmed; auto-mint worker belum dijadwalkan.`,
    })
  }
  if (intent.deferMint) {
    const attestation = await waitAttestationBeforeAutoMint(fromInfo, burnHash)
    if (attestation) {
      console.error(`[bridge] attestation ready during grace wait, mint on ${toInfo.id}`)
      const mintHash = await writeContractBuffered({
        chainInfo: toInfo,
        address: toInfo.messageTransmitter,
        abi: messageTransmitterAbi,
        functionName: 'receiveMessage',
        args: [attestation.message, attestation.attestation],
      })
      const mintReceipt = await waitForReceipt(destinationClient, mintHash, MCP_MINT_RECEIPT_WAIT_MS)
      return {
        status: mintReceipt ? 'submitted' : 'pending_mint_receipt',
        action: 'bridge',
        route: router ? 'arcox-router' : 'direct-cctp-fallback',
        router: router || null,
        from: fromInfo.id,
        to: toInfo.id,
        owner,
        amount: intent.amount,
        token: 'USDC',
        approveTx: approval.approveHash,
        burnTx: burnHash,
        mintTx: mintHash,
        approveExplorer: approval.approveHash ? fromInfo.explorer + approval.approveHash : undefined,
        burnExplorer: fromInfo.explorer + burnHash,
        mintExplorer: toInfo.explorer + mintHash,
        safeNextStep: mintReceipt ? 'Attestation siap dalam 20 detik; mint selesai tanpa auto-mint worker.' : 'Mint submitted after 20s grace wait, but receipt not confirmed before MCP timeout.',
      }
    }
    return pendingBridgeMintResult({
      route: router ? 'arcox-router' : 'direct-cctp-fallback',
      router,
      fromInfo,
      toInfo,
      owner,
      amount: intent.amount,
      approveHash: approval.approveHash,
      burnHash,
      safeNextStep: `Burn selesai. Attestation belum siap setelah ${Math.round(AUTO_MINT_GRACE_WAIT_MS / 1000)} detik; agent auto-mint worker baru dijadwalkan.`,
    })
  }

  console.error(`[bridge] wait attestation from Circle Iris`)
  const attestation = await pollAttestation(fromInfo.domain, burnHash, fromInfo, {
    maxWaitMs: intent.maxAttestationWaitMs,
    returnNullOnTimeout: Boolean(intent.maxAttestationWaitMs),
  })
  if (!attestation) {
    return pendingBridgeMintResult({
      route: router ? 'arcox-router' : 'direct-cctp-fallback',
      router,
      fromInfo,
      toInfo,
      owner,
      amount: intent.amount,
      approveHash: approval.approveHash,
      burnHash,
      safeNextStep: `Attestation belum siap sebelum batas waktu MCP. Agent auto-mint worker dijadwalkan setelah grace wait attestation.`,
    })
  }

  console.error(`[bridge] mint on ${toInfo.id}`)
  const mintHash = await writeContractBuffered({
    chainInfo: toInfo,
    address: toInfo.messageTransmitter,
    abi: messageTransmitterAbi,
    functionName: 'receiveMessage',
    args: [attestation.message, attestation.attestation],
  })
  const mintReceipt = await waitForReceipt(destinationClient, mintHash, MCP_MINT_RECEIPT_WAIT_MS)
  if (!mintReceipt) {
    return {
      status: 'pending_mint_receipt',
      action: 'bridge',
      route: router ? 'arcox-router' : 'direct-cctp-fallback',
      router: router || null,
      from: fromInfo.id,
      to: toInfo.id,
      owner,
      amount: intent.amount,
      token: 'USDC',
      approveTx: approval.approveHash,
      burnTx: burnHash,
      mintTx: mintHash,
      approveExplorer: approval.approveHash ? fromInfo.explorer + approval.approveHash : undefined,
      burnExplorer: fromInfo.explorer + burnHash,
      mintExplorer: toInfo.explorer + mintHash,
      safeNextStep: 'Mint transaction submitted, but receipt was not confirmed before MCP timeout. Check explorer/history before retrying.',
    }
  }

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
    approveTx: approval.approveHash,
    burnTx: burnHash,
    mintTx: mintHash,
    approveExplorer: approval.approveHash ? fromInfo.explorer + approval.approveHash : undefined,
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
  if (!router) throw new Error(`ArcoxRouter is not deployed for ${fromInfo.id}; refusing direct bridge without platform fee.`)
  const spender = router || fromInfo.tokenMessenger
  const mintRecipient = `0x${Buffer.from(recipientAta.toBuffer()).toString('hex')}`

  const approval = await ensureAllowance({
    sourceClient,
    fromInfo,
    owner,
    tokenAddress: fromInfo.usdc,
    spender,
    amount,
    deferMint: intent.deferMint,
  })
  if (!approval.confirmed) {
    return pendingBridgeStepResult({
      status: 'pending_approve',
      route: router ? 'arcox-router-solana' : 'direct-cctp-solana',
      router,
      fromInfo,
      toInfo,
      owner,
      amount: intent.amount,
      approveHash: approval.approveHash,
      solanaRecipient: solana.publicKey.toBase58(),
      safeNextStep: `Approve belum confirmed sebelum timeout MCP. Jalankan ulang bridge setelah approve tx ${approval.approveHash} confirmed.`,
    })
  }
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
  const burnReceipt = await waitForReceipt(sourceClient, burnHash, intent.deferMint ? BRIDGE_RECEIPT_WAIT_MS : 0)
  if (!burnReceipt) {
    return pendingBridgeStepResult({
      status: 'pending_burn',
      route: router ? 'arcox-router-solana' : 'direct-cctp-solana',
      router,
      fromInfo,
      toInfo,
      owner,
      amount: intent.amount,
      approveHash: approval.approveHash,
      burnHash,
      solanaRecipient: solana.publicKey.toBase58(),
      safeNextStep: `Burn belum confirmed sebelum timeout MCP. Jalankan ulang status/retry setelah burn confirmed; auto-mint worker belum dijadwalkan.`,
    })
  }
  if (intent.deferMint) {
    const attestation = await waitAttestationBeforeAutoMint(fromInfo, burnHash)
    if (attestation) {
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
        approveTx: approval.approveHash,
        burnTx: burnHash,
        mintTx,
        approveExplorer: approval.approveHash ? fromInfo.explorer + approval.approveHash : undefined,
        burnExplorer: fromInfo.explorer + burnHash,
        mintExplorer: `https://explorer.solana.com/tx/${mintTx}?cluster=devnet`,
        safeNextStep: 'Attestation siap dalam 20 detik; Solana mint selesai tanpa auto-mint worker.',
      }
    }
    return pendingBridgeMintResult({
      route: router ? 'arcox-router-solana' : 'direct-cctp-solana',
      router,
      fromInfo,
      toInfo,
      owner,
      solanaRecipient: solana.publicKey.toBase58(),
      amount: intent.amount,
      approveHash: approval.approveHash,
      burnHash,
      safeNextStep: `Burn selesai. Attestation belum siap setelah ${Math.round(AUTO_MINT_GRACE_WAIT_MS / 1000)} detik; agent auto-mint worker baru dijadwalkan untuk mint ke Solana.`,
    })
  }
  const attestation = await pollAttestation(fromInfo.domain, burnHash, fromInfo, {
    maxWaitMs: intent.maxAttestationWaitMs,
    returnNullOnTimeout: Boolean(intent.maxAttestationWaitMs),
  })
  if (!attestation) {
    return pendingBridgeMintResult({
      route: router ? 'arcox-router-solana' : 'direct-cctp-solana',
      router,
      fromInfo,
      toInfo,
      owner,
      solanaRecipient: solana.publicKey.toBase58(),
      amount: intent.amount,
      approveHash: approval.approveHash,
      burnHash,
      safeNextStep: `Attestation belum siap sebelum timeout MCP. Agent auto-mint worker dijadwalkan setelah grace wait attestation.`,
    })
  }
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
    approveTx: approval.approveHash,
    burnTx: burnHash,
    mintTx,
    approveExplorer: approval.approveHash ? fromInfo.explorer + approval.approveHash : undefined,
    burnExplorer: fromInfo.explorer + burnHash,
    mintExplorer: `https://explorer.solana.com/tx/${mintTx}?cluster=devnet`,
  }
}

async function executeSolanaToEvm(intent, owner, fromInfo, toInfo) {
  if (toInfo.solana) throw new Error('Solana to Solana bridge is not supported.')
  const solana = solanaKeypair()
  const destinationClient = clientFor(toInfo)
  const burn = await burnSolanaUsdc(intent.amount, owner, solana)
  const burnHash = burn.sig
  if (intent.deferMint) {
    const attestation = await waitAttestationBeforeAutoMint(fromInfo, burnHash)
    if (attestation) {
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
        platformFee: burn.platformFee,
        estimatedReceive: burn.netAmount,
        feeBps: burn.feeBps,
        feeTreasury: burn.treasury,
        burnTx: burnHash,
        mintTx: mintHash,
        burnExplorer: `https://explorer.solana.com/tx/${burnHash}?cluster=devnet`,
        mintExplorer: toInfo.explorer + mintHash,
        safeNextStep: 'Attestation siap dalam 20 detik; mint selesai tanpa auto-mint worker.',
      }
    }
    return pendingBridgeMintResult({
      route: 'direct-cctp-solana',
      router: null,
      fromInfo,
      toInfo,
      owner,
      amount: intent.amount,
      burnHash,
      burnExplorer: `https://explorer.solana.com/tx/${burnHash}?cluster=devnet`,
      solanaRecipient: solana.publicKey.toBase58(),
      safeNextStep: `Burn Solana selesai dengan platform fee ${burn.platformFee} USDC. Attestation belum siap setelah ${Math.round(AUTO_MINT_GRACE_WAIT_MS / 1000)} detik; agent auto-mint worker baru dijadwalkan.`,
    })
  }
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
    platformFee: burn.platformFee,
    estimatedReceive: burn.netAmount,
    feeBps: burn.feeBps,
    feeTreasury: burn.treasury,
    burnTx: burnHash,
    mintTx: mintHash,
    burnExplorer: `https://explorer.solana.com/tx/${burnHash}?cluster=devnet`,
    mintExplorer: toInfo.explorer + mintHash,
  }
}

function pendingBridgeMintResult({ route, router, fromInfo, toInfo, owner, amount, approveHash, burnHash, burnExplorer, solanaRecipient, safeNextStep }) {
  const autoMint = scheduleAutoMint({ burnTx: burnHash, fromInfo, toInfo, owner })
  return {
    status: 'auto_mint_scheduled',
    action: 'bridge',
    route,
    router: router || null,
    from: fromInfo.id,
    to: toInfo.id,
    owner,
    solanaRecipient,
    amount,
    token: 'USDC',
    approveTx: approveHash,
    burnTx: burnHash,
    approveExplorer: approveHash ? fromInfo.explorer + approveHash : undefined,
    burnExplorer: burnExplorer || fromInfo.explorer + burnHash,
    autoMint,
    safeNextStep,
  }
}

function pendingBridgeStepResult({ status, route, router, fromInfo, toInfo, owner, amount, approveHash, burnHash, solanaRecipient, safeNextStep }) {
  return {
    status,
    action: 'bridge',
    route,
    router: router || null,
    from: fromInfo.id,
    to: toInfo.id,
    owner,
    solanaRecipient,
    amount,
    token: 'USDC',
    approveTx: approveHash,
    burnTx: burnHash,
    approveExplorer: approveHash ? fromInfo.explorer + approveHash : undefined,
    burnExplorer: burnHash ? fromInfo.explorer + burnHash : undefined,
    autoMint: null,
    safeNextStep,
  }
}

export async function retryBridgeMint({ burnTx, fromChain, toChain }, owner) {
  const fromInfo = cctpChains[fromChain]
  const toInfo = cctpChains[toChain]
  if (!fromInfo || !toInfo) throw new Error('Unsupported retry route. Use Arc, Ethereum Sepolia, Base Sepolia, Arbitrum Sepolia, HyperEVM Testnet, or Solana Devnet.')
  if (fromInfo.id === toInfo.id) throw new Error('Retry source and destination must be different.')
  if (fromInfo.solana && !/^[1-9A-HJ-NP-Za-km-z]{32,88}$/.test(burnTx || '')) throw new Error('Missing valid Solana burn tx signature.')
  if (!fromInfo.solana && !/^0x[0-9a-fA-F]{64}$/.test(burnTx || '')) throw new Error('Missing valid EVM burn tx 0x...')

  console.error(`[retry-bridge] poll attestation for ${burnTx}`)
  const attestation = await pollAttestation(fromInfo.domain, burnTx, fromInfo)

  if (toInfo.solana) {
    const solana = solanaKeypair()
    const mintTx = await signSolanaReceiveMessage(attestation.attestation, attestation.message, solana)
    return {
      status: 'submitted',
      action: 'retry-bridge',
      owner,
      from: fromInfo.id,
      to: toInfo.id,
      solanaRecipient: solana.publicKey.toBase58(),
      burnTx,
      mintTx,
      mintExplorer: `https://explorer.solana.com/tx/${mintTx}?cluster=devnet`,
    }
  }

  console.error(`[retry-bridge] mint on ${toInfo.id}`)
  const destinationClient = clientFor(toInfo)
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

async function autoMintBridge() {
  const burnTx = arg('burn-tx')
  const fromChain = normalizeChainName(arg('from-chain')) || arg('from-chain')
  const toChain = normalizeChainName(arg('to-chain')) || arg('to-chain')
  const owner = arg('owner') || wallet().account.address
  const delayMs = Number(arg('delay-ms') || '0')
  if (delayMs > 0) await sleep(delayMs)
  const jobId = autoMintJobId(burnTx)
  writeAutoMintStatus(jobId, {
    status: 'running',
    action: 'auto-mint-bridge',
    owner,
    burnTx,
    from: fromChain,
    to: toChain,
  })
  try {
    const result = await retryBridgeMint({ burnTx, fromChain, toChain }, owner)
    const rec = updateAgentHistoryByBurnTx(burnTx, {
      status: 'success',
      action: 'bridge',
      source: 'agent-mcp',
      from: fromChain,
      to: toChain,
      mintTx: result.mintTx,
      mintExplorerUrl: result.mintExplorer,
      note: 'Auto-mint completed by agent worker.',
    }, owner)
    await pushBackendHistory(owner, rec)
    writeAutoMintStatus(jobId, {
      status: 'complete',
      action: 'auto-mint-bridge',
      owner,
      burnTx,
      from: fromChain,
      to: toChain,
      result,
    })
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    if (isRecoverableAutoMintError(error)) {
      const next = rescheduleAutoMintAfterFailure({ jobId, burnTx, fromChain, toChain, owner, error })
      console.log(JSON.stringify(next, null, 2))
      return
    }
    writeAutoMintStatus(jobId, {
      status: 'error',
      action: 'auto-mint-bridge',
      owner,
      burnTx,
      from: fromChain,
      to: toChain,
      error: error.message,
    })
    throw error
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
  const tokenIn = normalizeArcTokenKey(intent.tokenIn || 'USDC')
  const tokenOut = normalizeArcTokenKey(intent.tokenOut || '', '')
  const apiTokenIn = apiArcTokenKey(tokenIn)
  const apiTokenOut = apiArcTokenKey(tokenOut, '')
  const source = String(intent.source || intent.walletSource || 'eoa').toLowerCase() === 'circle' ? 'circle' : 'eoa'
  if (!intent.amount || Number(intent.amount) <= 0) throw new Error('Swap command needs amount, example: swap 10 USDC to EURC')
  if (!ARC_TOKENS[tokenIn]) throw new Error(`Unsupported swap input token: ${tokenIn}`)
  if (!ARC_TOKENS[tokenOut]) throw new Error('Swap command needs output token, example: swap 10 USDC to EURC')
  if (tokenIn === tokenOut) throw new Error('Swap input and output token must be different.')

  const account = privateKeyToAccount(privateKey())
  const token = await backendSession(account)
  const walletData = source === 'circle' ? await postJson('/api/wallet', { metamaskAddress: owner }, token) : null
  let quote
  try {
    quote = await postJson(source === 'circle' ? '/api/quote' : '/api/eoa-swap-quote', {
      metamaskAddress: owner,
      tokenIn: apiTokenIn,
      tokenOut: apiTokenOut,
      amountIn: intent.amount,
    }, token)
  } catch (error) {
    quote = swapRouteUnavailableQuote(error)
    if (!quote) throw error
  }
  if (quote.available === false) {
    return {
      status: 'route_unavailable',
      action: 'swap',
      source: source === 'circle' ? 'circle-wallet-proxy' : 'eoa-agent-wallet',
      owner,
      tokenIn,
      tokenOut,
      wallet: walletData?.wallet,
      quote,
    }
  }
  if (source === 'eoa') return executeEoaPreparedSwap({ owner, tokenIn, tokenOut, apiTokenIn, apiTokenOut, amount: intent.amount, quote, authToken: token })
  let swap
  try {
    swap = await withTimeout(
      postJson('/api/swap', { metamaskAddress: owner, tokenIn: apiTokenIn, tokenOut: apiTokenOut, amountIn: intent.amount }, token, SWAP_EXECUTION_TIMEOUT_MS),
      SWAP_EXECUTION_TIMEOUT_MS,
      `Circle swap backend did not respond within ${SWAP_EXECUTION_TIMEOUT_MS}ms. Check balances/history before retrying.`,
    )
  } catch (error) {
    return {
      status: 'pending_backend',
      action: 'swap',
      source: 'circle-wallet-proxy',
      owner,
      tokenIn,
      tokenOut,
      wallet: walletData.wallet,
      quote,
      error: error.message,
      safeNextStep: 'Do not repeat the swap immediately. Check wallet balances and transaction history first; backend/Circle may still be processing.',
    }
  }
  return {
    status: 'submitted',
    action: 'swap',
    source: 'circle-wallet-proxy',
    owner,
    tokenIn,
    tokenOut,
    wallet: walletData.wallet,
    quote,
    result: swap.result,
    note: 'Circle wallet swap is executed by backend proxy wallet after local agent signs ARCOX login message.',
  }
}

async function executeEoaPreparedSwap({ owner, tokenIn, tokenOut, apiTokenIn, apiTokenOut, amount, quote, authToken }) {
  const { walletClient } = wallet()
  const prepared = await postJson('/api/eoa-swap-prepare', {
    metamaskAddress: owner,
    tokenIn: apiTokenIn,
    tokenOut: apiTokenOut,
    amountIn: amount,
  }, authToken, SWAP_EXECUTION_TIMEOUT_MS)
  const adapterContract = getAddress(prepared.adapterContract || ARC_APPKIT_ADAPTER)
  const tokenInAddress = getAddress(prepared.tokenInAddress || ARC_TOKENS[tokenIn].address)
  const amountBaseUnits = BigInt(prepared.amountBaseUnits)
  const approveTx = await walletClient.writeContract({
    address: tokenInAddress,
    abi: erc20Abi,
    functionName: 'approve',
    args: [adapterContract, amountBaseUnits],
  })
  await publicClient.waitForTransactionReceipt({ hash: approveTx })
  const executionParams = normalizeAdapterExecutionParams(prepared.executionParams)
  const tokenInputs = [{
    permitType: 0,
    token: tokenInAddress,
    amount: amountBaseUnits,
    permitCalldata: '0x',
  }]
  const data = encodeFunctionData({
    abi: adapterExecuteAbi,
    functionName: 'execute',
    args: [executionParams, tokenInputs, prepared.signature],
  })
  const gas = prepared.gasLimit ? (BigInt(prepared.gasLimit) * 120n) / 100n : undefined
  const swapTx = await walletClient.sendTransaction({
    to: adapterContract,
    data,
    ...(gas ? { gas } : {}),
  })
  await publicClient.waitForTransactionReceipt({ hash: swapTx })
  let feeTx = ''
  let platformFeeError = ''
  const feeAmount = String(prepared.platformFee?.amount || '0')
  const feeUnits = parseUnits(feeAmount, ARC_TOKENS[tokenIn].decimals)
  if (feeUnits > 0n) {
    try {
      feeTx = await walletClient.writeContract({
        address: tokenInAddress,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [getAddress(prepared.platformFee?.treasury || process.env.ARCOX_FEE_TREASURY || owner), feeUnits],
      })
      await publicClient.waitForTransactionReceipt({ hash: feeTx })
    } catch (error) {
      platformFeeError = error.message
    }
  }
  return {
    status: 'submitted',
    action: 'swap',
    source: 'eoa-agent-wallet',
    route: 'circle-stablecoin-service-adapter',
    owner,
    tokenIn,
    tokenOut,
    quote,
    approveTx,
    result: {
      txHash: swapTx,
      transactionHash: swapTx,
      explorerUrl: EXPLORER_TX + swapTx,
      tokenIn,
      tokenOut,
      amountIn: prepared.amountIn,
      amountOut: prepared.amountOut,
      grossAmountIn: prepared.grossAmountIn,
      platformFee: {
        ...prepared.platformFee,
        txHash: feeTx || undefined,
        error: platformFeeError || undefined,
      },
    },
    note: platformFeeError
      ? `EOA swap executed through Circle Stablecoin Service adapter, but platform fee transfer failed: ${platformFeeError}`
      : 'EOA swap executed through Circle Stablecoin Service adapter with local AGENT_PRIVATE_KEY signer.',
  }
}

function normalizeAdapterExecutionParams(params = {}) {
  return {
    instructions: (params.instructions || []).map(item => ({
      target: getAddress(item.target),
      data: item.data,
      value: BigInt(item.value),
      tokenIn: getAddress(item.tokenIn),
      amountToApprove: BigInt(item.amountToApprove),
      tokenOut: getAddress(item.tokenOut),
      minTokenOut: BigInt(item.minTokenOut),
    })),
    tokens: (params.tokens || []).map(item => ({
      token: getAddress(item.token),
      beneficiary: getAddress(item.beneficiary),
    })),
    execId: BigInt(params.execId),
    deadline: BigInt(params.deadline),
    metadata: params.metadata || '0x',
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
    approval_mode: 'MCP quote + previewId + explicit user confirmation',
    note: 'Private key stays in the local .env file. ARCOX DEX only receives status/metadata if you choose to report it.',
  }
  if (!hasFlag('yes')) {
    console.log(JSON.stringify({ ...preview, status: 'preview_only', next: 'Review this plan. Re-run with --yes to execute supported onchain actions.' }, null, 2))
    return
  }
  if (['send', 'bridge', 'swap'].includes(intent.action)) {
    console.log(JSON.stringify({
      ...preview,
      status: 'mcp_confirmation_required',
      safe_next_step: 'Value-moving ARCOX actions must use MCP quote first, then execute with confirmed=true and the exact previewId after explicit user confirmation.',
      blocked_action: intent.action,
    }, null, 2))
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
  return { address: account.address, arcGasUsdc: formatUnits(nativeBalance, 18), usdc: formatUnits(usdcBalance, 6), rpc: ARC_RPC, envSecurityWarnings: envSecurityWarnings() }
}

async function arcTokenBalances(address) {
  const out = {}
  for (const [sym, token] of Object.entries(ARC_TOKENS)) {
    const bal = await publicClient.readContract({ address: token.address, abi: erc20Abi, functionName: 'balanceOf', args: [address] }).catch(() => 0n)
    out[sym] = formatUnits(bal, token.decimals)
  }
  return out
}

export async function walletBalances() {
  const { account } = wallet()
  const solana = (() => {
    try { return solanaKeypair() } catch { return null }
  })()
  let circleWallet = null
  let circleBalances = {}
  try {
    const token = await backendSession(account)
    const walletData = await postJson('/api/wallet', { metamaskAddress: account.address }, token)
    circleWallet = walletData.wallet || null
    if (circleWallet?.address) {
      circleBalances = await getJson(`${ARCOX_BACKEND_URL}/api/balance/${circleWallet.address}`)
    }
  } catch (error) {
    circleBalances = { error: error.message }
  }
  const [nativeBalance, eoaBalances, solanaUsdc] = await Promise.all([
    publicClient.getBalance({ address: account.address }).catch(() => 0n),
    arcTokenBalances(account.address),
    solana ? solanaUsdcBalance(solana.publicKey).catch(error => ({ error: error.message })) : Promise.resolve(null),
  ])
  return {
    status: 'balances',
    owner: account.address,
    eoa: { address: account.address, arcGasUsdc: formatUnits(nativeBalance, 18), balances: eoaBalances },
    circle: { wallet: circleWallet, balances: circleBalances },
    solana: solana ? { address: solana.publicKey.toBase58(), usdc: solanaUsdc } : null,
  }
}

export async function quoteBridge(intent) {
  const { account } = wallet()
  const fromChain = normalizeChainName(intent.fromChain) || intent.fromChain
  const toChain = normalizeChainName(intent.toChain) || intent.toChain
  const source = String(intent.source || intent.walletSource || 'eoa').toLowerCase() === 'circle' ? 'circle' : 'eoa'
  const token = normalizeBridgeTokenKey(intent.token)
  if (!intent.amount || Number(intent.amount) <= 0) throw new Error('Bridge quote needs a positive amount.')
  const fromInfo = cctpChains[fromChain]
  const toInfo = cctpChains[toChain]
  if (!fromInfo || !toInfo) throw new Error('Unsupported bridge route.')
  if (fromInfo.id === toInfo.id) throw new Error('Bridge source and destination must be different.')
  if (source === 'circle' && fromInfo.id !== 'Arc_Testnet') throw new Error('Circle Wallet bridge source is only supported from Arc Testnet. Use source="eoa" for other source chains.')
  if (isNativeBridgeIntent(token, fromInfo, toInfo)) return quoteNativeBridgeRoute({ ...intent, token }, account.address, fromInfo, toInfo, source)
  if (token !== 'USDC') throw new Error('MCP bridge supports USDC, plus native ETH from Ethereum/Base Sepolia to Arc when a native router is deployed.')
  if (fromInfo.solana) {
    if (source === 'circle') throw new Error('Circle Wallet source is not available for Solana source routes.')
    const solana = solanaKeypair()
    const balance = await solanaUsdcBalance(solana.publicKey)
    const amountUnits = parseUnits(String(intent.amount), 6)
    const platformFee = splitPlatformFeeUnits(amountUnits)
    return {
      status: 'quote',
      action: 'bridge',
      source: 'solana-agent-wallet',
      owner: account.address,
      solanaOwner: solana.publicKey.toBase58(),
      solanaSourceAta: balance.ata,
      from: fromInfo.id,
      to: toInfo.id,
      token: 'USDC',
      amount: String(intent.amount),
      balance: balance.amount,
      platformFee: formatUnits(platformFee.feeUnits, 6),
      estimatedReceive: formatUnits(platformFee.netUnits, 6),
      feeBps: platformFee.feeBps,
      feeTreasury: SOLANA_FEE_TREASURY,
      supported: Number(balance.amount) >= Number(intent.amount),
      terminalExecution: 'supported_with_local_solana_signer',
      approvalRequired: true,
      safeNextStep: 'Ask the user to confirm before calling arcox_execute_bridge with confirmed=true. Solana source routes should complete burn, attestation, and mint in the same MCP call.',
    }
  }
  const amount = parseUnits(String(intent.amount), 6)
  const sourceClient = clientFor(fromInfo)
  const router = routerFor(fromInfo.id)
  if (!router) throw new Error(`ArcoxRouter is not deployed for ${fromInfo.id}; refusing direct bridge without platform fee.`)
  const solanaRecipient = toInfo.solana ? solanaKeypair().publicKey.toBase58() : null
  const [eoaBalance, routerQuote] = await Promise.all([
    sourceClient.readContract({ address: fromInfo.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] }).catch(() => 0n),
    router
      ? sourceClient.readContract({ address: router, abi: arcoxRouterAbi, functionName: 'quoteFee', args: [amount] }).catch(() => null)
      : Promise.resolve(null),
  ])
  let balance = eoaBalance
  let circleWallet = null
  if (source === 'circle') {
    const authToken = await backendSession(account)
    const walletData = await postJson('/api/wallet', { metamaskAddress: account.address }, authToken)
    circleWallet = walletData.wallet || null
    if (circleWallet?.address) {
      const balances = await getJson(`${ARCOX_BACKEND_URL}/api/balance/${circleWallet.address}`).catch(() => ({}))
      balance = parseUnits(String(balances.USDC || '0'), 6)
    }
  }
  const fee = routerQuote ? BigInt(routerQuote[0] ?? 0) : 0n
  const netAmount = routerQuote ? BigInt(routerQuote[1] ?? amount) : amount
  return {
    status: 'quote',
    action: 'bridge',
    source: source === 'circle' ? 'circle-wallet-proxy' : 'eoa-agent-wallet',
    owner: account.address,
    circleWallet,
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
    solanaRecipientRequired: false,
    solanaRecipient,
    approvalRequired: true,
    safeNextStep: source === 'circle'
      ? 'Ask the user to confirm before calling arcox_execute_bridge with source="circle" and confirmed=true. Agent will first send USDC from Circle Wallet to EOA, then bridge from EOA.'
      : toInfo.solana
        ? 'Ask the user to confirm before calling arcox_execute_bridge with source="eoa" and confirmed=true. Fast CCTP routes should complete burn, attestation, and Solana mint in the same MCP call.'
        : fromInfo.fast
          ? 'Ask the user to confirm before calling arcox_execute_bridge with source="eoa" and confirmed=true. Fast CCTP routes should complete burn, attestation, and mint in the same MCP call.'
          : 'Ask the user to confirm before calling arcox_execute_bridge with source="eoa" and confirmed=true. Slow source routes may return auto_mint_scheduled while the background worker waits for attestation.',
  }
}

export async function quoteSend(intent) {
  const { account } = wallet()
  const source = String(intent.source || intent.walletSource || 'eoa').toLowerCase() === 'circle' ? 'circle' : 'eoa'
  const tokenKey = normalizeArcTokenKey(intent.token)
  const apiTokenKey = apiArcTokenKey(intent.token)
  const token = ARC_TOKENS[tokenKey]
  if (!token) throw new Error(`Unsupported Arc token: ${tokenKey}`)
  if (!intent.amount || Number(intent.amount) <= 0) throw new Error('Send quote needs a positive amount.')
  if (!intent.to || !/^0x[0-9a-fA-F]{40}$/.test(intent.to)) throw new Error('Send quote needs a valid EVM recipient.')
  if (source === 'circle') {
    const authToken = await backendSession(account)
    const walletData = await postJson('/api/wallet', { metamaskAddress: account.address }, authToken)
    const [circleBalances, estimate] = await Promise.all([
      getJson(`${ARCOX_BACKEND_URL}/api/balance/${walletData.wallet.address}`).catch(() => ({})),
      postJson('/api/send-estimate', { metamaskAddress: account.address, toAddress: getAddress(intent.to), amount: String(intent.amount), token: apiTokenKey, source: 'circle' }, authToken, SEND_ESTIMATE_TIMEOUT_MS).catch(error => ({ error: error.message })),
    ])
    const balance = circleBalances?.[apiTokenKey] || circleBalances?.[tokenKey] || '0'
    const to = getAddress(intent.to)
    const platformFee = estimate?.platformFee?.amount || '0'
    const recipientReceives = estimate?.recipientReceives || String(intent.amount)
    const networkFee = estimate?.fee || estimate?.estimatedFee || '0'
    const supported = Number(balance) >= Number(intent.amount)
    return {
      status: 'quote',
      action: 'send',
      source: 'circle-wallet-proxy',
      owner: account.address,
      from: walletData.wallet,
      to,
      token: tokenKey,
      amount: String(intent.amount),
      balance,
      platformFee,
      recipientReceives,
      networkFee,
      supported,
      approvalRequired: true,
      estimate,
      preview: sendPreviewDetails({
        source: 'circle',
        owner: account.address,
        from: walletData.wallet,
        to,
        token: tokenKey,
        amount: String(intent.amount),
        balance,
        platformFee,
        recipientReceives,
        networkFee,
        estimate,
        supported,
      }),
      safeNextStep: 'Ask the user to confirm before calling arcox_execute_send with source="circle" and confirmed=true.',
    }
  }
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
  const to = getAddress(intent.to)
  const balanceText = formatUnits(balance, token.decimals)
  const platformFee = formatUnits(fee, token.decimals)
  const recipientReceives = formatUnits(netAmount, token.decimals)
  const supported = balance >= amount
  return {
    status: 'quote',
    action: 'send',
    source: 'eoa-agent-wallet',
    owner: account.address,
    to,
    token: tokenKey,
    amount: String(intent.amount),
    balance: balanceText,
    router: router || null,
    platformFee,
    recipientReceives,
    supported,
    approvalRequired: true,
    preview: sendPreviewDetails({
      source: 'eoa',
      owner: account.address,
      from: account.address,
      to,
      token: tokenKey,
      amount: String(intent.amount),
      balance: balanceText,
      platformFee,
      recipientReceives,
      networkFee: 'wallet-signed gas',
      supported,
    }),
    safeNextStep: 'Ask the user to confirm before calling arcox_execute_send with source="eoa" and confirmed=true.',
  }
}

export async function quoteSwap(intent) {
  const tokenIn = normalizeArcTokenKey(intent.tokenIn || 'USDC')
  const tokenOut = normalizeArcTokenKey(intent.tokenOut || '', '')
  const apiTokenIn = apiArcTokenKey(tokenIn)
  const apiTokenOut = apiArcTokenKey(tokenOut, '')
  const amountIn = String(intent.amountIn || intent.amount || '')
  const source = String(intent.source || intent.walletSource || 'eoa').toLowerCase() === 'circle' ? 'circle' : 'eoa'
  if (!amountIn) throw new Error('Swap quote needs amountIn.')
  if (!ARC_TOKENS[tokenIn]) throw new Error(`Unsupported swap input token: ${tokenIn}`)
  if (!ARC_TOKENS[tokenOut]) throw new Error(`Unsupported swap output token: ${tokenOut}`)
  const { account } = wallet()
  const token = await backendSession(account)
  let quote
  try {
    quote = await postJson(source === 'circle' ? '/api/quote' : '/api/eoa-swap-quote', {
      metamaskAddress: account.address,
      tokenIn: apiTokenIn,
      tokenOut: apiTokenOut,
      amountIn,
    }, token)
  } catch (error) {
    quote = swapRouteUnavailableQuote(error)
    if (!quote) throw error
  }
  return {
    status: 'quote',
    action: 'swap',
    source: source === 'circle' ? 'circle-wallet-proxy' : 'eoa-agent-wallet',
    terminalExecution: source === 'eoa'
      ? 'Local AGENT_PRIVATE_KEY signs approve and Circle AppKit adapter execute transactions.'
      : 'ARCOX backend executes from the Circle proxy wallet after local login signature.',
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
  if (intent.mcpPreviewVerified !== true) throw new Error('MCP preview verification required before bridge execution.')
  const fromChain = normalizeChainName(intent.fromChain) || intent.fromChain
  const toChain = normalizeChainName(intent.toChain) || intent.toChain
  const { account } = wallet()
  const source = String(intent.source || intent.walletSource || 'eoa').toLowerCase() === 'circle' ? 'circle' : 'eoa'
  let prepareTx = ''
  let prepareExplorer = ''
  if (source === 'circle') {
    if (fromChain !== 'Arc_Testnet') throw new Error('Circle Wallet bridge source is only supported from Arc Testnet.')
    const authToken = await backendSession(account)
    const prepared = await postJson('/api/prepare-bridge', {
      metamaskAddress: account.address,
      amount: String(intent.amount),
      token: 'USDC',
    }, authToken)
    prepareTx = prepared.txHash || ''
    prepareExplorer = prepared.explorerUrl || (prepareTx ? EXPLORER_TX + prepareTx : '')
    if (prepareTx) await publicClient.waitForTransactionReceipt({ hash: prepareTx })
  }
  const result = await executeBridge({
    ...intent,
    token: normalizeBridgeTokenKey(intent.token),
    fromChain,
    toChain,
    maxAttestationWaitMs: intent.maxAttestationWaitMs || MCP_FAST_ATTESTATION_WAIT_MS,
  }, account.address)
  const rec = recordAgentHistory({
    action: 'bridge',
    from: result.from || fromChain,
    to: result.to || toChain,
    amount: String(intent.amount),
    token: result.token || 'USDC',
    status: result.status === 'submitted' ? 'success' : 'pending',
    walletSource: source,
    tx: prepareTx,
    explorer: prepareExplorer,
    approveTx: result.approveTx,
    burnTx: result.burnTx,
    burnExplorerUrl: result.burnExplorer,
    mintTx: result.mintTx,
    mintExplorerUrl: result.mintExplorer,
    note: source === 'circle'
      ? `Circle Wallet prepared to EOA before bridge. ${result.safeNextStep || result.route || ''}`
      : result.safeNextStep || result.route || '',
  }, account.address)
  await pushBackendHistory(account.address, rec)
  return result
}

export async function executeConfirmedSend(intent) {
  if (intent.confirmed !== true) return quoteSend(intent)
  if (intent.mcpPreviewVerified !== true) throw new Error('MCP preview verification required before send execution.')
  const { account } = wallet()
  const source = String(intent.source || intent.walletSource || 'eoa').toLowerCase() === 'circle' ? 'circle' : 'eoa'
  let result
  if (source === 'circle') {
    const tokenKey = normalizeArcTokenKey(intent.token)
    const apiTokenKey = apiArcTokenKey(intent.token)
    const authToken = await backendSession(account)
    const send = await postJson('/api/send', { metamaskAddress: account.address, toAddress: getAddress(intent.to), amount: String(intent.amount), token: apiTokenKey, source: 'circle' }, authToken, SEND_EXECUTION_TIMEOUT_MS)
    result = {
      status: 'submitted',
      action: 'send',
      source: 'circle-wallet-proxy',
      from: account.address,
      to: getAddress(intent.to),
      amount: String(intent.amount),
      token: tokenKey,
      result: send.result,
      platformFee: send.result?.platformFee,
      recipientReceives: send.result?.amount,
      tx: send.result?.txHash || send.result?.transactionHash,
      explorer: send.result?.explorerUrl,
    }
  } else {
    result = await executeSend({
    ...intent,
    token: normalizeArcTokenKey(intent.token),
    to: getAddress(intent.to),
  }, account.address)
  }
  const rec = recordAgentHistory({
    action: 'send',
    from: result.from || account.address,
    to: getAddress(intent.to),
    amount: String(intent.amount),
    token: result.token || intent.token || 'USDC',
    status: 'success',
    walletSource: source,
    approveTx: result.approveTx,
    tx: result.tx,
    explorer: result.explorer,
    note: source === 'circle' ? 'Send executed from Circle Wallet proxy by MCP agent.' : 'Send executed from EOA agent wallet by MCP agent.',
  }, account.address)
  await pushBackendHistory(account.address, rec)
  return result
}

export async function executeConfirmedSwap(intent) {
  if (intent.confirmed !== true) return quoteSwap(intent)
  if (intent.mcpPreviewVerified !== true) throw new Error('MCP preview verification required before swap execution.')
  const { account } = wallet()
  const source = String(intent.source || intent.walletSource || 'eoa').toLowerCase() === 'circle' ? 'circle' : 'eoa'
  const result = await executeSwap({
    ...intent,
    amount: String(intent.amountIn || intent.amount),
    source,
    tokenIn: String(intent.tokenIn || 'USDC').toUpperCase() === 'CIRBTC' ? 'CIRBTC' : String(intent.tokenIn || 'USDC').toUpperCase(),
    tokenOut: String(intent.tokenOut || '').toUpperCase() === 'CIRBTC' ? 'CIRBTC' : String(intent.tokenOut || '').toUpperCase(),
  }, account.address)
  const rec = recordAgentHistory({
    action: 'swap',
    from: result.result?.tokenIn || intent.tokenIn || 'USDC',
    to: result.result?.tokenOut || intent.tokenOut || '',
    amount: String(intent.amountIn || intent.amount),
    token: result.result?.tokenIn || intent.tokenIn || 'USDC',
    status: result.status === 'submitted' ? 'success' : 'pending',
    walletSource: source,
    approveTx: result.approveTx,
    tx: result.result?.txHash || result.result?.transactionHash,
    explorer: result.result?.explorerUrl,
    note: result.status === 'submitted'
      ? (source === 'circle' ? 'Swap executed from Circle Wallet proxy by MCP agent.' : 'Swap executed from EOA agent wallet by MCP agent.')
      : result.safeNextStep || result.error || 'Swap backend did not return a final transaction.',
  }, account.address)
  await pushBackendHistory(account.address, rec)
  return result
}

function paymentInvoiceSummary(invoice) {
  return {
    invoiceId: invoice.invoiceId,
    orderId: invoice.orderId,
    amount: invoice.amount,
    token: invoice.token,
    network: invoice.network,
    merchantAddress: invoice.merchantAddress,
    memo: invoice.memo,
    status: invoice.status,
    paymentUrl: invoice.paymentUrl,
    txHash: invoice.txHash,
    paidAt: invoice.paidAt,
    expiresAt: invoice.expiresAt,
    timeline: invoice.timeline || [],
  }
}

function assertPayableInvoice(invoice) {
  if (!invoice?.invoiceId) throw new Error('Invoice not found.')
  if (invoice.status === 'paid') throw new Error('Invoice already paid.')
  if (invoice.status === 'expired') throw new Error('Invoice expired.')
  if (invoice.status === 'cancelled' || invoice.status === 'failed') throw new Error(`Invoice status is ${invoice.status}.`)
  if (Date.now() > new Date(invoice.expiresAt).getTime()) throw new Error('Invoice expired.')
  if (invoice.token !== 'USDC' || invoice.network !== 'arc-testnet') throw new Error('Only USDC invoices on arc-testnet are supported.')
}

export async function createPaymentRequest(input = {}) {
  const invoice = await postJson('/api/invoices', {
    orderId: input.orderId,
    amount: String(input.amount || ''),
    token: input.token || 'USDC',
    network: input.network || 'arc-testnet',
    merchantAddress: getAddress(input.merchantAddress),
    memo: input.memo,
    expiresInMinutes: input.expiresInMinutes || 15,
  })
  return paymentInvoiceSummary(invoice)
}

export async function getPaymentRequest(input = {}) {
  const invoiceId = String(input.invoiceId || '')
  if (!invoiceId) throw new Error('invoiceId is required.')
  return paymentInvoiceSummary(await backendGet(`/api/invoices/${encodeURIComponent(invoiceId)}`))
}

export async function quotePaymentRequest(input = {}) {
  const invoice = await getPaymentRequest(input)
  assertPayableInvoice(invoice)
  const { account } = wallet()
  const balance = await publicClient.readContract({ address: ARC_USDC, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] }).catch(() => 0n)
  const amountUnits = parseUnits(invoice.amount, 6)
  return {
    ...invoice,
    payerAddress: account.address,
    payerUsdcBalance: formatUnits(balance, 6),
    supported: balance >= amountUnits,
    requiresUserConfirmation: true,
    feePolicy: 'No hidden ARCOX Pay invoice fee. Agent sends invoice amount directly to merchant address.',
    userMustCheck: [
      'Invoice id is correct.',
      'Merchant address is correct.',
      'Amount and token are correct.',
      'This action moves funds and cannot be reversed after execution.',
    ],
  }
}

export async function payPaymentRequest(input = {}) {
  if (input.confirmed !== true) return quotePaymentRequest(input)
  if (input.mcpPreviewVerified !== true) throw new Error('MCP preview verification required before invoice payment.')
  const invoice = await getPaymentRequest(input)
  assertPayableInvoice(invoice)
  if (input.amount && String(input.amount) !== String(invoice.amount)) throw new Error('Invoice amount changed after quote.')
  if (input.token && normalizeArcTokenKey(input.token) !== invoice.token) throw new Error('Invoice token changed after quote.')
  if (input.merchantAddress && getAddress(input.merchantAddress) !== invoice.merchantAddress) throw new Error('Invoice merchantAddress changed after quote.')
  const { account, walletClient } = wallet()
  const amountUnits = parseUnits(invoice.amount, 6)
  const balance = await publicClient.readContract({ address: ARC_USDC, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] }).catch(() => 0n)
  if (balance < amountUnits) throw new Error('Insufficient USDC balance for invoice payment.')
  const txHash = await walletClient.writeContract({
    address: ARC_USDC,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [getAddress(invoice.merchantAddress), amountUnits],
  })
  await patchJson(`/api/invoices/${encodeURIComponent(invoice.invoiceId)}`, { status: 'pending', txHash, payerAddress: account.address })
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 }).catch(() => null)
  const finalInvoice = receipt?.status === 'success'
    ? await postJson(`/api/invoices/${encodeURIComponent(invoice.invoiceId)}/mark-paid`, { txHash, payerAddress: account.address })
    : await getPaymentRequest({ invoiceId: invoice.invoiceId })
  const rec = recordAgentHistory({
    action: 'send',
    from: account.address,
    to: invoice.merchantAddress,
    amount: invoice.amount,
    token: invoice.token,
    status: receipt?.status === 'success' ? 'success' : 'pending',
    walletSource: 'eoa',
    tx: txHash,
    explorer: `${EXPLORER_TX}${txHash}`,
    note: `ARCOX Pay invoice ${invoice.invoiceId} paid by MCP agent.`,
  }, account.address)
  await pushBackendHistory(account.address, rec)
  return {
    status: receipt?.status === 'success' ? 'paid' : 'pending',
    invoice: paymentInvoiceSummary(finalInvoice),
    txHash,
    explorer: `${EXPLORER_TX}${txHash}`,
  }
}

export async function checkPaymentStatus(input = {}) {
  const invoiceId = String(input.invoiceId || '')
  if (!invoiceId) throw new Error('invoiceId is required.')
  return backendGet(`/api/invoices/${encodeURIComponent(invoiceId)}/status`)
}

export async function simulateCircleWebhook(input = {}) {
  return postJson('/api/dev/simulate-webhook', input)
}

export async function quoteEcoRoutePayment(input = {}) {
  return postJson('/api/eco/route-preview', input)
}

export async function payCreateNowpaymentsSandboxPayment(input = {}) {
  return payPostJson('/api/payments/nowpayments/create', {
    amount: input.amount,
    price_currency: input.price_currency || 'usd',
    pay_currency: input.pay_currency || 'usdcbase',
    order_id: input.order_id,
    description: input.description,
    user_id: input.user_id,
    case: input.case,
  })
}

export async function payGetPaymentStatus(input = {}) {
  const paymentId = String(input.payment_id || input.paymentId || '')
  if (!paymentId) throw new Error('payment_id is required.')
  return payGetJson(`/api/payments/nowpayments/${encodeURIComponent(paymentId)}/status`)
}

export async function paySimulateUserArcPayment(input = {}) {
  return payPostJson('/api/payments/nowpayments/simulate/user-arc-payment', {
    payment_id: input.payment_id || input.paymentId,
    user_wallet_address: input.user_wallet_address,
    amount: input.amount,
    arc_tx_hash: input.arc_tx_hash,
  })
}

export async function paySimulateBridgeToBase(input = {}) {
  return payPostJson('/api/payments/nowpayments/simulate/bridge-to-base', {
    payment_id: input.payment_id || input.paymentId,
    bridge_tx_hash: input.bridge_tx_hash,
  })
}

export async function paySimulateBaseTreasurySend(input = {}) {
  return payPostJson('/api/payments/nowpayments/simulate/base-treasury-send', {
    payment_id: input.payment_id || input.paymentId,
    base_tx_hash: input.base_tx_hash,
  })
}

export async function paySimulateNowpaymentsFinished(input = {}) {
  return payPostJson('/api/payments/nowpayments/simulate/finish', {
    payment_id: input.payment_id || input.paymentId,
  })
}

export async function paySimulateNowpaymentsStatus(input = {}) {
  return payPostJson('/api/payments/nowpayments/simulate', {
    payment_id: input.payment_id || input.paymentId,
    order_id: input.order_id,
    payment_status: input.payment_status,
  })
}

export async function payListRecentPayments(input = {}) {
  return payGetJson(`/api/payments/nowpayments/recent?limit=${encodeURIComponent(String(input.limit || 10))}`)
}

export async function intelQuoteWalletReport(input = {}) {
  const address = String(input.address || '').trim()
  if (!address) throw new Error('address is required.')
  return {
    action: 'arcox_intel_execute_wallet_report',
    address,
    resource: `/api/intel/report/address/${encodeURIComponent(address)}`,
    amount: process.env.ARCOX_INTEL_PRICE_REPORT_ADDRESS || '0.05',
    asset: 'USDC',
    network: 'arc-testnet',
    requiresUserConfirmation: true,
    instruction: 'This Arkham analysis costs 0.05 USDC on Arc. Continue?',
    backend: ARCOX_API_BASE_URL,
    arkhamApiKeyStoredInMcp: false,
  }
}

export async function intelExecuteWalletReport(input = {}) {
  if (input.confirmed !== true || !isSimpleConfirmationText(input.confirmationText)) {
    return intelQuoteWalletReport(input)
  }
  const address = String(input.address || '').trim()
  if (!address) throw new Error('address is required.')
  return arcoxApiGetJson(`/api/intel/report/address/${encodeURIComponent(address)}`, { mockPaid: true }, 60_000)
}

export async function intelGetAddress(input = {}) {
  const address = String(input.address || '').trim()
  if (!address) throw new Error('address is required.')
  return arcoxApiGetJson(`/api/intel/address/${encodeURIComponent(address)}`, { mockPaid: Boolean(input.mockPaid) })
}

export async function intelGetTx(input = {}) {
  const hash = String(input.hash || input.txHash || '').trim()
  if (!hash) throw new Error('hash is required.')
  return arcoxApiGetJson(`/api/intel/tx/${encodeURIComponent(hash)}`, { mockPaid: Boolean(input.mockPaid) })
}

export async function intelGetContract(input = {}) {
  const chain = String(input.chain || '').trim()
  const address = String(input.address || '').trim()
  if (!chain || !address) throw new Error('chain and address are required.')
  return arcoxApiGetJson(`/api/intel/contract/${encodeURIComponent(chain)}/${encodeURIComponent(address)}`, { mockPaid: Boolean(input.mockPaid) })
}

export async function intelGetEntity(input = {}) {
  const entity = String(input.entity || '').trim()
  if (!entity) throw new Error('entity is required.')
  return arcoxApiGetJson(`/api/intel/entity/${encodeURIComponent(entity)}`, { mockPaid: Boolean(input.mockPaid) })
}

export async function intelGetToken(input = {}) {
  const token = String(input.token || input.id || '').trim()
  if (!token) throw new Error('token is required.')
  return arcoxApiGetJson(`/api/intel/token/${encodeURIComponent(token)}`, { mockPaid: Boolean(input.mockPaid) })
}

export async function intelSearch(input = {}) {
  const query = String(input.q || input.query || '').trim()
  if (!query) throw new Error('query is required.')
  return arcoxApiGetJson(`/api/intel/search?q=${encodeURIComponent(query)}`, { mockPaid: Boolean(input.mockPaid) })
}

function isSimpleConfirmationText(value) {
  return ['yes', 'ya', 'y', 'confirm', 'konfirmasi', 'lanjut', 'ok', 'oke'].includes(String(value || '').trim().toLowerCase())
}

function readAutoMintStatuses() {
  const autoMint = []
  try {
    if (existsSync(AUTO_MINT_DIR)) {
      for (const file of readdirSync(AUTO_MINT_DIR)) {
        if (!file.endsWith('.json')) continue
        try {
          const item = JSON.parse(readFileSync(join(AUTO_MINT_DIR, file), 'utf8'))
          autoMint.push(item)
        } catch {}
      }
    }
  } catch {}
  return autoMint
}

function findByBurnTx(items, burnTx) {
  const target = String(burnTx || '').toLowerCase()
  if (!target) return null
  return items.find(item => String(item?.burnTx || '').toLowerCase() === target) || null
}

function mergeHistoryById(localHistory, remoteHistory) {
  const byId = new Map()
  for (const item of [...localHistory, ...remoteHistory]) {
    if (!item?.id) continue
    byId.set(item.id, item)
  }
  return [...byId.values()].sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0)).slice(0, 100)
}

function syncCompletedAutoMintStatus(job, completed) {
  if (!job?.burnTx || !completed?.mintTx) return job
  const next = {
    ...job,
    status: job.result?.mintTx ? 'complete' : 'complete_external',
    result: {
      ...(job.result || {}),
      status: 'submitted',
      action: job.action || 'auto-mint-bridge',
      owner: completed.owner || job.owner,
      from: completed.from || job.from,
      to: completed.to || job.to,
      burnTx: completed.burnTx || job.burnTx,
      mintTx: completed.mintTx,
      mintExplorer: completed.mintExplorerUrl || completed.mintExplorer || job.result?.mintExplorer,
    },
    note: job.result?.mintTx ? job.note : 'Mint completed outside auto-mint worker; status synchronized from backend history.',
  }
  return writeAutoMintStatus(autoMintJobId(job.burnTx), next)
}

function recoverStaleAutoMint(job) {
  if (!job?.burnTx || !['scheduled', 'running', 'rescheduled'].includes(job.status)) return job
  const updatedAt = Date.parse(job.updatedAt || '')
  if (!Number.isFinite(updatedAt) || Date.now() - updatedAt < AUTO_MINT_STALE_MS) return job
  const recoveries = Number(job.recoveries || 0)
  if (recoveries >= AUTO_MINT_MAX_RECOVERIES) return { ...job, status: 'stale', safeNextStep: 'Auto-mint worker reached recovery limit. Use retry bridge with the burn tx.' }
  const pid = spawnAutoMintWorker({ burnTx: job.burnTx, from: job.from, to: job.to, owner: job.owner })
  const next = {
    ...job,
    status: 'rescheduled',
    recoveries: recoveries + 1,
    lastRecoveryAt: new Date().toISOString(),
    pid,
  }
  return writeAutoMintStatus(autoMintJobId(job.burnTx), next)
}

async function syncAutoMintHistory() {
  const history = readAgentHistory()
  const owner = history.find(item => item.owner)?.owner || (() => {
    try { return wallet().account.address } catch { return '' }
  })()
  const remoteHistory = await pullBackendHistory(owner)
  let autoMint = readAutoMintStatuses()
  let changed = false
  const localWithRemote = history.map(item => {
    const remote = findByBurnTx(remoteHistory, item.burnTx)
    if (remote?.status === 'success' && remote.mintTx && item.status !== 'success') {
      changed = true
      return {
        ...item,
        status: 'success',
        mintTx: remote.mintTx,
        mintExplorerUrl: remote.mintExplorerUrl || remote.mintExplorer,
        note: remote.note || `${item.note || ''}\nMint completed and synchronized from backend history.`,
        error: '',
      }
    }
    return item
  })
  autoMint = autoMint.map(job => {
    const remote = findByBurnTx(remoteHistory, job.burnTx)
    if (remote?.status === 'success' && remote.mintTx) return syncCompletedAutoMintStatus(job, remote)
    return recoverStaleAutoMint(job)
  })
  const merged = localWithRemote.map(item => {
    const status = autoMint.find(job => String(job.burnTx || '').toLowerCase() === String(item.burnTx || '').toLowerCase())
    if (!status?.result?.mintTx || item.status === 'success') return item
    changed = true
    const updated = {
      ...item,
      status: 'success',
      mintTx: status.result.mintTx,
      mintExplorerUrl: status.result.mintExplorer,
      note: `${item.note || ''}\nAuto-mint completed by agent worker.`,
    }
    pushBackendHistory(updated.owner || status.owner || '', updated)
    return updated
  })
  const finalHistory = mergeHistoryById(merged, remoteHistory.filter(item => item.source === 'agent-mcp'))
  if (changed || finalHistory.length !== history.length) writeAgentHistory(finalHistory)
  return { history: finalHistory, autoMint }
}

export async function transactionHistory() {
  const { history, autoMint } = await syncAutoMintHistory()
  return { status: 'history', source: 'agent-local', history, autoMint }
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
    if (req.method === 'GET' && req.url === '/history') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify(await transactionHistory(), null, 2))
    }
    if (req.method === 'GET' && req.url === '/balances') {
      try {
        const balances = await walletBalances()
        res.writeHead(200, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify(balances, null, 2))
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ error: e.message }))
      }
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
  if (cmd === 'auto-mint-bridge') return autoMintBridge()
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
