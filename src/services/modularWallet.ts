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
} from '@circle-fin/modular-wallets-core'
import {
  createPublicClient,
} from 'viem'
import { toWebAuthnAccount, sendUserOperation, waitForUserOperationReceipt } from 'viem/account-abstraction'
import { arcTestnet } from 'viem/chains'

const CLIENT_URL = import.meta.env.VITE_CIRCLE_CLIENT_URL || 'https://modular-sdk.circle.com/v1/rpc/w3s/buidl'
const CLIENT_KEY = import.meta.env.VITE_CIRCLE_CLIENT_KEY || ''
const API = ''  // same origin proxy

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

interface MscaState {
  walletAddress: string
  credential: { id: string; publicKey: string } | null
  delegateAddress: string
  sessionActive: boolean
  deployed?: boolean
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
function passkeyTransport() {
  return toPasskeyTransport(CLIENT_URL, CLIENT_KEY)
}

function modularTransport(chainKey = 'arc-testnet') {
  const slug = chainKey === 'arc-testnet' ? 'arcTestnet' : chainKey
  return toModularTransport(`${CLIENT_URL}/${slug}`, CLIENT_KEY)
}

// ── Register passkey + create MSCA ──
export async function registerPasskey(): Promise<{ walletAddress: string; credential: { id: string; publicKey: string } }> {
  const pkTransport = passkeyTransport()

  // Step 1: Register passkey credential (browser prompts user for biometric)
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
  if (await smartAccount.isDeployed()) {
    saveState({ ...state, deployed: true })
    return { walletAddress: state.walletAddress, deployed: true }
  }

  // Deployment is the first UserOperation. It requires an intentional passkey
  // approval and must happen in the browser, where the WebAuthn credential lives.
  // NOTE: addOwners must be a SEPARATE UserOp after deployment (registerDelegateOwner).
  // Calling addOwners in the same UserOp as deploy causes "execution reverted"
  // because the MSCA storage isn't fully initialized yet.
  const userOpHash = await sendUserOperation(client as any, {
    account: smartAccount as any,
    calls: [{ to: smartAccount.address as `0x${string}`, value: 0n, data: '0x' as `0x${string}` }],
  })
  const receipt = await waitForUserOperationReceipt(client as any, { hash: userOpHash })
  if (!receipt.success || !(await smartAccount.isDeployed())) throw new Error('Aktivasi Agent Wallet belum berhasil. Coba lagi dengan passkey yang sama.')

  saveState({ ...state, deployed: true })
  return { walletAddress: state.walletAddress, deployed: true, userOpHash }
}

// ── Login with existing passkey ──
export async function loginPasskey(): Promise<{ walletAddress: string; credential: { id: string; publicKey: string } }> {
  const state = loadState()
  const pkTransport = passkeyTransport()

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

  saveState({ walletAddress, credential, sessionActive: state.sessionActive || false })

  return { walletAddress, credential }
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
export async function registerDelegateOwner(delegateAddress: string): Promise<{ success: boolean; userOpHash?: string }> {
  const state = loadState()
  if (!state.walletAddress || !state.credential) throw new Error('Login Passkey diperlukan.')

  const client = createPublicClient({ chain: arcTestnet, transport: modularTransport() as any })
  const smartAccount = await toCircleSmartAccount({
    address: state.walletAddress as `0x${string}`,
    client: client as any,
    owner: toWebAuthnAccount({ credential: state.credential as { id: string; publicKey: `0x${string}` } }),
  })

  // Extend client with recoveryActions to call registerRecoveryAddress
  const { createBundlerClient } = await import('viem/account-abstraction')
  const bundlerClient = createBundlerClient({
    account: smartAccount as any,
    client: client as any,
    transport: modularTransport() as any,
  }).extend(recoveryActions)

  try {
    const userOpHash = await bundlerClient.registerRecoveryAddress({
      account: smartAccount as any,
      recoveryAddress: delegateAddress as `0x${string}`,
      paymaster: true,
    })
    return { success: true, userOpHash }
  } catch (e: any) {
    // Address mapping may already exist — that's OK
    if (e?.message?.includes('already exists') || e?.message?.includes('ALREADY_KNOWN')) {
      return { success: true }
    }
    throw e
  }
}

// ── Sign a pending tx with passkey and submit to backend relay ──
export async function signPendingTx(txId: string, calls: Array<{ to: string; data: string; value: string }>, chainKey: string): Promise<{ txHash?: string; explorerUrl?: string; error?: string }> {
  const state = loadState()
  if (!state.walletAddress || !state.credential) throw new Error('Login Passkey diperlukan.')

  const client = createPublicClient({ chain: arcTestnet, transport: modularTransport() as any })
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

  // Build and sign UserOp
  const { signUserOperation } = await import('viem/account-abstraction')
  const signedUserOp = await signUserOperation(client as any, {
    account: smartAccount as any,
    calls: normalizedCalls,
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
