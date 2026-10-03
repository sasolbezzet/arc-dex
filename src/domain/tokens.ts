export type ArcToken = 'USDC' | 'EURC' | 'USYC' | 'cirBTC'
export type SwapToken = 'USDC' | 'EURC' | 'cirBTC'

export const ARC_TOKENS: Record<ArcToken, { symbol: ArcToken; address: `0x${string}`; decimals: number }> = {
  USDC: { symbol: 'USDC', address: '0x3600000000000000000000000000000000000000', decimals: 6 },
  EURC: { symbol: 'EURC', address: '0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1', decimals: 6 },
  USYC: { symbol: 'USYC', address: '0x8a5D989Bbb96929F689B0200f435f53dA42bF490', decimals: 6 },
  // cirBTC Arc Mainnet (docs.arc.io contract-addresses) — live sejak 24 Sep 2026
  // dan dirutekan Circle Stablecoin Service (provider LiFi) untuk swap.
  cirBTC: { symbol: 'cirBTC', address: '0x171A4217b86A807A64eB94757Db6849fb4bDbAA0', decimals: 8 },
}

export const SEND_TOKENS: ArcToken[] = ['USDC', 'EURC', 'USYC']
export const SWAP_TOKENS: SwapToken[] = ['USDC', 'EURC', 'cirBTC']

export function getArcToken(symbol: string) {
  return ARC_TOKENS[symbol as ArcToken]
}
