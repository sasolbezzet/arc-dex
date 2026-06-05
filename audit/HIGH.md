# 🟠 High Severity Findings

> **Definition:** Issues that can lead to significant security degradation, data theft, or user harm under realistic attack conditions.

---

## H-001: localStorage Poisoning → Agent Endpoint Hijacking

**File:** `src/services/agenticStore.ts`, `src/components/AgenticPanel.tsx`
**CVSS Estimate:** 7.1 (High)

### Root Cause

Agent link data (AI endpoint, signature, owner) is stored in `localStorage` without any integrity check or signature validation on read:

```typescript
// agenticStore.ts
export function getAgentLink(owner: string | null): StoredAgentLink | null {
  if (!owner) return null
  const links = readJson<StoredAgentLink[]>(LINKS_KEY, [])
  return links.find(item => item.owner.toLowerCase() === owner.toLowerCase()) ?? null
}
```

`readJson` simply parses whatever is in `localStorage`:

```typescript
function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}
```

### Exploit Vector

1. Attacker uses a **malicious browser extension** or **XSS on another tab** to modify `localStorage`.
2. They overwrite the `arcox-agentic-ai-links` key with a modified agent link:
   - `endpoint` → attacker-controlled server
   - `ownerSignature` → copied from original
   - `agentId` → kept the same
3. User opens ARCOX DEX and clicks "Run Simulation".
4. The frontend sends the user's prompt, wallet address, and capabilities to the **attacker's server**.
5. Attacker now has:
   - The user's wallet address
   - Their agent capabilities
   - Their prompt content (potentially sensitive trading intent)
   - The `ownerSignature` (which they can try to replay)

### Impact

- Phishing / social engineering via hijacked AI endpoint
- Data exfiltration of trading prompts and wallet metadata
- Potential replay of `ownerSignature` for unauthorized agent linking

### Fix

Validate the agent link against the onchain agent registry on every read, or at minimum store a HMAC:

```typescript
import { keccak256, toHex } from 'viem'

function computeLinkIntegrity(link: StoredAgentLink): string {
  const payload = JSON.stringify({
    agentId: link.agentId,
    owner: link.owner,
    endpoint: link.endpoint,
    capabilities: link.capabilities,
  })
  return keccak256(toHex(payload + link.ownerSignature.slice(0, 32)))
}

export function saveAgentLink(link: StoredAgentLink) {
  const integrity = computeLinkIntegrity(link)
  const stored = { ...link, _integrity: integrity }
  // ... save
}

export function getAgentLink(owner: string | null): StoredAgentLink | null {
  const link = /* read from storage */
  if (!link?._integrity || link._integrity !== computeLinkIntegrity(link)) {
    console.warn('Agent link integrity check failed — possible tampering.')
    return null
  }
  return link
}
```

---

## H-002: Precision Loss Denial of Service on Bridge

**File:** `src/components/BridgePanel.tsx`
**Function:** `bridgeEvm()`
**CVSS Estimate:** 6.1 (Medium)

### Root Cause

Token amounts for bridge are converted using `parseFloat` followed by `Math.round`, which introduces floating-point precision errors:

```typescript
const amtNum = parseFloat(amount)
const amtMicro = BigInt(Math.round(amtNum * 10**tokenDec))
```

For `cirBTC` which has 8 decimals, an amount like `0.00000001` (1 satoshi):
- `parseFloat('0.00000001')` → `1e-8`
- `1e-8 * 1e8` → `1.0`
- `Math.round(1.0)` → `1`
- `BigInt(1)` → `1n` ✅ (this specific case works)

But for `0.12345678`:
- `parseFloat('0.12345678')` → `0.12345678`
- `0.12345678 * 1e8` → `12345677.999999998`
- `Math.round(...)` → `12345678` ✅ (sometimes works)

However, for values like `0.1` with 8 decimals:
- `0.1 * 1e8` → `10000000.000000002` (IEEE 754 representation)
- `Math.round(...)` → `10000000` ✅

The real danger is edge cases and **very small amounts** where precision loss causes `amtMicro = 0n`:

```typescript
const amtNum = parseFloat('0.000000001')  // 0.000000001
const amtMicro = BigInt(Math.round(amtNum * 10**8))  // BigInt(Math.round(0.1)) = 0n
```

A burn with `amount = 0` may:
- Be rejected by the contract (best case)
- Pass through and burn 0 tokens while consuming gas (DoS)
- Cause unexpected state in tx history

### Exploit Vector

1. User (or attacker guiding user) inputs a very small bridge amount.
2. Precision loss causes `amtMicro = 0n`.
3. Transaction is submitted and consumes gas for no value transfer.
4. This can be repeated to drain gas funds.

### Impact

- Gas waste on zero-value transactions
- Confusing UX ("transaction succeeded but no tokens moved")
- Potential for spam/DoS if automated

### Fix

Use `viem`'s `parseUnits` which handles arbitrary precision correctly:

```typescript
import { parseUnits } from 'viem'

const amtMicro = parseUnits(amount, tokenDec)  // ✅ exact, no floating-point
```

---

## H-003: MCP Server — No Rate Limiting on Value-Moving Tools

**File:** `arcox-agent/mcp/server.mjs`
**CVSS Estimate:** 5.9 (Medium)

### Root Cause

The MCP server exposes tools like `arcox_execute_bridge`, `arcox_execute_swap`, and `arcox_execute_send` without any rate limiting, throttling, or per-session request caps.

### Exploit Vector

1. An AI agent connected to the MCP is compromised or goes into a loop.
2. The agent repeatedly calls `arcox_execute_bridge` with `confirmed: true`.
3. Each call triggers an onchain transaction using the local `AGENT_PRIVATE_KEY`.
4. Without rate limiting, hundreds of transactions can be fired in seconds.

### Impact

- Rapid fund drain if agent enters an execution loop
- Spam on the blockchain network
- Gas exhaustion on the agent's wallet

### Fix

Add a simple in-memory rate limiter:

```typescript
const rateLimits = new Map<string, { count: number; windowStart: number }>()
const MAX_REQUESTS_PER_MINUTE = 10

function checkRateLimit(clientId: string): boolean {
  const now = Date.now()
  const window = 60_000 // 1 minute
  const entry = rateLimits.get(clientId)

  if (!entry || now > entry.windowStart + window) {
    rateLimits.set(clientId, { count: 1, windowStart: now })
    return true
  }

  if (entry.count >= MAX_REQUESTS_PER_MINUTE) return false
  entry.count++
  return true
}
```

---

## Summary Table

| ID | Title | File | Exploitability | Impact |
|----|-------|------|---------------|--------|
| H-001 | localStorage agent poisoning | `src/services/agenticStore.ts` | High (XSS/ext) | Data theft / phishing |
| H-002 | Bridge precision loss DoS | `src/components/BridgePanel.tsx` | Medium (user input) | Gas waste |
| H-003 | No MCP rate limiting | `arcox-agent/mcp/server.mjs` | Medium (agent loop) | Fund drain / spam |
