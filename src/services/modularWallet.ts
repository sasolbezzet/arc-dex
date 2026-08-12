// modularWallet.ts — Circle Modular Wallet (MSCA) + passkey auth + session key management.
// Follows official Circle docs: https://developers.circle.com/wallets/modular/create-a-wallet-and-send-gasless-txn
//
// Flow:
//   1. registerPasskey()/loginPasskey() → browser WebAuthn → one backend Circle verification
//   2. createSmartAccount() → toCircleSmartAccount → MSCA address
//   3. setupSessionKey() → generate delegate EOA → createAddressMapping → POST /api/session/setup
//   4. Agent uses source=session to execute tx via MSCA

import {
  toModularTransport,
  toCircleSmartAccount,
  recoveryActions,
} from '@circle-fin/modular-wallets-core'
import { createPublicClient, defineChain } from 'viem'
import { isSuccessfulUserOpReceipt } from './mscaPolicy'
import { createBundlerClient, toWebAuthnAccount, sendUserOperation, waitForUserOperationReceipt } from 'viem/account-abstraction'
import { arcTestnet } from 'viem/chains'

// Circle's documented Modular Wallet endpoint and credential names.
// The Client Key must be created in Circle Console and bound to this web origin;
// it is not interchangeable with the server-side CIRCLE_API_KEY.
const CLIENT_URL = import.meta.env.VITE_CIRCLE_CLIENT_URL || 'https://modular-sdk.circle.com/v1/rpc/w3s/buidl'
const CLIENT_KEY = import.meta.env.VITE_CIRCLE_CLIENT_KEY || ''
const API = ''  // same origin proxy
const PASSKEY_ORIGIN = String(import.meta.env.VITE_PASSKEY_ORIGIN || 'https://arcoxdex.vercel.app').replace(/\/$/, '')
let passkeyOperationInFlight: Promise<unknown> | null = null
const PASSKEY_REGISTRATION_USERNAME_KEY = 'arx_passkey_registration_username'
type PasskeyMode = 'Login' | 'Register'

// ── Fetch interceptor: redirect Circle Modular SDK requests to backend proxy ──
// The SDK validates CLIENT_URL as a real Circle domain (isCircleUrl check), so we
// must keep the full URL. But we intercept fetch() at runtime to route all requests
// through our backend proxy, avoiding mobile network/adblock blocks on
// modular-sdk.circle.com.
if (typeof window !== 'undefined' && !window.__circleProxyInstalled) {
  window.__circleProxyInstalled = true
  const origFetch = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url || ''
    if (url.includes('modular-sdk.circle.com/v1/rpc')) {
      const proxied = url.replace(
        'https://modular-sdk.circle.com/v1/rpc',
        '/api/circle-modular',
      )
      return origFetch(proxied, init)
    }
    return origFetch(input, init)
  }
}

declare global { interface Window { __circleProxyInstalled?: boolean } }



// ── Persisted state ──
const STORAGE_KEY = 'arx_msca_state'
let livePasskeyCredential: any = null

type DeploymentStatus = { status: 'deployed' | 'failed' | 'unsupported'; userOpHash?: string; authorizationUserOpHash?: string; authorizationDelegateAddress?: string; authorizationStatus?: 'pending' | 'authorized' | 'failed'; authorizationPrecheckFailed?: boolean; authorizationError?: string; error?: string; updatedAt: number }

interface MscaState {
  walletAddress: string
  credential: { id: string; publicKey: string } | null
  delegateAddress: string
  sessionActive: boolean
  deployed?: boolean
  deploymentStatus?: Record<string, DeploymentStatus>
}

function loadState(): Partial<MscaState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const state = raw ? JSON.parse(raw) : {}
    if (livePasskeyCredential && state?.credential && !state.credential.raw) {
      state.credential = { ...state.credential, raw: livePasskeyCredential }
    }
    return state
  } catch { return {} }
}

function saveState(state: Partial<MscaState>) {
  if (state.credential?.raw) livePasskeyCredential = state.credential.raw
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

function bytesToBase64Url(value: unknown) {
  if (value === null || value === undefined) return null
  const bytes = value instanceof ArrayBuffer
    ? new Uint8Array(value)
    : value instanceof Uint8Array
      ? value
      : new Uint8Array((value as any)?.buffer || value as any)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function requireBase64Url(value: unknown, field: string, optional = false) {
  if (value === null || value === undefined) {
    if (optional) return undefined
    throw new Error(`Passkey credential field ${field} tidak tersedia. Login passkey ulang diperlukan.`)
  }
  const normalized = typeof value === 'string' ? value : bytesToBase64Url(value)
  if (!normalized || !/^[A-Za-z0-9_-]+$/.test(normalized)) {
    throw new Error(`Passkey credential field ${field} tidak valid. Login passkey ulang diperlukan.`)
  }
  return normalized
}

function normalizeSerializedCredential(value: any) {
  if (!value || typeof value !== 'object' || !value.id || !value.response) {
    throw new Error('Passkey credential tidak tersedia. Login passkey ulang diperlukan.')
  }
  const response = value.response
  return {
    id: String(value.id),
    rawId: requireBase64Url(value.rawId, 'rawId'),
    type: value.type || 'public-key',
    response: {
      clientDataJSON: requireBase64Url(response.clientDataJSON, 'clientDataJSON'),
      authenticatorData: requireBase64Url(response.authenticatorData, 'authenticatorData'),
      signature: requireBase64Url(response.signature, 'signature'),
      ...(response.userHandle !== null && response.userHandle !== undefined ? { userHandle: requireBase64Url(response.userHandle, 'userHandle') } : {}),
      ...(response.attestationObject !== null && response.attestationObject !== undefined ? { attestationObject: requireBase64Url(response.attestationObject, 'attestationObject') } : {}),
      ...(typeof response.publicKeyAlgorithm === 'number' ? { publicKeyAlgorithm: response.publicKeyAlgorithm } : {}),
      ...(Array.isArray(response.transports) ? { transports: response.transports } : {}),
    },
  }
}

function hasWebAuthnResponse(value: any): boolean {
  return Boolean(value && typeof value === 'object' && value.id && value.response)
}

function unwrapWebAuthnCredential(credential: any): any {
  let current = credential
  const seen = new Set<any>()
  for (let depth = 0; current && depth < 4 && !seen.has(current); depth++) {
    if (hasWebAuthnResponse(current)) return current
    seen.add(current)
    if (current.raw && typeof current.raw === 'object') current = current.raw
    else if (current.credential && typeof current.credential === 'object') current = current.credential
    else break
  }
  return current
}

/** Send the raw browser credential to Circle, not the SDK's derived wrapper. */
export function serializeWebAuthnCredential(credential: any) {
  const raw = unwrapWebAuthnCredential(credential)
  if (!hasWebAuthnResponse(raw)) throw new Error('Passkey credential tidak tersedia. Login passkey ulang diperlukan.')

  // PublicKeyCredential.toJSON() is supported by modern browsers, but older
  // Safari/WebViews may expose it partially or not at all. Prefer it only when
  // it contains the complete assertion; otherwise read the ArrayBuffers from
  // the native response explicitly.
  if (typeof raw.toJSON === 'function') {
    try {
      const serialized = raw.toJSON()
      if (hasWebAuthnResponse(serialized)) return normalizeSerializedCredential(serialized)
    } catch { /* use the explicit ArrayBuffer path below */ }
  }

  const response = raw.response
  return normalizeSerializedCredential({
    id: raw.id,
    rawId: bytesToBase64Url(raw.rawId),
    type: raw.type || 'public-key',
    response: {
      clientDataJSON: bytesToBase64Url(response.clientDataJSON),
      authenticatorData: bytesToBase64Url(response.authenticatorData),
      signature: bytesToBase64Url(response.signature),
      ...(response.userHandle !== null && response.userHandle !== undefined ? { userHandle: bytesToBase64Url(response.userHandle) } : {}),
      ...(response.attestationObject ? { attestationObject: bytesToBase64Url(response.attestationObject) } : {}),
      ...(typeof response.publicKeyAlgorithm === 'number' ? { publicKeyAlgorithm: response.publicKeyAlgorithm } : {}),
      ...(Array.isArray(response.transports) ? { transports: response.transports } : {}),
    },
  })
}

function clearState() {
  livePasskeyCredential = null
  localStorage.removeItem(STORAGE_KEY)
}

// ── Transports ──
function ensurePasskeyEnvironment() {
  if (typeof window === 'undefined') throw new Error('Passkey hanya dapat digunakan di browser.')
  if (!window.isSecureContext) throw new Error('Passkey membutuhkan HTTPS atau localhost. Buka ARCOX melalui https://arcoxdex.vercel.app.')
  if (window.location.origin !== PASSKEY_ORIGIN && !['localhost', '127.0.0.1'].includes(window.location.hostname)) {
    throw new Error(`Passkey terikat ke ${PASSKEY_ORIGIN}. Buka ARCOX dari ${PASSKEY_ORIGIN}, bukan ${window.location.origin}.`)
  }
  if (typeof window.PublicKeyCredential !== 'function' || typeof navigator.credentials?.get !== 'function' || typeof navigator.credentials?.create !== 'function') {
    throw new Error('Browser ini tidak mendukung WebAuthn passkey. Gunakan Chrome, Edge, Safari, atau Firefox versi terbaru.')
  }
}

function runPasskeyOperation<T>(operation: () => Promise<T>): Promise<T> {
  if (passkeyOperationInFlight) {
    throw new Error('Permintaan passkey masih berjalan. Selesaikan atau batalkan prompt passkey yang terbuka, lalu coba lagi.')
  }
  const request = operation()
  passkeyOperationInFlight = request
  request.finally(() => {
    if (passkeyOperationInFlight === request) passkeyOperationInFlight = null
  }).catch(() => {})
  return request
}

function registrationUsername() {
  try {
    const saved = localStorage.getItem(PASSKEY_REGISTRATION_USERNAME_KEY)
    if (saved) return saved
    const value = `arx-user-${Date.now()}`
    localStorage.setItem(PASSKEY_REGISTRATION_USERNAME_KEY, value)
    return value
  } catch {
    return `arx-user-${Date.now()}`
  }
}

/**
 * Fetch a fresh Circle challenge for exactly one browser operation. The
 * browser assertion is sent to the backend, which performs the one and only
 * rp_get*Verification call and returns the verified public key.
 */
async function freshPasskeyOptions(mode: PasskeyMode) {
  ensurePasskeyEnvironment()
  const username = mode === 'Register' ? registrationUsername() : ''
  const response = await fetch(`${API}/api/auth/passkey-options`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, username }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.success || !data.flowId || !data.options?.challenge) {
    throw new Error(data?.error || `Circle passkey ${mode.toLowerCase()} options tidak tersedia.`)
  }
  return { options: data.options, flowId: String(data.flowId) }
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const binary = atob(padded)
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

function loginPublicKeyOptions(options: any) {
  return {
    ...options,
    challenge: base64UrlToBytes(options.challenge),
    ...(Array.isArray(options.allowCredentials) ? {
      allowCredentials: options.allowCredentials.map((credential: any) => ({
        ...credential,
        id: base64UrlToBytes(credential.id),
      })),
    } : {}),
  }
}

function registrationPublicKeyOptions(options: any) {
  return {
    ...options,
    challenge: base64UrlToBytes(options.challenge),
    user: { ...options.user, id: base64UrlToBytes(options.user.id) },
  }
}

async function verifyPasskeyWithBackend(rawCredential: any, mode: PasskeyMode, flowId: string) {
  const response = await fetch(`${API}/api/auth/passkey-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential: serializeWebAuthnCredential(rawCredential), mode, flowId }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.success || !data.token || !data.credential?.publicKey || !data.address) {
    throw new Error(data?.error || 'Passkey verification gagal')
  }
  return data
}

function passkeyErrorMessage(error: unknown) {
  // Circle wraps the browser DOMException in one or more Error.cause layers.
  // Inspect the complete chain so NotAllowedError is not shown as an opaque
  // "Failed to request credential" transport error.
  const seen = new Set<unknown>()
  let current: any = error
  let name = ''
  let message = ''
  let domException = false
  const names: string[] = []
  const messages: string[] = []
  for (let depth = 0; current && depth < 8 && !seen.has(current); depth++) {
    seen.add(current)
    const currentName = String(current?.name || '')
    const currentMessage = String(current?.message || '')
    if (currentName) names.push(currentName)
    if (currentMessage) messages.push(currentMessage)
    if (!name && currentName && !['Error', 'Exception'].includes(currentName)) name = currentName
    if (!message && currentMessage) message = currentMessage
    domException ||= typeof DOMException !== 'undefined' && current instanceof DOMException
    current = current?.cause
  }
  const errorText = messages.join(' ')
  if (names.includes('NotAllowedError') || names.includes('AbortError') || /timed out or was not allowed/i.test(errorText)) {
    return `Passkey tidak selesai. Pastikan prompt authenticator disetujui dalam 90 detik, lalu coba lagi dari ${PASSKEY_ORIGIN}. Jika prompt tidak muncul, batalkan prompt lama dan pastikan passkey dibuat pada origin yang sama.`
  }
  if (names.includes('SecurityError') || names.includes('InvalidStateError') || /rp.?id|origin/i.test(errorText)) {
    return `Passkey tidak cocok dengan origin. Buka ${PASSKEY_ORIGIN} dan gunakan passkey yang dibuat di domain tersebut.`
  }
  if (name === 'NotSupportedError') {
    return 'Perangkat/browser ini tidak menyediakan authenticator WebAuthn. Aktifkan Windows Hello, Touch ID, atau security key, lalu coba dari HTTPS.'
  }
  if (domException && !message) return 'Browser menolak permintaan passkey. Batalkan prompt yang tertinggal, klik tombol sekali, lalu coba lagi.'
  return message || String(error || '') || 'Passkey login gagal.'
}

const EVM_CHAIN_CONFIG = {
  'arc-testnet': { slug: 'arcTestnet', chain: arcTestnet },
  'base-sepolia': { slug: 'baseSepolia', chain: defineChain({ id: 84532, name: 'Base Sepolia', nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: ['https://sepolia.base.org'] } } }) },
  'arbitrum-sepolia': { slug: 'arbitrumSepolia', chain: defineChain({ id: 421614, name: 'Arbitrum Sepolia', nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: ['https://sepolia-rollup.arbitrum.io/rpc'] } } }) },
} as const

// Gas Station supports Ethereum Sepolia, but Circle Modular MSCA does not.
// Keep it in the status matrix so the UI explains the limitation without
// submitting an invalid UserOperation.
export const MSCA_DEPLOYMENT_CHAINS = ['arc-testnet', 'ethereum-sepolia', 'base-sepolia', 'arbitrum-sepolia'] as const

function chainConfig(chainKey = 'arc-testnet') {
  if (chainKey === 'ethereum-sepolia') {
    throw new Error('MSCA unsupported on Ethereum Sepolia. Circle Gas Station support does not add Modular MSCA support.')
  }
  const config = EVM_CHAIN_CONFIG[chainKey as keyof typeof EVM_CHAIN_CONFIG]
  if (!config) throw new Error(`Unsupported MSCA chain: ${chainKey}`)
  return config
}

function modularTransport(chainKey = 'arc-testnet') {
  return toModularTransport(`${CLIENT_URL}/${chainConfig(chainKey).slug}`, CLIENT_KEY)
}

async function userOpOutcome(client: any, userOpHash?: string, submittedAt?: number) {
  if (!userOpHash) return 'unknown' as const
  try {
    const receipt = await client.request({ method: 'eth_getUserOperationReceipt', params: [userOpHash] })
    if (!receipt) {
      // A stale null response must not block retries forever. We still fail
      // closed while the bounded reconciliation window is open.
      return submittedAt && Date.now() - submittedAt > 2 * 60 * 1000 ? 'unknown' as const : 'pending' as const
    }
    return isSuccessfulUserOpReceipt(receipt) ? 'success' as const : 'failed' as const
  } catch {
    return 'unknown' as const
  }
}

function mergeAuthorizationStatus(chainKey: string, userOpHash: string, delegateAddress: string) {
  const state = loadState()
  const previous = state.deploymentStatus?.[chainKey]
  // Authorization state must never downgrade a confirmed deployment to failed.
  // Keep the two concerns distinguishable in the same backward-compatible
  // per-chain record used by the existing UI.
  saveDeploymentStatus(chainKey, {
    ...(previous || { status: 'deployed' }),
    authorizationUserOpHash: userOpHash,
    authorizationDelegateAddress: delegateAddress,
    authorizationStatus: 'pending',
    authorizationError: undefined,
    updatedAt: Date.now(),
  })
}

function bundlerClientFor(chainKey: string, account: any, publicClient: any) {
  return createBundlerClient({
    account,
    chain: chainConfig(chainKey).chain,
    client: publicClient,
    transport: modularTransport(chainKey) as any,
    paymaster: true,
  })
}


// ── Register passkey + create MSCA ──
export async function registerPasskey(): Promise<{ walletAddress: string; credential: { id: string; publicKey: string; raw?: unknown }; sessionToken: string }> {
  ensurePasskeyEnvironment()
  // Keep one browser credential request at a time. The browser assertion is
  // verified by Circle exactly once on the backend; the SDK high-level helper
  // is intentionally not used because it would verify the same session again.
  return runPasskeyOperation(async () => {
    try {
      const { options, flowId } = await freshPasskeyOptions('Register')
      const rawCredential = await navigator.credentials.create({
        publicKey: registrationPublicKeyOptions(options),
      }) as any
      if (!rawCredential) throw new Error('No credential created.')
      const verified = await verifyPasskeyWithBackend(rawCredential, 'Register', flowId)
      const credential = { id: String(rawCredential.id), publicKey: String(verified.credential.publicKey), raw: rawCredential }

      const client = createPublicClient({ chain: arcTestnet, transport: modularTransport() as any })
      const smartAccount = await toCircleSmartAccount({
        client: client as any,
        owner: toWebAuthnAccount({ credential }),
      })
      const walletAddress = String(verified.address)
      if (String(smartAccount.address).toLowerCase() !== walletAddress.toLowerCase()) {
        throw new Error('Passkey wallet address mismatch')
      }
      saveState({ walletAddress, credential, sessionActive: false })
      return { walletAddress, credential, sessionToken: String(verified.token) }
    } catch (error) {
      throw new Error(passkeyErrorMessage(error), { cause: error })
    }
  })
}



// ── Deploy MSCA on-chain via passkey UserOp ──
// After deployment, call registerDelegateOwner to add delegate as owner.
export async function deploySmartAccount(): Promise<{ walletAddress: string; deployed: boolean; userOpHash?: string }> {
  const state = loadState()
  if (!state.walletAddress || !state.credential) throw new Error('Login Passkey diperlukan sebelum mengaktifkan Agent Wallet.')

  const client = createPublicClient({ chain: arcTestnet, transport: modularTransport() as any })
  const smartAccount = await toCircleSmartAccount({
    address: state.walletAddress as `0x${string}`,
    client: client as any,
    owner: toWebAuthnAccount({ credential: state.credential as { id: string; publicKey: `0x${string}` } }),
  })
  const bundlerClient = bundlerClientFor('arc-testnet', smartAccount as any, client as any)
  if (await smartAccount.isDeployed()) {
    const previous = loadState().deploymentStatus?.['arc-testnet']
    saveDeploymentStatus('arc-testnet', { ...(previous || {}), status: 'deployed', updatedAt: Date.now() })
    saveState({ ...loadState(), deployed: true })
    return { walletAddress: state.walletAddress, deployed: true }
  }

  const previousStatus = loadState().deploymentStatus?.['arc-testnet']
  const previousHash = previousStatus?.userOpHash
  const previousOutcome = await userOpOutcome(client, previousHash, previousStatus?.updatedAt)
  // Deployment is the first UserOperation. It requires an intentional passkey
  // approval and must happen in the browser, where the WebAuthn credential lives.
  // NOTE: addOwners must be a SEPARATE UserOp after deployment (registerDelegateOwner).
  // Calling addOwners in the same UserOp as deploy causes "execution reverted"
  // because the MSCA storage isn't fully initialized yet.
  const userOpHash = await sendUserOperation(bundlerClient as any, {
    calls: [{ to: smartAccount.address as `0x${string}`, value: 0n, data: '0x' as `0x${string}` }],
    paymaster: true,
  })
  const previousDeployment = loadState().deploymentStatus?.['arc-testnet']
  saveDeploymentStatus('arc-testnet', { ...(previousDeployment || {}), status: 'failed', userOpHash, updatedAt: Date.now() })
  const receipt = await waitForUserOperationReceipt(bundlerClient as any, { hash: userOpHash })
  if (!isSuccessfulUserOpReceipt(receipt) || !(await smartAccount.isDeployed())) throw new Error('Aktivasi Agent Wallet belum berhasil. Coba lagi dengan passkey yang sama.')

  const latestDeployment = loadState().deploymentStatus?.['arc-testnet']
  saveDeploymentStatus('arc-testnet', { ...(latestDeployment || {}), status: 'deployed', userOpHash, updatedAt: Date.now() })
  saveState({ ...loadState(), deployed: true })
  return { walletAddress: state.walletAddress, deployed: true, userOpHash }
}

function saveDeploymentStatus(chainKey: string, status: DeploymentStatus) {
  const state = loadState()
  const previous = state.deploymentStatus?.[chainKey]
  saveState({
    ...state,
    deploymentStatus: {
      ...(state.deploymentStatus || {}),
      [chainKey]: { ...(previous || {}), ...status },
    },
  })
}

export async function deployAllSmartAccounts(): Promise<{ walletAddress: string; results: Record<string, DeploymentStatus> }> {
  const state = loadState()
  if (!state.walletAddress || !state.credential) throw new Error('Login Passkey diperlukan sebelum deploy multi-chain.')
  const results: Record<string, DeploymentStatus> = {}
  for (const chainKey of MSCA_DEPLOYMENT_CHAINS) {
    if (chainKey === 'ethereum-sepolia') {
      const result: DeploymentStatus = { status: 'unsupported', error: 'Circle saat ini tidak mendukung MSCA di Ethereum Sepolia.', updatedAt: Date.now() }
      results[chainKey] = result; saveDeploymentStatus(chainKey, result); continue
    }
    try {
      await deploySmartAccountOnChain(chainKey)
      const result: DeploymentStatus = { status: 'deployed', ...(loadState().deploymentStatus?.[chainKey] || {}), updatedAt: Date.now() }
      results[chainKey] = result; saveDeploymentStatus(chainKey, result)
    } catch (error: any) {
      const previous = loadState().deploymentStatus?.[chainKey]
      const result: DeploymentStatus = {
        ...(previous || {}),
        status: 'failed',
        error: `${chainKey}: deployment failed: ${error?.message || 'unknown error'}`,
        updatedAt: Date.now(),
      }
      results[chainKey] = result; saveDeploymentStatus(chainKey, result)
    }
  }
  const latest = loadState()
  saveState({ ...latest, deployed: latest.deploymentStatus?.['arc-testnet']?.status === 'deployed' })
  return { walletAddress: state.walletAddress, results }
}

export function getDeploymentStatus(): Record<string, DeploymentStatus> { return loadState().deploymentStatus || {} }

export async function isSmartAccountDeployedOnChain(chainKey: string, walletAddress?: string): Promise<boolean> {
  const state = loadState()
  const address = walletAddress || state.walletAddress
  if (!address || !state.credential) throw new Error('Login Passkey diperlukan untuk verifikasi deployment.')
  if (chainKey === 'ethereum-sepolia') {
    throw new Error('MSCA unsupported on Ethereum Sepolia. Use Circle SCA/EOA wallet flow for this network.')
  }
  const config = chainConfig(chainKey)
  const client = createPublicClient({ chain: config.chain, transport: modularTransport(chainKey) as any })
  const smartAccount = await toCircleSmartAccount({
    address: address as `0x${string}`,
    client: client as any,
    owner: toWebAuthnAccount({ credential: state.credential as { id: string; publicKey: `0x${string}` } }),
  })
  return smartAccount.isDeployed()
}

// Deploy the same deterministic MSCA on a destination EVM chain using the
// original passkey credential. This must run in the browser because only the
// passkey can produce the valid first UserOperation signature.
export async function deploySmartAccountOnChain(chainKey: string): Promise<{ walletAddress: string; deployed: boolean; userOpHash?: string }> {
  const state = loadState()
  if (!state.walletAddress || !state.credential) throw new Error('Login Passkey diperlukan sebelum deploy destination MSCA.')
  if (chainKey === 'ethereum-sepolia') {
    throw new Error('MSCA unsupported on Ethereum Sepolia. Use Circle SCA/EOA wallet flow for this network.')
  }
  const config = chainConfig(chainKey)
  const client = createPublicClient({ chain: config.chain, transport: modularTransport(chainKey) as any })
  const smartAccount = await toCircleSmartAccount({
    address: state.walletAddress as `0x${string}`,
    client: client as any,
    owner: toWebAuthnAccount({ credential: state.credential as { id: string; publicKey: `0x${string}` } }),
  })
  const bundlerClient = bundlerClientFor(chainKey, smartAccount as any, client as any)
  if (await smartAccount.isDeployed()) {
    const previous = loadState().deploymentStatus?.[chainKey]
    saveDeploymentStatus(chainKey, { ...(previous || {}), status: 'deployed', updatedAt: Date.now() })
    return { walletAddress: state.walletAddress, deployed: true }
  }
  const previousStatus = loadState().deploymentStatus?.[chainKey]
  const previousHash = previousStatus?.userOpHash
  const previousOutcome = await userOpOutcome(client, previousHash, previousStatus?.updatedAt)
  if (previousOutcome === 'success' && await smartAccount.isDeployed()) {
    saveDeploymentStatus(chainKey, { ...(previousStatus as DeploymentStatus), status: 'deployed', userOpHash: previousHash, updatedAt: Date.now() })
    return { walletAddress: state.walletAddress, deployed: true, userOpHash: previousHash }
  }
  const userOpHash = await sendUserOperation(bundlerClient as any, {
    calls: [{ to: smartAccount.address as `0x${string}`, value: 0n, data: '0x' as `0x${string}` }],
    paymaster: true,
  })
  const previousDeployment = loadState().deploymentStatus?.[chainKey]
  saveDeploymentStatus(chainKey, { ...(previousDeployment || {}), status: 'failed', userOpHash, updatedAt: Date.now() })
  const receipt = await waitForUserOperationReceipt(bundlerClient as any, { hash: userOpHash })
  if (!isSuccessfulUserOpReceipt(receipt) || !(await smartAccount.isDeployed())) throw new Error(`MSCA deployment failed on ${chainKey}`)
  const latestDeployment = loadState().deploymentStatus?.[chainKey]
  saveDeploymentStatus(chainKey, { ...(latestDeployment || {}), status: 'deployed', userOpHash, updatedAt: Date.now() })
  const latest = loadState()
  saveState({ ...latest, deployed: latest.deployed ?? true })
  return { walletAddress: state.walletAddress, deployed: true, userOpHash }
}

// ── Login with existing passkey ──
export async function loginPasskey(): Promise<{ walletAddress: string; credential: { id: string; publicKey: string; raw?: unknown }; sessionToken: string }> {
  ensurePasskeyEnvironment()
  const state = loadState()
  return runPasskeyOperation(async () => {
    try {
      const { options, flowId } = await freshPasskeyOptions('Login')
      const rawCredential = await navigator.credentials.get({
        publicKey: loginPublicKeyOptions(options),
      }) as any
      if (!rawCredential) throw new Error('No credential available.')
      const verified = await verifyPasskeyWithBackend(rawCredential, 'Login', flowId)
      const credential = { id: String(rawCredential.id), publicKey: String(verified.credential.publicKey), raw: rawCredential }

      const client = createPublicClient({ chain: arcTestnet, transport: modularTransport() as any })
      const smartAccount = await toCircleSmartAccount({
        client: client as any,
        owner: toWebAuthnAccount({ credential }),
      })
      const walletAddress = String(verified.address)
      if (String(smartAccount.address).toLowerCase() !== walletAddress.toLowerCase()) {
        throw new Error('Passkey wallet address mismatch')
      }
      saveState({
        ...state,
        walletAddress,
        credential,
        sessionActive: false,
        deployed: state.deployed,
        delegateAddress: state.delegateAddress,
        deploymentStatus: state.deploymentStatus,
      })
      return { walletAddress, credential, sessionToken: String(verified.token) }
    } catch (error) {
      throw new Error(passkeyErrorMessage(error), { cause: error })
    }
  })
}

// ── Setup session key: authorize delegate on-chain, then store it in vault ──
// The backend must never activate a signer before the MSCA has accepted it.
// The delegate is an automation key, not the user's EOA or passkey key.
export async function setupSessionKey(vaultToken: string, ownerAddress?: string, ownerSessionToken?: string): Promise<{
  walletAddress: string
  delegateAddress: string
  active: boolean
}> {
  const state = loadState()
  if (!state.walletAddress) throw new Error('MSCA wallet belum dibuat. Register passkey dulu.')

  if (!state.deployed) throw new Error('MSCA harus deployed sebelum mengaktifkan automation signer.')

  // Reserve the automation signer on the backend. The private key never enters
  // the browser; only its public address is returned for passkey authorization.
  let reserveRes = await fetch(`${API}/api/session/generate-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${vaultToken}` },
    body: JSON.stringify({ walletAddress: state.walletAddress, ownerAddress, ownerSessionToken }),
  })
  let reserved = await reserveRes.json()
  // An EOA SIWE token can expire independently from the passkey/MSCA token.
  // Owner binding is optional, so discard only the stale EOA proof and retry
  // the MSCA reservation without ownerAddress instead of blocking activation.
  if (!reserveRes.ok && ownerAddress && ownerSessionToken && reserveRes.status === 403 && /Verified EOA session|ownerAddress is not authenticated/i.test(String(reserved.error || ''))) {
    localStorage.removeItem('arx_eoa_vault_token')
    reserveRes = await fetch(`${API}/api/session/generate-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${vaultToken}` },
      body: JSON.stringify({ walletAddress: state.walletAddress }),
    })
    reserved = await reserveRes.json()
  }
  if (!reserveRes.ok || !reserved.success || !reserved.delegateAddress) throw new Error(reserved.error || 'Automation signer reservation failed')
  const delegateAddress = reserved.delegateAddress

  // A passkey login may be restoring an existing on-chain authorization. Ask
  // the backend for its authoritative status before generating another
  // addOwners UserOperation. The endpoint reconciles an inactive record only
  // when it can independently verify the stored receipt and calldata; this
  // avoids duplicate owner mutations and also repairs the old split-brain
  // vault/session state after a restart or lost browser response.
  const existingStatus = await fetch(`${API}/api/session/status`, {
    headers: { Authorization: `Bearer ${vaultToken}` },
  }).then(async response => {
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data?.error || `Session status failed (${response.status})`)
    return data?.session || null
  })
  if (existingStatus?.active === true && String(existingStatus.walletAddress || '').toLowerCase() === state.walletAddress.toLowerCase()) {
    saveState({ ...state, walletAddress: state.walletAddress, delegateAddress: existingStatus.delegateAddress || delegateAddress, sessionActive: true })
    return { walletAddress: state.walletAddress, delegateAddress: existingStatus.delegateAddress || delegateAddress, active: true }
  }

  // An inactivity sweep can make the authoritative store look inactive even
  // though the exact addOwners UserOperation already succeeded on-chain.
  // Reconcile that proof before considering another owner mutation.
  if (existingStatus?.authorizationUserOpHash) {
    const reconcileResponse = await fetch(`${API}/api/session/reconcile`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${vaultToken}` },
    })
    const reconcileData = await reconcileResponse.json().catch(() => ({}))
    if (!reconcileResponse.ok) throw new Error(reconcileData?.error || `Session reconciliation failed (${reconcileResponse.status})`)
    if (reconcileData?.session?.active === true) {
      const reconciledDelegate = reconcileData.session.delegateAddress || delegateAddress
      saveState({ ...state, walletAddress: state.walletAddress, delegateAddress: reconciledDelegate, sessionActive: true })
      return { walletAddress: state.walletAddress, delegateAddress: reconciledDelegate, active: true }
    }
    const reason = String(reconcileData?.session?.reason || '')
    if (reason && reason !== 'authorization_proof_missing') {
      throw new Error(`Session authorization belum dapat direkonsiliasi: ${reason}`)
    }
  }

  // The passkey authorizes exactly this reserved address on-chain.
  const authorization = await registerDelegateOwner(delegateAddress, 'arc-testnet', vaultToken)
  if (!authorization.success || !authorization.userOpHash) throw new Error('Automation signer authorization did not return a UserOperation hash')

  // Activate the already-reserved signer only after authorization succeeded.
  const res = await fetch(`${API}/api/session/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${vaultToken}` },
    body: JSON.stringify({
      walletAddress: state.walletAddress,
      delegateAddress,
      authorizationUserOpHash: authorization.userOpHash,
      ownerAddress,
    }),
  })
  const data = await res.json()
  if (!data.success) throw new Error(data.error || 'Session setup gagal')

  // Step 4: Update local state
  saveState({ ...state, delegateAddress, sessionActive: true })

  return {
    walletAddress: state.walletAddress,
    delegateAddress,
    active: true,
  }
}

// ── Revoke session key ──
export async function revokeSessionKey(vaultToken: string): Promise<void> {
  const res = await fetch(`${API}/api/session/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${vaultToken}` },
  })
  const data = await res.json()
  if (!data.success) throw new Error(data.error || 'Revoke gagal')

  const state = loadState()
  saveState({ ...state, sessionActive: false, delegateAddress: '' })
}

// ── Get session status ──
export async function getSessionStatus(vaultToken: string): Promise<{
  active: boolean
  walletAddress?: string
  delegateAddress?: string
  statusReason?: string
  reconciled?: boolean
}> {
  try {
    const res = await fetch(`${API}/api/session/status`, {
      headers: { 'Authorization': `Bearer ${vaultToken}` },
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.error || `Session status failed (${res.status})`)
    return data.session || { active: false }
  } catch {
    return { active: false, statusReason: 'status_unavailable' }
  }
}

// ── Get stored MSCA state ──
export function getMscaState(): Partial<MscaState> {
  return loadState()
}

// ── Clear MSCA state (logout) ──
export function clearMscaState() {
  clearState()
}

// ── Register delegate EOA as on-chain owner via recovery mechanism ──
// ONE-TIME: passkey signs UserOp to add delegate as owner. After this,
// backend can sign all transactions automatically with delegate EOA.
export async function registerDelegateOwner(delegateAddress: string, chainKey = 'arc-testnet', vaultToken = ''): Promise<{ success: boolean; userOpHash?: string }> {
  const state = loadState()
  if (!state.walletAddress || !state.credential) throw new Error('Login Passkey diperlukan.')
  const config = chainConfig(chainKey)

  const client = createPublicClient({ chain: config.chain, transport: modularTransport(chainKey) as any })
  const smartAccount = await toCircleSmartAccount({
    address: state.walletAddress as `0x${string}`,
    client: client as any,
    owner: toWebAuthnAccount({ credential: state.credential as { id: string; publicKey: `0x${string}` } }),
  })

  // Extend client with recoveryActions to call registerRecoveryAddress
  const bundlerClient = createBundlerClient({
    account: smartAccount as any,
    client: client as any,
    transport: modularTransport(chainKey) as any,
    paymaster: true,
  }).extend(recoveryActions)

  const saved = loadState().deploymentStatus?.[chainKey]
  const sameDelegate = saved?.authorizationDelegateAddress?.toLowerCase() === delegateAddress.toLowerCase()
  // Never reuse a prior delegate's UserOperation as proof for a new delegate.
  // The persisted attempt is relevant only when its delegate is an exact match.
  const savedForDelegate = sameDelegate ? saved : undefined
  if (sameDelegate && saved?.authorizationUserOpHash) {
    const outcome = await userOpOutcome(client, saved.authorizationUserOpHash, saved.updatedAt)
    if (outcome === 'success') {
      // A successful on-chain addOwners is authoritative. Do not require a
      // second Circle mapping read to recognize an already completed owner
      // authorization.
      const current = loadState().deploymentStatus?.[chainKey]
      if (current?.authorizationStatus !== 'authorized') {
        saveDeploymentStatus(chainKey, { ...current, authorizationStatus: 'authorized', authorizationError: undefined, updatedAt: Date.now() })
      }
      return { success: true, userOpHash: saved.authorizationUserOpHash }
    }
  }
  // Let Circle's recovery action own mapping initialization. It treats an
  // already-known mapping as idempotent and then submits addOwners with the
  // exact payload used by Circle's SDK. No local mapping preflight or retry
  // decision can strand a fresh passkey authorization.

  // Persist the attempt marker immediately before mutation so a browser close
  // after this point can still recover the exact submitted hash.
  saveDeploymentStatus(chainKey, {
    ...(loadState().deploymentStatus?.[chainKey] || { status: 'deployed' }),
    authorizationDelegateAddress: delegateAddress,
    authorizationStatus: 'pending',
    updatedAt: Date.now(),
  })

  let userOpHash: string
  try {
    // Mirror Circle's recoveryActions implementation exactly. It performs the
    // idempotent createAddressMapping call (ignoring ALREADY_KNOWN), then sends
    // addOwners([delegate], [1], [], [], 0). This avoids the local mapping
    // branch that previously stranded an otherwise valid session activation.
    userOpHash = await bundlerClient.registerRecoveryAddress({
      account: smartAccount as any,
      recoveryAddress: delegateAddress as `0x${string}`,
      paymaster: true,
    })
  } catch (error: any) {
    // Surface Circle's original error unchanged so its official bundler
    // response can be debugged and retried by the user.
    throw error
  }
  // Persist locally and server-side before waiting. The backend records the
  // exact hash but does not activate the delegate until it independently
  // verifies a successful receipt and exact addOwners calldata.
  mergeAuthorizationStatus(chainKey, userOpHash, delegateAddress)
  try {
    const token = vaultToken || localStorage.getItem('arx_vault_token') || ''
    if (token) {
      const response = await fetch(`${API}/api/session/authorization-attempt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ walletAddress: state.walletAddress, delegateAddress, authorizationUserOpHash: userOpHash, chainKey }),
      })
      if (!response.ok) throw new Error(`authorization attempt record failed (${response.status})`)
    }
  } catch (error: any) {
    // Do not submit a second UserOperation if recording fails. The local hash
    // remains available for manual reconciliation, and the backend stays
    // fail-closed rather than activating an unverified signer.
    throw new Error(`${chainKey}: authorization hash belum tersimpan di backend; jangan retry addOwners sebelum rekonsiliasi. ${error?.message || ''}`)
  }
  try {
    const receipt = await waitForUserOperationReceipt(bundlerClient as any, { hash: userOpHash })
    if (!isSuccessfulUserOpReceipt(receipt)) {
      throw new Error(`${chainKey}: delegate authorization UserOperation reverted`)
    }
    const current = loadState().deploymentStatus?.[chainKey]
    if (current) saveDeploymentStatus(chainKey, { ...current, authorizationStatus: 'authorized', authorizationPrecheckFailed: undefined, authorizationError: undefined, updatedAt: Date.now() })
    return { success: true, userOpHash }
  } catch (error: any) {
    const current = loadState().deploymentStatus?.[chainKey]
    if (current) saveDeploymentStatus(chainKey, { ...current, authorizationStatus: 'failed', authorizationError: error?.message || 'authorization failed', updatedAt: Date.now() })
    throw error
  }
}

// ── Sign a pending tx with passkey and submit to backend relay ──
export async function signPendingTx(txId: string, calls: Array<{ to: string; data: string; value: string }>, chainKey: string): Promise<{ txHash?: string; explorerUrl?: string; error?: string }> {
  const state = loadState()
  if (!state.walletAddress || !state.credential) throw new Error('Login Passkey diperlukan.')

  if (chainKey === 'ethereum-sepolia') {
    throw new Error('MSCA unsupported on Ethereum Sepolia. Use Circle SCA/EOA wallet flow for this network.')
  }
  const config = chainConfig(chainKey)
  const client = createPublicClient({ chain: config.chain, transport: modularTransport(chainKey) as any })
  const smartAccount = await toCircleSmartAccount({
    address: state.walletAddress as `0x${string}`,
    client: client as any,
    owner: toWebAuthnAccount({ credential: state.credential as { id: string; publicKey: `0x${string}` } }),
  })

  // Normalize calls — value can be string "0x0" or bigint
  const normalizedCalls = calls.map(c => ({
    to: c.to as `0x${string}`,
    data: c.data as `0x${string}`,
    value: typeof c.value === 'string' ? BigInt(c.value) : c.value,
  }))

  // Build and sign the UserOp through the paymaster-aware bundler client.
  // Using a plain public client here omits Circle Gas Station paymaster data,
  // which makes the relayed Arbitrum UserOp fall back to native ETH funding.
  const bundlerClient = bundlerClientFor(chainKey, smartAccount as any, client as any)
  const { signUserOperation } = await import('viem/account-abstraction')
  const signedUserOp = await signUserOperation(bundlerClient as any, {
    account: smartAccount as any,
    calls: normalizedCalls,
    paymaster: true,
  })

  // Submit signed UserOp to backend relay
  const token = localStorage.getItem('arx_vault_token')
  const res = await fetch(`${API}/api/pending-txs/${txId}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ signedUserOp }),
  })
  const data = await res.json()
  if (!data.success) throw new Error(data.error || 'Submit gagal')
  return { txHash: data.txHash, explorerUrl: data.explorerUrl }
}
