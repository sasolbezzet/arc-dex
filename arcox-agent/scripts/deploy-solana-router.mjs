#!/usr/bin/env node
import { copyFileSync, existsSync } from 'fs'
import { join } from 'path'
import { spawnSync } from 'child_process'
import { dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = dirname(__dirname)
const routerDir = join(root, 'solana-router')

function has(cmd) {
  const result = spawnSync('bash', ['-lc', `command -v ${cmd}`], { encoding: 'utf8' })
  return result.status === 0 && result.stdout.trim()
}

function fail(message) {
  console.error(JSON.stringify({
    status: 'blocked',
    target: 'Solana_Devnet',
    reason: message,
    required: [
      'Install Solana CLI',
      'Install Anchor CLI',
      'Set a funded devnet fee payer at ~/.config/solana/id.json',
      'Replace placeholder declare_id/program id with `anchor keys sync` output',
      'Run this script again',
    ],
  }, null, 2))
  process.exit(1)
}

if (!existsSync(routerDir)) fail(`Missing router directory: ${routerDir}`)
if (!has('solana')) fail('Solana CLI is not installed on this machine.')
if (!has('anchor')) fail('Anchor CLI is not installed on this machine.')

const keypairPath = process.env.SOLANA_KEYPAIR || `${process.env.HOME}/.config/solana/id.json`
if (!existsSync(keypairPath)) fail(`Missing Solana keypair: ${keypairPath}`)

const cluster = process.env.SOLANA_DEVNET_RPC || 'https://api.devnet.solana.com'
console.log(`[solana-router] cluster=${cluster}`)
spawnSync('solana', ['config', 'set', '--url', cluster, '--keypair', keypairPath], { stdio: 'inherit' })

const build = spawnSync('anchor', ['build', '--arch', 'sbf'], { cwd: routerDir, stdio: 'inherit' })
if (build.status !== 0) process.exit(build.status || 1)

const builtSo = join(routerDir, 'programs', 'arcox-solana-router', 'target', 'sbpf-solana-solana', 'release', 'arcox_solana_router.so')
const deploySo = join(routerDir, 'target', 'deploy', 'arcox_solana_router.so')
if (existsSync(builtSo)) copyFileSync(builtSo, deploySo)
if (!existsSync(deploySo)) fail(`Missing deploy artifact: ${deploySo}`)

const deploy = spawnSync('anchor', ['deploy'], { cwd: routerDir, stdio: 'inherit' })
if (deploy.status !== 0) process.exit(deploy.status || 1)

console.log(JSON.stringify({
  status: 'deployed',
  target: 'Solana_Devnet',
  note: 'Run initialize instruction with treasury USDC token account before using transfer_with_fee.',
}, null, 2))
