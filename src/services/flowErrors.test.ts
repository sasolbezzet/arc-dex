import { describe, expect, it } from 'vitest'
import { classifyFlowError, flowErrorText } from './flowErrors'
import type { MessageKey } from '../i18n'

// Stub translator: keeps assertions independent of the catalogue wording but
// still proves which keys are selected and that params are passed through.
const t = (key: MessageKey, params?: Record<string, string | number>) =>
  params?.detail ? `${key}:${params.detail}` : key

describe('flow error classification', () => {
  it('separates empty balance from an unavailable route and from configuration', () => {
    expect(classifyFlowError(new Error('Insufficient token balance on Arc')).code).toBe('insufficient_balance')
    expect(classifyFlowError(new Error('NO_SWAP_ROUTE')).code).toBe('no_route')
    expect(classifyFlowError(new Error('The entity secret has not been set yet')).code).toBe('config')
    expect(classifyFlowError(new Error('Wallet authentication required')).code).toBe('auth')
  })

  it('keeps the original message as detail so amounts and addresses are not lost', () => {
    const text = flowErrorText(t, new Error('Insufficient token balance on Arc'), 'bridge')
    expect(text.split('\n')).toEqual([
      'flow.titleBridge',
      'flow.balance',
      'flow.balanceHint',
      'flow.detail:Insufficient token balance on Arc',
    ])
  })

  it('uses the original message as the explanation when the cause is unknown', () => {
    const text = flowErrorText(t, new Error('RPC timeout after 3 retries'), 'swap')
    expect(text.split('\n')).toEqual(['flow.titleSwap', 'RPC timeout after 3 retries', 'flow.unknownHint'])
  })

  it('still explains a configuration failure that carries no message', () => {
    const text = flowErrorText(t, undefined, 'swap')
    expect(text.split('\n')).toEqual(['flow.titleSwap', 'flow.unknown', 'flow.unknownHint'])
  })
})
