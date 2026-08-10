import { describe, expect, it } from 'vitest'
import {
  AUTO_MINT_HANDOFF_MS,
  acquireMintLock,
  isAutoMintWorkerTerminal,
  releaseMintLock,
  shouldHandoffToAutoMintWorker,
} from './autoMintWorker'

describe('auto-mint worker handoff policy', () => {
  it('does not hand off before 30 seconds', () => {
    expect(shouldHandoffToAutoMintWorker(10_000, 10_000 + AUTO_MINT_HANDOFF_MS - 1)).toBe(false)
  })

  it('hands off at 30 seconds', () => {
    expect(shouldHandoffToAutoMintWorker(10_000, 10_000 + AUTO_MINT_HANDOFF_MS)).toBe(true)
  })

  it('recognizes ready, timeout, and error as terminal states', () => {
    expect(isAutoMintWorkerTerminal('ready')).toBe(true)
    expect(isAutoMintWorkerTerminal('timeout')).toBe(true)
    expect(isAutoMintWorkerTerminal('error')).toBe(true)
    expect(isAutoMintWorkerTerminal('polling')).toBe(false)
  })

  it('prevents concurrent mint attempts for the same burn', () => {
    const burn = `0x${'ab'.repeat(32)}`
    releaseMintLock(burn)
    expect(acquireMintLock(burn, 1_000)).toBe(true)
    expect(acquireMintLock(burn, 2_000)).toBe(false)
    releaseMintLock(burn)
    expect(acquireMintLock(burn, 2_000)).toBe(true)
    releaseMintLock(burn)
  })
})
