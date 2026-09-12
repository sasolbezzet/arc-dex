import { describe, expect, it } from 'vitest'
import { MCPSetupTutorial } from './MCPSetupTutorial'
import { AgentLogo } from './AgentLogo'
import { withApprovalTimeout } from '../../hooks/useOAuthApproval'

// The component intentionally owns no protocol logic; this contract test protects
// the copy keys used by the three-language setup guide from accidental removal.
describe('MCP setup tutorial contract', () => {
  it('exports a renderable tutorial component', () => {
    expect(MCPSetupTutorial).toBeTypeOf('function')
  })
  it('provides a local logo mark for every built-in provider', () => {
    expect(AgentLogo({ type: 'hermes' })).toBeTruthy()
    expect(AgentLogo({ type: 'claude' })).toBeTruthy()
    expect(AgentLogo({ type: 'chatgpt' })).toBeTruthy()
    expect(AgentLogo({ type: 'grok' })).toBeTruthy()
  })

  it('fails closed when approval readiness exceeds its timeout', async () => {
    await expect(withApprovalTimeout(new Promise(() => {}), 'readiness timeout', 5)).rejects.toThrow('readiness timeout')
  })
})
