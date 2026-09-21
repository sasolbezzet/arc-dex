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
 *   3. authorize and verify the same deterministic MSCA on Base/Arbitrum.
 *
 * Agent Wallet creation is fail-closed: the function does not return a usable
 * activation until Arc, Base Sepolia, and Arbitrum Sepolia are all deployed
 * and authorized. A destination-chain failure is therefore an error, never a
 * token-issuance warning.
 */

const API = '' // same-origin

export interface SessionActivation {
  walletAddress: string
  delegateAddress: string
  sessionActive: boolean
  chainAuthorizationStatus: Record<string, ChainAuthStatus>
  deploymentStatus: Record<string, unknown>
  /** Empty on success. Destination-chain failures throw before activation is returned. */
  warnings: string[]
}

interface SessionStatusResponse {
  success?: boolean
  session?: {
    walletAddress?: string
    delegateAddress?: string
    active?: boolean
    statusReason?: string
    revokeReason?: string
    manualRevokePending?: boolean
    authorizationUserOpHash?: string
    pendingAuthorization?: boolean
    agentBindingActive?: boolean
    agentBindingFound?: boolean
    agentBindingReason?: string
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

/**
 * The wallet session may be perfectly healthy while this exact agent has no
 * durable binding row (Clear removed it, or the row was never created). That is
 * NOT an owner-session failure, so it must not reuse the owner message: the
 * caller already supplied a verified SIWE proof and re-signing would change
 * nothing.
 */
function agentBindingMissingError() {
  const error = new Error('Binding agent ini belum ada untuk wallet tersebut. Selesaikan langkah owner (SIWE) lalu ulangi Login passkey.') as Error & { code?: string }
  error.code = 'agent_binding_missing'
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
  agentBindingActive?: boolean
  agentBindingFound?: boolean
  agentBindingReason?: string
}

/**
 * Manual revoke is an explicit fresh-passkey reactivation path. Reconcile is
 * reserved for inactivity/unknown authorization state and must never poll an
 * old proof after the user intentionally revoked this agent.
 */
export function shouldReconcileExistingSession(
  session: Pick<NonNullable<SessionStatusResponse['session']>, 'walletAddress' | 'statusReason' | 'revokeReason' | 'manualRevokePending'> | null | undefined,
  walletAddress: string,
): boolean {
  if (!session?.walletAddress || String(session.walletAddress).toLowerCase() !== walletAddress.toLowerCase()) return false
  if (['manual_revoke', 'agent_manual', 'agent_deleted', 'clear'].includes(String(session.statusReason || session.revokeReason || ''))) return false
  return session.manualRevokePending !== true
}

/** Read the backend's view of the session bound to this token. */
export async function readSessionStatus(vaultToken: string, agentKey = ''): Promise<SessionStatusResponse['session'] | null> {
  try {
    const query = agentKey ? `?agentKey=${encodeURIComponent(agentKey)}` : ''
    const response = await fetch(`${API}/api/session/status${query}`, {
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
): Promise<boolean> {
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
  if (response.status === 404) return false
  const data = await response.json().catch(() => ({})) as { success?: boolean; error?: string; code?: string }
  if (!response.ok || !data.success) {
    const error = new Error(data.error || `Binding agent gagal diaktifkan (${response.status})`) as Error & { code?: string }
    // Keep the backend code so callers can tell a genuinely unverified owner
    // session (retry SIWE) apart from an owner/binding mismatch (do not retry).
    if (data.code) error.code = data.code
    throw error
  }
  return true
}

async function destinationAuthorizationMissing(
  walletAddress: string,
  vaultToken: string,
): Promise<boolean> {
  // Always read both destination chains. Registration and login share this
  // check so an already-complete wallet is not asked to submit duplicate
  // addOwners operations, while an incomplete wallet remains fail-closed.
  const statuses = await Promise.all(['base-sepolia', 'arbitrum-sepolia'].map(async chainKey => {
    const response = await fetch(`${API}/api/session/destination-status?chainKey=${chainKey}&walletAddress=${encodeURIComponent(walletAddress)}`, {
      headers: { Authorization: `Bearer ${vaultToken}` },
      signal: AbortSignal.timeout(20_000),
    })
    const data = await response.json().catch(() => null) as { authorized?: boolean; deployed?: boolean; error?: string } | null
    if (!response.ok || !data) {
      throw new Error(`${chainKey}: status deployment/otorisasi tidak tersedia (${data?.error || response.status})`)
    }
    // An authorization hash without deployed bytecode is not a ready MSCA.
    return data.authorized === true && data.deployed === true
  }))
  return statuses.some(ready => !ready)
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
      // that would create a second UserOperation and make retries ambiguous.
      await authorizeDelegateOnChain(chainKey, walletAddress, delegateAddress, vaultToken, agentKey)
      chainAuthorizationStatus[chainKey] = 'authorized'
    } catch (error) {
      chainAuthorizationStatus[chainKey] = 'failed'
      warnings.push(error instanceof Error ? error.message : `${chainKey}: gagal`)
    }
  }
  if (warnings.length > 0) {
    const error = new Error(`Deployment/otorisasi 3-chain belum lengkap: ${warnings.join('; ')}`) as Error & {
      code?: string
      chainAuthorizationStatus?: Record<string, ChainAuthStatus>
      warnings?: string[]
    }
    error.code = 'destination_chain_authorization_incomplete'
    error.chainAuthorizationStatus = chainAuthorizationStatus
    error.warnings = warnings
    throw error
  }
  return { chainAuthorizationStatus, warnings: [] }
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

  // Binding an EOA requires a separate signature proof in this browser. The
  // passkey/MSCA token is a different identity and must never be substituted
  // for it, nor may the legacy `arx_eoa_vault_token` key be trusted here. The
  // proof is decided once per call and is a first-class activation path: the
  // backend re-verifies it against the same address before it creates or
  // repairs anything.
  const ownerSessionToken = options.ownerSessionToken
  const verifiedEoaAddress = ownerSessionToken && options.eoaAddress ? options.eoaAddress : undefined

  // Re-running setup revokes and re-authorizes the delegate, leaving a window
  // where agent tools fail. If this exact wallet is already active, adopt it.
  const existing = await readSessionStatus(vaultToken, agentKey)
  if (
    existing?.active
    && existing.delegateAddress
    && String(existing.walletAddress || '').toLowerCase() === walletAddress.toLowerCase()
  ) {
    const authorizeDestinations = (!options.skipDestinationChains || existing.agentBindingActive === false)
      && await destinationAuthorizationMissing(walletAddress, vaultToken)
    const { chainAuthorizationStatus, warnings } = authorizeDestinations
      ? await authorizeDestinationChains(walletAddress, existing.delegateAddress, vaultToken, agentKey)
      : { chainAuthorizationStatus: { 'arc-testnet': 'authorized' } as Record<string, ChainAuthStatus>, warnings: [] as string[] }
    const bindingActivated = await activateBindingAfterSession(vaultToken, walletAddress, agentKey, {
      address: options.eoaAddress,
      token: options.ownerSessionToken,
    }, options.credentialId)
    // A cleared agent may share an active MSCA session with another agent. In
    // that case the wallet session is healthy but this exact binding is gone.
    // Never report success. When owner proof was supplied the backend already
    // had its chance to recreate the row, so the missing row is the real error;
    // without proof the caller must be asked for the owner session.
    if (!bindingActivated) throw verifiedEoaAddress ? agentBindingMissingError() : ownerSessionRequiredError()
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
  const ownerProofRequiredForClearedWallet = existing?.agentBindingFound === false
    || ['agent_deleted', 'clear'].includes(String(existing?.statusReason || existing?.revokeReason || ''))
  if (shouldReconcileExistingSession(existing, walletAddress)) {
    const reconciled = await reconcileWithPasskey(vaultToken, walletAddress)
    if (reconciled?.active && reconciled.delegateAddress) {
      const authorizeDestinations = (!options.skipDestinationChains || reconciled.agentBindingActive === false)
      && await destinationAuthorizationMissing(walletAddress, vaultToken)
      const { chainAuthorizationStatus, warnings } = authorizeDestinations
        ? await authorizeDestinationChains(walletAddress, reconciled.delegateAddress, vaultToken, agentKey)
        : { chainAuthorizationStatus: { 'arc-testnet': 'authorized' } as Record<string, ChainAuthStatus>, warnings: [] as string[] }
      const bindingActivated = await activateBindingAfterSession(vaultToken, walletAddress, agentKey, {
        address: options.eoaAddress,
        token: options.ownerSessionToken,
      }, options.credentialId)
      if (!bindingActivated) throw verifiedEoaAddress ? agentBindingMissingError() : ownerSessionRequiredError()
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

  // Durable recovery is valid for Revoke (the binding remains) and ordinary
  // login. Clear deletes the binding, so it must use the owner-proof path to
  // recreate exactly one binding for this already-proven wallet.
  const canRecoverDurableBinding = Boolean(
    options.allowDurableBindingRecovery && agentKey && !ownerProofRequiredForClearedWallet,
  )
  // A verified owner proof is a first-class path: Create New Wallet and the
  // Clear re-binding both arrive here with a fresh SIWE token, and the backend
  // verifies it against the same EOA before creating or repairing the binding.
  // Omitting `!verifiedEoaAddress` here discarded that proof and showed
  // "Sesi wallet utama belum tervalidasi" right after the user signed SIWE.
  if ((!passkeyOnlyReauthorization && !canRecoverDurableBinding && !verifiedEoaAddress)
    || (ownerProofRequiredForClearedWallet && !verifiedEoaAddress)) {
    throw ownerSessionRequiredError()
  }

  const result = await setupSessionKey(
    vaultToken,
    passkeyOnlyReauthorization || canRecoverDurableBinding ? undefined : verifiedEoaAddress,
    passkeyOnlyReauthorization || canRecoverDurableBinding ? undefined : ownerSessionToken,
    agentKey,
  )
  // A normal login keeps the same delegate and can remain Arc-only. Clear and
  // manual revoke may produce a fresh delegate, however; that delegate has no
  // Base/Arbitrum authorization history and must complete the same three-chain
  // setup before the agent is reported ready.
  const authorizeDestinations = shouldAuthorizeDestinationChainsAfterActivation(
    options.skipDestinationChains && existing?.agentBindingActive !== false,
    existing?.delegateAddress,
    result.delegateAddress,
  ) && await destinationAuthorizationMissing(walletAddress, vaultToken)
  const { chainAuthorizationStatus, warnings } = authorizeDestinations
    ? await authorizeDestinationChains(walletAddress, result.delegateAddress, vaultToken, agentKey)
    : { chainAuthorizationStatus: { 'arc-testnet': 'authorized' } as Record<string, ChainAuthStatus>, warnings: [] as string[] }

  // The session key exists now, but the agent still needs its durable binding
  // row before any agent tool may use this wallet. `activate-binding` creates
  // that row only when the owner proof is present, so a missing row here must
  // fail closed instead of reporting a ready agent.
  const finalBindingActivated = await activateBindingAfterSession(vaultToken, walletAddress, agentKey, {
    address: options.eoaAddress,
    token: options.ownerSessionToken,
  }, options.credentialId)
  if (!finalBindingActivated) throw verifiedEoaAddress ? agentBindingMissingError() : ownerSessionRequiredError()
  return {
    walletAddress,
    delegateAddress: result.delegateAddress,
    // `setupSessionKey` only returns after the backend activated the signer, so
    // treat anything other than an explicit negative as active.
    sessionActive: result.active !== false,
    chainAuthorizationStatus,
    deploymentStatus: getDeploymentStatus(agentKey),
    warnings,
  }
}
