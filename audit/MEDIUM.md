# 🟡 Medium Severity Findings

> **Definition:** Issues that degrade code quality, safety, or maintainability, and may become exploitable under specific conditions or compound with other issues.

---

## M-001: Duplicate Code — ABI Encoding & Fee Estimation

**Files:** `src/components/BridgePanel.tsx`, `src/components/InfoPanel.tsx`

### Root Cause

The following logic is copy-pasted identically in both files:

1. **ABI encoding `receiveMessage(bytes,bytes)`:**
   - `pad32` helper
   - `msgLenHex`, `attLenHex`, `msgPadded`, `attPadded`
   - `attOffsetBytes` calculation
   - `0x57ecfd28` selector hardcoding

2. **Buffered EVM fee estimation:**
   - `getBufferedEvmFees()`
   - `sendEvmTxBuffered()`
   - `waitEvmTx()`

3. **Chain switching logic:**
   - `wallet_switchEthereumChain` / `wallet_addEthereumChain`

### Impact

- **Maintenance burden:** Any fix to bridge retry logic must be applied in 2+ places
- **Inconsistency risk:** One file may be updated while the other is forgotten
- **Bug propagation:** If a bug exists in the copied code, it exists in all copies

### Fix

Extract to a shared utility module:

```typescript
// src/services/evmTxHelpers.ts
export function encodeReceiveMessage(msg: string, att: string): string { ... }
export async function getBufferedEvmFees(tx: any, multiplier: bigint): Promise<any> { ... }
export async function sendEvmTxBuffered(tx: any): Promise<string> { ... }
export async function waitEvmTx(txHash: string, maxWaitMs = 120000): Promise<void> { ... }
export async function switchToChain(chainId: string, addParams?: any): Promise<void> { ... }
```

---

## M-002: `routerDeployments` File Read Without Try-Catch

**File:** `arcox-agent/mcp/server.mjs`
**Function:** `routerDeployments()`

### Root Cause

```typescript
function routerDeployments() {
  const path = join(agentRoot, 'deployments', 'arcox-router.testnet.json')
  if (!existsSync(path)) return {}
  return JSON.parse(readFileSync(path, 'utf8'))  // ❌ no try-catch
}
```

If the deployment JSON file is:
- Corrupted (invalid JSON)
- Truncated (partial write)
- Permission-denied after exists check (race condition)

The MCP server will **crash on startup or first request**.

### Impact

- MCP server Denial of Service
- Agent CLI becomes unusable
- No graceful degradation

### Fix

```typescript
function routerDeployments() {
  const path = join(agentRoot, 'deployments', 'arcox-router.testnet.json')
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (e) {
    console.error(`[MCP] Failed to load router deployments from ${path}:`, e)
    return {}
  }
}
```

---

## M-003: `safePost` Error Preview Can Leak HTML

**File:** `src/api.ts`
**Function:** `safePost()`

### Root Cause

When the backend returns a non-JSON error response (e.g., HTML 502 page from a reverse proxy):

```typescript
const preview = text.trim().startsWith('<')
  ? `HTML ${resp.status} page (endpoint missing or server error)`
  : text.slice(0, 200)
throw new Error(`Server ${resp.status} on ${path}: ${preview}`)
```

The code does handle the `<` prefix case, but if the HTML response starts with whitespace or a BOM before `<`, the `startsWith('<')` check fails and `text.slice(0, 200)` containing raw HTML is embedded in the error message.

### Impact

- **Information disclosure:** Error messages may contain internal server details, stack traces, or infrastructure fingerprints from proxy error pages
- **Potential XSS:** If any caller renders this error with `dangerouslySetInnerHTML` or insufficient escaping, raw HTML could execute

### Fix

```typescript
function sanitizePreview(text: string, status: number): string {
  const trimmed = text.trim()
  if (trimmed.startsWith('<') || trimmed.startsWith('<!')) {
    return `HTML ${status} response (endpoint unavailable)`
  }
  // Also escape any remaining HTML-like content
  return trimmed.slice(0, 200).replace(/[<>]/g, '')
}
```

---

## M-004: Token Address Hardcoded Without Checksum

**Files:** `src/App.tsx`, `src/chains.ts`, `src/domain/tokens.ts`

### Root Cause

Token and contract addresses are hardcoded as string literals without `getAddress()` validation:

```typescript
const USDC = '0x3600000000000000000000000000000000000000' as `0x${string}`
const EURC = '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a' as `0x${string}`
```

While `as `${string}`` provides TypeScript type safety, it does not validate the address format or checksum at runtime.

### Impact

- A single typo in any hardcoded address results in **permanent fund loss** (tokens sent to an invalid or non-existent contract)
- No early failure — the transaction would be submitted and confirmed, burning gas for no benefit

### Fix

Use runtime validation on module load:

```typescript
import { getAddress, isAddress } from 'viem'

const RAW_USDC = '0x3600000000000000000000000000000000000000'
if (!isAddress(RAW_USDC)) throw new Error('Invalid USDC address')
export const USDC = getAddress(RAW_USDC)  // checksum-validated
```

---

## M-005: Balance Auto-Refresh Polling Is Aggressive

**File:** `src/App.tsx`

### Root Cause

```typescript
useEffect(() => {
  if (!circleWallet?.address) return
  const iv = setInterval(refresh, 15000)  // every 15 seconds
  return () => clearInterval(iv)
}, [circleWallet, address, refresh])
```

Balance polling runs even when:
- The tab is not visible (background tab)
- The user is on the docs page
- No transaction is pending

### Impact

- Unnecessary RPC requests every 15 seconds per connected user
- Higher backend load and RPC provider costs
- Browser battery drain on mobile

### Fix

Pause polling when tab is hidden:

```typescript
useEffect(() => {
  if (!circleWallet?.address) return

  let iv: ReturnType<typeof setInterval>

  const startPolling = () => {
    iv = setInterval(refresh, 15000)
  }

  const stopPolling = () => clearInterval(iv)

  document.addEventListener('visibilitychange', () => {
    document.hidden ? stopPolling() : startPolling()
  })

  if (!document.hidden) startPolling()
  return stopPolling
}, [circleWallet, address, refresh])
```

---

## Summary Table

| ID | Title | File | Impact |
|----|-------|------|--------|
| M-001 | Duplicate ABI/fee code | `BridgePanel.tsx`, `InfoPanel.tsx` | Maintenance burden / inconsistency |
| M-002 | No try-catch on router JSON | `arcox-agent/mcp/server.mjs` | MCP server crash |
| M-003 | HTML leak in error preview | `src/api.ts` | Info disclosure |
| M-004 | Unchecked hardcoded addresses | `src/App.tsx`, `chains.ts`, `tokens.ts` | Fund loss on typo |
| M-005 | Aggressive balance polling | `src/App.tsx` | Resource waste |
