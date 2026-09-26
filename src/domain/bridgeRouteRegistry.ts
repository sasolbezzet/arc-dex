export type BridgeRegistryToken = 'USDC' | 'EURC' | 'cirBTC'

export type BridgeRouteRegistryItem = {
  sourceChain: string
  destinationChain: string
  sourceToken: BridgeRegistryToken
  receiveToken: BridgeRegistryToken
  sourceTokenAddress?: string
  destinationTokenAddress?: string
  usdcAddressSource?: string
  usdcAddressDestination?: string
  swapAvailable: boolean
  burnAvailable: boolean
  mintAvailable: boolean
  destinationSwapAvailable: boolean
  multicallAvailable: boolean
  routeAvailable: boolean
  unavailableReason?: string
}

// Alamat token mainnet, semua diverifikasi on-chain lewat symbol()/decimals()
// sebelum dipakai. Token yang belum bisa diverifikasi sengaja tidak didaftarkan
// supaya route-nya gagal-tertutup (bukan diam-diam memakai alamat mainnet).
export const MAINNET_TOKEN_ADDRESSES = {
  USDC: {
    Arc: '0x3600000000000000000000000000000000000000',
    Ethereum: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    Base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    Arbitrum: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    HyperEVM: '0xb88339CB7199b77E23DB6E890353E22632Ba630f',
    Solana: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  },
  EURC: {
    Arc: '0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1',
    Ethereum: '0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c',
    Base: '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42',
  },
  // cirBTC belum ada di mainnet (hanya Arc Mainnet + Ethereum).
  cirBTC: {},
} as const

export function describeBridgeRoute(input: {
  sourceChain: string
  destinationChain: string
  sourceToken: BridgeRegistryToken
  receiveToken: BridgeRegistryToken
}): BridgeRouteRegistryItem {
  const sourceTokenAddress = tokenAddress(input.sourceToken, input.sourceChain)
  const destinationTokenAddress = tokenAddress(input.receiveToken, input.destinationChain)
  const usdcAddressSource = tokenAddress('USDC', input.sourceChain)
  const usdcAddressDestination = tokenAddress('USDC', input.destinationChain)
  // Router AMM ARCOX belum di-deploy di mainnet, jadi "swap sebelum bridge"
  // hanya tersedia kalau token sumbernya memang USDC (tanpa swap).
  const sourceSwapAvailable = input.sourceToken === 'USDC'
  const destinationSwapAvailable = input.receiveToken === 'USDC'
  const burnAvailable = Boolean(usdcAddressSource)
  const mintAvailable = Boolean(usdcAddressDestination)
  const cirbtcUnavailable = input.sourceToken === 'cirBTC' || input.receiveToken === 'cirBTC'
  const sameChain = input.sourceChain === input.destinationChain
  const routeAvailable = Boolean(
    !sameChain &&
    sourceTokenAddress &&
    destinationTokenAddress &&
    burnAvailable &&
    mintAvailable &&
    !cirbtcUnavailable &&
    sourceSwapAvailable &&
    destinationSwapAvailable,
  )
  return {
    ...input,
    sourceTokenAddress,
    destinationTokenAddress,
    usdcAddressSource,
    usdcAddressDestination,
    swapAvailable: sourceSwapAvailable,
    burnAvailable,
    mintAvailable,
    destinationSwapAvailable,
    multicallAvailable: false,
    routeAvailable,
    unavailableReason: routeAvailable
      ? undefined
      : cirbtcUnavailable
        ? 'cirBTC belum tersedia di mainnet; route cirBTC hanya aktif di Arc Mainnet.'
        : sameChain
          ? 'Source and destination chain must be different.'
          : !sourceTokenAddress
            ? 'Source token is not available on the selected mainnet chain.'
            : !destinationTokenAddress
              ? 'Receive token is not available on the selected mainnet chain.'
              : !sourceSwapAvailable
                ? 'Swap sebelum bridge belum tersedia di mainnet (router AMM belum di-deploy). Bridge USDC dari chain ini.'
                : !destinationSwapAvailable
                  ? 'Receive-token swap after mint is not enabled yet. Receive USDC, then swap on Arc once the mainnet router is live.'
                  : 'Route unavailable for selected source token, destination chain, or receive token.',
  }
}

function tokenAddress(token: BridgeRegistryToken, chain: string) {
  const byChain = MAINNET_TOKEN_ADDRESSES[token] as Record<string, string | undefined>
  return byChain[chain]
}
