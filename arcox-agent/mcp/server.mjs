#!/usr/bin/env node
import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
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
  setAgentJobBudget,
  submitAgentJob,
  transactionHistory,
  walletBalances,
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
    name: 'arcox_wallet_balances',
    description: 'Return all retail balances visible to the agent: EOA Arc tokens, Circle proxy wallet balances, and Solana Devnet USDC.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'arcox_quote_bridge',
    description: 'Quote a USDC bridge route, platform fee, estimated receive, and balance before execution. If the user says "circle arc ke solana" or "Circle Wallet Arc to Solana", use source="circle", fromChain="Arc_Testnet", toChain="Solana_Devnet". Circle Wallet bridge source is only valid from Arc Testnet.',
    inputSchema: {
      type: 'object',
      properties: {
        fromChain: { type: 'string' },
        toChain: { type: 'string' },
        amount: { type: 'string' },
        token: { type: 'string', default: 'USDC' },
        source: { type: 'string', enum: ['eoa', 'circle'], default: 'eoa' },
      },
      required: ['fromChain', 'toChain', 'amount'],
      additionalProperties: false,
    },
  },
  {
    name: 'arcox_execute_bridge',
    description: 'Execute a confirmed USDC bridge with the local AGENT_PRIVATE_KEY signer. Requires previewId from arcox_quote_bridge when confirmed=true. If the user says "circle arc ke solana" or "Circle Wallet Arc to Solana", use source="circle", fromChain="Arc_Testnet", toChain="Solana_Devnet". Circle Wallet bridge source is only valid from Arc Testnet.',
    inputSchema: {
      type: 'object',
      properties: {
        fromChain: { type: 'string' },
        toChain: { type: 'string' },
        amount: { type: 'string' },
        token: { type: 'string', default: 'USDC' },
        source: { type: 'string', enum: ['eoa', 'circle'], default: 'eoa' },
        previewId: { type: 'string' },
        confirmed: { type: 'boolean' },
      },
      required: ['fromChain', 'toChain', 'amount'],
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
        source: { type: 'string', enum: ['eoa', 'circle'], default: 'eoa' },
      },
      required: ['to', 'amount'],
      additionalProperties: false,
    },
  },
  {
    name: 'arcox_execute_send',
    description: 'Execute a confirmed Arc token send with the local AGENT_PRIVATE_KEY signer. Requires previewId from arcox_quote_send when confirmed=true.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string' },
        amount: { type: 'string' },
        token: { type: 'string', default: 'USDC' },
        source: { type: 'string', enum: ['eoa', 'circle'], default: 'eoa' },
        previewId: { type: 'string' },
        confirmed: { type: 'boolean' },
      },
      required: ['to', 'amount'],
      additionalProperties: false,
    },
  },
  {
    name: 'arcox_transaction_history',
    description: 'Return ARCOX transaction history recorded by the MCP/terminal agent for bridge, swap, and send.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
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
    description: 'Execute a confirmed Circle proxy wallet swap through the ARCOX backend. Requires previewId from arcox_quote_swap when confirmed=true.',
    inputSchema: {
      type: 'object',
      properties: {
        tokenIn: { type: 'string' },
        tokenOut: { type: 'string' },
        amountIn: { type: 'string' },
        previewId: { type: 'string' },
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
  const usdcBridge = action.includes('bridge') && String(args.token || 'USDC').toUpperCase() === 'USDC'
  return {
    supported: issues.length === 0,
    issues,
    normalized: { fromChain: fromChain || null, toChain: toChain || null },
    fromChain: from || null,
    toChain: to || null,
    routerFeeApplies: Boolean(usdcBridge && from?.router && fromChain !== 'Solana_Devnet'),
    solanaPlatformFeeApplies: Boolean(usdcBridge && fromChain === 'Solana_Devnet'),
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

const valueMovingTools = new Set(['arcox_execute_bridge', 'arcox_execute_send', 'arcox_execute_swap'])
const valueMovingJobOps = new Set(['register-agent', 'create-job', 'set-budget', 'fund', 'submit', 'complete'])
const rateLimitBuckets = new Map()
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 10
const previewApprovals = new Map()
const dailySpendBuckets = new Map()
const PREVIEW_TTL_MS = Number(process.env.ARCOX_PREVIEW_TTL_MS || 10 * 60 * 1000)
const MAX_TX_USDC = Number(process.env.ARCOX_MAX_TX_USDC || '10')
const DAILY_LIMIT_USDC = Number(process.env.ARCOX_DAILY_LIMIT_USDC || '50')
let activeValueMovingExecution = null

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

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function spendAmountFor(name, args) {
  if (name.includes('swap')) return Number(args.amountIn || args.amount || 0)
  if (name.includes('send') || name.includes('bridge')) return Number(args.amount || 0)
  if (name === 'arcox_agent_job') return Number(args.amount || 0)
  return 0
}

function canonicalAmount(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  if (!/^\d+(\.\d+)?$/.test(raw)) return raw
  const [whole, frac = ''] = raw.split('.')
  const normalizedWhole = whole.replace(/^0+(?=\d)/, '') || '0'
  const normalizedFrac = frac.replace(/0+$/, '')
  return normalizedFrac ? `${normalizedWhole}.${normalizedFrac}` : normalizedWhole
}

function canonicalToken(value, fallback = 'USDC') {
  const raw = String(value || fallback).trim()
  const upper = raw.toUpperCase()
  if (upper === 'CIRBTC' || upper === 'CIR-BTC' || upper === 'CIRCLEBTC') return 'CIRBTC'
  if (upper.includes('USDC')) return 'USDC'
  if (upper.includes('EURC')) return 'EURC'
  if (upper.includes('USYC')) return 'USYC'
  return upper || fallback
}

function canonicalSource(value, fallback = 'eoa') {
  const raw = String(value || fallback).trim().toLowerCase()
  if (raw.includes('circle') || raw.includes('proxy')) return 'circle'
  return 'eoa'
}

function canonicalPreviewAction(name) {
  return name.replace('quote', 'execute')
}

function canonicalPreviewArgs(name, args) {
  const action = canonicalPreviewAction(name)
  if (action === 'arcox_execute_bridge') {
    return {
      action,
      fromChain: normalizeMcpChain(args.fromChain) || args.fromChain,
      toChain: normalizeMcpChain(args.toChain) || args.toChain,
      amount: canonicalAmount(args.amount),
      token: canonicalToken(args.token),
      source: canonicalSource(args.source),
    }
  }
  if (action === 'arcox_execute_send') {
    return {
      action,
      to: String(args.to || '').toLowerCase(),
      amount: canonicalAmount(args.amount),
      token: canonicalToken(args.token),
      source: canonicalSource(args.source),
    }
  }
  if (action === 'arcox_execute_swap') {
    return {
      action,
      tokenIn: canonicalToken(args.tokenIn),
      tokenOut: canonicalToken(args.tokenOut, ''),
      amountIn: canonicalAmount(args.amountIn || args.amount),
    }
  }
  return { action, ...args }
}

function previewHash(name, args) {
  return createHash('sha256').update(stableJson(canonicalPreviewArgs(name, args))).digest('hex')
}

function attachPreview(name, args, quote) {
  const canonical = canonicalPreviewArgs(name, args)
  const hash = createHash('sha256').update(stableJson(canonical)).digest('hex')
  const previewId = `arcox-preview-${hash.slice(0, 16)}`
  previewApprovals.set(previewId, { hash, canonical, action: canonicalPreviewAction(name), createdAt: Date.now(), expiresAt: Date.now() + PREVIEW_TTL_MS })
  return {
    ...quote,
    previewId,
    previewExpiresAt: new Date(Date.now() + PREVIEW_TTL_MS).toISOString(),
    dryRunRequired: true,
    safetyLimits: {
      maxTxUsdc: MAX_TX_USDC,
      dailyLimitUsdc: DAILY_LIMIT_USDC,
    },
    riskChecks: quoteRiskChecks(name, quote),
    executeInstruction: `After explicit user confirmation for this single operation only, call ${canonicalPreviewAction(name)} with confirmed=true and this exact previewId. For bulk requests, execute one chain at a time and ask for confirmation before each chain.`,
  }
}

function quoteRiskChecks(name, quote) {
  const checks = []
  if (quote?.supported === false) checks.push({ level: 'error', item: 'balance', message: 'Source balance is lower than requested amount.' })
  if (quote?.supported === true) checks.push({ level: 'ok', item: 'balance', message: 'Source balance appears sufficient.' })
  if (quote?.platformFee !== undefined) checks.push({ level: 'info', item: 'platformFee', value: quote.platformFee })
  if (quote?.estimatedReceive !== undefined) checks.push({ level: 'info', item: 'estimatedReceive', value: quote.estimatedReceive })
  if (quote?.recipientReceives !== undefined) checks.push({ level: 'info', item: 'recipientReceives', value: quote.recipientReceives })
  if (quote?.router) checks.push({ level: 'info', item: 'router', value: quote.router })
  if (quote?.terminalExecution) checks.push({ level: 'info', item: 'execution', value: quote.terminalExecution })
  const amount = spendAmountFor(canonicalPreviewAction(name), { amount: quote?.amount, amountIn: quote?.amountIn })
  if (MAX_TX_USDC > 0 && amount > MAX_TX_USDC) checks.push({ level: 'error', item: 'maxTx', message: `Amount exceeds ARCOX_MAX_TX_USDC=${MAX_TX_USDC}.` })
  return checks
}

function enforcePreview(name, args) {
  if (!valueMovingTools.has(name) || args.confirmed !== true) return
  const previewId = String(args.previewId || '')
  const preview = previewApprovals.get(previewId)
  if (!preview) throw new Error('Dry-run required. Call the matching quote tool first and pass its previewId to execute.')
  if (preview.action !== name || Date.now() > preview.expiresAt) {
    previewApprovals.delete(previewId)
    throw new Error('Preview expired or mismatched. Re-quote before executing.')
  }
  const canonical = canonicalPreviewArgs(name, args)
  const expected = createHash('sha256').update(stableJson(canonical)).digest('hex')
  if (expected !== preview.hash) {
    throw new Error(`Execution parameters differ from quote preview. Re-quote before executing. expected=${stableJson(preview.canonical)} received=${stableJson(canonical)}`)
  }
  previewApprovals.delete(previewId)
}

async function runValueMovingTool(name, args, fn) {
  if (activeValueMovingExecution) {
    throw new Error(`Another value-moving ARCOX action is still running (${activeValueMovingExecution}). Wait for it to finish before starting a new transaction.`)
  }
  activeValueMovingExecution = name
  try {
    return await fn()
  } finally {
    activeValueMovingExecution = null
  }
}

function enforceSpendLimits(name, args) {
  if (!isValueMovingCall(name, args)) return
  const amount = spendAmountFor(name, args)
  if (!Number.isFinite(amount) || amount <= 0) return
  if (MAX_TX_USDC > 0 && amount > MAX_TX_USDC) throw new Error(`Transaction exceeds ARCOX_MAX_TX_USDC=${MAX_TX_USDC}. Reduce amount or raise local env limit.`)
  const day = new Date().toISOString().slice(0, 10)
  const key = `local-mcp-client:${day}`
  const used = dailySpendBuckets.get(key) || 0
  if (DAILY_LIMIT_USDC > 0 && used + amount > DAILY_LIMIT_USDC) throw new Error(`Daily limit exceeded. Used ${used} USDC, requested ${amount}, limit ${DAILY_LIMIT_USDC}.`)
  dailySpendBuckets.set(key, used + amount)
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
    if (name === 'arcox_wallet_balances') return result(id, await walletBalances())
    if (name === 'arcox_quote_bridge') return result(id, attachPreview(name, args, await quoteBridge(args)))
    if (name === 'arcox_execute_bridge') {
      const fromChain = normalizeMcpChain(args.fromChain)
      const toChain = normalizeMcpChain(args.toChain)
      const fastSource = fromChain === 'Arc_Testnet' || fromChain === 'Solana_Devnet'
      if (args.confirmed !== true) {
        const quoteArgs = { ...args, fromChain: fromChain || args.fromChain, toChain: toChain || args.toChain }
        return result(id, attachPreview('arcox_quote_bridge', quoteArgs, await quoteBridge(quoteArgs)))
      }
      enforcePreview(name, args)
      enforceSpendLimits(name, args)
      return result(id, await runValueMovingTool(name, args, () => executeConfirmedBridge({
          ...args,
          fromChain: fromChain || args.fromChain,
          toChain: toChain || args.toChain,
          deferMint: args.deferMint ?? !fastSource,
          maxAttestationWaitMs: args.maxAttestationWaitMs,
        })))
    }
    if (name === 'arcox_quote_send') return result(id, attachPreview(name, args, await quoteSend(args)))
    if (name === 'arcox_execute_send' && args.confirmed !== true) return result(id, attachPreview('arcox_quote_send', args, await quoteSend(args)))
    if (name === 'arcox_execute_send') {
      enforcePreview(name, args)
      enforceSpendLimits(name, args)
      return result(id, await runValueMovingTool(name, args, () => executeConfirmedSend(args)))
    }
    if (name === 'arcox_quote_swap') return result(id, attachPreview(name, args, await quoteSwap(args)))
    if (name === 'arcox_execute_swap' && args.confirmed !== true) return result(id, attachPreview('arcox_quote_swap', args, await quoteSwap(args)))
    if (name === 'arcox_execute_swap') {
      enforcePreview(name, args)
      enforceSpendLimits(name, args)
      return result(id, await runValueMovingTool(name, args, () => executeConfirmedSwap(args)))
    }
    if (name === 'arcox_transaction_history') return result(id, transactionHistory())
    if (name === 'arcox_agent_job') {
      if (isValueMovingCall(name, args)) enforceSpendLimits(name, args)
      return result(id, await agentJob(args))
    }
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
      let message = null
      try {
        message = JSON.parse(line)
        debug('request', { framing: 'ndjson', method: message.method, id: message.id })
        const response = await rpcResponse(message)
        if (response) writeMessage(response, 'ndjson')
      } catch (error) {
        writeErrorMessage(message?.id, error, 'ndjson')
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
    let message = null
    try {
      message = JSON.parse(body)
      debug('request', { framing: 'content-length', method: message.method, id: message.id })
      const response = await rpcResponse(message)
      if (response) writeMessage(response, 'content-length')
    } catch (error) {
      writeErrorMessage(message?.id, error, 'content-length')
    }
  }
})

function safeResponseId(id) {
  return typeof id === 'number' || typeof id === 'string' ? id : 'arcox-error'
}

function writeErrorMessage(id, error, framing) {
  writeMessage({
    jsonrpc: '2.0',
    id: safeResponseId(id),
    error: { code: -32000, message: error?.message || String(error) },
  }, framing)
}

function writeMessage(payload, framing = 'content-length') {
  const body = JSON.stringify(payload)
  debug('response', { framing, id: payload.id, method: payload.method, bytes: Buffer.byteLength(body) })
  if (framing === 'ndjson') {
    process.stdout.write(`${body}\n`)
    return
  }
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
}
