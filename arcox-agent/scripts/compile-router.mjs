#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import solc from 'solc'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = dirname(__dirname)
const sourcePath = join(root, 'contracts', 'ArcoxRouter.sol')
const source = readFileSync(sourcePath, 'utf8')

const input = {
  language: 'Solidity',
  sources: { 'ArcoxRouter.sol': { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: {
      '*': {
        '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'],
      },
    },
  },
}

const output = JSON.parse(solc.compile(JSON.stringify(input)))
const errors = output.errors || []
for (const error of errors) {
  const printer = error.severity === 'error' ? console.error : console.warn
  printer(error.formattedMessage)
}
if (errors.some(error => error.severity === 'error')) process.exit(1)

const contract = output.contracts['ArcoxRouter.sol'].ArcoxRouter
const outDir = join(root, 'artifacts')
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'ArcoxRouter.json'), JSON.stringify({
  contractName: 'ArcoxRouter',
  abi: contract.abi,
  bytecode: `0x${contract.evm.bytecode.object}`,
  deployedBytecode: `0x${contract.evm.deployedBytecode.object}`,
}, null, 2))
console.log(`Compiled ArcoxRouter -> ${join(outDir, 'ArcoxRouter.json')}`)
