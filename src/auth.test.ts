import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  generateNonceHex,
  readTokenExp,
  isSiweUnsupportedError,
  ensureAuthSession,
  clearAuthSession,
  getAuthToken,
  buildSiweMessage,
} from './auth'
import { HttpError } from './api'

// Mock the wallet provider so tests do not require a real browser wallet.
let mockProvider: { request: ReturnType<typeof vi.fn> }

vi.mock('./walletProvider', () => ({
  findConnectedWalletProvider: vi.fn(() => Promise.resolve(mockProvider)),
}))

// Minimal JWT builder for tests: header.payload.signature
function makeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  return `${header}.${body}.signature`
}

function base64UrlEncode(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

describe('auth utilities', () => {
  beforeEach(() => {
    mockProvider = { request: vi.fn() }
    localStorage.clear()
    vi.clearAllMocks()
  })

  afterEach(() => {
    clearAuthSession()
  })

  describe('generateNonceHex', () => {
    it('produces a 32-character hex string', () => {
      const nonce = generateNonceHex()
      expect(nonce).toHaveLength(32)
      expect(/^[0-9a-f]+$/i.test(nonce)).toBe(true)
    })

    it('produces different nonces on successive calls', () => {
      const a = generateNonceHex()
      const b = generateNonceHex()
      expect(a).not.toBe(b)
    })
  })

  describe('readTokenExp', () => {
    it('returns null for malformed tokens', () => {
      expect(readTokenExp('not-a-jwt')).toBeNull()
      expect(readTokenExp('')).toBeNull()
    })

    it('reads exp from JWT payload and converts seconds to ms', () => {
      const expSeconds = 1700000000
      const token = `header.${base64UrlEncode(JSON.stringify({ exp: expSeconds }))}.sig`
      expect(readTokenExp(token)).toBe(expSeconds * 1000)
    })

    it('returns null when exp is missing', () => {
      const token = `header.${base64UrlEncode(JSON.stringify({ sub: '123' }))}.sig`
      expect(readTokenExp(token)).toBeNull()
    })
  })

  describe('isSiweUnsupportedError', () => {
    it('returns true for HTTP 501 errors', () => {
      const error = new HttpError('Not Implemented', 501, {})
      expect(isSiweUnsupportedError(error)).toBe(true)
    })

    it('returns true for SIWE_NOT_SUPPORTED code', () => {
      const error = new HttpError('Bad Request', 400, { code: 'SIWE_NOT_SUPPORTED' })
      expect(isSiweUnsupportedError(error)).toBe(true)
    })

    it('returns true for UNSUPPORTED_AUTH_MODE code', () => {
      const error = new HttpError('Bad Request', 400, { code: 'UNSUPPORTED_AUTH_MODE' })
      expect(isSiweUnsupportedError(error)).toBe(true)
    })

    it('returns false for generic errors', () => {
      expect(isSiweUnsupportedError(new Error('Invalid signature'))).toBe(false)
      expect(isSiweUnsupportedError(new HttpError('Bad Request', 400, { error: 'Invalid SIWE signature' }))).toBe(false)
    })
  })

  describe('ensureAuthSession', () => {
    it('reuses an existing valid session for the same address', async () => {
      const token = makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 })
      localStorage.setItem('arc-dex-auth', JSON.stringify({ address: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e', token, issuedAt: Date.now() }))

      const result = await ensureAuthSession('0x742d35Cc6634C0532925a3b844Bc454e4438f44e')
      expect(result).toBe(token)
      expect(mockProvider.request).not.toHaveBeenCalled()
    })

    it('requests personal_sign when forcing a new session', async () => {
      const backendToken = 'new-backend-token'
      mockProvider.request.mockResolvedValueOnce('0xsignature')
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ token: backendToken })),
      } as any)

      const result = await ensureAuthSession('0x742d35Cc6634C0532925a3b844Bc454e4438f44e', true)
      expect(result).toBe(backendToken)
      expect(mockProvider.request).toHaveBeenCalledWith({
        method: 'personal_sign',
        params: expect.any(Array),
      })
    })
  })

  describe('getAuthToken', () => {
    it('returns empty string when no session exists', () => {
      expect(getAuthToken()).toBe('')
    })

    it('returns the stored token', () => {
      const token = makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 })
      localStorage.setItem('arc-dex-auth', JSON.stringify({ address: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e', token, issuedAt: Date.now() }))
      expect(getAuthToken()).toBe(token)
    })
  })

  describe('buildSiweMessage', () => {
    it('produces a valid EIP-4361 message bound to the current domain', async () => {
      const provider = { request: vi.fn().mockResolvedValue('0x4cef52') }
      const msg = await buildSiweMessage(
        '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
        'aabbccdd',
        new Date().toISOString(),
        new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        provider,
      )
      expect(msg).toContain('wants you to sign in with your Ethereum account')
      expect(msg).toContain('0x742d35Cc6634C0532925a3b844Bc454e4438f44e')
      expect(msg).toContain('Only sign this message on the official ARCOX DEX website.')
      expect(msg).toMatch(/URI: https?:\/\/localhost/)
      expect(msg).toMatch(/wants you to sign in with your Ethereum account:/)
      expect(msg).toContain('Chain ID: 5042002')
      expect(msg).toContain('Nonce: aabbccdd')
      expect(provider.request).toHaveBeenCalledWith({ method: 'eth_chainId' })
    })
  })
})
