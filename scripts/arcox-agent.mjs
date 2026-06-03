#!/usr/bin/env node
import { createHash } from 'crypto'
import { createServer } from 'http'
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

const ARC_RPC = process.env.ARC_RPC || 'https://rpc.testnet.arc.network/'
const EXPLORER_TX = 'https://testnet.arcscan.app/tx/'
const AGENTIC_COMMERCE_CONTRACT = '0x0747EEf0706327138c69792bF28Cd525089e4583'
const IDENTITY_REGISTRY = '0x8004A818BFB912233c491871b3d84c89A494BD9e'
const ARC_USDC = '0x3600000000000000000000000000000000000000'
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const JOB_STATUS = ['Open', 'Funded', 'Submitted', 'Completed', 'Rejected', 'Expired']

const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC] } },
  blockExplorers: { default: { name: 'ArcScan', url: 'https://testnet.arcscan.app' } },
})

const publicClient = createPublicClient({ chain: arcTestnet, transport: http(ARC_RPC) })

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
  AGENT_PRIVATE_KEY=0x... npm run agent -- status

Local endpoint for ARCOX DEX UI:
  AGENT_PRIVATE_KEY=0x... npm run agent -- serve --port 8787
  Use endpoint: http://127.0.0.1:8787/agent
`)
}

function arg(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  return process.argv[index + 1] || fallback
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

function hashTextBytes32(text) {
  return keccak256(toHex(text || 'arcox-agent-deliverable'))
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
      return res.end(JSON.stringify({
        name: process.env.AGENT_NAME || 'ARCOX Terminal AI Agent',
        agent_type: 'retail_payment_agent',
        capabilities: ['create_job_plan', 'verify_deliverable', 'submit_job_result'],
        owner,
        endpoint: `http://127.0.0.1:${port}/agent`,
      }))
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
