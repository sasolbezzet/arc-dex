export type ArcToken = 'USDC' | 'EURC' | 'USYC' | 'cirBTC'
export type SwapToken = 'USDC' | 'EURC' | 'cirBTC'

export const ARC_TOKENS: Record<ArcToken, { symbol: ArcToken; address: `0x${string}`; decimals: number }> = {
  USDC: { symbol: 'USDC', address: '0x3600000000000000000000000000000000000000', decimals: 6 },
  EURC: { symbol: 'EURC', address: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a', decimals: 6 },
  USYC: { symbol: 'USYC', address: '0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C', decimals: 6 },
  cirBTC: { symbol: 'cirBTC', address: '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF', decimals: 8 },
}

export const SEND_TOKENS: ArcToken[] = ['USDC', 'EURC', 'USYC', 'cirBTC']
export const SWAP_TOKENS: SwapToken[] = ['USDC', 'EURC', 'cirBTC']

export function getArcToken(symbol: string) {
  return ARC_TOKENS[symbol as ArcToken]
}
