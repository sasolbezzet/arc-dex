#!/usr/bin/env node
import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve, relative } from 'node:path'
import { homedir } from 'node:os'
import { actions, ARCOX_API_URL, ARCOX_WEB_URL, chainSupport, pages, retailRules } from './registry.mjs'
import {
  agentStatus,
  completeAgentJob,
  createAgentJob,
  executeConfirmedBridge,
  executeConfirmedSend,
  executeConfirmedSwap,
  fundAgentJob,
  makeAgentResponse,
  quoteBridge,
  quoteSend,
  quoteSwap,
  readAgent,
  readJob,
  registerAgentIdentity,
  retryConfirmedBridge,
  setAgentJobBudget,
  submitAgentJob,
} from '../bin/arcox-agent.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const agentRoot = join(__dirname, '..')
const debugPath = resolveDebugPath(process.env.ARCOX_MCP_DEBUG)

function debug(event, payload = {}) {
  if (!debugPath) return
  try {
    appendFileSync(debugPath, JSON.stringify({ ts: new Date().toISOString(), event, ...payload }) + '\n')
  } catch {
    // Debug logging must never break MCP execution.
  }
}

function resolveDebugPath(value) {
  if (!value) return ''
  const allowedDir = resolve(process.env.ARCOX_MCP_DEBUG_DIR || join(homedir(), '.arcox', 'logs'))
  const target = resolve(allowedDir, value)
  const rel = relative(allowedDir, target)
  if (rel.startsWith('..') || rel === '' || rel.includes('..')) return ''
  mkdirSync(allowedDir, { recursive: true })
  return target
}

const resources = [
  { uri: 'arcox://ui/pages', name: 'ARCOX DEX UI Pages', mimeType: 'application/json' },
  { uri: 'arcox://ui/actions', name: 'ARCOX DEX Action Registry', mimeType: 'application/json' },
  { uri: 'arcox://ui/chains', name: 'ARCOX Chain Support', mimeType: 'application/json' },
  { uri: 'arcox://rules/retail-safety', name: 'Retail Safety Rules', mimeType: 'application/json' },
  { uri: 'arcox://deployments/router', name: 'Arcox Router Deployments', mimeType: 'application/json' },
]

const tools = [
  {
    name: 'arcox_ui_map',
    description: 'Return the full ARCOX DEX page/action map so an agent can understand the Web UI.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'arcox_action_plan',
    description: 'Convert a user intent into a cautious ARCOX action plan with missing slots and signing rules.',
    inputSchema: {
      type: 'object',
      properties: {
        intent: { type: 'string' },
        pageHint: { type: 'string' },
      },
      required: ['intent'],
      additionalProperties: false,
    },
  },
  {
    name: 'arcox_route_status',
    description: 'Describe support status for a swap, bridge, send, or retry route.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        fromChain: { type: 'string' },
        toChain: { type: 'string' },
        token: { type: 'string' },
        source: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'arcox_agent_status',
    description: 'Return the local ARCOX agent signer address and Arc balances from AGENT_PRIVATE_KEY.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'arcox_quote_bridge',
    description: 'Quote a USDC bridge route, platform fee, estimated receive, and balance before execution.',
    inputSchema: {
      type: 'object',
      properties: {
        fromChain: { type: 'string' },
        toChain: { type: 'string' },
        amount: { type: 'string' },
        token: { type: 'string', default: 'USDC' },
      },
      required: ['fromChain', 'toChain', 'amount'],
      additionalProperties: false,
    },
  },
  {
    name: 'arcox_execute_bridge',
    description: 'Execute a confirmed USDC bridge with the local AGENT_PRIVATE_KEY signer. If confirmed is not true, returns quote only.',
    inputSchema: {
      type: 'object',
      properties: {
        fromChain: { type: 'string' },
        toChain: { type: 'string' },
        amount: { type: 'string' },
        token: { type: 'string', default: 'USDC' },
        confirmed: { type: 'boolean' },
      },
      required: ['fromChain', 'toChain', 'amount'],
      additionalProperties: false,
    },
  },
  {
    name: 'arcox_retry_bridge',
    description: 'Retry mint for a pending CCTP bridge burn transaction. If confirmed is not true, returns preview only.',
    inputSchema: {
      type: 'object',
      properties: {
        burnTx: { type: 'string' },
        fromChain: { type: 'string' },
        toChain: { type: 'string' },
        confirmed: { type: 'boolean' },
      },
      required: ['burnTx', 'fromChain', 'toChain'],
      additionalProperties: false,
    },
  },
  {
    name: 'arcox_quote_send',
    description: 'Quote an Arc token send from the local agent signer, including platform fee and recipient receive amount.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string' },
        amount: { type: 'string' },
        token: { type: 'string', default: 'USDC' },
      },
      required: ['to', 'amount'],
      additionalProperties: false,
    },
  },
  {
    name: 'arcox_execute_send',
    description: 'Execute a confirmed Arc token send with the local AGENT_PRIVATE_KEY signer. If confirmed is not true, returns quote only.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string' },
        amount: { type: 'string' },
        token: { type: 'string', default: 'USDC' },
        confirmed: { type: 'boolean' },
      },
      required: ['to', 'amount'],
      additionalProperties: false,
    },
  },
  {
    name: 'arcox_quote_swap',
    description: 'Quote a Circle proxy wallet swap through the ARCOX backend.',
    inputSchema: {
      type: 'object',
      properties: {
        tokenIn: { type: 'string' },
        tokenOut: { type: 'string' },
        amountIn: { type: 'string' },
      },
      required: ['tokenIn', 'tokenOut', 'amountIn'],
      additionalProperties: false,
    },
  },
  {
    name: 'arcox_execute_swap',
    description: 'Execute a confirmed Circle proxy wallet swap through the ARCOX backend. If confirmed is not true, returns quote only.',
    inputSchema: {
      type: 'object',
      properties: {
        tokenIn: { type: 'string' },
        tokenOut: { type: 'string' },
        amountIn: { type: 'string' },
        confirmed: { type: 'boolean' },
      },
      required: ['tokenIn', 'tokenOut', 'amountIn'],
      additionalProperties: false,
    },
  },
  {
    name: 'arcox_agent_job',
    description: 'Plan, register, create, read, set budget, fund, submit, or complete ARCOX Agentic Economy jobs.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: { type: 'string', enum: ['plan', 'register-agent', 'read-agent', 'create-job', 'read-job', 'set-budget', 'fund', 'submit', 'complete'] },
        prompt: { type: 'string' },
        agentId: { type: 'string' },
        metadataUri: { type: 'string' },
        jobId: { type: 'string' },
        provider: { type: 'string' },
        evaluator: { type: 'string' },
        description: { type: 'string' },
        hours: { type: 'number' },
        amount: { type: 'string' },
        deliverable: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['operation'],
      additionalProperties: false,
    },
  },
]

function routerDeployments() {
  const path = join(agentRoot, 'deployments', 'arcox-router.testnet.json')
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    debug('router_deployments_read_failed', { message: error.message })
    return {}
  }
}

function readResource(uri) {
  if (uri === 'arcox://ui/pages') return pages
  if (uri === 'arcox://ui/actions') return actions
  if (uri === 'arcox://ui/chains') return chainSupport
  if (uri === 'arcox://rules/retail-safety') return retailRules
  if (uri === 'arcox://deployments/router') return routerDeployments()
  throw new Error(`Unknown resource: ${uri}`)
}

function findAction(intent, pageHint) {
  const text = `${intent || ''} ${pageHint || ''}`.toLowerCase()
  const candidates = actions.map((action) => {
    const haystack = [action.id, action.page, ...action.intentExamples].join(' ').toLowerCase()
    const score = haystack.split(/\W+/).reduce((sum, word) => sum + (word && text.includes(word) ? 1 : 0), 0)
    return { action, score }
  }).sort((a, b) => b.score - a.score)
  return candidates[0]?.score > 0 ? candidates[0].action : null
}

function actionPlan(args) {
  const action = findAction(args.intent, args.pageHint)
  if (!action) {
    return {
      status: 'needs_clarification',
      reason: 'No matching ARCOX action found.',
      safeNextStep: 'Ask whether user wants swap, bridge, send, retry bridge, or agent job.',
      ui: { webUrl: ARCOX_WEB_URL, apiUrl: ARCOX_API_URL },
    }
  }
  const page = pages.find((item) => item.id === action.page)
  return {
    status: 'planned',
    matchedAction: action,
    page,
    missingSlots: action.requiredSlots,
    safetyRules: retailRules,
    safeNextStep: action.safeExecution === 'read_only'
      ? 'Fetch quote/status only.'
      : 'Show quote/plan and request explicit user confirmation before execution.',
    ui: { webUrl: ARCOX_WEB_URL, apiUrl: ARCOX_API_URL },
  }
}

function normalizeMcpChain(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
  if (!normalized) return ''
  for (const [id, info] of Object.entries(chainSupport)) {
    if (id.toLowerCase().replace(/_/g, ' ') === normalized) return id
    if ((info.aliases || []).includes(normalized)) return id
  }
  return String(value || '')
}

function routeStatus(args) {
  const fromChain = normalizeMcpChain(args.fromChain)
  const toChain = normalizeMcpChain(args.toChain)
  const from = fromChain ? chainSupport[fromChain] : null
  const to = toChain ? chainSupport[toChain] : null
  const action = String(args.action || '').toLowerCase()
  const issues = []
  if (args.fromChain && !from) issues.push(`Unsupported fromChain: ${args.fromChain}`)
  if (args.toChain && !to) issues.push(`Unsupported toChain: ${args.toChain}`)
  if (action.includes('bridge') && fromChain && toChain && fromChain === toChain) issues.push('Bridge source and destination must differ.')
  if (args.source === 'circle' && fromChain && !from?.circleWallet) issues.push('Circle Wallet source is only available on Arc Testnet.')
  const solanaRoute = fromChain === 'Solana_Devnet' || toChain === 'Solana_Devnet'
  return {
    supported: issues.length === 0,
    issues,
    normalized: { fromChain: fromChain || null, toChain: toChain || null },
    fromChain: from || null,
    toChain: to || null,
    routerFeeApplies: Boolean(from?.router && action.includes('bridge') && String(args.token || 'USDC').toUpperCase() === 'USDC'),
    solanaRoute,
    terminalExecution: solanaRoute ? 'supported_with_local_solana_signer' : 'supported',
    safeNextStep: issues.length
      ? 'Ask user to correct route.'
      : 'Quote first, then request confirmation before execution.',
  }
}

function result(id, value) {
  return {
    jsonrpc: '2.0',
    id,
    result: {
      content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
  }
}

async function agentJob(args) {
  if (args.operation === 'plan') return makeAgentResponse({ prompt: args.prompt, jobId: args.jobId, agentId: args.agentId })
  if (args.operation === 'register-agent') return registerAgentIdentity({ metadataUri: args.metadataUri })
  if (args.operation === 'read-agent') return readAgent(args.agentId)
  if (args.operation === 'create-job') return createAgentJob(args)
  if (args.operation === 'read-job') return readJob(args.jobId)
  if (args.operation === 'set-budget') return setAgentJobBudget(args)
  if (args.operation === 'fund') return fundAgentJob(args)
  if (args.operation === 'submit') return submitAgentJob(args)
  if (args.operation === 'complete') return completeAgentJob(args)
  throw new Error(`Unsupported agent job operation: ${args.operation}`)
}

const valueMovingTools = new Set(['arcox_execute_bridge', 'arcox_retry_bridge', 'arcox_execute_send', 'arcox_execute_swap'])
const valueMovingJobOps = new Set(['register-agent', 'create-job', 'set-budget', 'fund', 'submit', 'complete'])
const rateLimitBuckets = new Map()
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 10

function isValueMovingCall(name, args) {
  if (valueMovingTools.has(name)) return args.confirmed === true
  return name === 'arcox_agent_job' && valueMovingJobOps.has(args.operation)
}

function enforceRateLimit(key) {
  const now = Date.now()
  const bucket = rateLimitBuckets.get(key) || []
  const recent = bucket.filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS)
  if (recent.length >= RATE_LIMIT_MAX) {
    throw new Error('Rate limit exceeded for value-moving MCP actions. Wait before submitting another transaction.')
  }
  recent.push(now)
  rateLimitBuckets.set(key, recent)
}

async function rpcResponse(message) {
  const { id, method, params = {} } = message
  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: params.protocolVersion || '2024-11-05',
        capabilities: {
          tools: { listChanged: false },
          resources: { subscribe: false, listChanged: false },
        },
        serverInfo: { name: 'arcox-mcp', version: '0.1.0' },
      },
    }
  }
  if (method === 'ping') return { jsonrpc: '2.0', id, result: {} }
  if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools } }
  if (method === 'tools/call') {
    const name = params.name
    const args = params.arguments || {}
    if (isValueMovingCall(name, args)) enforceRateLimit('local-mcp-client')
    if (name === 'arcox_ui_map') return result(id, { webUrl: ARCOX_WEB_URL, apiUrl: ARCOX_API_URL, pages, actions, chainSupport, retailRules })
    if (name === 'arcox_action_plan') return result(id, actionPlan(args))
    if (name === 'arcox_route_status') return result(id, routeStatus(args))
    if (name === 'arcox_agent_status') return result(id, await agentStatus())
    if (name === 'arcox_quote_bridge') return result(id, await quoteBridge(args))
    if (name === 'arcox_execute_bridge') {
      const fromChain = normalizeMcpChain(args.fromChain)
      const toChain = normalizeMcpChain(args.toChain)
      const solanaRoute = fromChain === 'Solana_Devnet' || toChain === 'Solana_Devnet'
      return result(id, await executeConfirmedBridge({
        ...args,
        fromChain: fromChain || args.fromChain,
        toChain: toChain || args.toChain,
        maxAttestationWaitMs: args.maxAttestationWaitMs ?? (solanaRoute ? 55_000 : undefined),
      }))
    }
    if (name === 'arcox_retry_bridge') return result(id, await retryConfirmedBridge(args))
    if (name === 'arcox_quote_send') return result(id, await quoteSend(args))
    if (name === 'arcox_execute_send') return result(id, await executeConfirmedSend(args))
    if (name === 'arcox_quote_swap') return result(id, await quoteSwap(args))
    if (name === 'arcox_execute_swap') return result(id, await executeConfirmedSwap(args))
    if (name === 'arcox_agent_job') return result(id, await agentJob(args))
    throw new Error(`Unknown tool: ${name}`)
  }
  if (method === 'resources/list') return { jsonrpc: '2.0', id, result: { resources } }
  if (method === 'resources/read') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        contents: [{ uri: params.uri, mimeType: 'application/json', text: JSON.stringify(readResource(params.uri), null, 2) }],
      },
    }
  }
  if (method === 'notifications/initialized') return null
  throw new Error(`Unsupported method: ${method}`)
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', async (chunk) => {
  debug('stdin_chunk', { chunk })
  buffer += chunk
  for (;;) {
    const trimmed = buffer.trimStart()
    if (trimmed !== buffer) buffer = trimmed
    if (buffer.startsWith('{')) {
      const lineEnd = buffer.indexOf('\n')
      if (lineEnd === -1) return
      const line = buffer.slice(0, lineEnd).trim()
      buffer = buffer.slice(lineEnd + 1)
      if (!line) continue
      try {
        const message = JSON.parse(line)
        debug('request', { framing: 'ndjson', method: message.method, id: message.id })
        const response = await rpcResponse(message)
        if (response) writeMessage(response, 'ndjson')
      } catch (error) {
        writeMessage({ jsonrpc: '2.0', id: null, error: { code: -32000, message: error.message } }, 'ndjson')
      }
      continue
    }
    const headerEnd = buffer.indexOf('\r\n\r\n')
    if (headerEnd === -1) return
    const header = buffer.slice(0, headerEnd)
    const match = header.match(/Content-Length:\s*(\d+)/i)
    if (!match) throw new Error('Missing Content-Length header')
    const length = Number(match[1])
    const bodyStart = headerEnd + 4
    if (buffer.length < bodyStart + length) return
    const body = buffer.slice(bodyStart, bodyStart + length)
    buffer = buffer.slice(bodyStart + length)
    try {
      const message = JSON.parse(body)
      debug('request', { framing: 'content-length', method: message.method, id: message.id })
      const response = await rpcResponse(message)
      if (response) writeMessage(response, 'content-length')
    } catch (error) {
      writeMessage({ jsonrpc: '2.0', id: null, error: { code: -32000, message: error.message } }, 'content-length')
    }
  }
})

function writeMessage(payload, framing = 'content-length') {
  const body = JSON.stringify(payload)
  debug('response', { framing, id: payload.id, method: payload.method, bytes: Buffer.byteLength(body) })
  if (framing === 'ndjson') {
    process.stdout.write(`${body}\n`)
    return
  }
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
}
