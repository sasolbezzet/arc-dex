import {
  setupSessionKey,
  registerDelegateOwner,
  getDeploymentStatus,
  deploySmartAccountOnChain,
} from './modularWallet'
import type { ChainAuthStatus } from '../types/agent'

/**
 * Agent Wallet session activation, extracted from the old PluginPanel so the
 * Plugin dashboard can activate a session key without rendering that 1600-line
 * component. This is the ONE place that knows the activation order:
 *
 *   1. reuse an already-active session for this exact wallet (idempotent), else
 *   2. reserve a delegate + addOwners on Arc (deploy + authorize in one UserOp)
 *      and register it with the backend, then
 *   3. best-effort authorize the same delegate on Base/Arbitrum.
 *
 * Step 3 must never fail the whole flow: a destination-chain problem cannot be
 * allowed to deactivate the Arc session that MCP tools depend on.
 */

const API = '' // same-origin

export interface SessionActivation {
  walletAddress: string
  delegateAddress: string
  sessionActive: boolean
  chainAuthorizationStatus: Record<string, ChainAuthStatus>
  deploymentStatus: Record<string, unknown>
  /** Non-fatal problems from destination chains, surfaced as a soft warning. */
  warnings: string[]
}

interface SessionStatusResponse {
  success?: boolean
  session?: {
    walletAddress?: string
    delegateAddress?: string
    active?: boolean
    statusReason?: string
    authorizationUserOpHash?: string
    pendingAuthorization?: boolean
  }
}

/**
 * A passkey proves the Agent Wallet. Creating a new delegate still needs the
 * separately authenticated owner EOA, but restoring an existing on-chain
 * authorization must not force the user through SIWE again.
 */
export function isOwnerSessionRequiredError(error: unknown): boolean {
  return error instanceof Error && (
    (error as Error & { code?: string }).code === 'owner_session_required'
      || /Sesi wallet utama belum tervalidasi/i.test(error.message)
  )
}

function ownerSessionRequiredError() {
  const error = new Error('Sesi wallet utama belum tervalidasi. Hubungkan wallet utama dan login ulang sebelum membuat Agent Wallet.') as Error & { code?: string }
  error.code = 'owner_session_required'
  return error
}

interface ReconcileResponse {
  active?: boolean
  walletAddress?: string
  delegateAddress?: string
  reason?: string
  retryAllowed?: boolean
  userOpHash?: string
  reconciled?: boolean
}

/** Read the backend's view of the session bound to this token. */
export async function readSessionStatus(vaultToken: string): Promise<SessionStatusResponse['session'] | null> {
  try {
    const response = await fetch(`${API}/api/session/status`, {
      headers: { Authorization: `Bearer ${vaultToken}` },
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) return null
    const data = (await response.json()) as SessionStatusResponse
    return data?.session || null
  } catch {
    return null
  }
}

/**
 * Verify a passkey-signed delegate authorization on a destination chain. The
 * backend re-checks the UserOperation against that chain's bundler, so the hash
 * alone is never trusted.
 */
async function authorizeDelegateOnChain(
  chainKey: 'base-sepolia' | 'arbitrum-sepolia',
  walletAddress: string,
  delegateAddress: string,
  vaultToken: string,
  agentKey: string,
): Promise<void> {
  let authorization: { success: boolean; userOpHash?: string }
  try {
    authorization = await registerDelegateOwner(delegateAddress, chainKey, vaultToken, agentKey)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error'
    throw new Error(`${chainKey}: ${message}`)
  }
  if (!authorization.success || !authorization.userOpHash) {
    throw new Error(`${chainKey}: konfirmasi jaringan tidak tersedia`)
  }
  const response = await fetch(`${API}/api/session/authorize-chain`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${vaultToken}` },
    body: JSON.stringify({
      walletAddress,
      delegateAddress,
      chainKey,
      authorizationUserOpHash: authorization.userOpHash,
    }),
    signal: AbortSignal.timeout(60_000),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data?.success) {
    throw new Error(`${chainKey}: ${data?.error || 'verifikasi gagal'}`)
  }
}

/**
 * Reconcile an inactive session using the freshly issued passkey vault token.
 * This is intentionally attempted before asking for owner SIWE: the stored
 * binding and the exact successful addOwners proof are sufficient to restore
 * an expired/inactivity session without creating a new delegate.
 */
async function reconcileWithPasskey(vaultToken: string, walletAddress: string): Promise<ReconcileResponse | null> {
  const response = await fetch(`${API}/api/session/reconcile`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${vaultToken}` },
    signal: AbortSignal.timeout(60_000),
  })
  const data = await response.json().catch(() => ({})) as { session?: ReconcileResponse; error?: string }
  if (!response.ok) throw new Error(data?.error || `Session reconciliation failed (${response.status})`)
  const session = data?.session || null
  if (!session?.active) return session
  if (String(session.walletAddress || '').toLowerCase() !== walletAddress.toLowerCase()) {
    throw new Error('Session wallet mismatch setelah passkey login.')
  }
  return session
}

/**
 * Mark the exact durable agent binding active after the MSCA session is active.
 * A missing row is normal during first-time registration: OAuth creates its
 * canonical row in passkey-verify and Hermes creates it when the token is
 * issued. Existing-agent login must already have passed the binding check in
 * passkey-login, so any other response is a real recovery error.
 */
async function activateBindingAfterSession(vaultToken: string, walletAddress: string, agentKey: string): Promise<void> {
  const response = await fetch(`${API}/api/session/activate-binding`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${vaultToken}` },
    body: JSON.stringify({ walletAddress, agentKey }),
    signal: AbortSignal.timeout(20_000),
  })
  if (response.status === 404) return
  const data = await response.json().catch(() => ({})) as { success?: boolean; error?: string }
  if (!response.ok || !data.success) {
    throw new Error(data.error || `Binding agent gagal diaktifkan (${response.status})`)
  }
}

async function authorizeDestinationChains(
  walletAddress: string,
  delegateAddress: string,
  vaultToken: string,
  agentKey: string,
): Promise<{ chainAuthorizationStatus: Record<string, ChainAuthStatus>; warnings: string[] }> {
  const chainAuthorizationStatus: Record<string, ChainAuthStatus> = { 'arc-testnet': 'authorized' }
  const warnings: string[] = []
  for (const chainKey of ['base-sepolia', 'arbitrum-sepolia'] as const) {
    try {
      await deploySmartAccountOnChain(chainKey, agentKey)
      await authorizeDelegateOnChain(chainKey, walletAddress, delegateAddress, vaultToken, agentKey)
      chainAuthorizationStatus[chainKey] = 'authorized'
    } catch (error) {
      chainAuthorizationStatus[chainKey] = 'failed'
      warnings.push(error instanceof Error ? error.message : `${chainKey}: gagal`)
    }
  }
  return { chainAuthorizationStatus, warnings }
}

/**
 * Make the Agent Wallet usable by agents. Safe to call repeatedly: an existing
 * active session for the same wallet is adopted instead of re-authorized.
 */
export async function activateAgentSession(
  walletAddress: string,
  vaultToken: string,
  agentKey: string,
  options: { eoaAddress?: string; ownerSessionToken?: string; skipDestinationChains?: boolean } = {},
): Promise<SessionActivation> {
  if (!vaultToken) throw new Error('Sesi Agent Wallet belum tersedia')

  // Re-running setup revokes and re-authorizes the delegate, leaving a window
  // where agent tools fail. If this exact wallet is already active, adopt it.
  const existing = await readSessionStatus(vaultToken)
  if (
    existing?.active
    && existing.delegateAddress
    && String(existing.walletAddress || '').toLowerCase() === walletAddress.toLowerCase()
  ) {
    const { chainAuthorizationStatus, warnings } = await authorizeDestinationChains(
      walletAddress,
      existing.delegateAddress,
      vaultToken,
      agentKey,
    )
    await activateBindingAfterSession(vaultToken, walletAddress, agentKey)
    return {
      walletAddress,
      delegateAddress: existing.delegateAddress,
      sessionActive: true,
      chainAuthorizationStatus,
      deploymentStatus: getDeploymentStatus(agentKey),
      warnings,
    }
  }

  // A vault/passkey token can expire independently from the durable session-key
  // record. Reconcile the exact previous authorization before asking for owner
  // SIWE or submitting another addOwners operation. A pending/unknown proof is
  // deliberately surfaced instead of being replaced, preventing duplicate
  // delegate owners.
  let passkeyOnlyReauthorization = false
  if (existing?.walletAddress && String(existing.walletAddress).toLowerCase() === walletAddress.toLowerCase()) {
    const reconciled = await reconcileWithPasskey(vaultToken, walletAddress)
    if (reconciled?.active && reconciled.delegateAddress) {
      const { chainAuthorizationStatus, warnings } = await authorizeDestinationChains(
        walletAddress,
        reconciled.delegateAddress,
        vaultToken,
        agentKey,
      )
      await activateBindingAfterSession(vaultToken, walletAddress, agentKey)
      return {
        walletAddress,
        delegateAddress: reconciled.delegateAddress,
        sessionActive: true,
        chainAuthorizationStatus,
        deploymentStatus: getDeploymentStatus(agentKey),
        warnings,
      }
    }
    const reason = String(reconciled?.reason || '')
    if (reason === 'authorization_pending') {
      throw new Error('Session authorization masih diproses Circle. Tunggu beberapa detik lalu ulangi Login passkey; tidak ada SIWE atau UserOperation baru yang dibuat.')
    }
    if (['authorization_unknown', 'authorization_verification_unavailable', 'authorization_changed'].includes(reason)
      || (reason === 'authorization_proof_missing' && reconciled?.retryAllowed === false)) {
      throw new Error(`Session authorization belum dapat dipulihkan dengan aman: ${reason}. Jangan membuat Agent Wallet baru; coba lagi setelah status Circle tersedia.`)
    }
    // The passkey has authenticated this exact wallet and the backend status
    // lookup proved that an old session record exists. A manual revoke or a
    // finalized failed/missing authorization may therefore start a fresh
    // authorization for that same binding without owner SIWE. The backend
    // re-checks the durable agentKey + wallet pair before reserving/rotating
    // the delegate; a deleted or unknown agent still falls through to the
    // owner-required path below.
    passkeyOnlyReauthorization = reason === 'revoked'
      || (reason === 'authorization_failed' && reconciled?.retryAllowed === true)
      || (reason === 'authorization_proof_missing' && reconciled?.retryAllowed !== false)
  }

  // Binding an EOA is optional and requires a separate signature proof in this
  // browser. The passkey/MSCA token is not an EOA proof and must not be sent.
  // The owner proof is passed explicitly by the caller. Never substitute the
  // passkey/MSCA token or the legacy `arx_eoa_vault_token` key: those tokens
  // authenticate a different identity and cause the backend owner mismatch.
  const ownerSessionToken = options.ownerSessionToken
  const verifiedEoaAddress = ownerSessionToken && options.eoaAddress ? options.eoaAddress : undefined
  if (!passkeyOnlyReauthorization && (!verifiedEoaAddress || !ownerSessionToken)) {
    throw ownerSessionRequiredError()
  }

  const result = await setupSessionKey(
    vaultToken,
    passkeyOnlyReauthorization ? undefined : verifiedEoaAddress,
    passkeyOnlyReauthorization ? undefined : ownerSessionToken,
    agentKey,
  )

  const { chainAuthorizationStatus, warnings } = options.skipDestinationChains
    ? { chainAuthorizationStatus: { 'arc-testnet': 'authorized' } as Record<string, ChainAuthStatus>, warnings: [] as string[] }
    : await authorizeDestinationChains(walletAddress, result.delegateAddress, vaultToken, agentKey)

  await activateBindingAfterSession(vaultToken, walletAddress, agentKey)
  return {
    walletAddress,
    delegateAddress: result.delegateAddress,
    sessionActive: result.active,
    chainAuthorizationStatus,
    deploymentStatus: getDeploymentStatus(agentKey),
    warnings,
  }
}
