import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const WALLET = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

vi.mock('@circle-fin/modular-wallets-core', () => ({
  toModularTransport: vi.fn(() => () => ({ request: vi.fn() })),
  toCircleSmartAccount: vi.fn(async ({ address }: { address?: string }) => ({ address: address || WALLET })),
}))

vi.mock('viem', async () => {
  const actual = await vi.importActual<typeof import('viem')>('viem')
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({ request: vi.fn() })),
  }
})

vi.mock('viem/account-abstraction', async () => {
  const actual = await vi.importActual<typeof import('viem/account-abstraction')>('viem/account-abstraction')
  return {
    ...actual,
    toWebAuthnAccount: vi.fn(() => ({})),
  }
})

import { loginPasskey } from './modularWallet'

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  }
}

function makeCredential() {
  return {
    id: 'credential-1',
    rawId: Uint8Array.from([1, 2, 3]).buffer,
    type: 'public-key',
    response: {
      clientDataJSON: Uint8Array.from([4, 5, 6]).buffer,
      authenticatorData: Uint8Array.from([7, 8, 9]).buffer,
      signature: Uint8Array.from([10, 11, 12]).buffer,
      userHandle: null,
    },
  }
}

describe('Login passkey ceremony', () => {
  let previousSecureContext: PropertyDescriptor | undefined
  let previousPublicKeyCredential: PropertyDescriptor | undefined
  let previousCredentials: PropertyDescriptor | undefined
  let previousEthereum: unknown

  beforeEach(() => {
    localStorage.clear()
    previousSecureContext = Object.getOwnPropertyDescriptor(window, 'isSecureContext')
    previousPublicKeyCredential = Object.getOwnPropertyDescriptor(window, 'PublicKeyCredential')
    previousCredentials = Object.getOwnPropertyDescriptor(navigator, 'credentials')
    previousEthereum = (window as Window & { ethereum?: unknown }).ethereum

    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
    Object.defineProperty(window, 'PublicKeyCredential', { configurable: true, value: class PublicKeyCredential {} })

    Object.defineProperty(navigator, 'credentials', {
      configurable: true,
      value: {
        get: vi.fn().mockResolvedValue(makeCredential()),
        create: vi.fn(),
      },
    })
    ;(window as Window & { ethereum?: { request: ReturnType<typeof vi.fn> } }).ethereum = {
      request: vi.fn(),
    }
  })

  afterEach(() => {
    if (previousSecureContext) Object.defineProperty(window, 'isSecureContext', previousSecureContext)
    else Reflect.deleteProperty(window, 'isSecureContext')
    if (previousPublicKeyCredential) Object.defineProperty(window, 'PublicKeyCredential', previousPublicKeyCredential)
    else Reflect.deleteProperty(window, 'PublicKeyCredential')
    if (previousCredentials) Object.defineProperty(navigator, 'credentials', previousCredentials)
    else Reflect.deleteProperty(navigator, 'credentials')
    ;(window as Window & { ethereum?: unknown }).ethereum = previousEthereum
    vi.unstubAllGlobals()
  })

  it('opens WebAuthn first and never calls personal_sign', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        flowId: 'flow-1',
        options: {
          challenge: 'AQ',
          rpId: 'arcoxdex.vercel.app',
          allowCredentials: [{ type: 'public-key', id: 'Ag' }],
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        token: 'agent-session-token',
        address: WALLET,
        credential: { publicKey: `0x${'11'.repeat(33)}` },
      }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await loginPasskey('oauth:claude')

    const credentialGet = (navigator.credentials as unknown as { get: ReturnType<typeof vi.fn> }).get
    expect(credentialGet).toHaveBeenCalledTimes(1)
    expect(credentialGet.mock.calls[0][0].publicKey.allowCredentials).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/passkey-options')
    expect(fetchMock.mock.calls[1][0]).toBe('/api/auth/passkey-login')
    expect((window as Window & { ethereum?: { request: ReturnType<typeof vi.fn> } }).ethereum?.request).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: 'personal_sign' }),
    )
    expect(result).toMatchObject({ walletAddress: WALLET, sessionToken: 'agent-session-token' })
  })
})
