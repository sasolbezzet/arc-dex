import { describe, expect, it } from 'vitest'
import {
  SCOPED_VAULT_TOKEN_PREFIX,
  agentTokenCandidates,
  forgetVaultToken,
  isStaleTokenError,
  isVaultTokenKey,
  scopedVaultTokenKey,
  type TokenStore,
} from './agentTokenSelection'

/**
 * A dead per-agent token used to be preferred forever: every Revoke/Clear on a
 * card sent it, the backend answered 401, and the dashboard kept showing
 * "Sesi berakhir. Masuk kembali dengan passkey." even after a fresh passkey
 * login — because that login only refreshed the global slots.
 */
function fakeStore(entries: Record<string, string>): TokenStore & { data: Record<string, string> } {
  const data = { ...entries }
  return {
    data,
    getItem: key => (key in data ? data[key] : null),
    removeItem: key => { delete data[key] },
    key: index => Object.keys(data)[index] ?? null,
    get length() { return Object.keys(data).length },
  }
}

describe('scopedVaultTokenKey', () => {
  it('maps a composite agent key to its clientId slot', () => {
    expect(scopedVaultTokenKey('arcox_21718393-af7|0x19d0730c4a4b1c509eba5d59b6dc0d46bd3ac807'))
      .toBe(`${SCOPED_VAULT_TOKEN_PREFIX}arcox_21718393-af7`)
  })

  it('maps passkey namespaces without an owner suffix', () => {
    expect(scopedVaultTokenKey('oauth:grok')).toBe(`${SCOPED_VAULT_TOKEN_PREFIX}oauth:grok`)
    expect(scopedVaultTokenKey('hermes-mcp')).toBe(`${SCOPED_VAULT_TOKEN_PREFIX}hermes-mcp`)
  })

  it('returns nothing for an empty agent key', () => {
    expect(scopedVaultTokenKey('')).toBe('')
  })
})

describe('agentTokenCandidates', () => {
  it('prefers the agent own session, then the freshest global slot', () => {
    const store = fakeStore({
      [`${SCOPED_VAULT_TOKEN_PREFIX}grok`]: 'scoped-dead',
      arx_vault_token: 'global-dashboard',
      arx_passkey_vault_token: 'global-passkey',
      arx_owner_vault_token: 'global-owner',
    })
    expect(agentTokenCandidates('grok|0xabc', 'primary-token', store))
      .toEqual(['scoped-dead', 'primary-token', 'global-dashboard', 'global-passkey', 'global-owner'])
  })

  it('falls back to the global session when no per-agent token exists', () => {
    const store = fakeStore({ arx_passkey_vault_token: 'global-passkey' })
    expect(agentTokenCandidates('hermes-mcp|0xabc', null, store)).toEqual(['global-passkey'])
  })

  it('collapses the same token stored in several slots', () => {
    const store = fakeStore({
      [`${SCOPED_VAULT_TOKEN_PREFIX}grok`]: 'shared',
      arx_vault_token: 'shared',
      arx_passkey_vault_token: 'shared',
    })
    expect(agentTokenCandidates('grok|0xabc', 'shared', store)).toEqual(['shared'])
  })

  it('never returns empty string entries', () => {
    const store = fakeStore({ arx_vault_token: '   ' })
    expect(agentTokenCandidates('grok|0xabc', undefined, store)).toEqual([])
  })

  it('tolerates storage being unavailable', () => {
    expect(agentTokenCandidates('grok|0xabc', 'primary', null)).toEqual(['primary'])
  })
})

describe('forgetVaultToken', () => {
  it('removes a rejected token from the per-agent and global slots', () => {
    const store = fakeStore({
      [`${SCOPED_VAULT_TOKEN_PREFIX}grok`]: 'dead-token',
      arx_vault_token: 'dead-token',
      arx_passkey_vault_token: 'healthy-token',
      'arx-auth': 'unrelated',
    })
    forgetVaultToken('dead-token', store)
    expect(store.data).toEqual({ arx_passkey_vault_token: 'healthy-token', 'arx-auth': 'unrelated' })
  })

  it('keeps other agents sessions intact', () => {
    const store = fakeStore({
      [`${SCOPED_VAULT_TOKEN_PREFIX}claude`]: 'claude-token',
      [`${SCOPED_VAULT_TOKEN_PREFIX}grok`]: 'grok-token',
    })
    forgetVaultToken('grok-token', store)
    expect(agentTokenCandidates('claude|0xabc', null, store)).toEqual(['claude-token'])
    expect(agentTokenCandidates('grok|0xabc', null, store)).toEqual([])
  })

  it('is a no-op for empty values and stores without removal', () => {
    const store = fakeStore({ arx_vault_token: 'kept' })
    forgetVaultToken('', store)
    forgetVaultToken('kept', { getItem: store.getItem })
    expect(store.data.arx_vault_token).toBe('kept')
  })
})

describe('isVaultTokenKey', () => {
  it('recognizes vault slots only', () => {
    expect(isVaultTokenKey('arx_vault_token')).toBe(true)
    expect(isVaultTokenKey(`${SCOPED_VAULT_TOKEN_PREFIX}grok`)).toBe(true)
    expect(isVaultTokenKey('arx-auth')).toBe(false)
    expect(isVaultTokenKey('arx_msca_state')).toBe(false)
  })
})

describe('isStaleTokenError', () => {
  it('retries on expired sessions', () => {
    expect(isStaleTokenError({ status: 401 })).toBe(true)
    expect(isStaleTokenError({ code: 'session_expired' })).toBe(true)
  })

  it('retries when the token belongs to another owner', () => {
    expect(isStaleTokenError({ status: 403, code: 'forbidden' })).toBe(true)
    expect(isStaleTokenError({ status: 403, code: 'owner_authentication_required' })).toBe(true)
  })

  it('does not retry real failures', () => {
    expect(isStaleTokenError({ status: 400, code: 'wallet_required' })).toBe(false)
    expect(isStaleTokenError({ status: 409, code: 'authorization_pending' })).toBe(false)
    expect(isStaleTokenError({ status: 0, code: 'network_error' })).toBe(false)
    expect(isStaleTokenError(new Error('boom'))).toBe(false)
    expect(isStaleTokenError(null)).toBe(false)
  })
})
