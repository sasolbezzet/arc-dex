// modularWallet.ts — Circle Modular Wallet (MSCA) + passkey auth + session key management.
// Follows official Circle docs: https://developers.circle.com/wallets/modular/create-a-wallet-and-send-gasless-txn
//
// Flow:
//   1. registerPasskey()/loginPasskey() → browser WebAuthn → one backend Circle verification
//   2. createSmartAccount() → toCircleSmartAccount → MSCA address (counterfactual, not on-chain yet)
//   3. setupSessionKey() → deploySmartAccount (UserOp #1) → reserve delegate → addOwners (UserOp #2) → POST /api/session/setup
//   4. Agent uses source=session to execute tx via MSCA
//
// The MSCA has code on-chain only after its first UserOperation. Circle's
// mainnet bundler rejects a UserOperation aimed at a counterfactual address
// with `-32600 Cannot find target wallet in the system`, so deployment must be
// its own UserOperation that succeeds BEFORE addOwners is submitted. This is
// why the deploy step is never merged with the authorize step on mainnet.

import {
  toModularTransport,
  toCircleSmartAccount,
} from '@circle-fin/modular-wallets-core'
import { createPublicClient, defineChain, encodeFunctionData } from 'viem'
import { isSuccessfulUserOpReceipt } from './mscaPolicy'
import { proofWasInvalidatedByPolicy } from './sessionProofPolicy'
import { createBundlerClient, toWebAuthnAccount, sendUserOperation, waitForUserOperationReceipt } from 'viem/account-abstraction'
import { parsePublicKey } from 'webauthn-p256'

import { ensureConnectedOwnerSession, requireConnectedOwnerWallet } from '../auth'

// Circle's documented Modular Wallet endpoint and credential names.
// The Client Key must be created in Circle Console and bound to this web origin;
// it is not interchangeable with the server-side CIRCLE_API_KEY.
const CLIENT_URL = import.meta.env.VITE_CIRCLE_CLIENT_URL || 'https://modular-sdk.circle.com/v1/rpc/w3s/buidl'
const CLIENT_KEY = import.meta.env.VITE_CIRCLE_CLIENT_KEY || ''
const API = ''  // same origin proxy
const PASSKEY_ORIGIN = String(import.meta.env.VITE_PASSKEY_ORIGIN || 'https://arcoxdex.vercel.app').replace(/\/$/, '')
let passkeyOperationInFlight: Promise<unknown> | null = null
const PASSKEY_REGISTRATION_USERNAME_KEY = 'arx_passkey_registration_username'
const PASSKEY_REGISTRATION_COUNTER_KEY = 'arx_passkey_registration_counter'
const PASSKEY_REGISTRATION_LABEL_KEY = 'arx_passkey_registration_label'
type PasskeyMode = 'Login' | 'Register'

/** Proof that the connected primary EOA has an authenticated owner session. */
export interface OwnerSessionProof {
  address: string
  token: string
}

/** Human-readable labels used by the browser/password-manager passkey UI. */
const PASSKEY_AGENT_LABELS = {
  claude: 'Claude Agent Wallet',
  chatgpt: 'ChatGPT Agent Wallet',
  grok: 'Grok Agent Wallet',
  hermes: 'Hermes Agent Wallet',
  custom: 'Custom Agent Wallet',
} as const

function cleanPasskeyLabel(value: unknown) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48)
}

/**
 * Resolve the provider label independently from the durable agent key. OAuth
 * client IDs are dynamically generated, so callers may pass the server-provided
 * client name as the second argument when the key itself has no provider name.
 */
export function passkeyAgentDisplayName(agentKey = '', explicitAgentName = ''): string {
  const value = `${String(agentKey || '')} ${String(explicitAgentName || '')}`.toLowerCase()
  if (value.includes('chatgpt') || value.includes('gpt')) return PASSKEY_AGENT_LABELS.chatgpt
  if (value.includes('claude') || value.includes('anthropic')) return PASSKEY_AGENT_LABELS.claude
  if (value.includes('grok') || value.includes('xai')) return PASSKEY_AGENT_LABELS.grok
  if (value.includes('hermes')) return PASSKEY_AGENT_LABELS.hermes

  const explicit = cleanPasskeyLabel(explicitAgentName)
  if (explicit && !/^(agent|mcp)(\s+agent)?$/i.test(explicit)) {
    return `${explicit} Agent Wallet`.slice(0, 64)
  }
  return PASSKEY_AGENT_LABELS.custom
}

function registrationAgentSlug(agentKey = '', explicitAgentName = '') {
  const identity = `${String(agentKey || '')} ${String(explicitAgentName || '')}`.toLowerCase()
  if (identity.includes('chatgpt') || identity.includes('gpt')) return 'chatgpt'
  if (identity.includes('claude') || identity.includes('anthropic')) return 'claude'
  if (identity.includes('grok') || identity.includes('xai')) return 'grok'
  if (identity.includes('hermes')) return 'hermes'
  const explicitSlug = cleanPasskeyLabel(explicitAgentName).toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 12)
  const keySlug = String(agentKey || DEFAULT_AGENT_KEY).toLowerCase()
    .replace(/^oauth:/, '')
    .replace(/\|.*$/, '')
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 12)
  return explicitSlug || keySlug || 'agent'
}

function registrationCounterStorageKey(safeAgent: string) {
  return `${PASSKEY_REGISTRATION_COUNTER_KEY}:${safeAgent}`
}

function registrationLabelStorageKey(safeAgent: string) {
  return `${PASSKEY_REGISTRATION_LABEL_KEY}:${safeAgent}`
}

function nextRegistrationNumber(safeAgent: string): string {
  let current = 0
  try {
    current = Number.parseInt(localStorage.getItem(registrationCounterStorageKey(safeAgent)) || '0', 10)
  } catch { /* use the first sequence number */ }
  const next = Number.isSafeInteger(current) && current >= 0 ? current + 1 : 1
  try { localStorage.setItem(registrationCounterStorageKey(safeAgent), String(next)) } catch { /* ignore storage errors */ }
  return String(next).padStart(2, '0')
}

/**
 * Allocate one display label per registration ceremony. The pending label is
 * shared by registrationUsername() and registrationPublicKeyOptions() so the
 * Circle username and the authenticator UI show the same wallet number.
 */
function registrationLabel(agentKey = DEFAULT_AGENT_KEY, explicitAgentName = ''): string {
  const safeAgent = registrationAgentSlug(agentKey, explicitAgentName).slice(0, 12)
  try {
    const pending = localStorage.getItem(registrationLabelStorageKey(safeAgent))
    if (pending) return pending
  } catch { /* allocate below */ }
  const label = cleanPasskeyLabel(`${passkeyAgentDisplayName(agentKey, explicitAgentName)} #${nextRegistrationNumber(safeAgent)}`)
  try { localStorage.setItem(registrationLabelStorageKey(safeAgent), label) } catch { /* ignore storage errors */ }
  return label
}

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
const AGENT_STORAGE_KEY = 'arx_active_agent_key'

const DEFAULT_AGENT_KEY = 'dashboard:primary'

function resolveAgentKey(agentKey?: string) {
  const explicit = typeof agentKey === 'string' ? agentKey.trim() : ''
  try {
    const stored = localStorage.getItem(AGENT_STORAGE_KEY)
    return explicit || (typeof stored === 'string' ? stored.trim() : '') || DEFAULT_AGENT_KEY
  } catch { return explicit || DEFAULT_AGENT_KEY }
}

function stateStorageKey(agentKey?: string) {
  return `${STORAGE_KEY}:${resolveAgentKey(agentKey)}`
}
let livePasskeyCredential: any = null

type DeploymentStatus = { status: 'deployed' | 'failed' | 'unsupported'; userOpHash?: string; authorizationUserOpHash?: string; authorizationDelegateAddress?: string; authorizationStatus?: 'pending' | 'authorized' | 'failed'; authorizationPrecheckFailed?: boolean; authorizationError?: string; error?: string; updatedAt: number }
type DeploymentStatusUpdate = Omit<Partial<DeploymentStatus>, 'updatedAt'> & { updatedAt: number }
type StoredCredential = { id: string; publicKey: `0x${string}`; raw?: unknown }

interface MscaState {
  walletAddress: string
  credential: StoredCredential | null
  delegateAddress: string
  sessionActive: boolean
  deployed?: boolean
  deploymentStatus?: Record<string, DeploymentStatus>
}

function loadState(agentKey?: string): Partial<MscaState> {
  try {
    const raw = localStorage.getItem(stateStorageKey(agentKey))
    const state = raw ? JSON.parse(raw) : {}
    if (livePasskeyCredential && state?.credential && !state.credential.raw) {
      state.credential = { ...state.credential, raw: livePasskeyCredential }
    }
    return state
  } catch { return {} }
}

function saveState(state: Partial<MscaState>, agentKey?: string) {
  if (state.credential?.raw) livePasskeyCredential = state.credential.raw
  localStorage.setItem(stateStorageKey(agentKey), JSON.stringify(state))
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
      // authenticatorData/signature only exist on ASSERTION (login) credentials.
      // Registration (create) credentials carry attestationObject instead; a
      // create credential must not be rejected for missing login-only fields.
      ...(response.authenticatorData != null ? { authenticatorData: requireBase64Url(response.authenticatorData, 'authenticatorData') } : {}),
      ...(response.signature != null ? { signature: requireBase64Url(response.signature, 'signature') } : {}),
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
      // Assertion-only fields are optional here too (registration credentials
      // carry attestationObject instead of authenticatorData/signature).
      ...(response.authenticatorData != null ? { authenticatorData: bytesToBase64Url(response.authenticatorData) } : {}),
      ...(response.signature != null ? { signature: bytesToBase64Url(response.signature) } : {}),
      ...(response.userHandle !== null && response.userHandle !== undefined ? { userHandle: bytesToBase64Url(response.userHandle) } : {}),
      ...(response.attestationObject ? { attestationObject: bytesToBase64Url(response.attestationObject) } : {}),
      ...(typeof response.publicKeyAlgorithm === 'number' ? { publicKeyAlgorithm: response.publicKeyAlgorithm } : {}),
      ...(Array.isArray(response.transports) ? { transports: response.transports } : {}),
    },
  })
}

function clearState(agentKey?: string) {
  livePasskeyCredential = null
  localStorage.removeItem(stateStorageKey(agentKey))
}

async function fetchJsonWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 30_000,
): Promise<{ response: Response; data: any }> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(input, { ...init, signal: controller.signal })
    const data = await response.json().catch(() => ({}))
    return { response, data }
  } finally {
    window.clearTimeout(timer)
  }
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

export function registrationUsername(agentKey = DEFAULT_AGENT_KEY, explicitAgentName = '') {
  // Circle requires a globally unique username for each registration. The
  // numeric sequence is human-readable and the timestamp/random suffix keeps
  // the Circle username unique even if a user creates wallets on another tab.
  const safeAgent = registrationAgentSlug(agentKey, explicitAgentName).slice(0, 12)
  const label = registrationLabel(agentKey, explicitAgentName)
  const number = label.match(/#(\d+)$/)?.[1] || '01'
  const stamp = Date.now().toString(36).slice(-6)
  const rand = Math.random().toString(36).slice(2, 6)
  // <slug>-agent-wallet-<number>-<stamp>-<rand> stays below Circle's 50-char limit.
  const value = `${safeAgent}-agent-wallet-${number}-${stamp}-${rand}`.slice(0, 50)
  const key = `${PASSKEY_REGISTRATION_USERNAME_KEY}:${safeAgent}`
  try { localStorage.setItem(key, value) } catch { /* ignore */ }
  return value
}

/**
 * Fetch a fresh Circle challenge for exactly one browser operation. The
 * browser assertion is sent to the backend, which performs the one and only
 * rp_get*Verification call and returns the verified public key.
 */
async function freshPasskeyOptions(mode: PasskeyMode, agentKey = '', ownerProof?: OwnerSessionProof, explicitAgentName = '') {
  ensurePasskeyEnvironment()
  const username = mode === 'Register' ? registrationUsername(agentKey, explicitAgentName) : ''
  const response = await fetch(`${API}/api/auth/passkey-options`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode,
      username,
      ...(agentKey ? { agentKey } : {}),
      ...(ownerProof ? { ownerAddress: ownerProof.address, ownerSessionToken: ownerProof.token } : {}),
    }),
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

function normalizeRpId(value: unknown) {
  const raw = String(value || '').trim()
  if (!raw) return raw
  // WebAuthn RP IDs are hostnames, never URLs or paths. Circle normally
  // returns the hostname already, but normalize provider variants before the
  // browser hands the request to the OS Credential Manager.
  return raw.replace(/^https?:\/\//i, '').split('/')[0].split(':')[0]
}

export function loginPublicKeyOptions(options: any) {
  const result: any = {
    ...options,
    challenge: base64UrlToBytes(options.challenge),
    ...(typeof options.rpId === 'string' ? { rpId: normalizeRpId(options.rpId) } : {}),
  }
  // Always omit allowCredentials for an explicit Login passkey action. This
  // requests discoverable credentials so Chrome/Windows Hello/Touch ID can show
  // the stored passkey picker instead of binding the user to one credential and
  // jumping straight to biometric approval. The backend still validates the
  // selected credential's wallet and exact agent binding after the ceremony.
  delete result.allowCredentials
  // WebAuthn L3: request user verification explicitly so the OS authenticator
  // (Windows Hello / Touch ID / Google Password Manager) shows its own prompt
  // instead of silently resolving or declining when the flow is run from a
  // progressive web app / headless context (Hermes device pairing).
  result.userVerification = options.userVerification || 'preferred'
  // Do not consume a conditional mediation: a discoverable-credential prompt
  // must appear on demand.
  delete result.mediation
  return result
}

export function registrationPublicKeyOptions(options: any, agentKey = DEFAULT_AGENT_KEY, explicitAgentName = '') {
  const safeAgent = registrationAgentSlug(agentKey, explicitAgentName).slice(0, 12)
  const agentLabel = registrationLabel(agentKey, explicitAgentName)
  const user = options?.user || {}
  const result = {
    ...options,
    challenge: base64UrlToBytes(options.challenge),
    ...(options.rp ? {
      // `rp.name` is presentation-only. Include the agent here as well as in
      // `user.name`/`displayName` because some platform credential managers
      // show the RP label instead of the WebAuthn user label.
      rp: { ...options.rp, id: normalizeRpId(options.rp.id), name: `ARCOX · ${agentLabel}` },
    } : {}),
    user: {
      ...user,
      id: base64UrlToBytes(user.id),
      // Circle receives a unique internal username in rp_getRegistrationOptions.
      // Replace only the browser-facing labels so the passkey picker says which
      // Agent Wallet is being created instead of exposing `arx-<random>`. The
      // unique server username remains in Circle's challenge/session state.
      name: agentLabel,
      displayName: agentLabel,
    },
    ...(Array.isArray(options.excludeCredentials) ? {
      excludeCredentials: options.excludeCredentials.map((credential: any) => ({
        ...credential,
        id: base64UrlToBytes(credential.id),
      })),
    } : {}),
  }
  // The pending label is consumed by this registration ceremony. A failed or
  // cancelled ceremony gets a fresh number on the next attempt instead of
  // reusing the label from an older wallet.
  try { localStorage.removeItem(registrationLabelStorageKey(safeAgent)) } catch { /* ignore */ }
  return result
}

async function verifyPasskeyWithBackend(rawCredential: any, mode: PasskeyMode, flowId: string, agentKey = '', ownerProof?: OwnerSessionProof) {
  const response = await fetch(`${API}/api/auth/passkey-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      credential: serializeWebAuthnCredential(rawCredential),
      mode,
      flowId,
      ...(agentKey ? { agentKey } : {}),
      ...(ownerProof ? { ownerAddress: ownerProof.address, ownerSessionToken: ownerProof.token } : {}),
    }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.success || !data.token || !data.credential?.publicKey || !data.address) {
    throw new Error(data?.error || 'Passkey verification gagal')
  }
  return data
}

function errorMessageChain(error: unknown): string {
  const seen = new Set<unknown>()
  const messages: string[] = []
  let current: any = error
  for (let depth = 0; current && depth < 8 && !seen.has(current); depth++) {
    seen.add(current)
    if (current?.message) messages.push(String(current.message))
    current = current?.cause
  }
  return messages.join(' ')
}

/**
 * Circle/viem sometimes wraps a Gas Station policy rejection in the generic
 * `JSON is not a valid request object` error. Keep the actionable policy reason
 * and distinguish it from passkey/browser failures. A policy precheck rejection
 * happens before the UserOperation is accepted, so retrying immediately only
 * burns the same daily quota again and never creates a wallet.
 */
export function formatCircleUserOperationError(error: unknown, chainKey = ''): string {
  const text = [
    errorMessageChain(error),
    String((error as any)?.details || ''),
    String((error as any)?.shortMessage || ''),
  ].filter(Boolean).join(' ')
  if (/exceeded max daily native token|daily native token.*policy|policy.*max daily native token/i.test(text)) {
    const chain = chainKey ? ` di ${chainKey}` : ''
    return `Kuota Gas Station harian untuk native token pada policy Circle sudah habis${chain}. UserOperation ditolak sebelum masuk bundler; wallet Agent belum dibuat. Reset atau naikkan batas harian policy di Circle Console, lalu ulangi sekali. Jangan mengulang klik sebelum kuota tersedia.`
  }
  if (/exceeded max daily .*policy|daily .*token.*policy|policy.*daily limit/i.test(text)) {
    const chain = chainKey ? ` di ${chainKey}` : ''
    return `Batas harian Gas Station policy Circle sudah tercapai${chain}. UserOperation belum diterima dan tidak ada wallet baru yang dibuat. Perbarui/reset policy di Circle Console, lalu ulangi.`
  }
  return error instanceof Error ? error.message : String(error || 'UserOperation gagal')
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
  if (names.includes('NotReadableError') || /credential manager|credential vault/i.test(errorText)) {
    return 'Credential Manager perangkat gagal diakses. Tutup prompt passkey yang tertinggal, buka ARCOX dari https://arcoxdex.vercel.app, lalu coba lagi. Jika tetap gagal, pilih Windows Hello/Touch ID atau security key lain.'
  }
  if (domException && !message) return 'Browser menolak permintaan passkey. Batalkan prompt yang tertinggal, klik tombol sekali, lalu coba lagi.'
  return message || String(error || '') || 'Passkey login gagal.'
}

// addOwners calldata for the reserved delegate: Circle's recovery action and
// the backend validator both expect exactly addOwners([delegate],[1],[],[],0).
const ADD_OWNERS_ABI = [{
  type: 'function' as const,
  name: 'addOwners',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'ownersToAdd', type: 'address[]' },
    { name: 'weightsToAdd', type: 'uint256[]' },
    { name: 'publicKeyOwnersToAdd', type: 'tuple[]', components: [{ name: 'x', type: 'uint256' }, { name: 'y', type: 'uint256' }] },
    { name: 'publicKeyWeightsToAdd', type: 'uint256[]' },
    { name: 'newThresholdWeight', type: 'uint256' },
  ],
  outputs: [],
}]

// Circle's Arbitrum bundler rejects UserOperations with a zero priority
// fee. Circle publishes authoritative prices via circle_getUserOperationGasPrice
// (low/medium/high); use the medium level so deployment/authorization does not
// wait on a second attempt. Other chains leave fee selection to Circle Gas
// Station exactly as before.
export function normalizeArbitrumUserOperationFees(maxFeePerGas: bigint, maxPriorityFeePerGas: bigint, minimumPriority = 1_000_000_000n) {
  const priority = maxPriorityFeePerGas > minimumPriority ? maxPriorityFeePerGas : minimumPriority
  // EIP-1559 requires maxFee >= priority. Add the priority to the observed
  // base fee so a rapidly changing Arbitrum base fee cannot invalidate the op.
  const max = maxFeePerGas >= priority ? maxFeePerGas + priority : priority * 2n
  return { maxPriorityFeePerGas: priority, maxFeePerGas: max }
}

async function circleGasFees(chainKey: string): Promise<{ maxPriorityFeePerGas?: bigint; maxFeePerGas?: bigint }> {
  // Circle's default viem fee can fall below the bundler's minimum on Arc.
  // Query Circle's recommendation for every MSCA creation chain so a quiet
  // network does not produce an underpriced precheck, while retaining a safe
  // 1 gwei floor for Arc and other providers that require it.
  const safeFloor = { maxPriorityFeePerGas: 1_000_000_000n, maxFeePerGas: 2_000_000_000n }
  try {
    const config = chainConfig(chainKey)
    const client = createPublicClient({ chain: config.chain, transport: modularTransport(chainKey) as any })
    const price = await (client as any).request({ method: 'circle_getUserOperationGasPrice', params: [] }).catch(() => null) as any
    for (const level of [price?.medium, price?.fast, price?.slow]) {
      if (!level) continue
      const suggestedMax = BigInt(level.maxFeePerGas || 0)
      const suggestedPriority = BigInt(level.maxPriorityFeePerGas || 0)
      if (suggestedMax <= 0n && suggestedPriority <= 0n) continue
      const priority = suggestedPriority > safeFloor.maxPriorityFeePerGas
        ? suggestedPriority
        : safeFloor.maxPriorityFeePerGas
      const max = suggestedMax >= priority ? suggestedMax : safeFloor.maxFeePerGas
      return { maxPriorityFeePerGas: priority, maxFeePerGas: max }
    }
  } catch { /* fall through to the safe floor */ }
  return safeFloor
}

// viem belum mengekspor chain Arc mainnet, jadi didefinisikan lokal (id 5042)
// dengan RPC publik mainnet yang sudah diverifikasi.
const arcMainnet = defineChain({
  id: 5042,
  name: 'Arc Mainnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.arc.io'] } },
})

// Slug transport Circle Modular mainnet (lowerCamelCase nama chain SDK).
const EVM_CHAIN_CONFIG = {
  'arc-mainnet': { slug: 'arc', chain: arcMainnet },
  'base-mainnet': { slug: 'base', chain: defineChain({ id: 8453, name: 'Base', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: ['https://mainnet.base.org'] } } }) },
  'arbitrum-mainnet': { slug: 'arbitrum', chain: defineChain({ id: 42161, name: 'Arbitrum', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: ['https://arb1.arbitrum.io/rpc'] } } }) },
} as const

// Exactly these three networks are part of Agent Wallet creation. Ethereum
// Mainnet remains available to CCTP/balance features, but it is not an MSCA
// deployment target and must never produce an "unsupported" pseudo-success.
// Catatan mainnet: backend hanya mengizinkan MSCA di `arc-mainnet`
// (MSCA_SUPPORTED_CHAIN_KEYS), jadi Base/Arbitrum mainnet tetap gagal-tertutup
// di server sampai Circle mendukung Modular MSCA di chain tersebut.
export const MSCA_DEPLOYMENT_CHAINS = ['arc-mainnet', 'base-mainnet', 'arbitrum-mainnet'] as const

function chainConfig(chainKey = 'arc-mainnet') {
  if (chainKey === 'ethereum-mainnet') {
    throw new Error('MSCA unsupported on Ethereum. Circle Gas Station support does not add Modular MSCA support.')
  }
  const config = EVM_CHAIN_CONFIG[chainKey as keyof typeof EVM_CHAIN_CONFIG]
  if (!config) throw new Error(`Unsupported MSCA chain: ${chainKey}`)
  return config
}

function modularTransport(chainKey = 'arc-mainnet') {
  return toModularTransport(`${CLIENT_URL}/${chainConfig(chainKey).slug}`, CLIENT_KEY)
}

async function waitForUserOperationReceiptBounded(bundlerClient: any, hash: `0x${string}`, timeoutMs = 180_000) {
  return Promise.race([
    waitForUserOperationReceipt(bundlerClient, { hash }),
    new Promise<never>((_, reject) => {
      window.setTimeout(() => reject(new Error('Otorisasi Agent Wallet belum mendapat receipt dari Circle setelah 3 menit. Hash UserOperation tetap disimpan; jangan membuat wallet baru, tunggu jaringan lalu Login passkey lagi.')), timeoutMs)
    }),
  ])
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

// ── WebAuthn sender mapping for destination chains ──
// Circle's WeightedWebAuthnMultisig plugin resolves the WebAuthn validation
// entry by the sender = keccak(publicKeyX, publicKeyY). That resolution must
// exist on EVERY chain the wallet is used on. Registration on Arc mainnet
// creates the mapping on Arc only; Base / Arbitrum have no
// mapping and the plugin then reverts with `InvalidValidationFunctionId`
// during UserOperation simulation (the exact production error).
//
// `circle_createAddressMapping` is an off-chain Circle API call (no tx, no
// gas) and is what the official SDK's executeRecovery does before addOwners.
// It is idempotent: a duplicate mapping returns an ALREADY_KNOWN error that
// we swallow.
async function ensureWebAuthnOwnerMapping(chainKey: string, agentKey = DEFAULT_AGENT_KEY): Promise<void> {
  if (chainKey === 'arc-mainnet' || chainKey === 'ethereum-mainnet') return
  const state = loadState(agentKey)
  if (!state.walletAddress || !state.credential?.publicKey) return
  const config = chainConfig(chainKey)
  // Backend stores the passkey public key as a compressed SEC1 point
  // (serializePublicKey(..., { compressed: true })). Extract x/y the same
  // way the official SDK's executeRecovery does before createAddressMapping.
  const { x, y } = parsePublicKey(state.credential.publicKey)
  const body = {
    jsonrpc: '2.0',
    id: Date.now(),
    method: 'circle_createAddressMapping',
    params: [{
      walletAddress: state.walletAddress,
      owners: [{ type: 'WEBAUTHOWNER', identifier: { publicKeyX: x.toString(), publicKeyY: y.toString() } }],
    }],
  }
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 20_000)
  let res: Response
  try {
    res = await fetch(`/api/circle-modular/w3s/buidl/${config.slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError'
      ? 'proxy Circle timeout setelah 20 detik'
      : error instanceof Error ? error.message : 'request proxy Circle gagal'
    throw new Error(`${chainKey}: sender mapping gagal (${message})`, { cause: error })
  } finally {
    window.clearTimeout(timeout)
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.error) {
    const message = String(data?.error?.message || res.statusText || 'unknown')
    // ALREADY_KNOWN = duplicate mapping; that is the desired end state.
    if (/already|ALREADY|exists|duplicate|known/i.test(message)) return
    throw new Error(`${chainKey}: sender mapping gagal (${message})`)
  }
}

function mergeAuthorizationStatus(chainKey: string, userOpHash: string, delegateAddress: string, agentKey = DEFAULT_AGENT_KEY) {
  const state = loadState(agentKey)
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


function createStoredCredential(id: unknown, publicKey: unknown, raw: unknown): StoredCredential {
  const normalizedPublicKey = String(publicKey || '')
  if (!/^0x[0-9a-fA-F]+$/.test(normalizedPublicKey)) {
    throw new Error('Kunci passkey dari server tidak valid. Login passkey ulang diperlukan.')
  }
  return { id: String(id), publicKey: normalizedPublicKey as `0x${string}`, raw }
}

/**
 * Build every browser-side Circle account with the same RP ID that was used
 * during registration/login. Without this explicit RP ID, viem/webauthn-p256
 * falls back to `window.location.hostname`; on a Vercel preview, an embedded
 * mobile tab, or an agent callback route that can differ from the credential's
 * `arcoxdex.vercel.app` origin. Circle then never reaches the authenticator
 * prompt and the UI appears stuck while preparing the UserOperation.
 */
function webAuthnOwner(credential: StoredCredential) {
  const rpId = new URL(PASSKEY_ORIGIN).hostname
  return toWebAuthnAccount({ credential, rpId })
}

export function getPasskeyRpId() {
  return new URL(PASSKEY_ORIGIN).hostname
}

// ── Register passkey + create MSCA ──
export async function registerPasskey(agentKey = DEFAULT_AGENT_KEY, ownerProof?: OwnerSessionProof, explicitAgentName = ''): Promise<{ walletAddress: string; credential: StoredCredential; sessionToken: string }> {
  ensurePasskeyEnvironment()
  const selectedAgentKey = resolveAgentKey(agentKey)
  // A new Agent Wallet is an owner-bound resource. Obtain and validate the
  // primary EOA session before opening WebAuthn so the passkey ceremony cannot
  // create an orphaned wallet that cannot later be attached to an agent.
  localStorage.setItem(AGENT_STORAGE_KEY, selectedAgentKey)
  return runPasskeyOperation(async () => {
    try {
      // This happens before navigator.credentials.create(). `ownerProof` is
      // accepted from OAuth approval callers that already completed the owner
      // session; otherwise the connected wallet is verified here exactly once.
      const verifiedOwner = ownerProof || await ensureConnectedOwnerSession()
      const { options, flowId } = await freshPasskeyOptions('Register', selectedAgentKey, verifiedOwner, explicitAgentName)
      const rawCredential = await navigator.credentials.create({
        publicKey: registrationPublicKeyOptions(options, selectedAgentKey, explicitAgentName),
      }) as any
      if (!rawCredential) throw new Error('No credential created.')
      const verified = await verifyPasskeyWithBackend(rawCredential, 'Register', flowId, selectedAgentKey, verifiedOwner)
      const credential = createStoredCredential(rawCredential.id, verified.credential.publicKey, rawCredential)

      const client = createPublicClient({ chain: arcMainnet, transport: modularTransport() as any })
      const smartAccount = await toCircleSmartAccount({
        client: client as any,
        owner: webAuthnOwner(credential),
      })
      const walletAddress = String(verified.address)
      if (String(smartAccount.address).toLowerCase() !== walletAddress.toLowerCase()) {
        throw new Error('Passkey wallet address mismatch')
      }
      saveState({ walletAddress, credential, sessionActive: false }, selectedAgentKey)
      return { walletAddress, credential, sessionToken: String(verified.token) }
    } catch (error) {
      throw new Error(passkeyErrorMessage(error), { cause: error })
    }
  })
}



// ── Deploy MSCA on-chain via passkey UserOp ──
// After deployment, call registerDelegateOwner to add delegate as owner.
export async function deploySmartAccount(agentKey = DEFAULT_AGENT_KEY): Promise<{ walletAddress: string; deployed: boolean; userOpHash?: string }> {
  const selectedAgentKey = resolveAgentKey(agentKey)
  const state = loadState(selectedAgentKey)
  if (!state.walletAddress || !state.credential) throw new Error('Login Passkey diperlukan sebelum mengaktifkan Agent Wallet.')

  const client = createPublicClient({ chain: arcMainnet, transport: modularTransport() as any })
  const smartAccount = await toCircleSmartAccount({
    address: state.walletAddress as `0x${string}`,
    client: client as any,
    owner: webAuthnOwner(state.credential as StoredCredential),
  })
  const bundlerClient = bundlerClientFor('arc-mainnet', smartAccount as any, client as any)
  if (await smartAccount.isDeployed()) {
    const previous = loadState(agentKey).deploymentStatus?.['arc-mainnet']
    saveDeploymentStatus('arc-mainnet', { ...(previous || {}), status: 'deployed', updatedAt: Date.now() }, agentKey)
    saveState({ ...loadState(agentKey), deployed: true }, agentKey)
    return { walletAddress: state.walletAddress, deployed: true }
  }

  // Deployment is the first UserOperation. It requires an intentional passkey
  // approval and must happen in the browser, where the WebAuthn credential lives.
  // NOTE: addOwners must always be a SEPARATE, later UserOp (registerDelegateOwner).
  // Circle's mainnet bundler cannot resolve a counterfactual MSCA, so an
  // addOwners op that carries the deploy initCode is rejected before it is ever
  // simulated. Deploy has to land first.
  // Arc mainnet rejects a UserOperation whose maxPriorityFeePerGas is 0 with
  // `precheck failed: maxPriorityFeePerGas is 0 but must be at least 1000000000`.
  // Circle's default viem fee is 0 on a quiet network, so query Circle's own
  // recommendation and apply the 1 gwei floor exactly like the other chains.
  const fees = await circleGasFees('arc-mainnet')
  const userOpHash = await sendUserOperation(bundlerClient as any, {
    calls: [{ to: smartAccount.address as `0x${string}`, value: 0n, data: '0x' as `0x${string}` }],
    paymaster: true,
    ...fees,
  })
  const previousDeployment = loadState(agentKey).deploymentStatus?.['arc-mainnet']
  saveDeploymentStatus('arc-mainnet', { ...(previousDeployment || {}), status: 'failed', userOpHash, updatedAt: Date.now() }, agentKey)
  const receipt = await waitForUserOperationReceiptBounded(bundlerClient as any, userOpHash as `0x${string}`)
  if (!isSuccessfulUserOpReceipt(receipt) || !(await smartAccount.isDeployed())) throw new Error('Aktivasi Agent Wallet belum berhasil. Coba lagi dengan passkey yang sama.')

  const latestDeployment = loadState(agentKey).deploymentStatus?.['arc-mainnet']
  saveDeploymentStatus('arc-mainnet', { ...(latestDeployment || {}), status: 'deployed', userOpHash, updatedAt: Date.now() }, agentKey)
  saveState({ ...loadState(agentKey), deployed: true }, agentKey)
  return { walletAddress: state.walletAddress, deployed: true, userOpHash }
}

function saveDeploymentStatus(chainKey: string, status: DeploymentStatusUpdate, agentKey = DEFAULT_AGENT_KEY) {
  const state = loadState(agentKey)
  const previous = state.deploymentStatus?.[chainKey]
  const merged: DeploymentStatus = {
    ...(previous || {}),
    ...status,
    status: status.status || previous?.status || 'failed',
    updatedAt: status.updatedAt,
  } as DeploymentStatus
  saveState({
    ...state,
    deploymentStatus: {
      ...(state.deploymentStatus || {}),
      [chainKey]: merged,
    },
  }, agentKey)
}

export async function deployAllSmartAccounts(agentKey = DEFAULT_AGENT_KEY): Promise<{ walletAddress: string; results: Record<string, DeploymentStatus> }> {
  const state = loadState(agentKey)
  if (!state.walletAddress || !state.credential) throw new Error('Login Passkey diperlukan sebelum deploy multi-chain.')
  const results: Record<string, DeploymentStatus> = {}
  for (const chainKey of MSCA_DEPLOYMENT_CHAINS) {
    try {
      await deploySmartAccountOnChain(chainKey, agentKey)
      const result: DeploymentStatus = { status: 'deployed', ...(loadState(agentKey).deploymentStatus?.[chainKey] || {}), updatedAt: Date.now() }
      results[chainKey] = result; saveDeploymentStatus(chainKey, result, agentKey)
    } catch (error: any) {
      const previous = loadState(agentKey).deploymentStatus?.[chainKey]
      const result: DeploymentStatus = {
        ...(previous || {}),
        status: 'failed',
        error: `${chainKey}: deployment failed: ${error?.message || 'unknown error'}`,
        updatedAt: Date.now(),
      }
      results[chainKey] = result; saveDeploymentStatus(chainKey, result, agentKey)
    }
  }
  const latest = loadState(agentKey)
  saveState({ ...latest, deployed: latest.deploymentStatus?.['arc-mainnet']?.status === 'deployed' }, agentKey)
  return { walletAddress: state.walletAddress, results }
}

export function getDeploymentStatus(agentKey = DEFAULT_AGENT_KEY): Record<string, DeploymentStatus> { return loadState(agentKey).deploymentStatus || {} }

export async function isSmartAccountDeployedOnChain(chainKey: string, walletAddress?: string, agentKey = DEFAULT_AGENT_KEY): Promise<boolean> {
  const state = loadState(agentKey)
  const address = walletAddress || state.walletAddress
  if (!address || !state.credential) throw new Error('Login Passkey diperlukan untuk verifikasi deployment.')
  if (chainKey === 'ethereum-mainnet') {
    throw new Error('MSCA unsupported on Ethereum. Use Circle SCA/EOA wallet flow for this network.')
  }
  const config = chainConfig(chainKey)
  const client = createPublicClient({ chain: config.chain, transport: modularTransport(chainKey) as any })
  const smartAccount = await toCircleSmartAccount({
    address: address as `0x${string}`,
    client: client as any,
    owner: webAuthnOwner(state.credential as StoredCredential),
  })
  return smartAccount.isDeployed()
}

// Deploy the same deterministic MSCA on a destination EVM chain using the
// original passkey credential. This must run in the browser because only the
// passkey can produce the valid first UserOperation signature.
export async function deploySmartAccountOnChain(chainKey: string, agentKey = DEFAULT_AGENT_KEY): Promise<{ walletAddress: string; deployed: boolean; userOpHash?: string }> {
  const state = loadState(agentKey)
  if (!state.walletAddress || !state.credential) throw new Error('Login Passkey diperlukan sebelum deploy destination MSCA.')
  if (chainKey === 'ethereum-mainnet') {
    throw new Error('MSCA unsupported on Ethereum. Use Circle SCA/EOA wallet flow for this network.')
  }
  const config = chainConfig(chainKey)
  const client = createPublicClient({ chain: config.chain, transport: modularTransport(chainKey) as any })
  const smartAccount = await toCircleSmartAccount({
    address: state.walletAddress as `0x${string}`,
    client: client as any,
    owner: webAuthnOwner(state.credential as StoredCredential),
  })
  const bundlerClient = bundlerClientFor(chainKey, smartAccount as any, client as any)
  if (await smartAccount.isDeployed()) {
    const previous = loadState(agentKey).deploymentStatus?.[chainKey]
    saveDeploymentStatus(chainKey, { ...(previous || {}), status: 'deployed', updatedAt: Date.now() }, agentKey)
    return { walletAddress: state.walletAddress, deployed: true }
  }
  const previousStatus = loadState(agentKey).deploymentStatus?.[chainKey]
  const previousHash = previousStatus?.userOpHash
  const previousOutcome = await userOpOutcome(client, previousHash, previousStatus?.updatedAt)
  if (previousOutcome === 'success' && await smartAccount.isDeployed()) {
    saveDeploymentStatus(chainKey, { ...(previousStatus as DeploymentStatus), status: 'deployed', userOpHash: previousHash, updatedAt: Date.now() }, agentKey)
    return { walletAddress: state.walletAddress, deployed: true, userOpHash: previousHash }
  }
  // Destination chains do not inherit the WebAuthn sender mapping from Arc;
  // create it (idempotent, off-chain) so the plugin can validate the UserOp.
  await ensureWebAuthnOwnerMapping(chainKey, agentKey)
  const fees = await circleGasFees(chainKey)
  const userOpHash = await sendUserOperation(bundlerClient as any, {
    calls: [{ to: smartAccount.address as `0x${string}`, value: 0n, data: '0x' as `0x${string}` }],
    paymaster: true,
    ...fees,
  })
  const previousDeployment = loadState(agentKey).deploymentStatus?.[chainKey]
  saveDeploymentStatus(chainKey, { ...(previousDeployment || {}), status: 'failed', userOpHash, updatedAt: Date.now() }, agentKey)
  const receipt = await waitForUserOperationReceiptBounded(bundlerClient as any, userOpHash as `0x${string}`)
  if (!isSuccessfulUserOpReceipt(receipt) || !(await smartAccount.isDeployed())) throw new Error(`MSCA deployment failed on ${chainKey}`)
  const latestDeployment = loadState(agentKey).deploymentStatus?.[chainKey]
  saveDeploymentStatus(chainKey, { ...(latestDeployment || {}), status: 'deployed', userOpHash, updatedAt: Date.now() }, agentKey)
  const latest = loadState(agentKey)
  saveState({ ...latest, deployed: latest.deployed ?? true }, agentKey)
  return { walletAddress: state.walletAddress, deployed: true, userOpHash }
}

// ── Login with existing passkey ──
export async function loginPasskey(agentKey = DEFAULT_AGENT_KEY, ownerProof?: OwnerSessionProof): Promise<{ walletAddress: string; credential: StoredCredential; sessionToken: string }> {
  ensurePasskeyEnvironment()
  const requestedAgentKey = typeof agentKey === 'string' ? agentKey.trim() : ''
  if (!requestedAgentKey) throw new Error('Agent key tidak tersedia. Muat ulang dashboard lalu coba lagi.')
  const selectedAgentKey = resolveAgentKey(requestedAgentKey)
  // A passkey login must never be usable as an ownerless entry point. Check the
  // injected/WalletConnect account silently before opening WebAuthn; eth_accounts
  // never opens a wallet popup. Owner SIWE is intentionally deferred until after
  // the passkey succeeds so Login does not jump to the wallet app first.
  await requireConnectedOwnerWallet()
  localStorage.setItem(AGENT_STORAGE_KEY, selectedAgentKey)
  const state = loadState(selectedAgentKey)
  return runPasskeyOperation(async () => {
    try {
      const { options, flowId } = await freshPasskeyOptions('Login', selectedAgentKey, ownerProof)
      const rawCredential = await navigator.credentials.get({
        publicKey: loginPublicKeyOptions(options),
      }) as any
      if (!rawCredential) throw new Error('No credential available.')
      const verified = await verifyPasskeyWithBackend(rawCredential, 'Login', flowId, selectedAgentKey, ownerProof)
      const credential = createStoredCredential(rawCredential.id, verified.credential.publicKey, rawCredential)

      const client = createPublicClient({ chain: arcMainnet, transport: modularTransport() as any })
      const smartAccount = await toCircleSmartAccount({
        client: client as any,
        owner: webAuthnOwner(credential),
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
      }, selectedAgentKey)
      return { walletAddress, credential, sessionToken: String(verified.token) }
    } catch (error) {
      throw new Error(passkeyErrorMessage(error), { cause: error })
    }
  })
}

// ── Setup session key: authorize delegate on-chain, then store it in vault ──
// The backend must never activate a signer before the MSCA has accepted it.
// The delegate is an automation key, not the user's EOA or passkey key.
export async function setupSessionKey(vaultToken: string, ownerAddress?: string, ownerSessionToken?: string, agentKey = DEFAULT_AGENT_KEY): Promise<{
  walletAddress: string
  delegateAddress: string
  active: boolean
}> {
  const state = loadState(agentKey)
  if (!state.walletAddress) throw new Error('MSCA wallet belum dibuat. Register passkey dulu.')

  // The deployment UserOp is NOT optional on mainnet. A counterfactual MSCA
  // (no code yet) is rejected by Circle's bundler with `Cannot find target
  // wallet in the system`, so addOwners can only ever be the SECOND
  // UserOperation. `deploySmartAccount` is idempotent and returns immediately
  // once `isDeployed()` is true, so an already-deployed wallet costs no extra
  // Gas Station quota. The call itself happens below, immediately before the
  // addOwners authorization, so a re-used active session never triggers it.

  // Reserve the automation signer on the backend. The private key never enters
  // the browser; only its public address is returned for passkey authorization.
  const reserveRes = await fetchJsonWithTimeout(`${API}/api/session/generate-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${vaultToken}` },
    body: JSON.stringify({ walletAddress: state.walletAddress, ownerAddress, ownerSessionToken, agentKey }),
  }, 30_000)
  const reserved = reserveRes.data
  // Owner proof is mandatory. Never retry without it: doing so would recreate
  // the historical bug where an MSCA passkey was silently attached to a stale
  // or foreign owner identity.
  if (!reserveRes.response.ok || !reserved.success || !reserved.delegateAddress) {
    const error = new Error(reserved.error || 'Automation signer reservation failed') as Error & { code?: string }
    if (reserved.code) error.code = String(reserved.code)
    throw error
  }
  const delegateAddress = reserved.delegateAddress

  // A passkey login may be restoring an existing on-chain authorization. Ask
  // the backend for its authoritative status before generating another
  // addOwners UserOperation. The endpoint reconciles an inactive record only
  // when it can independently verify the stored receipt and calldata; this
  // avoids duplicate owner mutations and also repairs the old split-brain
  // vault/session state after a restart or lost browser response.
  const existingStatusResult = await fetchJsonWithTimeout(`${API}/api/session/status`, {
    headers: { Authorization: `Bearer ${vaultToken}` },
  }, 20_000)
  if (!existingStatusResult.response.ok) {
    throw new Error(existingStatusResult.data?.error || `Session status failed (${existingStatusResult.response.status})`)
  }
  const existingStatus = existingStatusResult.data?.session || null
  if (existingStatus?.active === true && String(existingStatus.walletAddress || '').toLowerCase() === state.walletAddress.toLowerCase()) {
    saveState({ ...state, walletAddress: state.walletAddress, delegateAddress: existingStatus.delegateAddress || delegateAddress, sessionActive: true }, agentKey)
    return { walletAddress: state.walletAddress, delegateAddress: existingStatus.delegateAddress || delegateAddress, active: true }
  }

  // A revoked or cleared record must never replay its old proof: the user did
  // not re-approve that UserOperation, and resurrecting it would silently
  // re-enable a delegate they revoked. The reservation above already rotated
  // the delegate for those cases, so this guard only protects records written
  // before the backend started dropping the stale hash.
  const proofIsDead = proofWasInvalidatedByPolicy(existingStatus)
  // An inactivity expiry can leave the authoritative store inactive even
  // though the exact addOwners UserOperation already succeeded on-chain.
  // Reconcile that proof before considering another owner mutation.
  if (existingStatus?.authorizationUserOpHash && !proofIsDead) {
    let lastReconcileReason = ''
    const reconciliationDeadline = Date.now() + 90_000
    // The hash already exists, so keep reconciling that exact operation while
    // Circle's receipt/indexer catches up. Never submit another addOwners while
    // this path is pending; doing so could create duplicate owners.
    for (let attempt = 0; attempt < 60 && Date.now() < reconciliationDeadline; attempt++) {
      const reconcileResult = await fetchJsonWithTimeout(`${API}/api/session/reconcile`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${vaultToken}` },
      }, 75_000)
      if (!reconcileResult.response.ok) throw new Error(reconcileResult.data?.error || `Session reconciliation failed (${reconcileResult.response.status})`)
      const reconcileData = reconcileResult.data
      if (reconcileData?.session?.active === true) {
        const reconciledDelegate = reconcileData.session.delegateAddress || delegateAddress
        saveState({ ...state, walletAddress: state.walletAddress, delegateAddress: reconciledDelegate, sessionActive: true }, agentKey)
        return { walletAddress: state.walletAddress, delegateAddress: reconciledDelegate, active: true }
      }
      lastReconcileReason = String(reconcileData?.session?.reason || '')
      const retryAllowed = reconcileData?.session?.retryAllowed === true
      if (lastReconcileReason !== 'authorization_pending') {
        // A finalized failed UserOperation is safe to replace; the backend
        // re-checks the old hash before accepting the new authorization.
        if (lastReconcileReason === 'authorization_failed' && retryAllowed) break
        // Legacy proof-missing records may retry only when the backend did not
        // explicitly report that owner mapping/index state is unknown.
        if (lastReconcileReason === 'authorization_proof_missing' && reconcileData?.session?.retryAllowed !== false) break
        if (lastReconcileReason) throw new Error(`Session authorization belum dapat direkonsiliasi: ${lastReconcileReason}`)
      }
      await new Promise(resolve => setTimeout(resolve, 2_000))
    }
    if (lastReconcileReason === 'authorization_pending') {
      throw new Error('Session authorization masih diproses Circle. Hash yang sama tetap disimpan; tunggu beberapa detik lalu tekan Login Passkey lagi, jangan membuat Agent Wallet baru.')
    }
    // `authorization_proof_missing` means the stored hash is either not
    // finalized or was pruned by the bundler index and the record was never
    // activated. In both cases there is no on-chain owner proof yet, so it is
    // safe to authorize a fresh addOwners UserOperation below. Only an
    // explicit unresolved hash (e.g. a manual revoke) must block activation.
    if (lastReconcileReason && lastReconcileReason !== 'authorization_proof_missing') {
      throw new Error(`Session authorization belum aktif; rekonsiliasi hash lama berhenti pada: ${lastReconcileReason || 'unknown'}`)
    }
  }

  // Step 3 — deploy the deterministic MSCA on-chain (UserOp #1) and wait for
  // its receipt. Until this succeeds the address has no bytecode and Circle's
  // bundler refuses every UserOperation that targets it, so this must complete
  // before the addOwners authorization below (UserOp #2). Idempotent: an
  // already-deployed wallet returns without a new UserOperation.
  await deploySmartAccount(agentKey)

  // Step 4 — the passkey authorizes exactly this reserved address. This is the
  // second UserOperation (addOwners), which is only valid once the MSCA exists.
  const authorization = await registerDelegateOwner(delegateAddress, 'arc-mainnet', vaultToken, agentKey)
  if (!authorization.success || !authorization.userOpHash) throw new Error('Automation signer authorization did not return a UserOperation hash')

  // Activate the already-reserved signer only after authorization succeeded.
  const setupResult = await fetchJsonWithTimeout(`${API}/api/session/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${vaultToken}` },
    body: JSON.stringify({
      walletAddress: state.walletAddress,
      delegateAddress,
      authorizationUserOpHash: authorization.userOpHash,
      ownerAddress,
    }),
  }, 30_000)
  const data = setupResult.data
  if (!setupResult.response.ok || !data.success) {
    const detail = [data.code, data.retryAllowed === true ? 'retry_allowed' : '', data.receiptStatus ? `receipt=${data.receiptStatus}` : '', data.transactionHash ? `tx=${data.transactionHash}` : ''].filter(Boolean).join(' ')
    throw new Error(`${data.error || 'Session setup gagal'}${detail ? ` (${detail})` : ''}`)
  }

  // Step 5: Update local state. The deploy UserOp above already put the MSCA
  // on-chain and the addOwners UserOp authorized the delegate.
  saveState({ ...state, delegateAddress, sessionActive: true, deployed: true }, agentKey)

  return {
    walletAddress: state.walletAddress,
    delegateAddress,
    active: true,
  }
}

// ── Revoke session key ──
export async function revokeSessionKey(vaultToken: string, agentKey = DEFAULT_AGENT_KEY): Promise<void> {
  const res = await fetch(`${API}/api/session/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${vaultToken}` },
  })
  const data = await res.json()
  if (!data.success) throw new Error(data.error || 'Revoke gagal')

  const state = loadState(agentKey)
  saveState({ ...state, sessionActive: false, delegateAddress: '' }, agentKey)
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
export function getMscaState(agentKey?: string): Partial<MscaState> {
  return loadState(agentKey)
}

// ── Clear MSCA state (logout) ──
export function clearMscaState(agentKey?: string) {
  clearState(agentKey)
}

// ── Register delegate EOA as on-chain owner ──
// Passkey signs ONE addOwners UserOperation that adds the delegate as owner.
// After that the backend can sign transactions with the delegate EOA
// automatically.
//
// Precondition, enforced here: the MSCA must already have bytecode on this
// chain. `addOwners` can never be the first UserOperation on mainnet — Circle's
// bundler answers a counterfactual address with `-32600 Cannot find target
// wallet in the system`. The deploy UserOp is therefore submitted first (also
// inside this function, idempotently) and only then is addOwners sent.
export async function registerDelegateOwner(delegateAddress: string, chainKey = 'arc-mainnet', vaultToken = '', agentKey = DEFAULT_AGENT_KEY): Promise<{ success: boolean; userOpHash?: string }> {
  const state = loadState(agentKey)
  if (!state.walletAddress || !state.credential) throw new Error('Login Passkey diperlukan.')
  const config = chainConfig(chainKey)

  const client = createPublicClient({ chain: config.chain, transport: modularTransport(chainKey) as any })
  const smartAccount = await toCircleSmartAccount({
    address: state.walletAddress as `0x${string}`,
    client: client as any,
    owner: webAuthnOwner(state.credential as StoredCredential),
  })

  const saved = loadState(agentKey).deploymentStatus?.[chainKey]
  const sameDelegate = saved?.authorizationDelegateAddress?.toLowerCase() === delegateAddress.toLowerCase()
  // Never reuse a prior delegate's UserOperation as proof for a new delegate.
  // The persisted attempt is relevant only when its delegate is an exact match.
  if (sameDelegate && saved?.authorizationUserOpHash) {
    const outcome = await userOpOutcome(client, saved.authorizationUserOpHash, saved.updatedAt)
    if (outcome === 'success') {
      // A successful on-chain addOwners is authoritative: the MSCA is deployed
      // and the delegate is already an owner. No second mutation is needed.
      const current = loadState(agentKey).deploymentStatus?.[chainKey]
      if (current?.authorizationStatus !== 'authorized') {
        saveDeploymentStatus(chainKey, { ...current, status: 'deployed', authorizationStatus: 'authorized', authorizationError: undefined, updatedAt: Date.now() })
      }
      return { success: true, userOpHash: saved.authorizationUserOpHash }
    }
  }

  // Persist the attempt marker immediately before mutation so a browser close
  // after this point can still recover the exact submitted hash.
  saveDeploymentStatus(chainKey, {
    ...(loadState(agentKey).deploymentStatus?.[chainKey] || {}),
    authorizationDelegateAddress: delegateAddress,
    authorizationStatus: 'pending',
    updatedAt: Date.now(),
  })

  // Destination chains (Base/Arbitrum) do not inherit the WebAuthn sender
  // mapping that registration created on Arc. Without it the plugin reverts
  // with InvalidValidationFunctionId during simulation. Create it first
  // (off-chain API call, idempotent).
  await ensureWebAuthnOwnerMapping(chainKey, agentKey)

  // Hard invariant: never submit addOwners against a counterfactual MSCA.
  // `deploySmartAccountOnChain` is idempotent (it returns as soon as
  // `isDeployed()` is true), so this only spends one UserOperation when the
  // wallet genuinely has no code on this chain — the case Circle's bundler
  // rejects. Keeping the guard here means every caller (setupSessionKey on
  // Arc, destination-chain authorization on Base/Arbitrum) inherits the exact
  // deploy-then-authorize order without duplicating it.
  await deploySmartAccountOnChain(chainKey, agentKey)

  const callData = encodeFunctionData({ abi: ADD_OWNERS_ABI, functionName: 'addOwners', args: [[delegateAddress as `0x${string}`], [1n], [], [], 0n] })
  const fees = await circleGasFees(chainKey)
  const bundlerClient = bundlerClientFor(chainKey, smartAccount as any, client as any)
  // Surface Circle's original error unchanged so its official bundler
  // response can be debugged and retried by the user.
  let userOpHash: string
  try {
    userOpHash = await sendUserOperation(bundlerClient as any, {
      account: smartAccount as any,
      callData,
      paymaster: true,
      ...fees,
    })
  } catch (error) {
    const message = formatCircleUserOperationError(error, chainKey)
    const policyRejected = /Kuota Gas Station harian|Batas harian Gas Station/i.test(message)
    const current = loadState(agentKey).deploymentStatus?.[chainKey]
    if (current) {
      saveDeploymentStatus(chainKey, {
        ...current,
        authorizationStatus: 'failed',
        authorizationPrecheckFailed: true,
        authorizationError: message,
        error: policyRejected ? 'gas_station_daily_policy_exceeded' : current.error,
        updatedAt: Date.now(),
      }, agentKey)
    }
    throw new Error(message, { cause: error })
  }
  // Persist locally and server-side before waiting. The backend records the
  // exact hash but does not activate the delegate until it independently
  // verifies a successful receipt and exact addOwners calldata.
  mergeAuthorizationStatus(chainKey, userOpHash, delegateAddress, agentKey)
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
    const bundlerClient = bundlerClientFor(chainKey, smartAccount as any, client as any)
    const receipt = await waitForUserOperationReceiptBounded(bundlerClient as any, userOpHash as `0x${string}`)
    if (!isSuccessfulUserOpReceipt(receipt)) {
      const status = receipt?.receipt?.status ?? 'unknown'
      const txHash = receipt?.receipt?.transactionHash
      throw new Error(`${chainKey}: delegate authorization UserOperation reverted (receipt=${status}${txHash ? ` tx=${txHash}` : ''})`)
    }
    const deployed = await smartAccount.isDeployed()
    const current = loadState(agentKey).deploymentStatus?.[chainKey]
    if (current) saveDeploymentStatus(chainKey, { ...current, status: deployed ? 'deployed' : current.status, authorizationStatus: 'authorized', authorizationPrecheckFailed: undefined, authorizationError: undefined, updatedAt: Date.now() })
    return { success: true, userOpHash }
  } catch (error: any) {
    const current = loadState(agentKey).deploymentStatus?.[chainKey]
    if (current) saveDeploymentStatus(chainKey, { ...current, authorizationStatus: 'failed', authorizationError: error?.message || 'authorization failed', updatedAt: Date.now() })
    throw error
  }
}

// ── Sign a pending tx with passkey and submit to backend relay ──
export async function signPendingTx(txId: string, calls: Array<{ to: string; data: string; value: string }>, chainKey: string, agentKey = DEFAULT_AGENT_KEY): Promise<{ txHash?: string; explorerUrl?: string; error?: string }> {
  const state = loadState(agentKey)
  if (!state.walletAddress || !state.credential) throw new Error('Login Passkey diperlukan.')

  if (chainKey === 'ethereum-mainnet') {
    throw new Error('MSCA unsupported on Ethereum. Use Circle SCA/EOA wallet flow for this network.')
  }
  const config = chainConfig(chainKey)
  const client = createPublicClient({ chain: config.chain, transport: modularTransport(chainKey) as any })
  const smartAccount = await toCircleSmartAccount({
    address: state.walletAddress as `0x${string}`,
    client: client as any,
    owner: webAuthnOwner(state.credential as StoredCredential),
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
  const preparedUserOp = await bundlerClient.prepareUserOperation({
    account: smartAccount as any,
    calls: normalizedCalls,
    paymaster: true,
    ...(await circleGasFees(chainKey)),
  })
  const signature = await smartAccount.signUserOperation({
    ...preparedUserOp,
    chainId: config.chain.id,
  })
  const signedUserOp = { ...preparedUserOp, signature }

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
