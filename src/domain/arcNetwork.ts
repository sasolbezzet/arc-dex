export const ARC_TESTNET_CHAIN_ID = '0x4cef52'

export const ARC_TESTNET_ADD_PARAMS = {
  chainId: ARC_TESTNET_CHAIN_ID,
  chainName: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: ['https://rpc.testnet.arc.network/'],
  blockExplorerUrls: ['https://testnet.arcscan.app'],
}

export const ARC_TESTNET_EXPLORER_TX = 'https://testnet.arcscan.app/tx/'

declare global {
  interface Window {
    ethereum?: any
  }
}

export async function switchToArcTestnet() {
  if (!window.ethereum) throw new Error('MetaMask tidak terdeteksi.')
  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: ARC_TESTNET_CHAIN_ID }],
    })
  } catch (e: any) {
    if (e?.code !== 4902 && e?.code !== -32603) throw e
    await window.ethereum.request({
      method: 'wallet_addEthereumChain',
      params: [ARC_TESTNET_ADD_PARAMS],
    })
  }
}
