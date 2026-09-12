import {
  setupSessionKey,
  registerDelegateOwner,
  getDeploymentStatus,
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

/**
 * Destination-chain deployment is an explicit setup concern, not part of a
 * passkey re-login. Keeping this decision pure makes it impossible for a
 * successful Arc/session restore to remain stuck on a second chain's approval.
 */
export function destinationChainAuthorizationEnabled(skipDestinationChains = false): boolean {
  return !skipDestinationChains
}

/**
 * A manual revoke rotates the delegate. The new delegate has no destination
 * authorization history, even when the previous delegate was authorized on
 * Base/Arbitrum. Re-login must therefore repair those chain permissions once;
 * an ordinary re-login that keeps the same delegate remains Arc-only and does
 * not trigger extra UserOperations.
 */
export function shouldAuthorizeDestinationChainsAfterActivation(
  skipDestinationChains: boolean | undefined,
  previousDelegateAddress: string | undefined,
  activeDelegateAddress: string | undefined,
): boolean {
  if (!skipDestinationChains) return true
  if (!previousDelegateAddress || !activeDelegateAddress) return false
  return previousDelegateAddress.toLowerCase() !== activeDelegateAddress.toLowerCase()
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
async function activateBindingAfterSession(
  vaultToken: string,
  walletAddress: string,
  agentKey: string,
  ownerProof?: { address?: string; token?: string },
  credentialId = '',
): Promise<void> {
  const response = await fetch(`${API}/api/session/activate-binding`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${vaultToken}` },
    body: JSON.stringify({
      walletAddress,
      agentKey,
      ...(ownerProof?.address && ownerProof?.token
        ? { ownerAddress: ownerProof.address, ownerSessionToken: ownerProof.token }
        : {}),
      ...(credentialId ? { credentialId } : {}),
    }),
    signal: AbortSignal.timeout(20_000),
  })
  if (response.status === 404) return
  const data = await response.json().catch(() => ({})) as { success?: boolean; error?: string }
  if (!response.ok || !data.success) {
    throw new Error(data.error || `Binding agent gagal diaktifkan (${response.status})`)
  }
}

async function destinationAuthorizationMissing(
  walletAddress: string,
  vaultToken: string,
  skipDestinationChains = false,
): Promise<boolean> {
  if (!skipDestinationChains) return false
  try {
    const statuses = await Promise.all(['base-sepolia', 'arbitrum-sepolia'].map(async chainKey => {
      const response = await fetch(`${API}/api/session/destination-status?chainKey=${chainKey}&walletAddress=${encodeURIComponent(walletAddress)}`, {
        headers: { Authorization: `Bearer ${vaultToken}` },
        signal: AbortSignal.timeout(20_000),
      })
      if (!response.ok) return null
      return await response.json().catch(() => null) as { authorized?: boolean } | null
    }))
    // Only an explicit successful status response can trigger extra UserOps.
    // An unavailable status remains fail-closed and can be retried by Login.
    return statuses.some(status => status && status.authorized !== true)
  } catch {
    return false
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
      // `registerDelegateOwner` submits the single passkey UserOperation for
      // this chain. For a deterministic Circle MSCA that first addOwners op
      // carries the factory initCode, so it performs deploy + delegate
      // authorization together. Do not call deploySmartAccountOnChain first:
      // that would create a second UserOperation, hide the expected passkey
      // ceremony behind a redundant deploy step, and leave the flow stuck on
      // chains that are not deployed yet.
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
  options: {
    eoaAddress?: string
    ownerSessionToken?: string
    credentialId?: string
    skipDestinationChains?: boolean
    /** Existing-agent login may recover the owner relationship from its durable binding. */
    allowDurableBindingRecovery?: boolean
  } = {},
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
    const authorizeDestinations = destinationChainAuthorizationEnabled(options.skipDestinationChains)
      || await destinationAuthorizationMissing(walletAddress, vaultToken, Boolean(options.skipDestinationChains))
    const { chainAuthorizationStatus, warnings } = authorizeDestinations
      ? await authorizeDestinationChains(walletAddress, existing.delegateAddress, vaultToken, agentKey)
      : { chainAuthorizationStatus: { 'arc-testnet': 'authorized' } as Record<string, ChainAuthStatus>, warnings: [] as string[] }
    await activateBindingAfterSession(vaultToken, walletAddress, agentKey, {
      address: options.eoaAddress,
      token: options.ownerSessionToken,
    }, options.credentialId)
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
      const authorizeDestinations = destinationChainAuthorizationEnabled(options.skipDestinationChains)
        || await destinationAuthorizationMissing(walletAddress, vaultToken, Boolean(options.skipDestinationChains))
      const { chainAuthorizationStatus, warnings } = authorizeDestinations
        ? await authorizeDestinationChains(walletAddress, reconciled.delegateAddress, vaultToken, agentKey)
        : { chainAuthorizationStatus: { 'arc-testnet': 'authorized' } as Record<string, ChainAuthStatus>, warnings: [] as string[] }
      await activateBindingAfterSession(vaultToken, walletAddress, agentKey, {
        address: options.eoaAddress,
        token: options.ownerSessionToken,
      }, options.credentialId)
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
  const canRecoverDurableBinding = Boolean(options.allowDurableBindingRecovery && agentKey)
  if (!passkeyOnlyReauthorization && !canRecoverDurableBinding && (!verifiedEoaAddress || !ownerSessionToken)) {
    throw ownerSessionRequiredError()
  }

  const result = await setupSessionKey(
    vaultToken,
    passkeyOnlyReauthorization || canRecoverDurableBinding ? undefined : verifiedEoaAddress,
    passkeyOnlyReauthorization || canRecoverDurableBinding ? undefined : ownerSessionToken,
    agentKey,
  )
  const authorizeDestinations = shouldAuthorizeDestinationChainsAfterActivation(
    options.skipDestinationChains,
    existing?.delegateAddress,
    result.delegateAddress,
  )
  const { chainAuthorizationStatus, warnings } = authorizeDestinations
    ? await authorizeDestinationChains(walletAddress, result.delegateAddress, vaultToken, agentKey)
    : { chainAuthorizationStatus: { 'arc-testnet': 'authorized' } as Record<string, ChainAuthStatus>, warnings: [] as string[] }

  await activateBindingAfterSession(vaultToken, walletAddress, agentKey, {
    address: options.eoaAddress,
    token: options.ownerSessionToken,
  }, options.credentialId)
  return {
    walletAddress,
    delegateAddress: result.delegateAddress,
    sessionActive: result.active,
    chainAuthorizationStatus,
    deploymentStatus: getDeploymentStatus(agentKey),
    warnings,
  }
}
