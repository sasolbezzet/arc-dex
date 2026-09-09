import { describe, expect, it } from 'vitest'
import type { AgentReadiness } from '../types/agent'

describe('agent readiness contract', () => {
  it('keeps MCP connection separate from execution readiness', () => {
    const readiness: AgentReadiness = {
      agentKey: 'arcox_conn_demo|0x1111111111111111111111111111111111111111',
      clientId: 'arcox_conn_demo',
      agentType: 'hermes',
      revoked: false,
      mcp: { configured: true, connected: true, tokenActive: true, tokenExpiresAt: null },
      execution: {
        ready: false,
        sessionActive: true,
        arcAuthorized: true,
        destinations: { 'base-sepolia': false, 'arbitrum-sepolia': true },
        reason: 'destination_session_not_authorized',
      },
    }
    expect(readiness.mcp.connected).toBe(true)
    expect(readiness.execution.ready).toBe(false)
    expect(readiness.execution.destinations['base-sepolia']).toBe(false)
  })
})
