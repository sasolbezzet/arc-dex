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

export const TESTNET_TOKEN_ADDRESSES = {
  USDC: {
    Arc_Testnet: '0x3600000000000000000000000000000000000000',
    Ethereum_Sepolia: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    Base_Sepolia: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    Arbitrum_Sepolia: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
  },
  EURC: {
    Arc_Testnet: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a',
    Ethereum_Sepolia: '0x08210F9170F89Ab7658F0B5E3fF39b0E03C594D4',
    Base_Sepolia: '0x808456652fDB597867f38412077A9182bF77359F',
    Solana_Devnet: 'HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr',
  },
  cirBTC: {
    Arc_Testnet: '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF',
  },
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
  const swapAvailable = input.sourceToken === 'USDC'
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
    swapAvailable &&
    destinationSwapAvailable,
  )
  return {
    ...input,
    sourceTokenAddress,
    destinationTokenAddress,
    usdcAddressSource,
    usdcAddressDestination,
    swapAvailable,
    burnAvailable,
    mintAvailable,
    destinationSwapAvailable,
    multicallAvailable: false,
    routeAvailable,
    unavailableReason: routeAvailable
      ? undefined
      : cirbtcUnavailable
        ? 'cirBTC testnet bridge route is unavailable until valid testnet addresses/liquidity exist.'
        : sameChain
          ? 'Source and destination chain must be different.'
          : !sourceTokenAddress
            ? 'Source token is not available on the selected testnet chain.'
            : !destinationTokenAddress
              ? 'Receive token is not available on the selected testnet chain.'
              : !swapAvailable
                ? 'Source-token swap is not enabled for this bridge execution yet; use Swap first, then bridge USDC.'
                : !destinationSwapAvailable
                  ? 'Destination-token swap is not enabled for this bridge execution yet; bridge USDC, then swap on destination.'
                  : 'Route unavailable for selected source token, destination chain, or receive token.',
  }
}

function tokenAddress(token: BridgeRegistryToken, chain: string) {
  const byChain = TESTNET_TOKEN_ADDRESSES[token] as Record<string, string | undefined>
  return byChain[chain]
}
