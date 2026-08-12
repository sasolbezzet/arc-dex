import { findConnectedWalletProvider, normalizeWalletProvider } from '../walletProvider'

export const ARC_TESTNET_CHAIN_ID = '0x4cef52'

// Public Arc RPC is the primary endpoint. dRPC is used as a fallback.
export const ARC_TESTNET_PUBLIC_RPC = 'https://rpc.testnet.arc.io'
export const ARC_TESTNET_DRPC_RPC = 'https://arc-testnet.drpc.org'
export const ARC_TESTNET_RPC_URLS = [ARC_TESTNET_PUBLIC_RPC, ARC_TESTNET_DRPC_RPC]

export const ARC_TESTNET_ADD_PARAMS = {
  chainId: ARC_TESTNET_CHAIN_ID,
  chainName: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: ARC_TESTNET_RPC_URLS,
  blockExplorerUrls: ['https://testnet.arcscan.app'],
}

export const ARC_TESTNET_EXPLORER_TX = 'https://testnet.arcscan.app/tx/'

declare global {
  interface Window {
    ethereum?: any
  }
}

export async function switchToArcTestnet(expectedAddress?: string | null) {
  const rawProvider = await findConnectedWalletProvider(expectedAddress)
  if (!rawProvider) throw new Error('Wallet EVM tidak terdeteksi.')
  const provider = normalizeWalletProvider(rawProvider)
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: ARC_TESTNET_CHAIN_ID }],
    })
  } catch (e: any) {
    if (e?.code !== 4902 && e?.code !== -32603) throw e
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [ARC_TESTNET_ADD_PARAMS],
    })
  }
}
