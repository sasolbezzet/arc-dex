import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Regression coverage for the three Plugin flows that are easy to confuse:
 *
 *   1. Create New Wallet  → fresh passkey + explicit owner (SIWE) proof.
 *   2. Relogin after Clear → binding was deleted, owner proof required to
 *      recreate exactly one binding for the already-proven wallet.
 *   3. Relogin after Revoke → binding remains, passkey-only recovery is allowed
 *      and no extra SIWE must be requested.
 *
 * The bug this file locks down: activation threw the owner-session error even
 * when a verified owner proof was supplied, so a user who had just signed SIWE
 * still saw "Sesi wallet utama belum tervalidasi" on Create New Wallet and on
 * Clear re-login.
 */

const WALLET = '0x' + '11'.repeat(20)
const DELEGATE = '0x' + '22'.repeat(20)
const ROTATED_DELEGATE = '0x' + '33'.repeat(20)
const OWNER = '0x' + '44'.repeat(20)
const OWNER_TOKEN = 'owner-session-token'
const MSCA_TOKEN = 'msca-passkey-token'

const { setupSessionKeyMock, registerDelegateOwnerMock, getDeploymentStatusMock } = vi.hoisted(() => ({
  setupSessionKeyMock: vi.fn(),
  registerDelegateOwnerMock: vi.fn(),
  getDeploymentStatusMock: vi.fn(() => ({})),
}))

vi.mock('./modularWallet', () => ({
  setupSessionKey: setupSessionKeyMock,
  registerDelegateOwner: registerDelegateOwnerMock,
  getDeploymentStatus: getDeploymentStatusMock,
}))

import { activateAgentSession, isOwnerSessionRequiredError } from './agentSession'

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  }
}

interface FetchPlan {
  /** Body returned by GET /api/session/status (already wrapped in { session }). */
  session: { session: Record<string, unknown> | null }
  destination?: { authorized?: boolean; deployed?: boolean }
  activateBinding?: { body: unknown; status?: number }
  reconcile?: { body: unknown; status?: number }
}

function installFetch(plan: FetchPlan) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    if (url.includes('/api/session/status')) return jsonResponse(plan.session)
    if (url.includes('/api/session/destination-status')) {
      return jsonResponse(plan.destination ?? { authorized: true, deployed: true })
    }
    if (url.includes('/api/session/reconcile')) {
      return jsonResponse(plan.reconcile?.body ?? {}, plan.reconcile?.status ?? 200)
    }
    if (url.includes('/api/session/activate-binding')) {
      return jsonResponse(plan.activateBinding?.body ?? { success: true }, plan.activateBinding?.status ?? 200)
    }
    if (url.includes('/api/session/authorize-chain')) return jsonResponse({ success: true })
    throw new Error(`unexpected fetch: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

const bodyOf = (calls: Array<{ url: string; init?: RequestInit }>, fragment: string) =>
  JSON.parse(String(calls.find(call => call.url.includes(fragment))?.init?.body || '{}'))

beforeEach(() => {
  setupSessionKeyMock.mockReset()
  registerDelegateOwnerMock.mockReset()
  getDeploymentStatusMock.mockReset()
  getDeploymentStatusMock.mockReturnValue({})
  // Mirrors the real `setupSessionKey` contract: it resolves only after the
  // backend activated the reserved signer, so `active` is always true there.
  setupSessionKeyMock.mockResolvedValue({ delegateAddress: DELEGATE, walletAddress: WALLET, active: true, pendingAuthorization: false })
  registerDelegateOwnerMock.mockResolvedValue({ success: true, userOpHash: '0x' + '55'.repeat(32) })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Create New Wallet (register) activation', () => {
  it('uses the verified owner proof instead of asking for SIWE again', async () => {
    const calls = installFetch({ session: { session: null }, activateBinding: { body: { success: true } } })

    const activation = await activateAgentSession(WALLET, MSCA_TOKEN, 'oauth:grok', {
      eoaAddress: OWNER,
      ownerSessionToken: OWNER_TOKEN,
      credentialId: 'cred-1',
      allowDurableBindingRecovery: false,
      skipDestinationChains: false,
    })

    expect(setupSessionKeyMock).toHaveBeenCalledWith(MSCA_TOKEN, OWNER, OWNER_TOKEN, 'oauth:grok')
    expect(activation.delegateAddress).toBe(DELEGATE)
    // Owner proof is forwarded to the binding step too, so the backend can
    // create the durable row for this exact passkey wallet.
    expect(bodyOf(calls, 'activate-binding')).toMatchObject({
      walletAddress: WALLET,
      agentKey: 'oauth:grok',
      ownerAddress: OWNER,
      ownerSessionToken: OWNER_TOKEN,
    })
  })

  it('completes the three-chain authorization before reporting the wallet ready', async () => {
    installFetch({
      session: { session: null },
      destination: { authorized: false, deployed: false },
      activateBinding: { body: { success: true } },
    })

    const activation = await activateAgentSession(WALLET, MSCA_TOKEN, 'oauth:grok', {
      eoaAddress: OWNER,
      ownerSessionToken: OWNER_TOKEN,
      skipDestinationChains: false,
    })

    expect(registerDelegateOwnerMock.mock.calls.map(call => call[1])).toEqual(['base-sepolia', 'arbitrum-sepolia'])
    expect(activation.chainAuthorizationStatus).toEqual({
      'arc-testnet': 'authorized',
      'base-sepolia': 'authorized',
      'arbitrum-sepolia': 'authorized',
    })
  })
})

describe('Relogin after Clear', () => {
  it('accepts the owner proof and re-binds the surviving wallet session', async () => {
    const calls = installFetch({
      session: {
        session: {
          walletAddress: WALLET,
          active: true,
          delegateAddress: DELEGATE,
          agentBindingActive: false,
          agentBindingFound: false,
          statusReason: 'agent_deleted',
        },
      },
      activateBinding: { body: { success: true } },
    })

    const activation = await activateAgentSession(WALLET, MSCA_TOKEN, 'oauth:grok', {
      eoaAddress: OWNER,
      ownerSessionToken: OWNER_TOKEN,
      credentialId: 'cred-1',
      allowDurableBindingRecovery: true,
      skipDestinationChains: true,
    })

    expect(activation.sessionActive).toBe(true)
    expect(setupSessionKeyMock).not.toHaveBeenCalled()
    expect(bodyOf(calls, 'activate-binding')).toMatchObject({
      ownerAddress: OWNER,
      ownerSessionToken: OWNER_TOKEN,
      credentialId: 'cred-1',
    })
  })

  it('fails closed with owner_session_required when no owner proof is supplied', async () => {
    installFetch({
      session: {
        session: {
          walletAddress: WALLET,
          active: false,
          delegateAddress: DELEGATE,
          agentBindingFound: false,
          statusReason: 'agent_deleted',
        },
      },
    })

    const failure = await activateAgentSession(WALLET, MSCA_TOKEN, 'oauth:grok', {
      allowDurableBindingRecovery: true,
      skipDestinationChains: true,
    }).catch((caught: unknown) => caught)

    expect(failure).toMatchObject({ code: 'owner_session_required' })
    expect(isOwnerSessionRequiredError(failure)).toBe(true)
    expect(setupSessionKeyMock).not.toHaveBeenCalled()
  })

  it('reports a missing binding instead of a bad owner session once proof is supplied', async () => {
    installFetch({
      session: {
        session: {
          walletAddress: WALLET,
          active: true,
          delegateAddress: DELEGATE,
          agentBindingActive: true,
          agentBindingFound: false,
        },
      },
      activateBinding: { body: { code: 'agent_binding_not_found', error: 'agent_binding_not_found' }, status: 404 },
    })

    const failure = await activateAgentSession(WALLET, MSCA_TOKEN, 'oauth:grok', {
      eoaAddress: OWNER,
      ownerSessionToken: OWNER_TOKEN,
      allowDurableBindingRecovery: true,
      skipDestinationChains: true,
    }).catch((caught: unknown) => caught)

    expect(failure).toMatchObject({ code: 'agent_binding_missing' })
    expect(isOwnerSessionRequiredError(failure)).toBe(false)
  })
})

describe('Relogin after Revoke', () => {
  it('recovers passkey-only without SIWE and without destination UserOperations', async () => {
    const calls = installFetch({
      session: {
        session: {
          walletAddress: WALLET,
          active: false,
          delegateAddress: DELEGATE,
          statusReason: 'manual_revoke',
          revokeReason: 'agent_manual',
        },
      },
      activateBinding: { body: { success: true } },
    })

    const activation = await activateAgentSession(WALLET, MSCA_TOKEN, 'oauth:grok', {
      allowDurableBindingRecovery: true,
      skipDestinationChains: true,
    })

    expect(setupSessionKeyMock).toHaveBeenCalledWith(MSCA_TOKEN, undefined, undefined, 'oauth:grok')
    expect(activation.sessionActive).toBe(true)
    expect(calls.some(call => call.url.includes('destination-status'))).toBe(false)
    expect(registerDelegateOwnerMock).not.toHaveBeenCalled()
  })

  it('repairs Base and Arbitrum once when revoke rotated the delegate', async () => {
    setupSessionKeyMock.mockResolvedValue({
      delegateAddress: ROTATED_DELEGATE,
      walletAddress: WALLET,
      active: true,
      pendingAuthorization: false,
    })
    const calls = installFetch({
      session: {
        session: {
          walletAddress: WALLET,
          active: false,
          delegateAddress: DELEGATE,
          statusReason: 'manual_revoke',
          revokeReason: 'agent_manual',
        },
      },
      destination: { authorized: false, deployed: false },
      activateBinding: { body: { success: true } },
    })

    const activation = await activateAgentSession(WALLET, MSCA_TOKEN, 'oauth:grok', {
      allowDurableBindingRecovery: true,
      skipDestinationChains: true,
    })

    expect(calls.some(call => call.url.includes('destination-status'))).toBe(true)
    expect(registerDelegateOwnerMock.mock.calls.map(call => call[1])).toEqual(['base-sepolia', 'arbitrum-sepolia'])
    expect(activation.chainAuthorizationStatus['base-sepolia']).toBe('authorized')
    expect(activation.chainAuthorizationStatus['arbitrum-sepolia']).toBe('authorized')
  })

  it('keeps a genuine backend owner_session_required retryable', async () => {
    installFetch({
      session: {
        session: {
          walletAddress: WALLET,
          active: true,
          delegateAddress: DELEGATE,
          agentBindingActive: true,
        },
      },
      activateBinding: {
        body: { code: 'owner_session_required', error: 'Sesi owner wallet tidak valid.' },
        status: 403,
      },
    })

    const failure = await activateAgentSession(WALLET, MSCA_TOKEN, 'oauth:grok', {
      eoaAddress: OWNER,
      ownerSessionToken: OWNER_TOKEN,
      skipDestinationChains: true,
    }).catch((caught: unknown) => caught)

    expect(failure).toMatchObject({ code: 'owner_session_required' })
    expect(isOwnerSessionRequiredError(failure)).toBe(true)
  })
})
