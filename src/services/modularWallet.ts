// modularWallet.ts — Circle Modular Wallet (MSCA) + passkey auth + session key management.
// Follows official Circle docs: https://developers.circle.com/wallets/modular/create-a-wallet-and-send-gasless-txn
//
// Flow:
//   1. registerPasskey() → toWebAuthnCredential({ transport, mode: Register }) → credential
//   2. createSmartAccount() → toCircleSmartAccount → MSCA address
//   3. setupSessionKey() → generate delegate EOA → createAddressMapping → POST /api/session/setup
//   4. Agent uses source=session to execute tx via MSCA

import {
  toPasskeyTransport,
  toModularTransport,
  toCircleSmartAccount,
  toWebAuthnCredential,
  WebAuthnMode,
  recoveryActions,
  getUserOperationGasPrice,
  modularWalletActions,
} from '@circle-fin/modular-wallets-core'
import { createPublicClient, defineChain, encodeFunctionData } from 'viem'
import { hasCompleteFeeEnvelope, isBundlerPrecheckError, isSuccessfulUserOpReceipt, normalizeArbitrumFees, parseFeeWei, requestPaymasterWithFees, authorizationRetryDecision } from './mscaPolicy'
import { createBundlerClient, getPaymasterData, getPaymasterStubData, toWebAuthnAccount, sendUserOperation, waitForUserOperationReceipt } from 'viem/account-abstraction'
import { arcTestnet } from 'viem/chains'

const CLIENT_URL = import.meta.env.VITE_CIRCLE_CLIENT_URL || 'https://modular-sdk.circle.com/v1/rpc/w3s/buidl'
const CLIENT_KEY = import.meta.env.VITE_CIRCLE_CLIENT_KEY || ''
const API = ''  // same origin proxy
// Temporary production diagnostics. When explicitly enabled this records the
// guard context in the browser console, but it never bypasses an ambiguous
// UserOperation or submits a second addOwners mutation. Backend activation still
// requires a successful receipt, exact MSCA sender, and exact addOwners calldata.
const SESSION_AUTH_DEBUG = String(import.meta.env.VITE_SESSION_AUTH_DEBUG || '').toLowerCase() === 'true'
function sessionAuthGuard(message: string, context: Record<string, unknown> = {}) {
  if (SESSION_AUTH_DEBUG) console.warn('[session-auth-debug] authorization blocked', { message, ...context })
  throw new Error(message)
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
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

function saveState(state: Partial<MscaState>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

function clearState() {
  localStorage.removeItem(STORAGE_KEY)
}

// ── Transports ──
function ensurePasskeyEnvironment() {
  if (typeof window === 'undefined') throw new Error('Passkey hanya dapat digunakan di browser.')
  if (!window.isSecureContext) throw new Error('Passkey membutuhkan HTTPS atau localhost. Buka ARCOX melalui https://arcoxdex.vercel.app.')
  if (typeof window.PublicKeyCredential !== 'function' || typeof navigator.credentials?.get !== 'function') {
    throw new Error('Browser ini tidak mendukung WebAuthn passkey. Gunakan Chrome, Edge, Safari, atau Firefox versi terbaru.')
  }
}

function passkeyTransport() {
  ensurePasskeyEnvironment()
  return toPasskeyTransport(CLIENT_URL, CLIENT_KEY)
}

function passkeyErrorMessage(error: unknown) {
  // Only DOMException names identify a WebAuthn failure. Do not classify a
  // generic Circle RPC message containing words such as "timeout" or "cancel"
  // as missing passkeys; that hides the actual transport problem.
  const name = String((error as any)?.name || '')
  const message = String((error as any)?.message || error || '')
  const isDomException = typeof DOMException !== 'undefined' && error instanceof DOMException
  if (name === 'NotAllowedError' || (name === 'AbortError' && isDomException)) {
    return 'Passkey dibatalkan atau tidak ditemukan. Pilih passkey ARCOX yang sudah terdaftar, lalu izinkan Windows Hello, Touch ID, atau security key.'
  }
  if (name === 'SecurityError' || name === 'InvalidStateError') {
    return 'Passkey tidak dapat dipakai pada origin ini. Buka ARCOX dari domain yang sama saat passkey dibuat: https://arcoxdex.vercel.app.'
  }
  if (name === 'NotSupportedError') {
    return 'Perangkat/browser ini tidak menyediakan authenticator WebAuthn. Aktifkan Windows Hello, Touch ID, atau security key, lalu coba dari HTTPS.'
  }
  return message || 'Passkey login gagal.'
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

// Public clients read chain state and construct the deterministic account.
// Bundler clients submit ERC-4337 UserOperations and attach Circle Gas Station
// paymaster data when the Console policy permits the operation.
//
// Circle's fee endpoint is the source of truth for sponsored UserOperations.
// Some Arbitrum Sepolia responses contain a zero priority fee, which the
// bundler rejects at precheck even though the paymaster policy is enabled.
async function gasStationFeeOverrides(client: any, chainKey = 'arc-testnet') {
  try {
    const prices = await getUserOperationGasPrice(client as any) as any
    const level = prices?.high || prices?.medium || prices?.low || {}
    const priority = parseFeeWei(level.maxPriorityFeePerGas)
    const max = parseFeeWei(level.maxFeePerGas)
    if (chainKey !== 'arbitrum-sepolia') {
      // Let Circle's estimator own the envelope on chains without the observed
      // Arbitrum zero-tip precheck. Only forward a complete non-zero pair.
      return priority > 0n && max >= priority
        ? { maxPriorityFeePerGas: priority, maxFeePerGas: max }
        : {}
    }
    let networkGasPrice = 0n
    try {
      networkGasPrice = parseFeeWei(await client.request({ method: 'eth_gasPrice' }))
    } catch { /* Circle quote remains usable if public gasPrice is unavailable. */ }
    return normalizeArbitrumFees(priority, max, networkGasPrice)
  } catch {
    if (chainKey !== 'arbitrum-sepolia') return {}
    let networkGasPrice = 0n
    try { networkGasPrice = parseFeeWei(await client.request({ method: 'eth_gasPrice' })) } catch { /* use safe floor */ }
    return normalizeArbitrumFees(0n, 0n, networkGasPrice)
  }
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

// Circle's paymaster response on Arbitrum Sepolia can include a zero tip.
// Inject the validated fee envelope into the parameters before Circle signs the
// sponsorship payload. Remove only fee fields from the response so viem keeps
// the request fees while retaining paymaster/paymasterData validity fields.
function paymasterWithFeeOverrides(chainKey: string, bundlerClient: any, fees: Partial<{ maxPriorityFeePerGas: bigint; maxFeePerGas: bigint }>) {
  // Only Arbitrum has exhibited the zero-tip response. Keep Arc/Base on the
  // official Circle paymaster path and apply the adapter narrowly to Arbitrum.
  if (chainKey !== 'arbitrum-sepolia' || !hasCompleteFeeEnvelope(fees)) return true
  return {
    getPaymasterStubData: (parameters: any) => requestPaymasterWithFees(
      parameters,
      fees,
      request => getPaymasterStubData(bundlerClient as any, request) as Promise<any>,
    ),
    getPaymasterData: (parameters: any) => requestPaymasterWithFees(
      parameters,
      fees,
      request => getPaymasterData(bundlerClient as any, request) as Promise<any>,
    ),
  }
}

// ── Register passkey + create MSCA ──
export async function registerPasskey(): Promise<{ walletAddress: string; credential: { id: string; publicKey: string } }> {
  const pkTransport = passkeyTransport()

  // Step 1: Register passkey credential (browser prompts user for biometric)
  try {
    const credential = await toWebAuthnCredential({
      transport: pkTransport,
      mode: WebAuthnMode.Register,
      username: `arx-user-${Date.now()}`,
    })

    // Step 2: Create modular transport + public client for Arc Testnet
    const modTransport = modularTransport()
    const client = createPublicClient({
      chain: arcTestnet,
      transport: modTransport as any,
    })

    // Step 3: Create smart account from passkey credential
    const smartAccount = await toCircleSmartAccount({
      client: client as any,
      owner: toWebAuthnAccount({ credential }),
    })

    const walletAddress = smartAccount.address as string

    // Persist
    saveState({ walletAddress, credential, sessionActive: false })

    return { walletAddress, credential }
  } catch (error) {
    throw new Error(passkeyErrorMessage(error), { cause: error })
  }
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
  if (previousHash && (previousOutcome === 'pending' || previousOutcome === 'unknown')) {
    throw new Error('arc-testnet: deployment UserOperation belum dapat direkonsiliasi; retry diblokir agar tidak memakai nonce yang sama.')
  }

  // Deployment is the first UserOperation. It requires an intentional passkey
  // approval and must happen in the browser, where the WebAuthn credential lives.
  // NOTE: addOwners must be a SEPARATE UserOp after deployment (registerDelegateOwner).
  // Calling addOwners in the same UserOp as deploy causes "execution reverted"
  // because the MSCA storage isn't fully initialized yet.
  const feeOverrides = await gasStationFeeOverrides(client, 'arc-testnet')
  const userOpHash = await sendUserOperation(bundlerClient as any, {
    calls: [{ to: smartAccount.address as `0x${string}`, value: 0n, data: '0x' as `0x${string}` }],
    paymaster: paymasterWithFeeOverrides('arc-testnet', bundlerClient, feeOverrides),
    ...feeOverrides,
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
  if (previousHash && (previousOutcome === 'pending' || previousOutcome === 'unknown')) {
    throw new Error(`${chainKey}: deployment UserOperation belum dapat direkonsiliasi; retry diblokir agar tidak memakai nonce yang sama.`)
  }
  if (previousOutcome === 'success' && await smartAccount.isDeployed()) {
    saveDeploymentStatus(chainKey, { ...(previousStatus as DeploymentStatus), status: 'deployed', userOpHash: previousHash, updatedAt: Date.now() })
    return { walletAddress: state.walletAddress, deployed: true, userOpHash: previousHash }
  }
  const feeOverrides = await gasStationFeeOverrides(client, chainKey)
  const userOpHash = await sendUserOperation(bundlerClient as any, {
    calls: [{ to: smartAccount.address as `0x${string}`, value: 0n, data: '0x' as `0x${string}` }],
    paymaster: paymasterWithFeeOverrides(chainKey, bundlerClient, feeOverrides),
    ...feeOverrides,
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
export async function loginPasskey(): Promise<{ walletAddress: string; credential: { id: string; publicKey: string } }> {
  const state = loadState()
  const pkTransport = passkeyTransport()

  try {
    // Step 1: Login passkey (browser prompts user for biometric)
    const credential = await toWebAuthnCredential({
      transport: pkTransport,
      mode: WebAuthnMode.Login,
    })

    // Step 2: Recreate smart account from credential
    const modTransport = modularTransport()
    const client = createPublicClient({
      chain: arcTestnet,
      transport: modTransport as any,
    })

    const smartAccount = await toCircleSmartAccount({
      client: client as any,
      owner: toWebAuthnAccount({ credential }),
    })

    const walletAddress = smartAccount.address as string

    // Preserve locally known deployment/delegate metadata across passkey login.
    // Dropping it here makes a valid existing MSCA appear inactive until a full
    // setup flow runs again, and can incorrectly make deployment look missing.
    saveState({
      ...state,
      walletAddress,
      credential,
      sessionActive: state.sessionActive || false,
      deployed: state.deployed,
      delegateAddress: state.delegateAddress,
      deploymentStatus: state.deploymentStatus,
    })

    return { walletAddress, credential }
  } catch (error) {
    throw new Error(passkeyErrorMessage(error), { cause: error })
  }
}

// ── Setup session key: authorize delegate on-chain, then store it in vault ──
// The backend must never activate a signer before the MSCA has accepted it.
// The delegate is an automation key, not the user's EOA or passkey key.
export async function setupSessionKey(vaultToken: string, ownerAddress?: string): Promise<{
  walletAddress: string
  delegateAddress: string
  active: boolean
}> {
  const state = loadState()
  if (!state.walletAddress) throw new Error('MSCA wallet belum dibuat. Register passkey dulu.')

  if (!state.deployed) throw new Error('MSCA harus deployed sebelum mengaktifkan automation signer.')

  // Reserve the automation signer on the backend. The private key never enters
  // the browser; only its public address is returned for passkey authorization.
  const reserveRes = await fetch(`${API}/api/session/generate-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${vaultToken}` },
    body: JSON.stringify({ walletAddress: state.walletAddress, ownerAddress }),
  })
  const reserved = await reserveRes.json()
  if (!reserveRes.ok || !reserved.success || !reserved.delegateAddress) throw new Error(reserved.error || 'Automation signer reservation failed')
  const delegateAddress = reserved.delegateAddress
  // If a previous browser attempt received a hash but failed to record it
  // server-side, recover that exact hash before considering any new mutation.
  // A hashless reservation is different: no UserOperation hash was ever
  // persisted, so this function must continue into registerDelegateOwner().
  // That function performs Circle mapping reconciliation and only submits the
  // exact addOwners operation when its own retry policy says it is safe. The
  // old early throw stranded these reservations permanently as inactive.
  if (reserved.hashless) {
    const localAttempt = getDeploymentStatus()['arc-testnet']
    const localHash = localAttempt?.authorizationUserOpHash
    const localDelegate = localAttempt?.authorizationDelegateAddress?.toLowerCase()
    if (localHash && localDelegate === delegateAddress.toLowerCase()) {
      const record = await fetch(`${API}/api/session/authorization-attempt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${vaultToken}` },
        body: JSON.stringify({ walletAddress: state.walletAddress, delegateAddress, authorizationUserOpHash: localHash, chainKey: 'arc-testnet' }),
      })
      if (!record.ok) throw new Error('Authorization hash lokal gagal direkonsiliasi ke backend; jangan kirim addOwners kedua.')
    }
  }

  // The passkey authorizes exactly this reserved address on-chain.
  const authorization = await registerDelegateOwner(delegateAddress)
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
}> {
  try {
    const res = await fetch(`${API}/api/session/status`, {
      headers: { 'Authorization': `Bearer ${vaultToken}` },
    })
    const data = await res.json()
    return data.session || { active: false }
  } catch {
    return { active: false }
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
export async function registerDelegateOwner(delegateAddress: string, chainKey = 'arc-testnet'): Promise<{ success: boolean; userOpHash?: string }> {
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
    if (outcome === 'pending') {
      sessionAuthGuard(`${chainKey}: authorization UserOperation masih pending; tunggu receipt sebelum retry.`, { chainKey, outcome, hasHash: true })
    }
  }
  const feeOverrides = await gasStationFeeOverrides(client, chainKey)
  const mappingClient = client.extend(modularWalletActions as any) as any
  let mappingKnown = false
  let mappingExists = false
  try {
    const mappings = await mappingClient.getAddressMapping({ owner: { type: 'EOAOWNER', identifier: { address: delegateAddress } } })
    mappingKnown = true
    mappingExists = (Array.isArray(mappings) ? mappings : []).some((mapping: any) => String(mapping.walletAddress || '').toLowerCase() === state.walletAddress!.toLowerCase())
  } catch (error: any) {
    // Do not submit an owner mutation when Circle cannot answer the mapping
    // read. A transient/unknown RPC error is not proof that addOwners is safe.
    // In explicit diagnostics mode expose only a redacted error summary so the
    // real Circle failure is visible without leaking addresses or credentials.
    if (SESSION_AUTH_DEBUG) {
      const raw = String(error?.shortMessage || error?.message || error || '')
      const redacted = raw
        .replace(/0x[0-9a-fA-F]{64}/g, '0xHASH')
        .replace(/0x[0-9a-fA-F]{40}/g, '0xADDR')
        .replace(/Bearer\s+\S+/gi, 'Bearer <redacted>')
        .replace(/https?:\/\/\S+/gi, '<url-redacted>')
        .replace(/([?&](?:key|token|secret|signature|authorization|api[_-]?key)=)[^&\s]+/gi, '$1<redacted>')
        .replace(/\b(?:api[_-]?key|client[_-]?key|private[_-]?key|secret|token)\s*[:=]\s*[^\s,;]+/gi, '<redacted>')
      console.warn('[session-auth-debug] Circle mapping read failed', {
        chainKey,
        errorName: String(error?.name || 'Error').slice(0, 80),
        errorCode: typeof error?.code === 'number' || typeof error?.code === 'string' ? String(error.code).slice(0, 40) : undefined,
        error: redacted.slice(0, 500),
      })
    }
  }

  const savedOutcome = savedForDelegate?.authorizationUserOpHash ? await userOpOutcome(client, savedForDelegate.authorizationUserOpHash, savedForDelegate.updatedAt) : 'unknown'
  if (savedForDelegate?.authorizationUserOpHash && savedOutcome === 'unknown') {
    sessionAuthGuard(`${chainKey}: authorization UserOperation belum dapat direkonsiliasi; retry diblokir agar tidak mengulang addOwners.`, { chainKey, outcome: savedOutcome, hasHash: true })
  }
  // A hashless marker is never enough to prove that a previous operation was
  // rejected. If the browser persisted pending/authorized before losing the
  // response, a known-empty mapping may still be stale. Only an explicit
  // pre-submission failure marker is retryable; all other hashless markers stay
  // fail-closed to prevent duplicate addOwners.
  const hashlessAuthorizationMarker = Boolean(savedForDelegate?.authorizationStatus && (
    ['pending', 'authorized'].includes(savedForDelegate.authorizationStatus)
      || (savedForDelegate.authorizationStatus === 'failed' && savedForDelegate.authorizationPrecheckFailed !== true)
  ) && !savedForDelegate.authorizationUserOpHash)
  if (hashlessAuthorizationMarker) {
    sessionAuthGuard(`${chainKey}: status authorization tersimpan tanpa hash UserOperation; lakukan login passkey ulang untuk membuat attempt baru dengan binding yang jelas.`, { chainKey, outcome: 'hashless_marker', hasHash: false })
  }
  const retryDecision = authorizationRetryDecision({
    mappingKnown,
    mappingExists,
    previousOutcome: savedOutcome,
    previousAttempt: Boolean(savedForDelegate?.authorizationUserOpHash),
  })
  if (retryDecision === 'unavailable') {
    sessionAuthGuard(`${chainKey}: Circle mapping state tidak dapat diverifikasi untuk authorization yang sudah pernah dimulai; retry diblokir agar tidak mengulang addOwners.`, { chainKey, retryDecision, mappingKnown, mappingExists })
  }
  if (retryDecision === 'already_authorized') return { success: true, userOpHash: savedForDelegate!.authorizationUserOpHash }
  if (retryDecision === 'pending') {
    sessionAuthGuard(`${chainKey}: authorization UserOperation masih pending; tunggu receipt sebelum retry.`, { chainKey, retryDecision, mappingKnown, mappingExists })
  }
  if (retryDecision === 'unreconciled') {
    sessionAuthGuard(`${chainKey}: delegate mapping sudah ada tetapi owner state belum dapat direkonsiliasi; authorization retry diblokir untuk mencegah duplicate addOwners.`, { chainKey, retryDecision, mappingKnown, mappingExists })
  }

  // Circle mapping has been read successfully and the retry decision is safe.
  // Persist the attempt marker immediately before mutation so a browser close
  // after this point fails closed instead of submitting duplicate addOwners.
  saveDeploymentStatus(chainKey, {
    ...(loadState().deploymentStatus?.[chainKey] || { status: 'deployed' }),
    authorizationDelegateAddress: delegateAddress,
    authorizationStatus: 'pending',
    updatedAt: Date.now(),
  })

  let userOpHash: string
  try {
    if (mappingExists) {
    // The SDK action calls circle_createAddressMapping before addOwners. When
    // the mapping already exists, bypass that mutation and submit only the
    // exact addOwners call; this avoids the Base retry revert caused by replaying
    // the mapping step while retaining the same Circle paymaster flow.
    const addOwnersAbi = [{
      type: 'function', name: 'addOwners', stateMutability: 'nonpayable',
      inputs: [
        { name: 'ownersToAdd', type: 'address[]' }, { name: 'weightsToAdd', type: 'uint256[]' },
        { name: 'publicKeyOwnersToAdd', type: 'tuple[]', components: [{ name: 'x', type: 'uint256' }, { name: 'y', type: 'uint256' }] },
        { name: 'publicKeyWeightsToAdd', type: 'uint256[]' }, { name: 'newThresholdWeight', type: 'uint256' },
      ], outputs: [],
    }] as const
    // Match Circle's recoveryActions payload exactly. A zero threshold is
    // invalid for the weighted owner plugin and reverts during simulation.
    const callData = encodeFunctionData({ abi: addOwnersAbi, functionName: 'addOwners', args: [[delegateAddress as `0x${string}`], [1n], [], [], 1n] })
      userOpHash = await sendUserOperation(bundlerClient as any, {
        account: smartAccount as any,
        callData,
        paymaster: paymasterWithFeeOverrides(chainKey, bundlerClient, feeOverrides),
        ...feeOverrides,
      })
    } else {
      userOpHash = await bundlerClient.registerRecoveryAddress({
      account: smartAccount as any,
      recoveryAddress: delegateAddress as `0x${string}`,
      paymaster: paymasterWithFeeOverrides(chainKey, bundlerClient, feeOverrides),
        ...feeOverrides,
      })
    }
  } catch (error: any) {
    // A bundler simulation/precheck revert occurs before a UserOperation hash
    // exists. Mark that specific local marker retryable; transport failures and
    // unknown outcomes remain guarded to avoid duplicate addOwners.
    const message = String(error?.message || error || '')
    if (isBundlerPrecheckError(error)) {
      const current = loadState().deploymentStatus?.[chainKey]
      if (current) saveDeploymentStatus(chainKey, {
        ...current,
        authorizationStatus: 'failed',
        authorizationPrecheckFailed: true,
        authorizationError: message,
        authorizationUserOpHash: undefined,
        updatedAt: Date.now(),
      })
    }
    throw error
  }
  // Persist locally and server-side before waiting. The backend records the
  // exact hash but does not activate the delegate until it independently
  // verifies a successful receipt and exact addOwners calldata.
  mergeAuthorizationStatus(chainKey, userOpHash, delegateAddress)
  try {
    const token = localStorage.getItem('arx_vault_token')
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
  const feeOverrides = await gasStationFeeOverrides(client, chainKey)
  const { signUserOperation } = await import('viem/account-abstraction')
  const signedUserOp = await signUserOperation(bundlerClient as any, {
    account: smartAccount as any,
    calls: normalizedCalls,
    paymaster: paymasterWithFeeOverrides(chainKey, bundlerClient, feeOverrides),
    ...feeOverrides,
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
