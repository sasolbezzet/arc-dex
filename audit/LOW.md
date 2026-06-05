# 🟢 Low Severity Findings & Suggestions

> **Definition:** Issues that do not pose immediate security risks but represent code quality debt, missing best practices, or potential future vulnerabilities.

---

## L-001: Excessive Use of `any` Type

**Files:** `src/solflareWrapper.ts`, `src/appKit.ts`

### Details

```typescript
// solflareWrapper.ts
export function wrapSolflare(raw: any): any { ... }
export function wrapPhantom(raw: any): any { ... }

// appKit.ts
return await createViemAdapterFromProvider({
  provider: window.ethereum,
  capabilities: { ... }
} as any)
```

The Solana wallet wrappers accept and return `any`, completely bypassing TypeScript type checking. This means:
- Compile-time errors from SDK version mismatches go undetected
- Refactoring is dangerous — no IDE assistance for method renames
- Runtime errors from unexpected provider shapes are likely

### Suggestion

Define minimal interface shapes:

```typescript
interface SolanaProvider {
  isConnected: boolean
  publicKey?: { toString(): string; toBase58(): string }
  connect(): Promise<void>
  disconnect?(): Promise<void>
  signTransaction(tx: any): Promise<any>
  signAllTransactions(txs: any[]): Promise<any[]>
  signMessage(msg: Uint8Array): Promise<any>
}

export function wrapSolflare(raw: SolanaProvider): WrappedProvider { ... }
```

---

## L-002: `CustomEvent` Name Not Namespaced

**File:** `src/txHistory.ts`

### Details

```typescript
window.dispatchEvent(new CustomEvent('arc-dex.tx-history'))
```

The event name `arc-dex.tx-history` is reasonably namespaced, but it uses a dot (`.`) which can confuse some event delegation libraries. More importantly, **there is no verification** that listeners are from trusted code.

### Suggestion

Use a more explicit name and consider adding an origin check in listeners:

```typescript
const TX_HISTORY_EVENT = 'arcox-dex:tx-history-changed' as const
window.dispatchEvent(new CustomEvent(TX_HISTORY_EVENT, { detail: { source: 'txHistory' } }))
```

---

## L-003: `kitKeyCache` Never Invalidated

**File:** `src/services/swapService.ts`

### Details

```typescript
let kitKeyCache = ''

export async function getKitKey() {
  if (kitKeyCache) return kitKeyCache
  const r = await fetch(`${API}/api/config`)
  const d = await r.json()
  kitKeyCache = d.kitKey || ''
  return kitKeyCache
}
```

The `kitKey` is cached for the lifetime of the module (effectively the browser session). If the backend rotates the key, the frontend continues using the stale key until page reload.

### Suggestion

Add TTL-based cache invalidation:

```typescript
let kitKeyCache: { value: string; expiresAt: number } | null = null
const CACHE_TTL_MS = 5 * 60 * 1000  // 5 minutes

export async function getKitKey() {
  if (kitKeyCache && Date.now() < kitKeyCache.expiresAt) {
    return kitKeyCache.value
  }
  const r = await fetch(`${API}/api/config`)
  const d = await r.json()
  kitKeyCache = { value: d.kitKit || '', expiresAt: Date.now() + CACHE_TTL_MS }
  return kitKeyCache.value
}
```

---

## L-004: i18n Fallback Is Not Explicit

**File:** `src/i18n.tsx`

### Details

```typescript
t: (key, params) => {
  let text = messages[lang][key] || messages.id[key] || key
  // ...
}
```

When a translation key is missing in the active language, it silently falls back to Indonesian (`messages.id`). For example, if `zh` is missing a key, the UI shows Indonesian text — confusing for Chinese users.

### Suggestion

Add an explicit fallback chain with logging:

```typescript
const FALLBACK_CHAIN: Lang[] = ['en', 'id']  // try English first, then Indonesian

function resolveTranslation(lang: Lang, key: string): string {
  if (messages[lang][key]) return messages[lang][key]
  for (const fallback of FALLBACK_CHAIN) {
    if (messages[fallback][key]) {
      console.warn(`[i18n] Missing key "${key}" in "${lang}", falling back to "${fallback}"`)
      return messages[fallback][key]
    }
  }
  console.warn(`[i18n] Missing key "${key}" in all languages`)
  return key
}
```

---

## L-005: `swapService.ts` — No Timeout on Fetch

**File:** `src/services/swapService.ts`

### Details

```typescript
const r = await fetch(`${API}/api/config`)
```

No `AbortController` or timeout is used. On slow networks, this can hang indefinitely.

### Suggestion

```typescript
async function fetchWithTimeout(url: string, timeoutMs = 10000) {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal })
    return response
  } finally {
    clearTimeout(id)
  }
}
```

---

## L-006: `App.css` — Unused CSS File

**File:** `src/App.css`

### Details

The entire `App.css` file contains unused styles (`.counter`, `.hero`, `#next-steps`, etc.) from what appears to be a Vite starter template. It is imported in no visible component and likely dead code.

### Suggestion

Remove the file and its import if confirmed unused. Check `src/main.tsx` and `src/App.tsx` for `import './App.css'`.

---

## L-007: Solana Router — Missing Rustdoc

**File:** `arcox-agent/solana-router/programs/arcox-solana-router/src/lib.rs`

### Details

Public functions `initialize`, `set_fee_bps`, `set_treasury_token_account`, and `transfer_with_fee` have no documentation comments. For an onchain program handling fees, this is a maintainability risk.

### Suggestion

Add `///` doc comments above each public function explaining:
- Purpose and behavior
- Access control requirements
- Error conditions

```rust
/// Initialize the router config with an owner and fee basis points.
///
/// # Arguments
/// * `fee_bps` - Fee in basis points (max 1000 = 10%)
///
/// # Errors
/// * `ArcoxRouterError::FeeTooHigh` if fee_bps > 1000
pub fn initialize(ctx: Context<Initialize>, fee_bps: u16) -> Result<()> { ... }
```

---

## L-008: No Unit Tests Found

**Scope:** Entire project

### Details

No `*.test.ts`, `*.spec.ts`, or `*.test.tsx` files were found. Given the complexity of:
- CCTP bridge flow (approve → burn → attest → mint)
- Solana transaction signing and ATA creation
- Auth session management
- Agentic economy smart contract interactions

This represents significant untested critical-path code.

### Suggestion

Priority test coverage:
1. `src/auth.ts` — token expiration, nonce validation, signature verification
2. `src/services/agentic.ts` — contract interaction helpers, event parsing
3. `src/api.ts` — error handling, retry logic, content-type detection
4. `arcox-agent/bin/arcox-agent.mjs` — quote functions, intent classification

---

## Summary Table

| ID | Title | File | Category |
|----|-------|------|----------|
| L-001 | Excessive `any` types | `solflareWrapper.ts`, `appKit.ts` | Type safety |
| L-002 | Un-namespaced CustomEvent | `txHistory.ts` | Code quality |
| L-003 | kitKeyCache never expires | `swapService.ts` | Caching |
| L-004 | i18n silent fallback to Indonesian | `i18n.tsx` | UX |
| L-005 | No fetch timeout | `swapService.ts` | Resilience |
| L-006 | Unused CSS file | `App.css` | Dead code |
| L-007 | Missing Rustdoc | `lib.rs` | Documentation |
| L-008 | No unit tests | Project-wide | Test coverage |
