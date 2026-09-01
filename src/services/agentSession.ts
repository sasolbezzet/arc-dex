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
  }
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
    return {
      walletAddress,
      delegateAddress: existing.delegateAddress,
      sessionActive: true,
      chainAuthorizationStatus: { 'arc-testnet': 'authorized' },
      deploymentStatus: getDeploymentStatus(agentKey),
      warnings: [],
    }
  }

  // Binding an EOA is optional and requires a separate signature proof in this
  // browser. The passkey/MSCA token is not an EOA proof and must not be sent.
  // The owner proof is passed explicitly by the caller. Never substitute the
  // passkey/MSCA token or the legacy `arx_eoa_vault_token` key: those tokens
  // authenticate a different identity and cause the backend owner mismatch.
  const ownerSessionToken = options.ownerSessionToken
  const verifiedEoaAddress = ownerSessionToken && options.eoaAddress ? options.eoaAddress : undefined
  if (!verifiedEoaAddress || !ownerSessionToken) {
    throw new Error('Sesi wallet utama belum tervalidasi. Hubungkan wallet utama dan login ulang sebelum membuat Agent Wallet.')
  }

  const result = await setupSessionKey(vaultToken, verifiedEoaAddress, ownerSessionToken, agentKey)

  const chainAuthorizationStatus: Record<string, ChainAuthStatus> = { 'arc-testnet': 'authorized' }
  const warnings: string[] = []

  if (!options.skipDestinationChains) {
    for (const chainKey of ['base-sepolia', 'arbitrum-sepolia'] as const) {
      try {
        await authorizeDelegateOnChain(chainKey, walletAddress, result.delegateAddress, vaultToken, agentKey)
        chainAuthorizationStatus[chainKey] = 'authorized'
      } catch (error) {
        chainAuthorizationStatus[chainKey] = 'failed'
        warnings.push(error instanceof Error ? error.message : `${chainKey}: gagal`)
      }
    }
  }

  return {
    walletAddress,
    delegateAddress: result.delegateAddress,
    sessionActive: result.active,
    chainAuthorizationStatus,
    deploymentStatus: getDeploymentStatus(agentKey),
    warnings,
  }
}
