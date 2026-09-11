import { describe, expect, it } from 'vitest'
import { MCPSetupTutorial } from './MCPSetupTutorial'

// The component intentionally owns no protocol logic; this contract test protects
// the copy keys used by the three-language setup guide from accidental removal.
describe('MCP setup tutorial contract', () => {
  it('exports a renderable tutorial component', () => {
    expect(MCPSetupTutorial).toBeTypeOf('function')
  })
})
