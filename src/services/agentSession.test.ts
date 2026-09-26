import { describe, expect, it } from 'vitest'
import { formatCircleUserOperationError, getPasskeyRpId, normalizeArbitrumUserOperationFees } from './modularWallet'
import { shouldAuthorizeDestinationChainsAfterActivation, shouldReconcileExistingSession } from './agentSession'
import { oauthAgentLabel, readOAuthRequestFromUrl } from '../hooks/useOAuthApproval'

describe('multichain wallet activation invariants', () => {
  it('uses the production RP ID for every passkey UserOperation ceremony', () => {
    expect(getPasskeyRpId()).toBe('arcoxdex.vercel.app')
  })

  it('keeps Arbitrum fee envelope valid when the provider returns zero fees', () => {
    const fees = normalizeArbitrumUserOperationFees(0n, 0n)
    expect(fees.maxPriorityFeePerGas).toBeGreaterThanOrEqual(1_000_000_000n)
    expect(fees.maxFeePerGas).toBeGreaterThanOrEqual(fees.maxPriorityFeePerGas)
  })

  it('keeps headroom above a live Arbitrum max fee', () => {
    const fees = normalizeArbitrumUserOperationFees(2_000_000_000n, 1_000_000_000n)
    expect(fees.maxPriorityFeePerGas).toBe(1_000_000_000n)
    expect(fees.maxFeePerGas).toBe(3_000_000_000n)
  })

  it('keeps ordinary re-login Arc-only when the delegate is unchanged', () => {
    expect(shouldAuthorizeDestinationChainsAfterActivation(true, '0x' + '11'.repeat(20), '0x' + '11'.repeat(20))).toBe(false)
    expect(shouldAuthorizeDestinationChainsAfterActivation(false, '0x' + '11'.repeat(20), '0x' + '11'.repeat(20))).toBe(true)
  })

  it('repairs destination authorization when revoke or clear rotated the delegate', () => {
    expect(shouldAuthorizeDestinationChainsAfterActivation(true, '0x' + '11'.repeat(20), '0x' + '22'.repeat(20))).toBe(true)
    expect(shouldAuthorizeDestinationChainsAfterActivation(true, '0x' + '11'.repeat(20), '0x' + '11'.repeat(20))).toBe(false)
    // A new wallet has no previous delegate; its registration flow explicitly
    // uses skipDestinationChains=false, while a recovery flow with no proven
    // delegate must not infer a destination authorization requirement.
    expect(shouldAuthorizeDestinationChainsAfterActivation(true, undefined, '0x' + '22'.repeat(20))).toBe(false)
    expect(shouldAuthorizeDestinationChainsAfterActivation(false, undefined, '0x' + '22'.repeat(20))).toBe(true)
  })

  it('does not poll an old authorization after manual revoke', () => {
    const walletAddress = '0x' + '11'.repeat(20)
    expect(shouldReconcileExistingSession({ walletAddress, statusReason: 'manual_revoke' }, walletAddress)).toBe(false)
    expect(shouldReconcileExistingSession({ walletAddress, revokeReason: 'agent_manual' }, walletAddress)).toBe(false)
    expect(shouldReconcileExistingSession({ walletAddress, statusReason: 'agent_deleted' }, walletAddress)).toBe(false)
    expect(shouldReconcileExistingSession({ walletAddress, revokeReason: 'clear' }, walletAddress)).toBe(false)
    expect(shouldReconcileExistingSession({ walletAddress, manualRevokePending: true }, walletAddress)).toBe(false)
    expect(shouldReconcileExistingSession({ walletAddress, statusReason: 'inactivity_24h' }, walletAddress)).toBe(true)
    expect(shouldReconcileExistingSession({ walletAddress: '0x' + '22'.repeat(20) }, walletAddress)).toBe(false)
  })

  it('uses the OAuth client_name supplied by the agent for dynamic approval labels', () => {
    expect(oauthAgentLabel('arcox_7f91c2', 'Claude Desktop')).toBe('Claude')
    expect(oauthAgentLabel('arcox_92ab10', 'My Research Agent')).toBe('My Research Agent')
    expect(oauthAgentLabel('arcox_92ab10', 'Agent MCP')).toBe('Agent MCP')
  })

  it('preserves the dynamic agent name while parsing an OAuth approval URL', () => {
    const request = readOAuthRequestFromUrl(
      '?auth=mcp&request_id=req-1&client_id=arcox_dynamic&agent_name=Claude%20Desktop&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback',
    )
    expect(request).toMatchObject({
      requestId: 'req-1',
      clientId: 'arcox_dynamic',
      agentName: 'Claude Desktop',
    })
  })

  it('explains a wrapped Gas Station daily native-token policy rejection', () => {
    const error = new Error('JSON is not a valid request object', {
      cause: new Error('Details: Exceeded max daily native token of the policy.'),
    })
    const message = formatCircleUserOperationError(error, 'arc-mainnet')
    expect(message).toMatch(/Kuota Gas Station harian/i)
    expect(message).toMatch(/UserOperation ditolak sebelum masuk bundler/i)
    expect(message).toMatch(/Reset atau naikkan batas harian policy/i)
  })
})
