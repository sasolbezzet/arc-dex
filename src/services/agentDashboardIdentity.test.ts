import { describe, expect, it } from 'vitest'
import { canonicalAgentKey, mergeAgentRows } from '../hooks/useAgentManager'
import { mergeAgentBalance } from '../stores/agentStore'
import { buildHermesConnectionCommand } from '../features/plugin/ConnectionTokenDialog'
import { loginPublicKeyOptions } from './modularWallet'
import { shouldRestoreWalletConnect } from '../components/WalletButton'
import { destinationChainAuthorizationEnabled } from './agentSession'
import { agentTypeFromKey, AGENT_CONFIGS, AGENT_TYPES, type VaultAgent } from '../types/agent'

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

  it('uses a discoverable passkey picker instead of forcing one credential', () => {
    const options = loginPublicKeyOptions({
      challenge: 'AQ',
      allowCredentials: [{ type: 'public-key', id: 'Ag' }],
      userVerification: 'required',
    })

    expect(options.allowCredentials).toBeUndefined()
    expect(options.userVerification).toBe('required')
    expect(options.challenge).toBeInstanceOf(Uint8Array)
  })

  it('does not auto-restore the WalletConnect component on the Plugin or OAuth page', () => {
    expect(shouldRestoreWalletConnect('/arc-dex/plugin', '')).toBe(false)
    expect(shouldRestoreWalletConnect('/plugin/', '?auth=mcp&request_id=req')).toBe(false)
    expect(shouldRestoreWalletConnect('/arc-dex/portfolio', '')).toBe(true)
  })

  it('keeps destination authorization out of an existing-agent login', () => {
    expect(destinationChainAuthorizationEnabled(true)).toBe(false)
    expect(destinationChainAuthorizationEnabled(false)).toBe(true)
  })

  it('registers Grok as an isolated Custom MCP agent', () => {
    expect(AGENT_TYPES).toContain('grok')
    expect(agentTypeFromKey('oauth:grok|0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', 'Grok')).toBe('grok')
    expect(AGENT_CONFIGS.grok.connectionType).toBe('Custom MCP + OAuth')
  })

  it('keeps balances for other networks when a later network response arrives', () => {
    const initial = {
      agentKey: 'hermes|0xcccccccccccccccccccccccccccccccccccccccc',
      agentType: 'hermes' as const,
      clientName: 'Hermes',
      walletAddress: '0xcccccccccccccccccccccccccccccccccccccccc',
      status: 'connected' as const,
      clientId: 'hermes',
      boundAt: null,
      lastUsedAt: null,
      spentToday: '0',
      connectedAt: null,
      lastActivity: null,
    }
    const arc = mergeAgentBalance(initial, 'arc-testnet', { USDC: '1.25' }, 100)
    const base = mergeAgentBalance(arc, 'base-sepolia', { USDC: '0.75' }, 200)

    expect(base.balances).toEqual({
      'arc-testnet': { USDC: '1.25' },
      'base-sepolia': { USDC: '0.75' },
    })
    expect(base.balance).toEqual({ USDC: '0.75' })
  })

  it('preserves a real zero balance as available data', () => {
    const initial = {
      agentKey: 'hermes|0xdddddddddddddddddddddddddddddddddddddddd',
      agentType: 'hermes' as const,
      clientName: 'Hermes',
      walletAddress: '0xdddddddddddddddddddddddddddddddddddddddd',
      status: 'connected' as const,
      clientId: 'hermes',
      boundAt: null,
      lastUsedAt: null,
      spentToday: '0',
      connectedAt: null,
      lastActivity: null,
    }
    const result = mergeAgentBalance(initial, 'arc-testnet', { USDC: '0', EURC: '0' }, 300)

    expect(result.balance).toEqual({ USDC: '0', EURC: '0' })
    expect(result.balanceUpdatedAt).toBe(300)
  })
  it('builds a copy-paste command that configures Hermes through the helper', () => {
    const command = buildHermesConnectionCommand({
      token: 'arx_at_0123456789abcdef0123456789abcdef',
      mcpUrl: 'https://arcoxdex.vercel.app/mcp',
    })

    expect(command).toContain('npm exec --yes --package=arcox-agent@0.1.27 -- arcox-agent connect --prompt-token')
    expect(command).toContain("ARCOX_MCP_URL='https://arcoxdex.vercel.app/mcp'")
    expect(command).not.toContain('mktemp -d')
    expect(command).not.toContain('arx_at_0123456789abcdef0123456789abcdef')
    expect(command).not.toContain('printf')
  })
})
