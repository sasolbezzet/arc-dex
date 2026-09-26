export type ArcToken = 'USDC' | 'EURC' | 'USYC' | 'cirBTC'
export type SwapToken = 'USDC' | 'EURC' | 'cirBTC'

export const ARC_TOKENS: Record<ArcToken, { symbol: ArcToken; address: `0x${string}`; decimals: number }> = {
  USDC: { symbol: 'USDC', address: '0x3600000000000000000000000000000000000000', decimals: 6 },
  EURC: { symbol: 'EURC', address: '0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1', decimals: 6 },
  USYC: { symbol: 'USYC', address: '0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C', decimals: 6 },
  // cirBTC belum ada di Arc mainnet (alamat testnet tidak punya kode on-chain),
  // jadi alamatnya dikosongkan dan token ini tidak ditawarkan di UI.
  cirBTC: { symbol: 'cirBTC', address: '0x0000000000000000000000000000000000000000', decimals: 8 },
}

export const SEND_TOKENS: ArcToken[] = ['USDC', 'EURC', 'USYC']
export const SWAP_TOKENS: SwapToken[] = ['USDC', 'EURC']

export const UNAVAILABLE_MAINNET_TOKENS: ArcToken[] = ['cirBTC']

export function getArcToken(symbol: string) {
  return ARC_TOKENS[symbol as ArcToken]
}
