export type ChainKey =
  | 'Arc'
  | 'Ethereum'
  | 'Base'
  | 'Arbitrum'
  | 'HyperEVM'
  | 'Solana'

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

// CCTP v2 mainnet: alamat deterministik yang sama di semua EVM yang didukung
// (diverifikasi on-chain: kode 2175 byte + MessageTransmitterV2.localDomain()).
export const MESSAGE_TRANSMITTER_V2 = '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64'
export const TOKEN_MESSENGER_V2_EVM = '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d'
export const IRIS = 'https://iris-api.circle.com'

export const CHAINS: ChainCfg[] = [
  {
    id: 'Arc',
    label: 'Arc Mainnet',
    chainId: '0x13b2',
    domain: 26,
    tokenMessenger: TOKEN_MESSENGER_V2_EVM,
    usdc: '0x3600000000000000000000000000000000000000',
    explorer: 'https://explorer.arc.io',
    isEvm: true,
    isInstantFinality: true,
    addParams: {
      chainId: '0x13b2',
      chainName: 'Arc Mainnet',
      nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
      rpcUrls: ['https://rpc.mainnet.arc.io'],
      blockExplorerUrls: ['https://explorer.arc.io'],
    },
  },
  {
    id: 'Ethereum',
    label: 'Ethereum',
    chainId: '0x1',
    domain: 0,
    tokenMessenger: TOKEN_MESSENGER_V2_EVM,
    usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    explorer: 'https://etherscan.io',
    isEvm: true,
    isInstantFinality: false,
    addParams: {
      chainId: '0x1',
      chainName: 'Ethereum',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: ['https://ethereum-rpc.publicnode.com'],
      blockExplorerUrls: ['https://etherscan.io'],
    },
  },
  {
    id: 'Base',
    label: 'Base',
    chainId: '0x2105',
    domain: 6,
    tokenMessenger: TOKEN_MESSENGER_V2_EVM,
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    explorer: 'https://basescan.org',
    isEvm: true,
    isInstantFinality: false,
    addParams: {
      chainId: '0x2105',
      chainName: 'Base',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: ['https://mainnet.base.org'],
      blockExplorerUrls: ['https://basescan.org'],
    },
  },
  {
    id: 'Arbitrum',
    label: 'Arbitrum',
    chainId: '0xa4b1',
    domain: 3,
    tokenMessenger: TOKEN_MESSENGER_V2_EVM,
    usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    explorer: 'https://arbiscan.io',
    isEvm: true,
    isInstantFinality: false,
    addParams: {
      chainId: '0xa4b1',
      chainName: 'Arbitrum One',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: ['https://arb1.arbitrum.io/rpc'],
      blockExplorerUrls: ['https://arbiscan.io'],
    },
  },
  {
    id: 'HyperEVM',
    label: 'HyperEVM',
    chainId: '0x3e7',
    domain: 19,
    tokenMessenger: TOKEN_MESSENGER_V2_EVM,
    usdc: '0xb88339CB7199b77E23DB6E890353E22632Ba630f',
    explorer: 'https://hyperevmscan.io',
    isEvm: true,
    isInstantFinality: false,
    addParams: {
      chainId: '0x3e7',
      chainName: 'HyperEVM',
      nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 },
      rpcUrls: ['https://rpc.hyperliquid.xyz/evm'],
      blockExplorerUrls: ['https://hyperevmscan.io'],
    },
  },
  {
    id: 'Solana',
    label: 'Solana',
    chainId: null,
    domain: 5,
    tokenMessenger: null,
    usdc: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    explorer: 'https://explorer.solana.com',
    isEvm: false,
    isInstantFinality: false,
    addParams: null,
  },
]

export function findChain(id: string): ChainCfg | undefined {
  return CHAINS.find(c => c.id === id)
}
