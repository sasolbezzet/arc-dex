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
  encodeFunctionData,
  parseAbi,
} from 'viem'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
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

function modularTransport() {
  return toModularTransport(`${CLIENT_URL}/arcTestnet`, CLIENT_KEY)
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
// After deployment, backend can sign tx via delegate EOA.
export async function deploySmartAccount(delegateAddress?: string): Promise<{ walletAddress: string; deployed: boolean; userOpHash?: string }> {
  const state = loadState()
  if (!state.walletAddress || !state.credential) throw new Error('Login Passkey diperlukan sebelum mengaktifkan Agent Wallet.')

  const client = createPublicClient({ chain: arcTestnet, transport: modularTransport() as any })
  const smartAccount = await toCircleSmartAccount({
    address: state.walletAddress as `0x${string}`,
    client: client as any,
    owner: toWebAuthnAccount({ credential: state.credential as { id: string; publicKey: `0x${string}` } }),
  })
  if (await smartAccount.isDeployed()) {
    // Wallet already deployed — if delegate provided, add as on-chain owner
    if (delegateAddress) {
      const addOwnersData = encodeFunctionData({
        abi: parseAbi(['function addOwners(address[] ownersToAdd, uint256[] weightsToAdd, tuple(uint256 x, uint256 y)[] publicKeyOwnersToAdd, uint256[] publicKeyWeightsToAdd, uint256 newThresholdWeight)']),
        functionName: 'addOwners',
        args: [
          [delegateAddress as `0x${string}`],
          [1n],
          [],
          [],
          1n,
        ],
      })
      const userOpHash = await sendUserOperation(client as any, {
        account: smartAccount as any,
        calls: [{ to: smartAccount.address as `0x${string}`, value: 0n, data: addOwnersData }],
      })
      await waitForUserOperationReceipt(client as any, { hash: userOpHash })
    }
    saveState({ ...state, deployed: true })
    return { walletAddress: state.walletAddress, deployed: true }
  }

  // Deployment is the first UserOperation. It requires an intentional passkey
  // approval and must happen in the browser, where the WebAuthn credential lives.
  // Build calls: deploy (self-transfer) + addOwners if delegate provided
  const calls: Array<{ to: `0x${string}`; value: bigint; data: `0x${string}` }> = [
    { to: smartAccount.address as `0x${string}`, value: 0n, data: '0x' as `0x${string}` },
  ]
  if (delegateAddress) {
    const addOwnersData = encodeFunctionData({
      abi: parseAbi(['function addOwners(address[] ownersToAdd, uint256[] weightsToAdd, tuple(uint256 x, uint256 y)[] publicKeyOwnersToAdd, uint256[] publicKeyWeightsToAdd, uint256 newThresholdWeight)']),
      functionName: 'addOwners',
      args: [
        [delegateAddress as `0x${string}`],  // ownersToAdd
        [1n],                                  // weightsToAdd (weight=1)
        [],                                    // publicKeyOwnersToAdd (empty for EOA)
        [],                                    // publicKeyWeightsToAdd (empty)
        1n,                                    // newThresholdWeight (threshold=1)
      ],
    })
    calls.push({ to: smartAccount.address as `0x${string}`, value: 0n, data: addOwnersData })
  }

  const userOpHash = await sendUserOperation(client as any, {
    account: smartAccount as any,
    calls,
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

// ── Setup session key: generate delegate EOA + store in vault ──
// NOTE: Circle MSCA does not expose addOwner via UserOp in current
// testnet version (reverts with "execution reverted"). The delegate
// key is stored in the vault for backend-side signing. On-chain owner
// mapping will be added when Circle supports it.
export async function setupSessionKey(vaultToken: string, ownerAddress?: string): Promise<{
  walletAddress: string
  delegateAddress: string
  active: boolean
}> {
  const state = loadState()
  if (!state.walletAddress) throw new Error('MSCA wallet belum dibuat. Register passkey dulu.')

  // Step 1: Generate delegate EOA keypair
  const delegatePrivateKey = generatePrivateKey()
  const delegateAccount = privateKeyToAccount(delegatePrivateKey as any)
  const delegateAddress = delegateAccount.address

  // Step 2: Store delegate key on server (vault) — skip on-chain addOwner
  const res = await fetch(`${API}/api/session/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${vaultToken}` },
    body: JSON.stringify({
      walletAddress: state.walletAddress,
      delegateAddress,
      delegatePrivateKey,
      // OAuth/SIWE identity (wallet utama / EOA) so MCP sessions authenticated
      // as this address resolve the MSCA-held session key.
      ownerAddress,
    }),
  })
  const data = await res.json()
  if (!data.success) throw new Error(data.error || 'Session setup gagal')

  // Step 3: Update local state
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
