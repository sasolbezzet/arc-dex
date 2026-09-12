import { useCallback, useEffect, useRef, useState } from 'react'
import { registerPasskey, loginPasskey } from '../services/modularWallet'
import { activateAgentSession, isOwnerSessionRequiredError, readSessionStatus } from '../services/agentSession'
import { ensureConnectedOwnerSession } from '../auth'

/**
 * Claude / ChatGPT connector approval (MCP OAuth).
 *
 * The agent sends the user here with
 *   /plugin?auth=mcp&request_id=…&client_id=…&redirect_uri=…&state=…&code_challenge=…
 * and this hook finishes the handshake:
 *
 *   passkey ceremony (proves control of the Agent Wallet)
 *     -> activate the session key for that wallet
 *     -> verify the backend agrees the session is active for that exact wallet
 *     -> POST /api/auth/passkey-verify to mint the authorization code
 *     -> redirect back to the agent
 *
 * Two identities are checked: the connected owner wallet proves the account,
 * and the passkey proves the selected Agent Wallet MSCA. The backend validates
 * both sessions before issuing a code.
 *
 * REGRESSION GUARD: this flow used to live inside PluginPanel.tsx. When the
 * Plugin page was rewritten, PluginPanel stopped being rendered and the whole
 * Claude/ChatGPT connection path silently disappeared from production — the URL
 * parameters were never read again. Keep this as a hook so the page that
 * renders the Plugin dashboard always owns the approval flow.
 */

const API = '' // same-origin
const APPROVAL_TIMEOUT_MS = 210_000

export function withApprovalTimeout<T>(operation: Promise<T>, message: string, timeoutMs = APPROVAL_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs)
  })
  return Promise.race([operation, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

export type OAuthStep = 'idle' | 'passkey' | 'checking' | 'approving' | 'done' | 'error'

export interface OAuthRequest {
  requestId: string
  clientId: string
  redirectUri: string
  state: string
  codeChallenge: string
}

/** Human-readable label per step (no jargon: user-facing wording). */
export const OAUTH_STEP_LABEL: Record<OAuthStep, string> = {
  idle: 'Menunggu persetujuan Anda',
  passkey: 'Membuka Agent Wallet dengan passkey…',
  checking: 'Memeriksa kesiapan Agent Wallet…',
  approving: 'Mengizinkan akses agent…',
  done: 'Selesai. Mengembalikan Anda ke aplikasi agent…',
  error: 'Gagal',
}

export function readOAuthRequestFromUrl(search = window.location.search): OAuthRequest | null {
  const params = new URLSearchParams(search)
  if (params.get('auth') !== 'mcp') return null
  const requestId = params.get('request_id') || ''
  const clientId = params.get('client_id') || ''
  const redirectUri = params.get('redirect_uri') || ''
  if (!requestId || !clientId || !redirectUri) return null
  return {
    requestId,
    clientId,
    redirectUri,
    state: params.get('state') || '',
    codeChallenge: params.get('code_challenge') || '',
  }
}

/** Friendly agent name from an OAuth clientId such as `arcox_1a2b…`. */
export function oauthAgentLabel(clientId: string): string {
  const value = clientId.toLowerCase()
  if (value.includes('claude')) return 'Claude'
  if (value.includes('chatgpt') || value.includes('gpt')) return 'ChatGPT'
  return 'Agent MCP'
}

export function useOAuthApproval() {
  const [request, setRequest] = useState<OAuthRequest | null>(null)
  const [step, setStep] = useState<OAuthStep>('idle')
  const [error, setError] = useState<string | null>(null)
  const attempt = useRef(0)
  const mounted = useRef(true)

  useEffect(() => {
    setRequest(readOAuthRequestFromUrl())
    return () => { mounted.current = false }
  }, [])

  const approve = useCallback(async (mode: 'login' | 'register' = 'login') => {
    if (!request) return
    const current = ++attempt.current
    setError(null)

    // Each authorization must freshly prove control of the Agent Wallet. The
    // agent may reuse this page while localStorage still holds an older
    // session, so a stored token is never trusted on its own.
    const storageKey = `arx_oauth_vault_token:${request.clientId}`
    const agentKey = `oauth:${request.clientId}`

    try {
      // Existing-agent Login must show the passkey first. loginPasskey performs
      // the silent connected-wallet check and rejects with no WebAuthn prompt
      // when eth_accounts is empty. Registration remains owner-first because it
      // creates a new owner↔MSCA binding.
      const owner = mode === 'register' ? await ensureConnectedOwnerSession() : null
      let walletAddress = ''
      let sessionToken = ''
      // Login obtains this proof only after the passkey ceremony. Keep it in
      // scope for the final passkey-verify call; otherwise the backend cannot
      // issue the OAuth code and the browser never redirects back to Claude/GPT.
      let ownerAfterPasskey = owner
      let verified = false

      setStep('passkey')
      const passkey = mode === 'register'
        ? await registerPasskey(agentKey, owner || undefined)
        : await loginPasskey(agentKey)
      walletAddress = passkey.walletAddress
      sessionToken = passkey.sessionToken

      setStep('checking')
      // The login passkey proves the exact existing MSCA first. Only after
      // that ceremony succeeds do we obtain the owner proof needed by the
      // activation/final OAuth binding.
      ownerAfterPasskey = owner
      let activation
      try {
        activation = await withApprovalTimeout(
          activateAgentSession(walletAddress, sessionToken, agentKey,
            {
              ...(owner ? { eoaAddress: owner.address, ownerSessionToken: owner.token } : {}),
              credentialId: passkey.credential.id,
              allowDurableBindingRecovery: mode === 'login',
              // OAuth login must finish the existing Arc session without starting
              // extra destination-chain passkey UserOps in the approval flow.
              skipDestinationChains: mode === 'login',
            }),
          'Kesiapan Agent Wallet belum selesai dalam batas waktu. Tidak ada akses yang diizinkan; periksa status jaringan/Circle lalu ulangi dari passkey yang sama.',
        )
      } catch (error) {
        if (mode !== 'login' || !isOwnerSessionRequiredError(error)) throw error
        ownerAfterPasskey = await ensureConnectedOwnerSession()
        activation = await withApprovalTimeout(
          activateAgentSession(walletAddress, sessionToken, agentKey,
            {
              eoaAddress: ownerAfterPasskey.address,
              ownerSessionToken: ownerAfterPasskey.token,
              credentialId: passkey.credential.id,
              skipDestinationChains: true,
            }),
          'Kesiapan Agent Wallet belum selesai dalam batas waktu. Tidak ada akses yang diizinkan; periksa status jaringan/Circle lalu ulangi dari passkey yang sama.',
        )
      }
      void activation
      const session = await readSessionStatus(sessionToken)
      if (!session) throw new Error('Status Agent Wallet tidak dapat dibaca. Tidak ada akses yang diizinkan; periksa koneksi backend lalu coba lagi.')
      verified = Boolean(
        session.active
        && walletAddress
        && String(session.walletAddress || '').toLowerCase() === walletAddress.toLowerCase(),
      )
      if (!verified) throw new Error('Agent Wallet belum aktif. Tidak ada akses yang diizinkan; ulangi Login passkey setelah status session siap.')
      if (current !== attempt.current) return

      // Keep the OAuth session separate: connecting Claude must not overwrite
      // the token/wallet state Hermes is using in this browser.
      localStorage.setItem(storageKey, sessionToken)

      setStep('approving')
      const response = await withApprovalTimeout(fetch(`${API}/api/auth/passkey-verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mscaWalletAddress: walletAddress,
          mscaSessionToken: sessionToken,
          requestId: request.requestId,
          clientId: request.clientId,
          redirectUri: request.redirectUri,
          state: request.state,
          codeChallenge: request.codeChallenge,
          // For login, this is the owner SIWE session obtained after passkey.
          // Sending it is what lets the backend mint the OAuth code and return
          // the redirect to the originating Claude/ChatGPT application.
          ...(ownerAfterPasskey
            ? { ownerAddress: ownerAfterPasskey.address, ownerSessionToken: ownerAfterPasskey.token }
            : {}),
        }),
        signal: AbortSignal.timeout(30_000),
      }), 'Persetujuan agent tidak selesai dalam batas waktu. Tidak ada kode akses yang diterbitkan; ulangi koneksi dari aplikasi agent.', 45_000)
      const data = await response.json().catch(() => ({}))
      if (current !== attempt.current) return

      if (data?.redirect) {
        setStep('done')
        window.location.href = data.redirect
        return
      }
      throw new Error(data?.error || 'Kode izin tidak diterbitkan')
    } catch (err) {
      if (current !== attempt.current || !mounted.current) return
      setStep('error')
      setError(err instanceof Error ? err.message : 'Persetujuan gagal')
    }
  }, [request])

  const cancel = useCallback(() => {
    attempt.current++
    setStep('idle')
    setError(null)
    setRequest(null)
    // Drop the approval parameters so a reload does not re-open the prompt.
    const url = new URL(window.location.href)
    for (const key of ['auth', 'request_id', 'client_id', 'redirect_uri', 'state', 'code_challenge']) {
      url.searchParams.delete(key)
    }
    window.history.replaceState({}, '', url.toString())
  }, [])

  return {
    request,
    agentLabel: request ? oauthAgentLabel(request.clientId) : '',
    step,
    stepLabel: OAUTH_STEP_LABEL[step],
    busy: step === 'passkey' || step === 'checking' || step === 'approving',
    error,
    approve,
    cancel,
  }
}
