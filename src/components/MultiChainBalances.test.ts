import { describe, expect, it } from 'vitest'
import { chainTokenValue } from './MultiChainBalances'

describe('chainTokenValue', () => {
  it('reads native gas token from nativeBalance instead of a missing flat key', () => {
    const base = { USDC: '0', EURC: '0', nativeBalance: '0.00042', nativeSymbol: 'ETH', status: 'ok' }
    expect(chainTokenValue(base, 'ETH')).toEqual({ value: '0.00042', supported: true })
    expect(chainTokenValue(base, 'USDC')).toEqual({ value: '0', supported: true })
  })

  it('never shows Arc native USDC as ETH', () => {
    const arc = { USDC: '1.931937', EURC: '0.003978', nativeBalance: '1.93193719116321662', nativeSymbol: 'USDC', status: 'ok' }
    expect(chainTokenValue(arc, 'ETH')).toEqual({ value: undefined, supported: false })
  })

  it('marks tokens that are not deployed on a chain as unsupported, not zero', () => {
    const arbitrum = { USDC: '0.004', nativeBalance: '0', nativeSymbol: 'ETH', status: 'ok' }
    expect(chainTokenValue(arbitrum, 'EURC')).toEqual({ value: undefined, supported: false })
    expect(chainTokenValue(undefined, 'USDC')).toEqual({ value: undefined, supported: false })
  })
})
