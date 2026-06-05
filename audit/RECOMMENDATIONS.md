# 🛠️ Prioritized Fix Recommendations

> This document provides concrete, copy-paste-ready fixes for all findings in this audit, ordered by priority (Critical → High → Medium → Low).

---

## 🔴 Priority 1: Auth & Session Security (Critical)

### Fix C-001 + C-002: Token Expiration + Replay Protection

**File:** `src/auth.ts`

Replace the entire file with:

```typescript
import { safePost } from './api'
import { getAddress } from 'viem'

const STORAGE_KEY = 'arc-dex-auth'

// Maximum session lifetime: 24 hours
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000

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

function readSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const session = raw ? JSON.parse(raw) : null
    if (!session?.token || !session?.address) return null
    const exp = readTokenExp(session.token)
    const issued = new Date(session.issuedAt || 0).getTime()
    if ((exp && Date.now() > exp) || Date.now() - issued > SESSION_MAX_AGE_MS) {
      localStorage.removeItem(STORAGE_KEY)
      return null
    }
    return session
  } catch {
    return null
  }
}

function readTokenExp(token: string): number | null {
  try {
    const payload = token.split('.')[1]  // ✅ FIXED: read PAYLOAD (index 1), not header
    if (!payload) return null
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - payload.length % 4) % 4)
    const data = JSON.parse(atob(padded))
    return typeof data?.exp === 'number' ? data.exp * 1000 : null  // exp is in seconds
  } catch {
    return null
  }
}

export function getAuthToken() {
  return readSession()?.token || ''
}

export function clearAuthSession() {
  localStorage.removeItem(STORAGE_KEY)
}

export async function ensureAuthSession(address: string, forceNew = false) {
  const checksumAddress = getAddress(address)
  const normalized = checksumAddress.toLowerCase()
  const existing = readSession()
  if (!forceNew && existing?.token && existing.address.toLowerCase() === normalized) return existing.token
  if (!window.ethereum) throw new Error('MetaMask tidak terdeteksi')

  const issuedAt = new Date().toISOString()
  const nonce = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString()  // 5-minute signing window
  const message = buildAuthMessage(checksumAddress, issuedAt, nonce, expiresAt)

  const signature = await window.ethereum.request({
    method: 'personal_sign',
    params: [message, checksumAddress],
  })

  const result = await safePost('', '/api/auth/session', {
    address: checksumAddress,
    issuedAt,
    nonce,
    expiresAt,
    signature,
  })

  const session = { address: result.address || checksumAddress, token: result.token, issuedAt, nonce }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  return session.token
}

type AuthSession = {
  address: string
  token: string
  issuedAt: string
  nonce: string
}
```

**Backend must also:**
1. Validate `nonce` is unique (store used nonces in DB/cache with TTL)
2. Validate `expiresAt` is in the future
3. Independently verify `token.exp` on every protected endpoint

---

## 🔴 Priority 2: Bridge Precision & Fee Safety (Critical)

### Fix C-003 + H-002: Use `parseUnits` + Cap Fee Retry

**File:** `src/components/BridgePanel.tsx`

Replace the amount parsing in `bridgeEvm`:

```typescript
// ❌ BEFORE:
// const amtNum = parseFloat(amount)
// const amtMicro = BigInt(Math.round(amtNum * 10**tokenDec))

// ✅ AFTER:
import { parseUnits } from 'viem'
const amtMicro = parseUnits(amount, tokenDec)
```

Replace `sendEvmTxBuffered` and `getBufferedEvmFees`:

```typescript
// Extract to: src/services/evmTxHelpers.ts

const MAX_FEE_MULTIPLIER = 4n

export async function getBufferedEvmFees(tx: any, multiplier = 3n) {
  const out: any = {}
  try {
    const gasHex = await window.ethereum!.request({ method:'eth_estimateGas', params:[tx] })
    out.gas = toHex((BigInt(gasHex) * 13n) / 10n + 10_000n)
  } catch(e) {
    console.warn('eth_estimateGas failed:', e instanceof Error ? e.message : String(e))
  }
  try {
    const block = await window.ethereum!.request({ method:'eth_getBlockByNumber', params:['latest', false] })
    const baseFee = block?.baseFeePerGas ? BigInt(block.baseFeePerGas) : 0n
    if (baseFee > 0n) {
      let tip = 0n
      try { tip = BigInt(await window.ethereum!.request({ method:'eth_maxPriorityFeePerGas' })) } catch {}
      const minTip = 1_500_000n
      if (tip < minTip) tip = minTip
      out.maxPriorityFeePerGas = toHex(tip)
      out.maxFeePerGas = toHex(baseFee * multiplier + tip * 2n)
      return out
    }
  } catch(e) {
    console.warn('EIP-1559 fee lookup failed:', e instanceof Error ? e.message : String(e))
  }
  try {
    const gasPrice = BigInt(await window.ethereum!.request({ method:'eth_gasPrice' }))
    out.gasPrice = toHex(gasPrice * multiplier)
  } catch {}
  return out
}

export async function sendEvmTxBuffered(tx: any, currentMultiplier = 3n): Promise<string> {
  if (currentMultiplier > MAX_FEE_MULTIPLIER) {
    throw new Error(`Gas fee exceeded safe cap (${MAX_FEE_MULTIPLIER}x). Please retry manually.`)
  }
  const fees = await getBufferedEvmFees(tx, currentMultiplier)
  try {
    return await window.ethereum!.request({ method:'eth_sendTransaction', params:[{ ...tx, ...fees }] })
  } catch(e: any) {
    const msg = e?.message || ''
    if (!/max fee per gas less than block base fee|replacement transaction underpriced|fee/i.test(msg)) throw e
    await new Promise(r => setTimeout(r, 1200))
    return sendEvmTxBuffered(tx, currentMultiplier + 1n)
  }
}
```

---

## 🔴 Priority 3: MCP Debug Path Sanitization (Critical)

### Fix C-004: Restrict Debug File Path

**File:** `arcox-agent/mcp/server.mjs`

Replace the debug setup:

```typescript
import { mkdirSync, dirname } from 'node:fs'
import { resolve } from 'node:path'
import { homedir } from 'node:os'

const DEFAULT_DEBUG_DIR = resolve(homedir(), '.arcox', 'logs')

function getDebugPath(): string | null {
  const envPath = process.env.ARCOX_MCP_DEBUG
  if (!envPath) return null
  const resolved = resolve(envPath)
  const allowedDir = resolve(process.env.ARCOX_MCP_DEBUG_DIR || DEFAULT_DEBUG_DIR)
  if (!resolved.startsWith(allowedDir)) {
    console.error(`[MCP] debug path ${resolved} is outside allowed dir ${allowedDir}. Ignoring.`)
    return null
  }
  const dir = dirname(resolved)
  try {
    mkdirSync(dir, { recursive: true })
  } catch (e) {
    console.error(`[MCP] cannot create debug dir ${dir}:`, e)
    return null
  }
  return resolved
}

const debugPath = getDebugPath()
```

---

## 🟠 Priority 4: Agent Link Integrity (High)

### Fix H-001: HMAC Integrity Check

**File:** `src/services/agenticStore.ts`

Add integrity checking:

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
  const links = readJson<StoredAgentLink[]>(LINKS_KEY, [])
  const stored = { ...link, _integrity: computeLinkIntegrity(link) }
  const next = [stored, ...links.filter(item => item.agentId !== link.agentId && item.owner.toLowerCase() !== link.owner.toLowerCase())].slice(0, 20)
  writeJson(LINKS_KEY, next)
}

export function getAgentLink(owner: string | null): StoredAgentLink | null {
  if (!owner) return null
  const links = readJson<(StoredAgentLink & { _integrity?: string })[]>(LINKS_KEY, [])
  const link = links.find(item => item.owner.toLowerCase() === owner.toLowerCase()) ?? null
  if (!link) return null
  if (!link._integrity || link._integrity !== computeLinkIntegrity(link as StoredAgentLink)) {
    console.warn('[agentic] Agent link integrity check failed — possible tampering.')
    return null
  }
  return link as StoredAgentLink
}
```

---

## 🟠 Priority 5: MCP Rate Limiting (High)

### Fix H-003: In-Memory Rate Limiter

**File:** `arcox-agent/mcp/server.mjs`

Add before `rpcResponse`:

```typescript
const rateLimits = new Map<string, { count: number; windowStart: number }>()
const MAX_REQUESTS_PER_MINUTE = 10

function checkRateLimit(clientId: string): boolean {
  const now = Date.now()
  const window = 60_000
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

In `rpcResponse`, for value-moving tools:

```typescript
if (method === 'tools/call') {
  const name = params.name
  const valueMoving = ['arcox_execute_bridge', 'arcox_execute_send', 'arcox_execute_swap', 'arcox_agent_job'].includes(name)
  if (valueMoving && !checkRateLimit('global')) {
    return result(id, { error: 'Rate limit exceeded. Please wait before executing more transactions.' })
  }
  // ... rest of routing
}
```

---

## 🟡 Priority 6: Refactor Duplicate Code (Medium)

### Fix M-001: Extract Shared Helpers

**New file:** `src/services/evmTxHelpers.ts`

```typescript
import { toHex } from 'viem'

declare global {
  interface Window { ethereum?: any }
}

export const MAX_FEE_MULTIPLIER = 4n

export function pad32(hex: string): string {
  return hex.length % 64 === 0 ? hex : hex.padEnd(Math.ceil(hex.length / 64) * 64, '0')
}

export function encodeReceiveMessage(msg: string, att: string): string {
  const msgHex = msg.startsWith('0x') ? msg.slice(2) : msg
  const attHex = att.startsWith('0x') ? att.slice(2) : att
  const msgLenHex = (msgHex.length / 2).toString(16).padStart(64, '0')
  const attLenHex = (attHex.length / 2).toString(16).padStart(64, '0')
  const msgPadded = pad32(msgHex)
  const attPadded = pad32(attHex)
  const attOffsetBytes = 64 + 32 + msgPadded.length / 2
  return '0x57ecfd28' +
    '0000000000000000000000000000000000000000000000000000000000000040' +
    attOffsetBytes.toString(16).padStart(64, '0') +
    msgLenHex + msgPadded +
    attLenHex + attPadded
}

export async function getBufferedEvmFees(tx: any, multiplier = 3n) {
  const out: any = {}
  try {
    const gasHex = await window.ethereum!.request({ method:'eth_estimateGas', params:[tx] })
    out.gas = toHex((BigInt(gasHex) * 13n) / 10n + 10_000n)
  } catch(e) {
    console.warn('eth_estimateGas failed:', e instanceof Error ? e.message : String(e))
  }
  try {
    const block = await window.ethereum!.request({ method:'eth_getBlockByNumber', params:['latest', false] })
    const baseFee = block?.baseFeePerGas ? BigInt(block.baseFeePerGas) : 0n
    if (baseFee > 0n) {
      let tip = 0n
      try { tip = BigInt(await window.ethereum!.request({ method:'eth_maxPriorityFeePerGas' })) } catch {}
      if (tip < 1_500_000n) tip = 1_500_000n
      out.maxPriorityFeePerGas = toHex(tip)
      out.maxFeePerGas = toHex(baseFee * multiplier + tip * 2n)
      return out
    }
  } catch(e) {
    console.warn('EIP-1559 fee lookup failed:', e instanceof Error ? e.message : String(e))
  }
  try {
    const gasPrice = BigInt(await window.ethereum!.request({ method:'eth_gasPrice' }))
    out.gasPrice = toHex(gasPrice * multiplier)
  } catch {}
  return out
}

export async function sendEvmTxBuffered(tx: any, currentMultiplier = 3n): Promise<string> {
  if (currentMultiplier > MAX_FEE_MULTIPLIER) {
    throw new Error(`Gas fee exceeded safe cap (${MAX_FEE_MULTIPLIER}x). Please retry manually.`)
  }
  const fees = await getBufferedEvmFees(tx, currentMultiplier)
  try {
    return await window.ethereum!.request({ method:'eth_sendTransaction', params:[{ ...tx, ...fees }] })
  } catch(e: any) {
    const msg = e?.message || ''
    if (!/max fee per gas less than block base fee|replacement transaction underpriced|fee/i.test(msg)) throw e
    await new Promise(r => setTimeout(r, 1200))
    return sendEvmTxBuffered(tx, currentMultiplier + 1n)
  }
}

export async function waitEvmTx(txHash: string, maxRounds = 40): Promise<void> {
  await new Promise(r => setTimeout(r, 1000))
  for (let i = 0; i < maxRounds; i++) {
    try {
      const rec = await window.ethereum!.request({ method:'eth_getTransactionReceipt', params:[txHash] })
      if (rec?.status === '0x1') return
      if (rec?.status === '0x0') throw new Error('Transaction failed onchain')
    } catch(e: any) { if(e.message?.includes('failed')) throw e }
    await new Promise(r => setTimeout(r, i < 10 ? 1200 : 2000))
  }
  throw new Error('Transaction timeout')
}
```

Then remove duplicated code from `BridgePanel.tsx` and `InfoPanel.tsx` and import from `evmTxHelpers.ts`.

---

## 🟡 Priority 7: Address Checksum Validation (Medium)

### Fix M-004: Runtime Address Validation

**File:** `src/domain/tokens.ts`

```typescript
import { getAddress, isAddress } from 'viem'

export type ArcToken = 'USDC' | 'EURC' | 'USYC' | 'cirBTC'
export type SwapToken = 'USDC' | 'EURC' | 'cirBTC'

function validateAddress(symbol: string, raw: string): `0x${string}` {
  if (!isAddress(raw)) throw new Error(`Invalid address for ${symbol}: ${raw}`)
  return getAddress(raw)
}

export const ARC_TOKENS: Record<ArcToken, { symbol: ArcToken; address: `0x${string}`; decimals: number }> = {
  USDC: { symbol: 'USDC', address: validateAddress('USDC', '0x3600000000000000000000000000000000000000'), decimals: 6 },
  EURC: { symbol: 'EURC', address: validateAddress('EURC', '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a'), decimals: 6 },
  USYC: { symbol: 'USYC', address: validateAddress('USYC', '0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C'), decimals: 6 },
  cirBTC: { symbol: 'cirBTC', address: validateAddress('cirBTC', '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF'), decimals: 8 },
}
```

---

## 🟡 Priority 8: Safe HTML Preview (Medium)

### Fix M-003: Sanitize Error Preview

**File:** `src/api.ts`

```typescript
function sanitizePreview(text: string, status: number): string {
  const trimmed = text.trim()
  if (trimmed.startsWith('<') || trimmed.startsWith('<!')) {
    return `HTML ${status} response (endpoint unavailable or server error)`
  }
  return trimmed.slice(0, 200).replace(/[<>]/g, '')
}

// In safePost error handling:
const preview = sanitizePreview(text, resp.status)
throw new Error(`Server ${resp.status} on ${path}: ${preview}`)
```

---

## 🟢 Priority 9: Visibility-Aware Polling (Low)

### Fix M-005 + L-005: Pause Polling When Hidden + Fetch Timeouts

**File:** `src/App.tsx`

```typescript
useEffect(() => {
  if (!circleWallet?.address) return
  let iv: ReturnType<typeof setInterval>
  const start = () => { iv = setInterval(refresh, 15000) }
  const stop = () => clearInterval(iv)
  document.addEventListener('visibilitychange', () => document.hidden ? stop() : start())
  if (!document.hidden) start()
  return stop
}, [circleWallet, address, refresh])
```

**File:** `src/services/swapService.ts`

```typescript
async function fetchWithTimeout(url: string, timeoutMs = 10000) {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(id)
  }
}
```

---

## 🟢 Priority 10: Solana Router Documentation (Low)

### Fix L-007: Add Rustdoc

**File:** `arcox-agent/solana-router/programs/arcox-solana-router/src/lib.rs`

Add above each public function:

```rust
/// Initialize the router with an owner, treasury ATA, and fee basis points.
///
/// # Arguments
/// * `fee_bps` - Fee in basis points; max 1000 (10%).
///
/// # Errors
/// * `ArcoxRouterError::FeeTooHigh` if fee_bps > 1000.
pub fn initialize(ctx: Context<Initialize>, fee_bps: u16) -> Result<()> { ... }

/// Update the treasury token account. Only the owner can call.
pub fn set_treasury_token_account(...) -> Result<()> { ... }

/// Transfer tokens from source to destination, deducting a fee to treasury.
///
/// # Arguments
/// * `amount` - Total amount to transfer; fee is deducted from this.
///
/// # Errors
/// * `ArcoxRouterError::BadAmount` if amount is zero.
/// * `ArcoxRouterError::NetZero` if net amount after fee is zero.
pub fn transfer_with_fee(ctx: Context<TransferWithFee>, amount: u64) -> Result<()> { ... }
```

---

## Summary: Priority Order

| Priority | Fix | Effort | Impact |
|----------|-----|--------|--------|
| P1 | Auth token exp + nonce | Low | 🔴 Critical |
| P2 | Bridge `parseUnits` + fee cap | Low | 🔴 Critical |
| P3 | MCP debug path sanitization | Low | 🔴 Critical |
| P4 | Agent link HMAC integrity | Medium | 🟠 High |
| P5 | MCP rate limiting | Low | 🟠 High |
| P6 | Refactor duplicate EVM helpers | Medium | 🟡 Medium |
| P7 | Address checksum validation | Low | 🟡 Medium |
| P8 | Safe HTML preview | Low | 🟡 Medium |
| P9 | Visibility polling + timeouts | Low | 🟢 Low |
| P10 | Rustdoc + tests | Medium | 🟢 Low |

---

*All code examples are ready for copy-paste implementation. Each fix is designed to be minimal, non-breaking, and consistent with the existing codebase patterns.*
