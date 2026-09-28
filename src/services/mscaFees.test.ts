import { describe, expect, it } from 'vitest'
import { mscaFeeFloor } from './mscaFees'

describe('MSCA UserOperation fee floor', () => {
  it('keeps the 1 gwei floor Arc mainnet requires', () => {
    expect(mscaFeeFloor('arc-mainnet')).toEqual({
      maxPriorityFeePerGas: 1_000_000_000n,
      maxFeePerGas: 2_000_000_000n,
    })
    expect(mscaFeeFloor('arc-testnet').maxPriorityFeePerGas).toBe(1_000_000_000n)
  })

  it('does not apply the Arc floor to Base or Arbitrum', () => {
    // The Arc floor inflated the fee 50-400x on these chains, which the Gas
    // Station paymaster rejected as `Exceeded max spend USD per transaction`.
    for (const chainKey of ['base-mainnet', 'arbitrum-mainnet', 'base-sepolia', 'arbitrum-sepolia']) {
      expect(mscaFeeFloor(chainKey).maxPriorityFeePerGas).toBe(1_000_000n)
      expect(mscaFeeFloor(chainKey).maxFeePerGas).toBe(2_000_000n)
    }
  })
})
