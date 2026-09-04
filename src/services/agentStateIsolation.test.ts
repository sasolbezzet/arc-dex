import { describe, expect, it, beforeEach } from 'vitest'
import { clearMscaState, getMscaState } from './modularWallet'

describe('agent MSCA state isolation', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('keeps Claude, Hermes, and GPT records in separate namespaces', () => {
    const agents = ['oauth:claude', 'hermes-mcp', 'oauth:chatgpt']
    const addresses = ['0xclaude', '0xhermes', '0xgpt']

    agents.forEach((agentKey, index) => {
      localStorage.setItem(`arx_msca_state:${agentKey}`, JSON.stringify({
        walletAddress: addresses[index],
        sessionActive: true,
        delegateAddress: `0xdelegate${index}`,
      }))
    })

    expect(getMscaState('oauth:claude').walletAddress).toBe('0xclaude')
    expect(getMscaState('hermes-mcp').walletAddress).toBe('0xhermes')
    expect(getMscaState('oauth:chatgpt').walletAddress).toBe('0xgpt')
    expect(getMscaState('oauth:claude').delegateAddress).not.toBe(getMscaState('hermes-mcp').delegateAddress)
  })

  it('clears only the selected agent state', () => {
    localStorage.setItem('arx_msca_state:oauth:claude', JSON.stringify({ walletAddress: '0xclaude' }))
    localStorage.setItem('arx_msca_state:hermes-mcp', JSON.stringify({ walletAddress: '0xhermes' }))

    clearMscaState('hermes-mcp')

    expect(getMscaState('oauth:claude').walletAddress).toBe('0xclaude')
    expect(getMscaState('hermes-mcp').walletAddress).toBeUndefined()
  })
})
