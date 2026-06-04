#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { actions, ARCOX_API_URL, ARCOX_WEB_URL, chainSupport, pages, retailRules } from './registry.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const agentRoot = join(__dirname, '..')

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
]

function routerDeployments() {
  const path = join(agentRoot, 'deployments', 'arcox-router.testnet.json')
  if (!existsSync(path)) return {}
  return JSON.parse(readFileSync(path, 'utf8'))
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

function routeStatus(args) {
  const from = args.fromChain ? chainSupport[args.fromChain] : null
  const to = args.toChain ? chainSupport[args.toChain] : null
  const action = String(args.action || '').toLowerCase()
  const issues = []
  if (args.fromChain && !from) issues.push(`Unsupported fromChain: ${args.fromChain}`)
  if (args.toChain && !to) issues.push(`Unsupported toChain: ${args.toChain}`)
  if (action.includes('bridge') && args.fromChain && args.toChain && args.fromChain === args.toChain) issues.push('Bridge source and destination must differ.')
  if (args.source === 'circle' && args.fromChain && !from?.circleWallet) issues.push('Circle Wallet source is only available on Arc Testnet.')
  return {
    supported: issues.length === 0,
    issues,
    fromChain: from || null,
    toChain: to || null,
    routerFeeApplies: Boolean(from?.router && action.includes('bridge') && String(args.token || 'USDC').toUpperCase() === 'USDC'),
    safeNextStep: issues.length ? 'Ask user to correct route.' : 'Quote first, then request confirmation before execution.',
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

function rpcResponse(message) {
  const { id, method, params = {} } = message
  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: 'arcox-mcp', version: '0.1.0' },
      },
    }
  }
  if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools } }
  if (method === 'tools/call') {
    const name = params.name
    const args = params.arguments || {}
    if (name === 'arcox_ui_map') return result(id, { webUrl: ARCOX_WEB_URL, apiUrl: ARCOX_API_URL, pages, actions, chainSupport, retailRules })
    if (name === 'arcox_action_plan') return result(id, actionPlan(args))
    if (name === 'arcox_route_status') return result(id, routeStatus(args))
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
process.stdin.on('data', (chunk) => {
  buffer += chunk
  for (;;) {
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
      const response = rpcResponse(JSON.parse(body))
      if (response) writeMessage(response)
    } catch (error) {
      writeMessage({ jsonrpc: '2.0', id: null, error: { code: -32000, message: error.message } })
    }
  }
})

function writeMessage(payload) {
  const body = JSON.stringify(payload)
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
}
