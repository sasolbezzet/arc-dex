#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import solc from 'solc'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = dirname(__dirname)
const outDir = join(root, 'artifacts')
mkdirSync(outDir, { recursive: true })
compileOne('ArcoxRouter.sol', 'ArcoxRouter', { viaIR: false })
compileOne('ArcoxNativeSwapBridgeRouter.sol', 'ArcoxNativeSwapBridgeRouter', { viaIR: true })

function compileOne(sourceName, contractName, { viaIR }) {
  const input = {
    language: 'Solidity',
    sources: { [sourceName]: { content: readFileSync(join(root, 'contracts', sourceName), 'utf8') } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR,
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
  const contract = output.contracts[sourceName][contractName]
  writeFileSync(join(outDir, `${contractName}.json`), JSON.stringify({
    contractName,
    abi: contract.abi,
    bytecode: `0x${contract.evm.bytecode.object}`,
    deployedBytecode: `0x${contract.evm.deployedBytecode.object}`,
  }, null, 2))
  console.log(`Compiled ${contractName} -> ${join(outDir, `${contractName}.json`)}`)
}
