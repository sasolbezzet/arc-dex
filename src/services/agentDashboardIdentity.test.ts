import { describe, expect, it } from 'vitest'
import { canonicalAgentKey, mergeAgentRows } from '../hooks/useAgentManager'
import { buildHermesConnectionCommand } from '../features/plugin/ConnectionTokenDialog'
import type { VaultAgent } from '../types/agent'

const CLAUDE_WALLET = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const GPT_WALLET = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

function agent(overrides: Partial<VaultAgent>): VaultAgent {
  return {
    agentKey: 'oauth:claude',
    walletAddress: CLAUDE_WALLET,
    clientName: 'Claude',
    ...overrides,
  }
}

describe('Plugin agent identity normalization', () => {
  it('maps the temporary OAuth namespace to the durable key', () => {
    expect(canonicalAgentKey(agent({ agentKey: 'oauth:claude' })))
      .toBe(`claude|${CLAUDE_WALLET}`)
  })

  it('keeps one named Claude row when legacy and canonical rows share a wallet', () => {
    const rows = mergeAgentRows([
      agent({ agentKey: 'oauth:claude', clientName: 'Agent MCP' }),
      agent({ agentKey: `claude|${CLAUDE_WALLET}`, clientName: 'claude-mcp' }),
    ])

    expect(rows).toHaveLength(1)
    expect(rows[0].agentKey).toBe(`claude|${CLAUDE_WALLET}`)
    expect(rows[0].clientName).toBe('claude-mcp')
  })

  it('does not merge Claude and GPT wallets', () => {
    const rows = mergeAgentRows([
      agent({ agentKey: `claude|${CLAUDE_WALLET}`, clientName: 'Claude' }),
      agent({ agentKey: `chatgpt|${GPT_WALLET}`, walletAddress: GPT_WALLET, clientName: 'ChatGPT' }),
    ])

    expect(rows).toHaveLength(2)
    expect(rows.map(row => row.walletAddress)).toEqual([CLAUDE_WALLET, GPT_WALLET])
  })

  it('deduplicates Claude rows when the OAuth client ID rotated but wallet stayed the same', () => {
    const rows = mergeAgentRows([
      agent({ agentKey: 'claude-mcp|0x1111111111111111111111111111111111111111', clientName: 'claude-mcp' }),
      agent({ agentKey: 'arcox_b1f7ca68-5b7|0x2222222222222222222222222222222222222222', clientName: 'claude-mcp', walletAddress: CLAUDE_WALLET }),
      agent({ agentKey: 'arcox_d2021362-9bb|0x3333333333333333333333333333333333333333', clientName: 'claude-mcp', walletAddress: CLAUDE_WALLET }),
    ])

    expect(rows).toHaveLength(1)
    expect(rows.filter(row => row.walletAddress === CLAUDE_WALLET)).toHaveLength(1)
  })

  it('deduplicates the same wallet even when a legacy owner key changed', () => {
    const rows = mergeAgentRows([
      agent({ agentKey: 'oauth:claude|0x1111111111111111111111111111111111111111', clientName: 'Agent MCP' }),
      agent({ agentKey: `claude|${CLAUDE_WALLET}`, clientName: 'Claude' }),
    ])

    expect(rows).toHaveLength(1)
    expect(rows[0].clientName).toBe('Claude')
  })

  it('builds a copy-paste command that configures Hermes through the helper', () => {
    const command = buildHermesConnectionCommand({
      token: 'arx_at_0123456789abcdef0123456789abcdef',
      mcpUrl: 'https://arcoxdex.vercel.app/mcp',
    })

    expect(command).toContain('mktemp -d')
    expect(command).toContain('arcox-agent@0.1.23')
    expect(command).toContain('connect --prompt-token')
    expect(command).not.toContain('arx_at_0123456789abcdef0123456789abcdef')
    expect(command).not.toContain('printf')
  })
})
