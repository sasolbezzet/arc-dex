#!/usr/bin/env node
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const agentScript = join(__dirname, 'arcox-agent.mjs')
const args = process.argv.slice(2)

function printHelp() {
  console.log(`ARCOX Codex CLI Agent

Natural-language commands:
  npm run codex-agent -- "send 1 USDC to 0x..."
  npm run codex-agent -- "send 1 USDC to 0x..." --yes
  npm run codex-agent -- "swap 10 USDC to EURC"
  npm run codex-agent -- "bridge 5 USDC from Arbitrum Sepolia to Arc"
  npm run codex-agent -- "retry bridge 0xBURN_TX from Arc to Arbitrum Sepolia" --yes
  npm run codex-agent -- "create job audit app for 1 USDC" --yes

Connection commands:
  npm run codex-agent -- setup
  npm run codex-agent -- identity
  npm run codex-agent -- connect
  npm run codex-agent -- serve --port 8787
  npm run codex-agent -- status

Direct ARCOX agent commands:
  npm run codex-agent -- register --metadata-uri ipfs://...
  npm run codex-agent -- read-agent --agent-id 1
  npm run codex-agent -- read-job --job-id 1
  npm run codex-agent -- retry-bridge --burn-tx 0x... --from-chain Arc_Testnet --to-chain Arbitrum_Sepolia
  npm run codex-agent -- submit --job-id 1 --deliverable "proof"
  npm run codex-agent -- complete --job-id 1 --reason "approved"
`)
}

function runAgent(agentArgs) {
  const result = spawnSync(process.execPath, [agentScript, ...agentArgs], {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: process.env,
  })
  process.exit(result.status ?? 1)
}

if (args.length === 0 || args[0] === 'help' || args[0] === '--help') {
  printHelp()
  process.exit(0)
}

if (args[0] === 'setup') {
  runAgent(['env-template'])
}

const passthrough = new Set([
  'env-template',
  'identity',
  'connect',
  'serve',
  'ask',
  'status',
  'register',
  'read-agent',
  'create-job',
  'read-job',
  'retry-bridge',
  'set-budget',
  'fund',
  'submit',
  'complete',
])

if (passthrough.has(args[0])) {
  runAgent(args)
}

const yes = args.includes('--yes')
const promptParts = args.filter(item => item !== '--yes')
const prompt = promptParts.join(' ').trim()
if (!prompt) {
  printHelp()
  process.exit(0)
}

runAgent(['run', '--prompt', prompt, ...(yes ? ['--yes'] : [])])
