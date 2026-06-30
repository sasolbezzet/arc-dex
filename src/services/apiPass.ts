import { decodeEventLog, encodeFunctionData, getAddress } from 'viem'
import { switchToArcTestnet } from '../domain/arcNetwork'

export const API_PASS_ABI = [
  { type: 'function', name: 'mintApiPass', stateMutability: 'nonpayable', inputs: [{ name: 'owner', type: 'address' }, { name: 'apiKeyIdHash', type: 'bytes32' }, { name: 'metadataURI', type: 'string' }], outputs: [{ name: 'tokenId', type: 'uint256' }] },
  { type: 'function', name: 'burnApiPass', stateMutability: 'nonpayable', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [] },
  { type: 'event', name: 'ApiPassMinted', inputs: [{ name: 'owner', type: 'address', indexed: true }, { name: 'tokenId', type: 'uint256', indexed: true }, { name: 'apiKeyIdHash', type: 'bytes32', indexed: true }] },
] as const

export async function mintApiPass(input: { contractAddress: string; ownerAddress: string; apiKeyIdHash: `0x${string}` }) {
  await switchToArcTestnet()
  const from = getAddress(input.ownerAddress)
  const data = encodeFunctionData({ abi: API_PASS_ABI, functionName: 'mintApiPass', args: [from, input.apiKeyIdHash, ''] })
  const txHash = await window.ethereum.request({ method: 'eth_sendTransaction', params: [{ from, to: getAddress(input.contractAddress), data }] })
  const receipt = await waitForReceipt(txHash)
  const minted = receipt.logs.map((log: any) => {
    try { return decodeEventLog({ abi: API_PASS_ABI, data: log.data, topics: log.topics }) } catch { return null }
  }).find((event: any) => event?.eventName === 'ApiPassMinted') as any
  if (!minted?.args?.tokenId) throw new Error('API Pass mint event was not found')
  return { txHash, sbtTokenId: String(minted.args.tokenId) }
}

export async function burnApiPass(input: { contractAddress: string; ownerAddress: string; sbtTokenId: string }) {
  await switchToArcTestnet()
  const from = getAddress(input.ownerAddress)
  const data = encodeFunctionData({ abi: API_PASS_ABI, functionName: 'burnApiPass', args: [BigInt(input.sbtTokenId)] })
  const txHash = await window.ethereum.request({ method: 'eth_sendTransaction', params: [{ from, to: getAddress(input.contractAddress), data }] })
  await waitForReceipt(txHash)
  return { txHash }
}

async function waitForReceipt(txHash: string) {
  for (let i = 0; i < 90; i += 1) {
    const receipt = await window.ethereum.request({ method: 'eth_getTransactionReceipt', params: [txHash] })
    if (receipt) {
      if (receipt.status !== '0x1') throw new Error('API Pass transaction reverted')
      return receipt
    }
    await new Promise(resolve => window.setTimeout(resolve, 1000))
  }
  throw new Error('API Pass transaction confirmation timed out')
}
