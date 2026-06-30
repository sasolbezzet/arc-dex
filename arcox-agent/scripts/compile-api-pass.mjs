#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import solc from 'solc'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const sourceName = 'ArcoxApiPass.sol'
const contractName = 'ArcoxApiPass'
const input = {
  language: 'Solidity',
  sources: { [sourceName]: { content: readFileSync(join(root, 'contracts', sourceName), 'utf8') } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
  },
}
const output = JSON.parse(solc.compile(JSON.stringify(input)))
for (const error of output.errors || []) (error.severity === 'error' ? console.error : console.warn)(error.formattedMessage)
if ((output.errors || []).some(error => error.severity === 'error')) process.exit(1)
const contract = output.contracts[sourceName][contractName]
const outDir = join(root, 'artifacts')
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, `${contractName}.json`), JSON.stringify({
  contractName,
  abi: contract.abi,
  bytecode: `0x${contract.evm.bytecode.object}`,
  deployedBytecode: `0x${contract.evm.deployedBytecode.object}`,
}, null, 2))
console.log(`Compiled ${contractName}`)
