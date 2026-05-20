export interface CircleWallet { id: string; address: string }
export interface Balances { USDC: string; EURC: string; USYC: string }
export type Tab = 'swap' | 'bridge' | 'send' | 'info'