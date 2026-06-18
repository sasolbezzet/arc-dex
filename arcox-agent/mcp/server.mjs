#!/usr/bin/env node
import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve, relative } from 'node:path'
import { homedir } from 'node:os'
import { actions, ARCOX_API_URL, ARCOX_WEB_URL, chainSupport, pages, retailRules } from './registry.mjs'
import {
  agentStatus,
  checkPaymentStatus,
  completeAgentJob,
  createAgentJob,
  createPaymentRequest,
  executeConfirmedBridge,
  executeConfirmedSend,
  executeConfirmedSwap,
  fundAgentJob,
  getPaymentRequest,
  intelExecuteWalletReport,
  intelGetAddress,
  intelGetContract,
  intelGetEntity,
  intelGetToken,
  intelGetTx,
  intelQuoteWalletReport,
  intelSearch,
  makeAgentResponse,
  payPaymentRequest,
  payCreateNowpaymentsSandboxPayment,
  payGetPaymentStatus,
  payListRecentPayments,
  paySimulateBaseTreasurySend,
  paySimulateBridgeToBase,
  paySimulateNowpaymentsFinished,
  paySimulateNowpaymentsStatus,
  paySimulateUserArcPayment,
  quoteBridge,
  quoteEcoRoutePayment,
  quotePaymentRequest,
  quoteSend,
  quoteSwap,
  readAgent,
  readJob,
  registerAgentIdentity,
  setAgentJobBudget,
  simulateCircleWebhook,
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
  { uri: 'arcox://deployments/native-swap-bridge-router', name: 'Arcox Native Swap Bridge Router Deployments', mimeType: 'application/json' },
  { uri: 'arcox://docs/catalog', name: 'ARCOX Docs Catalog', mimeType: 'application/json' },
]

const docsCatalog = [
  {
    id: 'overview',
    title: 'ARCOX Overview',
    tags: ['dex', 'arc', 'wallet', 'retail'],
    body: 'ARCOX DEX is a retail Arc Testnet app for swap, bridge, send, receive/payment request, ARCOX Pay invoices, transaction history, and agent workflows. Value-moving actions must quote before execution.',
  },
  {
    id: 'pay',
    title: 'ARCOX Pay',
    tags: ['pay', 'invoice', 'payment request', 'usdc'],
    body: 'ARCOX Pay creates public USDC invoice/payment links on Arc Testnet. It is not private payment and does not charge hidden merchant fees. Invoice payment requires preview and confirmation.',
  },
  {
    id: 'circle-nanopayments',
    title: 'Circle Gateway Nanopayments Readiness',
    tags: ['circle', 'gateway', 'nanopayments', 'x402', 'eip-3009'],
    body: 'Circle Gateway Nanopayments use x402: paid resource request, HTTP 402 response, buyer offchain EIP-3009 authorization, retry with proof, and batched Gateway settlement. ARCOX exposes readiness metadata only; gas-free nanopayments settlement is not live yet.',
  },
  {
    id: 'circle-agents',
    title: 'Circle for Agents Alignment',
    tags: ['circle', 'agents', 'x402', 'paid api', 'usdc'],
    body: 'Circle for Agents positions USDC as payment-as-authentication for agents and paid APIs. ARCOX aligns by exposing quote-before-execute MCP tools, ARCOX Pay invoice/payment request tools, and x402/nanopayments readiness metadata. Current ARCOX execution remains public Arc Testnet USDC and does not claim live gas-free nanopayments.',
  },
  {
    id: 'mcp-safety',
    title: 'MCP Safety Rules',
    tags: ['mcp', 'agent', 'safety', 'confirmation'],
    body: 'Agents must call quote tools first, show preview details to the user, receive a simple explicit confirmation, then execute with previewId and confirmationText. Bulk transactions require one quote and one confirmation per operation.',
  },
  {
    id: 'bridge-retry',
    title: 'Bridge Retry',
    tags: ['bridge', 'retry', 'cctp', 'attestation'],
    body: 'CCTP bridge has approve, burn, attestation, and mint/receive stages. If burn succeeded but mint is pending, check status and retry mint instead of repeating the burn.',
  },
  {
    id: 'dynamic-style-docs',
    title: 'Dynamic-style MCP Docs Discovery',
    tags: ['dynamic', 'docs', 'search', 'mcp'],
    body: 'Following the Dynamic MCP docs pattern, ARCOX exposes arcox_search_docs and arcox_read_doc so agents can discover product docs before choosing tools.',
  },
]

const tools = [
  {
    name: 'arcox_search_docs',
    description: 'Search ARCOX product and MCP documentation. Use this before guessing an unfamiliar ARCOX flow.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'arcox_read_doc',
    description: 'Read a structured ARCOX documentation page by id returned from arcox_search_docs.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
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
    description: 'Quote a bridge route before execution. Supports USDC CCTP routes and native ETH from Ethereum/Base Sepolia to Arc via native swap bridge router. Circle Wallet source is only valid for USDC from Arc Testnet.',
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
    description: 'Execute a confirmed bridge with the local AGENT_PRIVATE_KEY signer. Requires previewId from arcox_quote_bridge when confirmed=true. Supports USDC CCTP routes and native ETH from Ethereum/Base Sepolia to Arc via native swap bridge router. Native bridge must use source="eoa".',
    inputSchema: {
      type: 'object',
      properties: {
        fromChain: { type: 'string' },
        toChain: { type: 'string' },
        amount: { type: 'string' },
        token: { type: 'string', default: 'USDC' },
        source: { type: 'string', enum: ['eoa', 'circle'], default: 'eoa' },
        previewId: { type: 'string' },
        confirmationText: { type: 'string' },
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
        confirmationText: { type: 'string' },
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
    name: 'arcox_create_payment_request',
    description: 'Create an ARCOX Pay USDC invoice/payment request on Arc Testnet.',
    inputSchema: {
      type: 'object',
      properties: {
        amount: { type: 'string' },
        token: { type: 'string', default: 'USDC' },
        merchantAddress: { type: 'string' },
        orderId: { type: 'string' },
        memo: { type: 'string' },
        expiresInMinutes: { type: 'number', default: 15 },
      },
      required: ['amount', 'merchantAddress'],
      additionalProperties: false,
    },
  },
  {
    name: 'arcox_get_payment_request',
    description: 'Read a full ARCOX Pay invoice/payment request.',
    inputSchema: {
      type: 'object',
      properties: { invoiceId: { type: 'string' } },
      required: ['invoiceId'],
      additionalProperties: false,
    },
  },
  {
    name: 'arcox_quote_payment_request',
    description: 'Quote an ARCOX Pay invoice before payment execution. This is required before arcox_pay_payment_request.',
    inputSchema: {
      type: 'object',
      properties: { invoiceId: { type: 'string' } },
      required: ['invoiceId'],
      additionalProperties: false,
    },
  },
  {
    name: 'arcox_pay_payment_request',
    description: 'Pay a quoted ARCOX Pay invoice with the local AGENT_PRIVATE_KEY signer. Requires previewId from arcox_quote_payment_request and explicit user confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        invoiceId: { type: 'string' },
        amount: { type: 'string' },
        token: { type: 'string' },
        merchantAddress: { type: 'string' },
        previewId: { type: 'string' },
        confirmationText: { type: 'string' },
        confirmed: { type: 'boolean' },
      },
      required: ['invoiceId'],
      additionalProperties: false,
    },
  },
  {
    name: 'arcox_check_payment_status',
    description: 'Check ARCOX Pay invoice status, tx hash, paidAt, and timeline.',
    inputSchema: {
      type: 'object',
      properties: { invoiceId: { type: 'string' } },
      required: ['invoiceId'],
      additionalProperties: false,
    },
  },
  {
    name: 'arcox_simulate_circle_webhook',
    description: 'Dev-only ARCOX Pay Circle Gateway webhook simulator. Requires ENABLE_DEV_TOOLS=true on backend.',
    inputSchema: {
      type: 'object',
      properties: {
        invoiceId: { type: 'string' },
        eventType: { type: 'string' },
        txHash: { type: 'string' },
      },
      required: ['invoiceId', 'eventType'],
      additionalProperties: false,
    },
  },
  {
    name: 'arcox_quote_eco_route_payment',
    description: 'Preview a future Eco route for cross-chain stablecoin invoice payment. Returns mockMode=true when Eco credentials are missing.',
    inputSchema: {
      type: 'object',
      properties: {
        sourceChain: { type: 'string' },
        destinationChain: { type: 'string', default: 'arc-testnet' },
        sourceToken: { type: 'string', default: 'USDC' },
        destinationToken: { type: 'string', default: 'USDC' },
        amount: { type: 'string' },
        recipient: { type: 'string' },
        invoiceId: { type: 'string' },
      },
      required: ['sourceChain', 'amount', 'recipient'],
      additionalProperties: false,
    },
  },
  {
    name: 'arcox_pay_create_nowpayments_sandbox_payment',
    description: 'Create a NOWPayments sandbox payment for ARCOX Pay USDC Base simulation.',
    inputSchema: {
      type: 'object',
      properties: {
        amount: { type: 'string' },
        price_currency: { type: 'string', default: 'usd' },
        pay_currency: { type: 'string', default: 'usdcbase' },
        order_id: { type: 'string' },
        description: { type: 'string' },
        user_id: { type: 'string' },
        case: { type: 'string' },
      },
      required: ['amount'],
      additionalProperties: false,
    },
  },
  {
    name: 'arcox_pay_get_payment_status',
    description: 'Read ARCOX Pay NOWPayments sandbox payment status.',
    inputSchema: {
      type: 'object',
      properties: { payment_id: { type: 'string' } },
      required: ['payment_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'arcox_pay_simulate_user_arc_payment',
    description: 'Sandbox only: mark user Arc payment to ARCOX Arc Treasury as funded.',
    inputSchema: {
      type: 'object',
      properties: {
        payment_id: { type: 'string' },
        user_wallet_address: { type: 'string' },
        amount: { type: 'string' },
        arc_tx_hash: { type: 'string' },
      },
      required: ['payment_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'arcox_pay_simulate_bridge_to_base',
    description: 'Sandbox only: simulate ARCOX Arc Treasury to Base Treasury rebalance.',
    inputSchema: {
      type: 'object',
      properties: {
        payment_id: { type: 'string' },
        bridge_tx_hash: { type: 'string' },
      },
      required: ['payment_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'arcox_pay_simulate_base_treasury_send',
    description: 'Sandbox only: simulate Base Treasury sending USDC Base to NOWPayments pay_address.',
    inputSchema: {
      type: 'object',
      properties: {
        payment_id: { type: 'string' },
        base_tx_hash: { type: 'string' },
      },
      required: ['payment_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'arcox_pay_simulate_nowpayments_finished',
    description: 'Sandbox only: simulate NOWPayments IPN payment_status=finished.',
    inputSchema: {
      type: 'object',
      properties: { payment_id: { type: 'string' } },
      required: ['payment_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'arcox_pay_simulate_nowpayments_status',
    description: 'Sandbox only: simulate a NOWPayments status event.',
    inputSchema: {
      type: 'object',
      properties: {
        payment_id: { type: 'string' },
        order_id: { type: 'string' },
        payment_status: { type: 'string', enum: ['waiting', 'confirming', 'confirmed', 'finished', 'failed', 'expired'] },
      },
      required: ['payment_id', 'payment_status'],
      additionalProperties: false,
    },
  },
  {
    name: 'arcox_pay_list_recent_payments',
    description: 'List recent ARCOX Pay NOWPayments sandbox payments.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', default: 10 } },
      additionalProperties: false,
    },
  },
  {
    name: 'arcox_intel_quote_wallet_report',
    description: 'Quote an ARCOX Intel full wallet report. Shows x402 price and confirmation requirement before paid analysis.',
    inputSchema: {
      type: 'object',
      properties: { address: { type: 'string' } },
      required: ['address'],
      additionalProperties: false,
    },
  },
  {
    name: 'arcox_intel_execute_wallet_report',
    description: 'Execute an ARCOX Intel full wallet report through the ARCOX API backend after explicit user confirmation. MCP does not call Arkham directly.',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string' },
        confirmed: { type: 'boolean' },
        confirmationText: { type: 'string' },
      },
      required: ['address'],
      additionalProperties: false,
    },
  },
  {
    name: 'arcox_intel_get_address',
    description: 'Get address intelligence through ARCOX API. Returns x402 payment requirement unless mockPaid=true is accepted by backend dev mode.',
    inputSchema: {
      type: 'object',
      properties: { address: { type: 'string' }, mockPaid: { type: 'boolean' } },
      required: ['address'],
      additionalProperties: false,
    },
  },
  {
    name: 'arcox_intel_get_tx',
    description: 'Get transaction intelligence through ARCOX API.',
    inputSchema: {
      type: 'object',
      properties: { hash: { type: 'string' }, mockPaid: { type: 'boolean' } },
      required: ['hash'],
      additionalProperties: false,
    },
  },
  {
    name: 'arcox_intel_get_contract',
    description: 'Get contract intelligence through ARCOX API.',
    inputSchema: {
      type: 'object',
      properties: { chain: { type: 'string' }, address: { type: 'string' }, mockPaid: { type: 'boolean' } },
      required: ['chain', 'address'],
      additionalProperties: false,
    },
  },
  {
    name: 'arcox_intel_get_entity',
    description: 'Get entity intelligence through ARCOX API.',
    inputSchema: {
      type: 'object',
      properties: { entity: { type: 'string' }, mockPaid: { type: 'boolean' } },
      required: ['entity'],
      additionalProperties: false,
    },
  },
  {
    name: 'arcox_intel_get_token',
    description: 'Get token intelligence through ARCOX API.',
    inputSchema: {
      type: 'object',
      properties: { token: { type: 'string' }, mockPaid: { type: 'boolean' } },
      required: ['token'],
      additionalProperties: false,
    },
  },
  {
    name: 'arcox_intel_search',
    description: 'Search Arkham intelligence through ARCOX API.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' }, mockPaid: { type: 'boolean' } },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'arcox_quote_swap',
    description: 'Quote an Arc swap. Default source is EOA agent wallet; set source="circle" only when the user explicitly asks to use the Circle proxy wallet.',
    inputSchema: {
      type: 'object',
      properties: {
        tokenIn: { type: 'string' },
        tokenOut: { type: 'string' },
        amountIn: { type: 'string' },
        source: { type: 'string', enum: ['eoa', 'circle'], default: 'eoa' },
      },
      required: ['tokenIn', 'tokenOut', 'amountIn'],
      additionalProperties: false,
    },
  },
  {
    name: 'arcox_execute_swap',
    description: 'Execute a confirmed Arc swap. Default source is EOA agent wallet signed by local AGENT_PRIVATE_KEY. Set source="circle" only when explicitly quoted for Circle proxy wallet. Requires previewId from arcox_quote_swap when confirmed=true.',
    inputSchema: {
      type: 'object',
      properties: {
        tokenIn: { type: 'string' },
        tokenOut: { type: 'string' },
        amountIn: { type: 'string' },
        source: { type: 'string', enum: ['eoa', 'circle'], default: 'eoa' },
        previewId: { type: 'string' },
        confirmed: { type: 'boolean' },
        confirmationText: { type: 'string' },
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

function nativeSwapBridgeRouterDeployments() {
  const path = join(agentRoot, 'deployments', 'arcox-native-swap-bridge-router.testnet.json')
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    debug('native_router_deployments_read_failed', { message: error.message })
    return {}
  }
}

function readResource(uri) {
  if (uri === 'arcox://ui/pages') return pages
  if (uri === 'arcox://ui/actions') return actions
  if (uri === 'arcox://ui/chains') return chainSupport
  if (uri === 'arcox://rules/retail-safety') return retailRules
  if (uri === 'arcox://deployments/router') return routerDeployments()
  if (uri === 'arcox://deployments/native-swap-bridge-router') return nativeSwapBridgeRouterDeployments()
  if (uri === 'arcox://docs/catalog') return docsCatalog
  throw new Error(`Unknown resource: ${uri}`)
}

function searchDocs(args) {
  const query = String(args.query || '').trim().toLowerCase()
  const words = query.split(/\W+/).filter(Boolean)
  const results = docsCatalog
    .map((doc) => {
      const haystack = [doc.id, doc.title, ...(doc.tags || []), doc.body].join(' ').toLowerCase()
      const score = words.reduce((sum, word) => sum + (haystack.includes(word) ? 1 : 0), 0)
      return { id: doc.id, title: doc.title, tags: doc.tags, score, snippet: doc.body.slice(0, 220) }
    })
    .filter((item) => item.score > 0 || !query)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
  return {
    query,
    results,
    safeNextStep: results.length
      ? 'Call arcox_read_doc with the selected id before acting on unfamiliar flows.'
      : 'No doc match found. Ask the user to clarify the desired ARCOX flow.',
  }
}

function readDoc(args) {
  const id = String(args.id || '').trim().toLowerCase()
  const doc = docsCatalog.find((item) => item.id === id)
  if (!doc) throw new Error(`Unknown ARCOX doc id: ${args.id}`)
  return {
    ...doc,
    relatedResources: ['arcox://ui/pages', 'arcox://ui/actions', 'arcox://rules/retail-safety'],
  }
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

const valueMovingTools = new Set(['arcox_execute_bridge', 'arcox_execute_send', 'arcox_execute_swap', 'arcox_pay_payment_request'])
const valueMovingJobOps = new Set(['register-agent', 'create-job', 'set-budget', 'fund', 'submit', 'complete'])
const rateLimitBuckets = new Map()
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 10
const previewApprovals = new Map()
const dailySpendBuckets = new Map()
const PREVIEW_TTL_MS = Number(process.env.ARCOX_PREVIEW_TTL_MS || 10 * 60 * 1000)
const MAX_TX_USDC = Number(process.env.ARCOX_MAX_TX_USDC || '10')
const DAILY_LIMIT_USDC = Number(process.env.ARCOX_DAILY_LIMIT_USDC || '50')
const MAX_TX_NATIVE = Number(process.env.ARCOX_MAX_TX_NATIVE || '0.1')
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
  if (name === 'arcox_pay_payment_request') return Number(args.amount || 0)
  if (name === 'arcox_agent_job') return Number(args.amount || 0)
  return 0
}

function isNativeBridgeToken(value) {
  const token = canonicalToken(value)
  return token === 'ETH' || token === 'HYPE' || token === 'SOL' || token === 'ETH_NATIVE' || token === 'HYPE_NATIVE' || token === 'SOL_NATIVE'
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
  if (name === 'arcox_quote_payment_request') return 'arcox_pay_payment_request'
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
      source: canonicalSource(args.source),
    }
  }
  if (action === 'arcox_pay_payment_request') {
    return {
      action,
      invoiceId: String(args.invoiceId || ''),
      amount: canonicalAmount(args.amount),
      token: canonicalToken(args.token),
      merchantAddress: String(args.merchantAddress || '').toLowerCase(),
    }
  }
  return { action, ...args }
}

function previewHash(name, args) {
  return createHash('sha256').update(stableJson(canonicalPreviewArgs(name, args))).digest('hex')
}

function isSimpleUserConfirmation(value) {
  const text = String(value || '').trim().toLowerCase()
  return ['yes', 'ya', 'y', 'confirm', 'konfirmasi', 'lanjut', 'ok', 'oke'].includes(text)
}

function attachPreview(name, args, quote) {
  const canonical = canonicalPreviewArgs(name, args)
  const hash = createHash('sha256').update(stableJson(canonical)).digest('hex')
  const previewId = `arcox-preview-${hash.slice(0, 16)}`
  const action = canonicalPreviewAction(name)
  previewApprovals.set(previewId, { hash, canonical, action, createdAt: Date.now(), expiresAt: Date.now() + PREVIEW_TTL_MS })
  return {
    ...quote,
    previewId,
    previewExpiresAt: new Date(Date.now() + PREVIEW_TTL_MS).toISOString(),
    previewArgs: canonical,
    dryRunRequired: true,
    safetyLimits: {
      maxTxUsdc: MAX_TX_USDC,
      dailyLimitUsdc: DAILY_LIMIT_USDC,
      maxTxNative: MAX_TX_NATIVE,
    },
    riskChecks: quoteRiskChecks(name, quote),
    confirmationRequired: {
      required: true,
      acceptedReplies: ['yes', 'ya', 'confirm', 'konfirmasi', 'lanjut', 'ok'],
      instruction: 'Show this preview to the user first. Execute only after the user explicitly confirms this preview with a simple approval reply.',
    },
    executeInstruction: `After explicit user confirmation for this single operation only, call ${action} with confirmed=true, this exact previewId, and confirmationText set to the user approval reply. For bulk requests, execute one chain at a time and ask for confirmation before each chain.`,
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
  if (quote?.route === 'native-swap-bridge-router' && MAX_TX_NATIVE > 0 && amount > MAX_TX_NATIVE) {
    checks.push({ level: 'error', item: 'maxNativeTx', message: `Native amount exceeds ARCOX_MAX_TX_NATIVE=${MAX_TX_NATIVE}.` })
  } else if (MAX_TX_USDC > 0 && amount > MAX_TX_USDC) {
    checks.push({ level: 'error', item: 'maxTx', message: `Amount exceeds ARCOX_MAX_TX_USDC=${MAX_TX_USDC}.` })
  }
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
  if (!isSimpleUserConfirmation(args.confirmationText)) {
    throw new Error('Explicit user confirmation required after preview. Ask the user to reply yes/ya/confirm/lanjut, then pass that reply as confirmationText.')
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
  if (name === 'arcox_execute_bridge' && isNativeBridgeToken(args.token)) {
    if (MAX_TX_NATIVE > 0 && amount > MAX_TX_NATIVE) throw new Error(`Native bridge exceeds ARCOX_MAX_TX_NATIVE=${MAX_TX_NATIVE}. Reduce amount or raise local env limit.`)
    return
  }
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
        serverInfo: { name: 'arcox-mcp', version: '0.1.5' },
      },
    }
  }
  if (method === 'ping') return { jsonrpc: '2.0', id, result: {} }
  if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools } }
  if (method === 'tools/call') {
    const name = params.name
    const args = params.arguments || {}
    if (isValueMovingCall(name, args)) enforceRateLimit('local-mcp-client')
    if (name === 'arcox_search_docs') return result(id, searchDocs(args))
    if (name === 'arcox_read_doc') return result(id, readDoc(args))
    if (name === 'arcox_ui_map') return result(id, { webUrl: ARCOX_WEB_URL, apiUrl: ARCOX_API_URL, pages, actions, chainSupport, retailRules })
    if (name === 'arcox_action_plan') return result(id, actionPlan(args))
    if (name === 'arcox_route_status') return result(id, routeStatus(args))
    if (name === 'arcox_agent_status') return result(id, await agentStatus())
    if (name === 'arcox_wallet_balances') return result(id, await walletBalances())
    if (name === 'arcox_quote_bridge') return result(id, attachPreview(name, args, await quoteBridge(args)))
    if (name === 'arcox_execute_bridge') {
      const fromChain = normalizeMcpChain(args.fromChain)
      const toChain = normalizeMcpChain(args.toChain)
      const fastSource = ['Arc_Testnet', 'Ethereum_Sepolia', 'Base_Sepolia', 'Arbitrum_Sepolia', 'HyperEVM_Testnet', 'Solana_Devnet'].includes(fromChain)
      if (args.confirmed !== true) {
        const quoteArgs = { ...args, fromChain: fromChain || args.fromChain, toChain: toChain || args.toChain }
        return result(id, attachPreview('arcox_quote_bridge', quoteArgs, await quoteBridge(quoteArgs)))
      }
      enforcePreview(name, args)
      enforceSpendLimits(name, args)
      return result(id, await runValueMovingTool(name, args, () => executeConfirmedBridge({
          ...args,
          mcpPreviewVerified: true,
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
      return result(id, await runValueMovingTool(name, args, () => executeConfirmedSend({ ...args, mcpPreviewVerified: true })))
    }
    if (name === 'arcox_quote_swap') return result(id, attachPreview(name, args, await quoteSwap(args)))
    if (name === 'arcox_execute_swap' && args.confirmed !== true) return result(id, attachPreview('arcox_quote_swap', args, await quoteSwap(args)))
    if (name === 'arcox_execute_swap') {
      enforcePreview(name, args)
      enforceSpendLimits(name, args)
      return result(id, await runValueMovingTool(name, args, () => executeConfirmedSwap({ ...args, mcpPreviewVerified: true })))
    }
    if (name === 'arcox_transaction_history') return result(id, await transactionHistory())
    if (name === 'arcox_create_payment_request') return result(id, await createPaymentRequest(args))
    if (name === 'arcox_get_payment_request') return result(id, await getPaymentRequest(args))
    if (name === 'arcox_quote_payment_request') {
      const quote = await quotePaymentRequest(args)
      return result(id, attachPreview(name, {
        invoiceId: quote.invoiceId,
        amount: quote.amount,
        token: quote.token,
        merchantAddress: quote.merchantAddress,
      }, quote))
    }
    if (name === 'arcox_pay_payment_request' && args.confirmed !== true) {
      const quote = await quotePaymentRequest(args)
      return result(id, attachPreview('arcox_quote_payment_request', {
        invoiceId: quote.invoiceId,
        amount: quote.amount,
        token: quote.token,
        merchantAddress: quote.merchantAddress,
      }, quote))
    }
    if (name === 'arcox_pay_payment_request') {
      enforcePreview(name, args)
      enforceSpendLimits(name, args)
      return result(id, await runValueMovingTool(name, args, () => payPaymentRequest({ ...args, mcpPreviewVerified: true })))
    }
    if (name === 'arcox_check_payment_status') return result(id, await checkPaymentStatus(args))
    if (name === 'arcox_simulate_circle_webhook') return result(id, await simulateCircleWebhook(args))
    if (name === 'arcox_quote_eco_route_payment') return result(id, await quoteEcoRoutePayment(args))
    if (name === 'arcox_pay_create_nowpayments_sandbox_payment') return result(id, await payCreateNowpaymentsSandboxPayment(args))
    if (name === 'arcox_pay_get_payment_status') return result(id, await payGetPaymentStatus(args))
    if (name === 'arcox_pay_simulate_user_arc_payment') return result(id, await paySimulateUserArcPayment(args))
    if (name === 'arcox_pay_simulate_bridge_to_base') return result(id, await paySimulateBridgeToBase(args))
    if (name === 'arcox_pay_simulate_base_treasury_send') return result(id, await paySimulateBaseTreasurySend(args))
    if (name === 'arcox_pay_simulate_nowpayments_finished') return result(id, await paySimulateNowpaymentsFinished(args))
    if (name === 'arcox_pay_simulate_nowpayments_status') return result(id, await paySimulateNowpaymentsStatus(args))
    if (name === 'arcox_pay_list_recent_payments') return result(id, await payListRecentPayments(args))
    if (name === 'arcox_intel_quote_wallet_report') return result(id, await intelQuoteWalletReport(args))
    if (name === 'arcox_intel_execute_wallet_report') return result(id, await intelExecuteWalletReport(args))
    if (name === 'arcox_intel_get_address') return result(id, await intelGetAddress(args))
    if (name === 'arcox_intel_get_tx') return result(id, await intelGetTx(args))
    if (name === 'arcox_intel_get_contract') return result(id, await intelGetContract(args))
    if (name === 'arcox_intel_get_entity') return result(id, await intelGetEntity(args))
    if (name === 'arcox_intel_get_token') return result(id, await intelGetToken(args))
    if (name === 'arcox_intel_search') return result(id, await intelSearch(args))
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
