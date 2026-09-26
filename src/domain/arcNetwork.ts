import { findConnectedWalletProvider, normalizeWalletProvider } from '../walletProvider'

// Arc mainnet. Semua nilai diverifikasi on-chain (chainId 5042, USDC symbol(),
// CCTP v2 MessageTransmitterV2.localDomain() = 26); lihat juga registry backend
// `arc-dex-api/src/config/arcNetwork.mjs` yang memakai nilai yang sama.
export const ARC_MAINNET_CHAIN_ID = '0x13b2'

// RPC mainnet publik Arc dipakai sebagai endpoint utama.
export const ARC_MAINNET_PUBLIC_RPC = 'https://rpc.mainnet.arc.io'
export const ARC_MAINNET_RPC_URLS = [ARC_MAINNET_PUBLIC_RPC]

export const ARC_MAINNET_ADD_PARAMS = {
  chainId: ARC_MAINNET_CHAIN_ID,
  chainName: 'Arc Mainnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: ARC_MAINNET_RPC_URLS,
  blockExplorerUrls: ['https://explorer.arc.io'],
}

export const ARC_MAINNET_EXPLORER_TX = 'https://explorer.arc.io/tx/'

declare global {
  interface Window {
    ethereum?: any
  }
}

export async function switchToArcMainnet(expectedAddress?: string | null) {
  const rawProvider = await findConnectedWalletProvider(expectedAddress)
  if (!rawProvider) throw new Error('Wallet EVM tidak terdeteksi.')
  const provider = normalizeWalletProvider(rawProvider)
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: ARC_MAINNET_CHAIN_ID }],
    })
  } catch (e: any) {
    if (e?.code !== 4902 && e?.code !== -32603) throw e
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [ARC_MAINNET_ADD_PARAMS],
    })
  }
}
