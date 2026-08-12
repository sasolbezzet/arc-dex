import { describe, expect, it } from 'vitest'
import { isSuccessfulUserOpReceipt } from './mscaPolicy'

describe('Circle UserOperation receipt handling', () => {
  it('accepts a successful receipt', () => {
    expect(isSuccessfulUserOpReceipt({ success: true, receipt: { status: '0x1' } })).toBe(true)
    expect(isSuccessfulUserOpReceipt({ success: true, receipt: { status: 'success' } })).toBe(true)
  })

  it('does not treat an incomplete or reverted receipt as successful', () => {
    expect(isSuccessfulUserOpReceipt({ success: true, receipt: {} })).toBe(false)
    expect(isSuccessfulUserOpReceipt({ success: true, receipt: { status: '0x0' } })).toBe(false)
    expect(isSuccessfulUserOpReceipt({ success: false, receipt: { status: '0x1' } })).toBe(false)
  })
})
