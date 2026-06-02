export type ChainKey =
  | 'Arc_Testnet'
  | 'Ethereum_Sepolia'
  | 'Base_Sepolia'
  | 'Arbitrum_Sepolia'
  | 'HyperEVM_Testnet'
  | 'Solana_Devnet'

export interface ChainCfg {
  id: ChainKey
  label: string
  chainId: string | null // EVM chainId hex, null untuk non-EVM
  domain: number
  tokenMessenger: string | null
  usdc: string | null
  explorer: string
  isEvm: boolean
  isInstantFinality: boolean
  addParams: null | {
    chainId: string
    chainName: string
    nativeCurrency: { name: string; symbol: string; decimals: number }
    rpcUrls: string[]
    blockExplorerUrls: string[]
  }
}

export const MESSAGE_TRANSMITTER_V2 = '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275'
export const TOKEN_MESSENGER_V2_EVM = '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA'
export const IRIS = 'https://iris-api-sandbox.circle.com'

export const CHAINS: ChainCfg[] = [
  {
    id: 'Arc_Testnet',
    label: 'Arc Testnet',
    chainId: '0x4cef52',
    domain: 26,
    tokenMessenger: TOKEN_MESSENGER_V2_EVM,
    usdc: '0x3600000000000000000000000000000000000000',
    explorer: 'https://testnet.arcscan.app',
    isEvm: true,
    isInstantFinality: true,
    addParams: {
      chainId: '0x4cef52',
      chainName: 'Arc Testnet',
      nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
      rpcUrls: ['https://rpc.testnet.arc.network/'],
      blockExplorerUrls: ['https://testnet.arcscan.app'],
    },
  },
  {
    id: 'Ethereum_Sepolia',
    label: 'Ethereum Sepolia',
    chainId: '0xaa36a7',
    domain: 0,
    tokenMessenger: TOKEN_MESSENGER_V2_EVM,
    usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    explorer: 'https://sepolia.etherscan.io',
    isEvm: true,
    isInstantFinality: false,
    addParams: {
      chainId: '0xaa36a7',
      chainName: 'Ethereum Sepolia',
      nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 },
      rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com', 'https://rpc.sepolia.org'],
      blockExplorerUrls: ['https://sepolia.etherscan.io'],
    },
  },
  {
    id: 'Base_Sepolia',
    label: 'Base Sepolia',
    chainId: '0x14a34',
    domain: 6,
    tokenMessenger: TOKEN_MESSENGER_V2_EVM,
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    explorer: 'https://sepolia.basescan.org',
    isEvm: true,
    isInstantFinality: false,
    addParams: {
      chainId: '0x14a34',
      chainName: 'Base Sepolia',
      nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 },
      rpcUrls: ['https://sepolia.base.org'],
      blockExplorerUrls: ['https://sepolia.basescan.org'],
    },
  },
  {
    id: 'Arbitrum_Sepolia',
    label: 'Arbitrum Sepolia',
    chainId: '0x66eee',
    domain: 3,
    tokenMessenger: TOKEN_MESSENGER_V2_EVM,
    usdc: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
    explorer: 'https://sepolia.arbiscan.io',
    isEvm: true,
    isInstantFinality: false,
    addParams: {
      chainId: '0x66eee',
      chainName: 'Arbitrum Sepolia',
      nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 },
      rpcUrls: ['https://sepolia-rollup.arbitrum.io/rpc'],
      blockExplorerUrls: ['https://sepolia.arbiscan.io'],
    },
  },
  {
    id: 'HyperEVM_Testnet',
    label: 'HyperEVM Testnet',
    chainId: '0x3e6',
    domain: 19,
    tokenMessenger: TOKEN_MESSENGER_V2_EVM,
    usdc: '0x2B3370eE501B4a559b57D449569354196457D8Ab',
    explorer: 'https://app.hyperliquid-testnet.xyz/explorer',
    isEvm: true,
    isInstantFinality: false,
    addParams: {
      chainId: '0x3e6',
      chainName: 'HyperEVM Testnet',
      nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 },
      rpcUrls: ['https://rpc.hyperliquid-testnet.xyz/evm'],
      blockExplorerUrls: ['https://app.hyperliquid-testnet.xyz/explorer'],
    },
  },
  {
    id: 'Solana_Devnet',
    label: 'Solana Devnet',
    chainId: null,
    domain: 5,
    tokenMessenger: null,
    usdc: null,
    explorer: 'https://explorer.solana.com',
    isEvm: false,
    isInstantFinality: false,
    addParams: null,
  },
]

export function findChain(id: string): ChainCfg | undefined {
  return CHAINS.find(c => c.id === id)
}
