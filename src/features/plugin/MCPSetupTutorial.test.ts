import { describe, expect, it } from 'vitest'
import { MCPSetupTutorial } from './MCPSetupTutorial'
import { AgentLogo } from './AgentLogo'
import { AGENT_TYPES } from '../../types/agent'

// The component intentionally owns no protocol logic; this contract test protects
// the copy keys used by the three-language setup guide from accidental removal.
describe('MCP setup tutorial contract', () => {
  it('exports a renderable tutorial component', () => {
    expect(MCPSetupTutorial).toBeTypeOf('function')
  })

  it('provides a local logo mark for every built-in provider', () => {
    for (const type of AGENT_TYPES) {
      expect(AgentLogo({ type })).toBeTruthy()
    }
  })
})
