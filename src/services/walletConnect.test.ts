import { describe, expect, it } from 'vitest'
import { shouldWaitForWalletConnectPairing } from './walletConnect'

describe('WalletConnect pairing state', () => {
  it('does not wait for a URI when a persisted session exists', () => {
    expect(shouldWaitForWalletConnectPairing({ session: { topic: 'persisted' } })).toBe(false)
  })

  it('waits for a URI only for a fresh pairing', () => {
    expect(shouldWaitForWalletConnectPairing({ session: null })).toBe(true)
    expect(shouldWaitForWalletConnectPairing(null)).toBe(true)
  })
})
