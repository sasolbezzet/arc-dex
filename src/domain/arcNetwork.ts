import { getWalletProvider } from '../walletProvider'

export const ARC_TESTNET_CHAIN_ID = '0x4cef52'

// Public Arc RPC is deliberately used for browser wallets. DRPC requires a
// private Bearer key, which must never be exposed in frontend RPC URLs.
export const ARC_TESTNET_PUBLIC_RPC = 'https://rpc.testnet.arc.network'

export const ARC_TESTNET_ADD_PARAMS = {
  chainId: ARC_TESTNET_CHAIN_ID,
  chainName: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: [ARC_TESTNET_PUBLIC_RPC],
  blockExplorerUrls: ['https://testnet.arcscan.app'],
}

export const ARC_TESTNET_EXPLORER_TX = 'https://testnet.arcscan.app/tx/'

declare global {
  interface Window {
    ethereum?: any
  }
}

export async function switchToArcTestnet() {
  const provider = getWalletProvider()
  if (!provider) throw new Error('Wallet EVM tidak terdeteksi.')
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
