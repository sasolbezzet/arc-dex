import {
  createPublicClient,
  createWalletClient,
  custom,
  decodeEventLog,
  defineChain,
  erc20Abi,
  formatUnits,
  getAddress,
  http,
  keccak256,
  parseUnits,
  toHex,
  type Address,
  type Hex,
  type Log,
} from 'viem'
import { ARC_TESTNET_EXPLORER_TX, switchToArcTestnet } from '../domain/arcNetwork'

type EthereumProvider = Parameters<typeof custom>[0]
type ContractJob = readonly [bigint, string, string, string, string, bigint, bigint, number, string] & Partial<{
  id: bigint
  client: string
  provider: string
  evaluator: string
  description: string
  budget: bigint
  expiredAt: bigint
  status: number
  hook: string
}>

export const AGENTIC_COMMERCE_CONTRACT = '0x0747EEf0706327138c69792bF28Cd525089e4583' as Address
export const IDENTITY_REGISTRY = '0x8004A818BFB912233c491871b3d84c89A494BD9e' as Address
export const ARC_USDC = '0x3600000000000000000000000000000000000000' as Address

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address

const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.arc.network/'] } },
  blockExplorers: { default: { name: 'ArcScan', url: 'https://testnet.arcscan.app' } },
})

const publicClient = createPublicClient({ chain: arcTestnet, transport: http() })

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
  {
    type: 'function',
    name: 'setBudget',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'jobId', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
      { name: 'optParams', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'fund',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'jobId', type: 'uint256' },
      { name: 'optParams', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'submit',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'jobId', type: 'uint256' },
      { name: 'deliverable', type: 'bytes32' },
      { name: 'optParams', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'complete',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'jobId', type: 'uint256' },
      { name: 'reason', type: 'bytes32' },
      { name: 'optParams', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'getJob',
    stateMutability: 'view',
    inputs: [{ name: 'jobId', type: 'uint256' }],
    outputs: [
      {
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
      },
    ],
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
] as const

const identityAbi = [
  {
    type: 'function',
    name: 'register',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'metadataURI', type: 'string' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'ownerOf',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'tokenURI',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { indexed: true, name: 'from', type: 'address' },
      { indexed: true, name: 'to', type: 'address' },
      { indexed: true, name: 'tokenId', type: 'uint256' },
    ],
    anonymous: false,
  },
] as const

export const JOB_STATUS = ['Open', 'Funded', 'Submitted', 'Completed', 'Rejected', 'Expired'] as const

export type AgenticJob = {
  id: string
  client: string
  provider: string
  evaluator: string
  description: string
  budget: string
  expiredAt: number
  status: string
  hook: string
}

async function getWalletClient(account: string) {
  const ethereum = (window as Window & { ethereum?: EthereumProvider }).ethereum
  if (!ethereum) throw new Error('MetaMask tidak terdeteksi.')
  await switchToArcTestnet()
  return createWalletClient({
    account: getAddress(account) as Address,
    chain: arcTestnet,
    transport: custom(ethereum),
  })
}

function explorer(hash: Hex) {
  return `${ARC_TESTNET_EXPLORER_TX}${hash}`
}

function parseJobId(logs: readonly Log[]) {
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({ abi: agenticCommerceAbi, data: log.data, topics: log.topics })
      if (decoded.eventName === 'JobCreated') return decoded.args.jobId.toString()
    } catch {
      continue
    }
  }
  throw new Error('JobCreated event tidak ditemukan.')
}

function parseAgentId(logs: readonly Log[], owner: string) {
  const normalizedOwner = getAddress(owner)
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({ abi: identityAbi, data: log.data, topics: log.topics })
      if (decoded.eventName === 'Transfer' && getAddress(decoded.args.to) === normalizedOwner) {
        return decoded.args.tokenId.toString()
      }
    } catch {
      continue
    }
  }
  throw new Error('Transfer event agent tidak ditemukan.')
}

export function hashTextBytes32(text: string): Hex {
  return keccak256(toHex(text || 'arcox-agentic-deliverable'))
}

export async function registerAgent(account: string, metadataUri: string) {
  const walletClient = await getWalletClient(account)
  const hash = await walletClient.writeContract({
    address: IDENTITY_REGISTRY,
    abi: identityAbi,
    functionName: 'register',
    args: [metadataUri],
  })
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  const agentId = parseAgentId(receipt.logs, account)
  return { hash, explorerUrl: explorer(hash), agentId }
}

export async function readAgent(agentId: string) {
  const id = BigInt(agentId)
  const [owner, metadataUri] = await Promise.all([
    publicClient.readContract({ address: IDENTITY_REGISTRY, abi: identityAbi, functionName: 'ownerOf', args: [id] }),
    publicClient.readContract({ address: IDENTITY_REGISTRY, abi: identityAbi, functionName: 'tokenURI', args: [id] }),
  ])
  return { owner, metadataUri }
}

export async function createAgenticJob(args: { account: string; provider: string; evaluator: string; description: string; expiresInHours: number }) {
  const walletClient = await getWalletClient(args.account)
  const expiredAt = BigInt(Math.floor(Date.now() / 1000) + Math.max(1, args.expiresInHours) * 3600)
  const hash = await walletClient.writeContract({
    address: AGENTIC_COMMERCE_CONTRACT,
    abi: agenticCommerceAbi,
    functionName: 'createJob',
    args: [getAddress(args.provider) as Address, getAddress(args.evaluator) as Address, expiredAt, args.description, ZERO_ADDRESS],
  })
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  return { hash, explorerUrl: explorer(hash), jobId: parseJobId(receipt.logs) }
}

export async function setJobBudget(account: string, jobId: string, amountUsdc: string) {
  const walletClient = await getWalletClient(account)
  const hash = await walletClient.writeContract({
    address: AGENTIC_COMMERCE_CONTRACT,
    abi: agenticCommerceAbi,
    functionName: 'setBudget',
    args: [BigInt(jobId), parseUnits(amountUsdc, 6), '0x'],
  })
  await publicClient.waitForTransactionReceipt({ hash })
  return { hash, explorerUrl: explorer(hash) }
}

export async function approveAndFundJob(account: string, jobId: string, amountUsdc: string) {
  const walletClient = await getWalletClient(account)
  const amount = parseUnits(amountUsdc, 6)
  const approveHash = await walletClient.writeContract({
    address: ARC_USDC,
    abi: erc20Abi,
    functionName: 'approve',
    args: [AGENTIC_COMMERCE_CONTRACT, amount],
  })
  await publicClient.waitForTransactionReceipt({ hash: approveHash })
  const fundHash = await walletClient.writeContract({
    address: AGENTIC_COMMERCE_CONTRACT,
    abi: agenticCommerceAbi,
    functionName: 'fund',
    args: [BigInt(jobId), '0x'],
  })
  await publicClient.waitForTransactionReceipt({ hash: fundHash })
  return { approveHash, fundHash, explorerUrl: explorer(fundHash) }
}

export async function submitDeliverable(account: string, jobId: string, deliverableText: string) {
  const walletClient = await getWalletClient(account)
  const deliverableHash = hashTextBytes32(deliverableText)
  const hash = await walletClient.writeContract({
    address: AGENTIC_COMMERCE_CONTRACT,
    abi: agenticCommerceAbi,
    functionName: 'submit',
    args: [BigInt(jobId), deliverableHash, '0x'],
  })
  await publicClient.waitForTransactionReceipt({ hash })
  return { hash, deliverableHash, explorerUrl: explorer(hash) }
}

export async function completeJob(account: string, jobId: string, reasonText: string) {
  const walletClient = await getWalletClient(account)
  const reasonHash = hashTextBytes32(reasonText || 'deliverable-approved')
  const hash = await walletClient.writeContract({
    address: AGENTIC_COMMERCE_CONTRACT,
    abi: agenticCommerceAbi,
    functionName: 'complete',
    args: [BigInt(jobId), reasonHash, '0x'],
  })
  await publicClient.waitForTransactionReceipt({ hash })
  return { hash, reasonHash, explorerUrl: explorer(hash) }
}

export async function readJob(jobId: string): Promise<AgenticJob> {
  const job = await publicClient.readContract({
    address: AGENTIC_COMMERCE_CONTRACT,
    abi: agenticCommerceAbi,
    functionName: 'getJob',
    args: [BigInt(jobId)],
  }) as ContractJob
  const statusIndex = Number(job.status ?? job[7] ?? 0)
  return {
    id: String(job.id ?? job[0] ?? jobId),
    client: String(job.client ?? job[1]),
    provider: String(job.provider ?? job[2]),
    evaluator: String(job.evaluator ?? job[3]),
    description: String(job.description ?? job[4] ?? ''),
    budget: formatUnits(BigInt(job.budget ?? job[5] ?? 0), 6),
    expiredAt: Number(job.expiredAt ?? job[6] ?? 0),
    status: JOB_STATUS[statusIndex] ?? `Status ${statusIndex}`,
    hook: String(job.hook ?? job[8] ?? ZERO_ADDRESS),
  }
}
