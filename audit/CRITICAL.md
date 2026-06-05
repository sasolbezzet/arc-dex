# 🔴 Critical Severity Findings

> **Definition:** Issues that can lead to immediate fund loss, account takeover, or code execution with practical exploitability.

---

## C-001: Auth Token Never Expires Client-Side (Session Hijacking)

**File:** `src/auth.ts`
**Line:** `function readTokenExp(token: string)`
**CVSS Estimate:** 8.1 (High)

### Root Cause

JWT structure is `header.payload.signature`. The `readTokenExp` function incorrectly reads index `[0]` (the header) instead of `[1]` (the payload where `exp` lives):

```typescript
function readTokenExp(token: string): number | null {
  const payload = token.split('.')[0]  // ❌ WRONG: this is the HEADER
  // header looks like: {"alg":"HS256","typ":"JWT"}
  // it has NO "exp" field, so this always returns null
  ...
}
```

Because `exp` is never found, `readSession()` always treats the token as valid:

```typescript
const exp = readTokenExp(session.token)
if (exp && Date.now() > exp) {  // ❌ exp is always null → this check NEVER triggers
  localStorage.removeItem(STORAGE_KEY)
  return null
}
```

### Exploit Vector

1. Attacker obtains a stolen auth token (XSS, malicious extension, network sniffing, clipboard leak).
2. The token is valid **forever** — there is no expiration check.
3. Attacker can call any backend API (`/api/send`, `/api/swap`, `/api/bridge`) using this token.
4. If the backend also doesn't enforce token expiration independently, this is a **permanent account compromise**.

### Impact

- Permanent session hijacking
- Unauthorized swaps, sends, and bridge operations
- Circle Wallet proxy impersonation

### Fix

```typescript
function readTokenExp(token: string): number | null {
  try {
    const payload = token.split('.')[1]  // ✅ FIXED: read PAYLOAD (index 1)
    if (!payload) return null
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - payload.length % 4) % 4)
    const data = JSON.parse(atob(padded))
    return typeof data?.exp === 'number' ? data.exp * 1000 : null  // exp is in seconds
  } catch {
    return null
  }
}
```

**Also required:** Backend MUST independently validate `exp` on every protected endpoint.

---

## C-002: Replay Attack on Auth Signature

**File:** `src/auth.ts`
**Function:** `buildAuthMessage()`
**CVSS Estimate:** 7.5 (High)

### Root Cause

The auth message used for `personal_sign` contains only deterministic, guessable fields:

```
ARCOX DEX login
Only sign this message on the official ARCOX DEX website.
Address: 0x...
Issued At: 2026-06-04T12:00:00.000Z
Network: Arc Testnet
```

There is no:
- Random `nonce`
- `expires` timestamp
- `chainId`
- Domain binding

### Exploit Vector

1. Attacker intercepts a valid `personal_sign` signature + the corresponding message.
2. The attacker replays the exact `{address, issuedAt, signature}` payload to `/api/auth/session`.
3. Because the backend only verifies the signature against the reconstructed message (which the attacker knows), a **new valid token is issued**.
4. This works indefinitely because `issuedAt` is never checked for freshness.

### Impact

- Full account takeover without knowing the private key
- Bypasses all frontend auth checks
- Enables unauthorized access to Circle Wallet proxy

### Fix

Add a cryptographically random nonce and expires timestamp to the message:

```typescript
function buildAuthMessage(address: string, issuedAt: string, nonce: string, expiresAt: string) {
  return [
    'ARCOX DEX login',
    'Only sign this message on the official ARCOX DEX website.',
    `Address: ${address}`,
    `Issued At: ${issuedAt}`,
    `Expires At: ${expiresAt}`,
    `Nonce: ${nonce}`,
    'Network: Arc Testnet',
  ].join('\n')
}

// In ensureAuthSession:
const nonce = crypto.randomUUID()  // or crypto.getRandomValues
const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString()  // 5 min
const message = buildAuthMessage(checksumAddress, issuedAt, nonce, expiresAt)
// Backend must validate: nonce hasn't been used, expiresAt is in the future
```

---

## C-003: Economic Griefing via Bridge Fee Retry

**File:** `src/components/BridgePanel.tsx`
**Function:** `sendEvmTxBuffered()`
**CVSS Estimate:** 6.5 (Medium)

### Root Cause

When a transaction fails with a fee-related error, the code **automatically retries with 6x the gas multiplier** without user consent or a cap:

```typescript
const firstFees = await getBufferedEvmFees(tx, 3n)
try {
  return await window.ethereum!.request({ method:'eth_sendTransaction', params:[{ ...tx, ...firstFees }] })
} catch(e:any) {
  const msg = e?.message || ''
  if (!/max fee per gas less than block base fee|replacement transaction underpriced|fee/i.test(msg)) throw e
  await new Promise(r => setTimeout(r, 1200))
  const retryFees = await getBufferedEvmFees(tx, 6n)  // ❌ 6x without cap!
  return await window.ethereum!.request({ method:'eth_sendTransaction', params:[{ ...tx, ...retryFees }] })
}
```

### Exploit Vector

1. Attacker controls the user's RPC endpoint (e.g., via DNS hijacking, malicious WiFi, or compromised RPC provider).
2. The RPC returns a fake "underpriced" or "base fee too low" error even though the fee was actually sufficient.
3. The frontend blindly retries with `6n` multiplier, resulting in gas fees up to **6x higher** than market rate.
4. The attacker-operated RPC can even be a miner/MEV bot that profits from the inflated priority fee.

### Impact

- Unexpected gas fee up to 600% of normal
- User fund drain during high-gas periods
- Potential MEV extraction via manipulated RPC

### Fix

Add a **user-configurable cap** on max fee increase and require explicit confirmation for large jumps:

```typescript
const MAX_FEE_MULTIPLIER = 4n  // cap at 4x
const MAX_RETRY_WITHOUT_PROMPT = 2n

async function sendEvmTxBuffered(tx: any, currentMultiplier = 3n): Promise<string> {
  const fees = await getBufferedEvmFees(tx, currentMultiplier)
  try {
    return await window.ethereum!.request({ method:'eth_sendTransaction', params:[{ ...tx, ...fees }] })
  } catch(e: any) {
    const msg = e?.message || ''
    if (!/fee|underpriced|base fee/i.test(msg)) throw e
    if (currentMultiplier >= MAX_FEE_MULTIPLIER) {
      throw new Error(`Gas fee exceeded safe cap (${MAX_FEE_MULTIPLIER}x). Please retry manually or check network conditions.`)
    }
    await new Promise(r => setTimeout(r, 1200))
    return sendEvmTxBuffered(tx, currentMultiplier + 1n)
  }
}
```

---

## C-004: Arbitrary File Write via MCP Debug Environment Variable

**File:** `arcox-agent/mcp/server.mjs`
**Function:** `debug()`
**CVSS Estimate:** 7.8 (High)

### Root Cause

The MCP server writes debug output to any file path specified by the `ARCOX_MCP_DEBUG` environment variable with **zero validation**:

```typescript
const debugPath = process.env.ARCOX_MCP_DEBUG || ''
function debug(event, payload = {}) {
  if (!debugPath) return
  appendFileSync(debugPath, JSON.stringify({ ts: new Date().toISOString(), event, ...payload }) + '\n')
}
```

### Exploit Vector

1. Attacker gains ability to set environment variables (container escape, shared server, or supply-chain attack on CI/CD).
2. Attacker sets `ARCOX_MCP_DEBUG=/home/user/.bashrc` or `/etc/crontab` or `~/.zshrc`.
3. Every MCP request appends JSON lines to that file.
4. While the output is JSON (not shell code), if the attacker controls the `payload` content (via MCP tool parameters), they can craft parameters that, when stringified, contain shell-executable content. More practically, this is a **denial of service** and **system integrity** issue.
5. If the file is a symlink, this can write to sensitive system locations.

### Impact

- Arbitrary file append on the host filesystem
- Potential code execution if writing to startup scripts
- Log poisoning / integrity violation

### Fix

Restrict debug output to a controlled directory:

```typescript
import { mkdirSync, appendFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'

const DEFAULT_DEBUG_DIR = join(homedir(), '.arcox', 'logs')

function getDebugPath(): string | null {
  const envPath = process.env.ARCOX_MCP_DEBUG
  if (!envPath) return null

  // Only allow paths inside ~/.arcox/logs or an explicitly allowed dir
  const resolved = resolve(envPath)
  const allowedDir = resolve(process.env.ARCOX_MCP_DEBUG_DIR || DEFAULT_DEBUG_DIR)

  if (!resolved.startsWith(allowedDir)) {
    console.error(`[MCP] debug path ${resolved} is outside allowed dir ${allowedDir}. Ignoring.`)
    return null
  }

  const dir = dirname(resolved)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return resolved
}

const debugPath = getDebugPath()
```

---

## Summary Table

| ID | Title | File | Exploitability | Impact |
|----|-------|------|---------------|--------|
| C-001 | Auth token never expires | `src/auth.ts` | High (XSS/ext) | Permanent session hijack |
| C-002 | Replay auth signature | `src/auth.ts` | High (MITM/log) | Account takeover |
| C-003 | Bridge fee griefing | `src/components/BridgePanel.tsx` | Medium (evil RPC) | 6x gas drain |
| C-004 | MCP arbitrary file write | `arcox-agent/mcp/server.mjs` | Medium (env ctrl) | Code exec / DoS |
