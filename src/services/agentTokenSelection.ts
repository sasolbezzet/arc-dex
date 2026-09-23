/**
 * Per-agent vault-token selection.
 *
 * The dashboard keeps several independently issued owner sessions in
 * localStorage: a global one (`arx_vault_token` / `arx_passkey_vault_token` /
 * `arx_owner_vault_token`) plus one per OAuth client
 * (`arx_oauth_vault_token:<clientId>`), because each agent wallet authenticates
 * with its own passkey.
 *
 * A card action must send the proof that belongs to that exact agent first, but
 * a 24h session expires while the card is still on screen. The previous
 * implementation kept sending the dead per-agent token forever: Relogin/Revoke/
 * Clear answered "Sesi berakhir. Masuk kembali dengan passkey." even after the
 * user had just authenticated with the passkey again, because the fresh login
 * only refreshed the global keys while `tokenForAgent` still preferred the
 * expired per-agent one.
 *
 * `agentTokenCandidates` returns the proofs to try, most specific first, and
 * `forgetVaultToken` removes a proof the backend already rejected so the next
 * attempt starts from a healthy session instead of looping on a dead token.
 */
export const SCOPED_VAULT_TOKEN_PREFIX = 'arx_oauth_vault_token:'

/** Global (agent-independent) vault session slots, newest semantics first. */
export const GLOBAL_VAULT_TOKEN_KEYS = [
  'arx_vault_token',
  'arx_passkey_vault_token',
  'arx_owner_vault_token',
  'arx_eoa_vault_token',
] as const

export interface TokenStore {
  getItem(key: string): string | null
  removeItem?(key: string): void
  key?(index: number): string | null
  length?: number
}

function defaultStore(): TokenStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function read(store: TokenStore | null, key: string): string | null {
  if (!store || !key) return null
  try {
    return store.getItem(key)
  } catch {
    return null
  }
}

/** localStorage slot that holds the passkey session of one agent (by clientId). */
export function scopedVaultTokenKey(agentKey: string): string {
  const clientId = String(agentKey || '').split('|')[0]?.trim() || ''
  return clientId ? `${SCOPED_VAULT_TOKEN_PREFIX}${clientId}` : ''
}

/** True for any localStorage slot that stores a vault/owner session token. */
export function isVaultTokenKey(key: string): boolean {
  const value = String(key || '')
  return (GLOBAL_VAULT_TOKEN_KEYS as readonly string[]).includes(value)
    || value.startsWith(SCOPED_VAULT_TOKEN_PREFIX)
}

function vaultTokenKeys(store: TokenStore): string[] {
  if (typeof store.key === 'function' && typeof store.length === 'number') {
    const keys: string[] = []
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index)
      if (key) keys.push(key)
    }
    return keys
  }
  return Object.keys(store as unknown as Record<string, unknown>)
}

/**
 * Ordered vault tokens to try for one agent: its own passkey session first,
 * then the session the dashboard most recently used, then the remaining global
 * slots. Duplicates are collapsed — the same token can legitimately live in
 * several slots.
 */
export function agentTokenCandidates(
  agentKey: string,
  primary: string | null | undefined,
  store: TokenStore | null = defaultStore(),
): string[] {
  const tokens: string[] = []
  const add = (value: string | null | undefined) => {
    const token = String(value || '').trim()
    if (token && !tokens.includes(token)) tokens.push(token)
  }
  add(read(store, scopedVaultTokenKey(agentKey)))
  add(primary)
  for (const key of GLOBAL_VAULT_TOKEN_KEYS) add(read(store, key))
  return tokens
}

/**
 * Drop a proof every slot that still holds it, so a session the backend has
 * already rejected cannot be preferred again on the next card action.
 */
export function forgetVaultToken(token: string, store: TokenStore | null = defaultStore()): void {
  const value = String(token || '').trim()
  if (!store || !value || typeof store.removeItem !== 'function') return
  try {
    for (const key of vaultTokenKeys(store)) {
      if (!isVaultTokenKey(key)) continue
      if (read(store, key) === value) store.removeItem(key)
    }
  } catch { /* storage can be unavailable in privacy mode */ }
}

/**
 * Only an authentication/ownership rejection justifies replaying the same
 * action with a different proof. Network errors, 5xx, validation failures and
 * business rejections must surface unchanged.
 */
export function isStaleTokenError(error: unknown): boolean {
  const status = Number((error as { status?: number } | null)?.status || 0)
  const code = String((error as { code?: string } | null)?.code || '')
  if (status === 401 || code === 'session_expired') return true
  return status === 403 && (code === 'forbidden' || code === 'owner_authentication_required')
}
