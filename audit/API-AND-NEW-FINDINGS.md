# ARC DEX — API, MCP & Contracts Audit (Delta Report)

**Project:** ARCOX DEX Web UI, API, and MCP Agent
**Auditor:** Codebuff AI Audit (follow-up)
**Date:** June 14, 2026
**Scope:** `api/`, `arcox-agent/mcp/`, `arcox-agent/bin/`, `arcox-agent/contracts/`, `arcox-agent/scripts/`, `src/api.ts`
**Prior audit:** `audit/CRITICAL.md … audit/RECOMMENDATIONS.md` (June 4, 2026) — still valid; this report covers what changed and what was missed.
**Status:** 🟠 **NEW HIGH-SEVERITY FINDINGS** — `api/` was not previously audited; several production-blocking issues exist.

> **Remediation status of the prior audit (June 4, 2026):** C-001, C-002, C-003, H-001, H-002, M-001, M-004, M-005, L-001, L-002, L-003, L-004, L-005, L-006, L-007, L-008 are **all still present** in the current `src/`. The ready-to-paste fixes in `audit/RECOMMENDATIONS.md` have not been merged. This delta does not re-prioritize the prior list; section 7 combines old + new in a single sorted list.

---

## 0. Relationship to Prior Audit

The June 4 audit covered `src/`, `arcox-agent/`, `arcox-agent/solana-router/`. **The `api/` directory was not audited.** This delta report:

1. Audits the previously uncovered `api/` directory end-to-end.
2. Reviews the **rewritten** `arcox-agent/mcp/server.mjs` (it now has preview/quotes, rate limiting, spend caps, dry-run, daily buckets — much of the H-003 risk from the previous report is mitigated, but new issues appear).
3. Reviews the **two Solidity contracts** (`ArcoxRouter.sol`, `ArcoxNativeSwapBridgeRouter.sol`) that were not in the previous audit.
4. Reviews **deployment scripts** (`deploy-router.mjs`, `deploy-solana-router.mjs`, `deploy-native-swap-bridge-router.mjs`, `enable-router-domain.mjs`, `compile-router.mjs`) and the agent profile.
5. Cross-references and confirms/extends findings still applicable to the **current** `src/api.ts` (the prior M-003 has been **fixed**, but a related issue exists).

---

## 1. Executive Summary

| Severity | Count (new) | Exploitable? | Primary Domain |
|----------|-------------|--------------|----------------|
| 🔴 Critical | 3 | Yes | API |
| 🟠 High | 4 | Yes | API + MCP |
| 🟡 Medium | 7 | Partial | API + Contracts + Agent |
| 🟢 Low | 6 | Hardening | API + Contracts + Scripts |

The `api/` directory is the weakest part of the stack. Payment state lives in a process-local `Map` (works in dev, breaks on Vercel serverless), there is **no authentication** on any user-facing payment endpoint, and webhooks cannot actually verify Circle signatures (the verifyWebhook=true branch returns 401 unconditionally). Anyone with the URL can call `/api/payments/nowpayments/create` and trigger a real NOWPayments invoice in production mode.

The MCP server rewrite is a major improvement over the version that was in the prior audit (no rate limiting, no previews, no spend caps). All three of those controls now exist. The remaining MCP risks are mostly about **memory hygiene** (in-memory maps grow unboundedly) and **configuration bypass** (env vars that disable the very limits they implement).

The two Solidity contracts are small, well-scoped, and properly initialized. The biggest contract-level concern is that `rescueToken` / `rescueNative` are owner-unbounded (single point of failure on owner key).

---

## 2. 🔴 Critical Findings

### C-API-1: In-Memory Payment Store Will Lose All Data in Production

**File:** `api/_arcox-pay-store.mjs`
**Lines:** 1–10
**CVSS Estimate:** 8.6 (High) — production data loss + duplicate billing exposure

```javascript
// TODO: replace this sandbox in-memory ledger with persistent PostgreSQL/Redis storage before production use.
const state = globalThis.__arcoxPaySandboxState || {
  payments: new Map(),
  webhookEvents: new Map(),
  mcpSessions: new Map(),
}
```

**Root cause.** `payments`, `webhookEvents`, and `mcpSessions` are stored in a `Map` inside `globalThis`. On Vercel serverless functions this is **per-instance, ephemeral**. The moment a cold start happens on a different instance, every prior payment disappears.

**Exploit / impact vector.**

1. User creates a NOWPayments payment at T0. The payment is stored on instance A.
2. NOWPayments fires the `finished` webhook. The request lands on instance B (cold start).
3. `getPayment(paymentId)` returns `null`. `applyNowpaymentsEvent` records the webhook but never matches it to a payment (`findPaymentByProviderOrOrder` walks an empty `Map`).
4. The user has paid NOWPayments, the ARCOX merchant dashboard shows nothing, and the user has no `order_id` they can use to recover.
5. Even if the user retries the create endpoint, a *new* payment is issued and the previous one is silently orphaned on NOWPayments.
6. Webhook idempotency is also broken: `seenNotifications` (Circle) and `webhookEvents` (NOWPayments) Maps are empty on cold-start, so the same notification is reprocessed (e.g. toggling a payment from `waiting` → `finished` → `waiting` on every retry).

**Fix.**

1. Replace the Map with a real database (Postgres, KV, or Vercel KV). The TODOs at the top of the file are accurate.
2. Add an index on `order_id` and `provider_payment_id` so `findPaymentByProviderOrOrder` is O(1) instead of O(n).
3. Persist the `seenNotifications` set for Circle webhooks (or use the upstream `notificationId` and a unique index).
4. Until this is fixed, `isSandboxMode()` must be the only allowed mode in production deploys.

---

### C-API-2: No Authentication on User-Facing Payment Endpoints

**Files:**
- `api/payments/nowpayments/create.js`
- `api/payments/nowpayments/[paymentId]/status.js`
- `api/payments/nowpayments/recent.js`
- `api/payments/nowpayments/health.js`
**CVSS Estimate:** 8.2 (High)

**Root cause.** None of these endpoints inspect `Authorization`, session cookies, or any other auth token. The `safePost` in the *frontend* adds a token, but the API **does not** require or validate it.

```javascript
// create.js
export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
  const body = parseJsonSafe(await readRawBody(req))
  const amount = Number(body.amount || body.price_amount)
  ...
}
```

**Exploit vector.**

1. Attacker runs `curl -X POST https://arc-dex-bice.vercel.app/api/payments/nowpayments/create -d '{"amount":1000,"order_id":"ARCOX-attacker"}'`.
2. In production mode (`NOWPAYMENTS_MODE=production`, `NOWPAYMENTS_API_KEY=set`), the function calls the real NOWPayments `/payment` endpoint and **creates a real invoice for $1000 of USDC**. The merchant (ARCOX) gets billed, and the attacker now has a real `pay_address` to launder or resell.
3. The same attack works on `recent.js` (list all payment IDs and metadata) and `status.js` (poll any `paymentId` to discover recipient addresses, `base_treasury_address`, internal routing, etc.).
4. The new `arcox_pay_*` MCP tools inherit this: an agent calling `arcox_pay_create_nowpayments_sandbox_payment` will hit the same endpoint.

**Fix.**

1. Require `Authorization: Bearer <jwt>` (the same one the frontend uses via `safePost`) on all `/api/payments/*` and `/api/webhooks/*` GET endpoints.
2. Webhooks (`/api/webhooks/*`) verify HMAC signatures instead — see H-API-2 for the Circle issue, and the existing IPN check in `nowpayments.js` is a good baseline but needs to be **enforced by default** (`NOWPAYMENTS_VERIFY_IPN=true`).
3. Move the public `health.js` behind the same auth (or expose only `{ ok: true }` publicly and gate the rest).
4. Bind payment creation to the authenticated `user_id` and `merchant_id`; reject mismatches.

---

### C-API-3: Circle Webhook Signature Check Is Unimplemented and Fail-Closed, Blocking All Real Traffic

**File:** `api/webhooks/circle.js`
**Lines:** 25–35
**CVSS Estimate:** 7.5 (High) — production outage + unverifiable inbound events

```javascript
const verifyWebhook = String(process.env.CIRCLE_VERIFY_WEBHOOK || 'false').toLowerCase() === 'true'
if (verifyWebhook) {
  const signature = getHeader(req, 'circle-signature') || getHeader(req, 'x-circle-signature')
  // TODO: implement Circle Gateway webhook signature verification when Circle publishes the exact header/signing scheme for this subscription.
  // Keep disabled-by-default testing mode working; when enabled, fail closed until verification is wired.
  if (!signature) {
    return sendJson(res, 401, { ok: false, provider: PROVIDER, product: PRODUCT, error: 'Circle webhook signature required' })
  }
  return sendJson(res, 401, { ok: false, provider: PROVIDER, product: PRODUCT, error: 'Circle webhook signature verification is not configured yet' })
}
```

**Root cause.** When the env flag is on, the code **always** returns 401. When the env flag is off, **anybody** can POST any payload. There is no in-between.

**Exploit / impact vector.**

1. In production, the operator must choose: leave `CIRCLE_VERIFY_WEBHOOK=false` (accepts unsigned events — **C-API-2** is amplified) or set it to `true` (drops every real Circle event — payment state never advances).
2. An attacker who learns the URL (e.g. from public docs `docs/arcox-pay-nowpayments-sandbox.md`) can POST forged `gateway.mint.finalized` events, triggering downstream business logic in any future code that consumes the webhookEvents Map. Right now the inner `if/else if` blocks are mostly TODOs, so the immediate damage is small — but the moment any of those TODOs is filled with state-changing code, this becomes a critical state-corruption vector.

**Fix.**

1. Circle's documented gateway/subscription webhook signing scheme is `HMAC-SHA256(rawBody, secret)` with a `circle-signature` header that contains the hex digest and an optional `circle-timestamp` for replay protection. If the subscription the operator created uses this scheme, the verification code is:

   ```javascript
   const sig = getHeader(req, 'circle-signature')
   const ts = getHeader(req, 'circle-timestamp')
   const secret = process.env.CIRCLE_WEBHOOK_SECRET
   if (!sig || !secret) return sendJson(res, 401, ...)
   const expected = hmacHex('sha256', secret, `${ts}.${rawBody}`)
   if (!safeEqualHex(expected, sig)) return sendJson(res, 401, ...)
   if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return sendJson(res, 401, ...)
   ```

2. If the scheme is genuinely unknown (the existing TODO claims so), do not leave a 401-only branch in production code. Either (a) implement the scheme above, or (b) gate the endpoint behind a shared `CIRCLE_WEBHOOK_TOKEN` constant-time check (`safeEqualHex` helper already exists) and validate `notificationId` shape.
3. Add a unit test that the wrong signature produces 401 and the right one produces 200.

---

## 3. 🟠 High-Severity Findings

### H-API-1: In-Memory `seenNotifications` Set Does Not Survive Cold Starts

**File:** `api/webhooks/circle.js`
**Lines:** 9–11
**CVSS Estimate:** 6.8 (Medium-High)

```javascript
const seenNotifications = globalThis.__arcoxCircleWebhookSeenNotifications || new Set()
globalThis.__arcoxCircleWebhookSeenNotifications = seenNotifications
```

**Root cause.** Same root cause as C-API-1. The `Set` lives on `globalThis` and dies with the Lambda instance. On Vercel, functions are recycled frequently, so duplicate notifications can be processed many times.

**Exploit / impact vector.** When the `if (eventType === 'transactions.inbound')` / `'gateway.mint.finalized'` / etc. handlers are wired up, replayed webhooks will re-run business logic — e.g. duplicate mint reconciliation, double-credit a user balance, or repeatedly send merchant notifications.

**Fix.** Persist notification IDs in Postgres with a unique constraint (`ON CONFLICT DO NOTHING`), or use Vercel KV / Upstash Redis with `SET NX` and a 7-day TTL.

---

### H-API-2: NOWPayments Webhook Logs the Raw Body

**File:** `api/webhooks/nowpayments.js`
**Line:** 19
**CVSS Estimate:** 6.5 (Medium)

```javascript
const rawBody = await readRawBody(req)
console.log('[webhook:nowpayments] raw payload', rawBody)
```

**Root cause.** The raw payment body — which contains `pay_address`, `pay_amount`, `order_id`, `outcome_amount`, and in some cases user-supplied notes — is written to Vercel's stdout, which is shipped to the log aggregator (Datadog, Logflare, etc.) and retained for the platform's standard period (often 30+ days). Logs are typically accessible to a much wider audience than production data.

**Exploit / impact vector.**

1. Anyone with log read access (often a larger group than database read access) can dump every `pay_address` and `order_id`.
2. If `outcome_amount` includes user-identifying references (it doesn't today, but the field is unfiltered), future log changes become a PII leak.
3. The same problem exists in `api/webhooks/circle.js` line 23.

**Fix.** Drop the `console.log` of the raw body, or replace with a structured summary (`{ paymentId, status, orderId, length }`) that omits the entire `raw_payload_json` field.

---

### H-API-3: NOWPayments HMAC Verification May Not Match Upstream's Algorithm

**File:** `api/webhooks/nowpayments.js`
**Lines:** 21–28
**CVSS Estimate:** 6.1 (Medium)

```javascript
if (verifyIpn) {
  const secret = process.env.NOWPAYMENTS_IPN_SECRET || ''
  const signature = getHeader(req, 'x-nowpayments-sig')
  ...
  const signedPayload = payload?._parseError ? rawBody : stableStringify(payload)
  const expected = hmacHex('sha512', secret, signedPayload)
  if (!safeEqualHex(expected, signature)) {
    return sendJson(res, 401, { ok: false, provider: PROVIDER, error: 'Invalid NOWPayments IPN signature' })
  }
}
```

**Root cause.** NOWPayments signs the **raw HTTP body** bytes as received — the IPN signature is `HMAC-SHA512(rawBody, IPN_SECRET)`, sent in the `x-nowpayments-sig` header. This is documented in NOWPayments' IPN integration guide (https://documenter.getpostman.com/view/7907941/2s93JusNJt) and confirmed by their merchant examples. By using `stableStringify(payload)` after `parseJsonSafe`, the recomputed bytes will differ from the original body in three ways: key ordering, whitespace, and unicode normalization. This will cause **legitimate webhooks to fail verification** if `NOWPAYMENTS_VERIFY_IPN=true` is ever enabled.

**Exploit / impact vector.** Either:
1. Operators enable `NOWPAYMENTS_VERIFY_IPN=true` and all NOWPayments webhooks start returning 401 → payments never finalize.
2. Operators leave it `false` indefinitely to keep the flow working → no signature check at all (compounds with C-API-2).

**Fix.**

1. Use the `rawBody` directly: `hmacHex('sha512', secret, rawBody)`. Do not re-parse and re-serialize.
2. Only fall back to `stableStringify` if the upstream is documented to send a canonical form (it isn't, for NOWPayments).
3. Add a fixture-based test that a real captured body verifies correctly.

---

### H-MCP-1: MCP In-Memory Maps Grow Unboundedly (Memory Leak / DoS)

**File:** `arcox-agent/mcp/server.mjs`
**Lines:** 387–397 (approximate, after the rewrite)
**CVSS Estimate:** 5.9 (Medium)

```javascript
const rateLimitBuckets = new Map()
const previewApprovals = new Map()
const dailySpendBuckets = new Map()
```

**Root cause.** None of these Maps is ever garbage-collected. Entries are written on every request, but there is no periodic sweep. In a long-lived MCP process (the server is run via `npm run mcp` and stays up), this is a slow but certain memory leak.

- `rateLimitBuckets` — entries are pruned only when the same key hits again (`bucket.filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS)`). If an agent starts and never comes back, its bucket sits there forever. Worse, the key is the literal string `'local-mcp-client'` for everything (line ~ in `rpcResponse`), so this is effectively a single global bucket with a sliding window. Fine for memory; **concerning for fairness** (one agent can lock out all others by hitting the limit).
- `previewApprovals` — `expiresAt` is checked on read, but expired entries are only deleted on read. A preview that is never used again stays in the Map until the process restarts. With a 10-minute TTL, 1 preview per minute = ~1440 entries/day = small, but adversarial clients can create millions.
- `dailySpendBuckets` — keyed by `local-mcp-client:YYYY-MM-DD`. Old days accumulate forever. With 1 entry per day, this is negligible; with 1 entry per (client × day), the same concern applies.

**Exploit / impact vector.** A hostile agent that calls `arcox_quote_bridge` (or any other `attachPreview`) in a tight loop without ever calling `arcox_execute_*` will grow `previewApprovals` until OOM. `setInterval` cleanup is straightforward and effective.

**Fix.**

```javascript
setInterval(() => {
  const now = Date.now()
  let deleted = 0
  for (const [id, p] of previewApprovals) {
    if (p.expiresAt < now) { previewApprovals.delete(id); if (++deleted > 100) break }
  }
  const today = new Date().toISOString().slice(0, 10)
  deleted = 0
  for (const [k] of dailySpendBuckets) { if (!k.endsWith(today)) { dailySpendBuckets.delete(k); if (++deleted > 100) break } }
  deleted = 0
  for (const [k, v] of rateLimitBuckets) { if (v.every(ts => now - ts >= RATE_LIMIT_WINDOW_MS)) { rateLimitBuckets.delete(k); if (++deleted > 100) break } }
}, 60_000)
```

Additionally, replace the single `'local-mcp-client'` rate-limit key with a per-client identifier (a session token from the MCP `initialize` call, or the process PID of the connecting client).

---

### H-MCP-2: MCP Spend-Limit Bypass via `MAX_TX_USDC=0` or Non-Finite Amount

**File:** `arcox-agent/mcp/server.mjs`
**Function:** `enforceSpendLimits`
**CVSS Estimate:** 6.5 (Medium)

```javascript
function enforceSpendLimits(name, args) {
  if (!isValueMovingCall(name, args)) return
  const amount = spendAmountFor(name, args)
  if (!Number.isFinite(amount) || amount <= 0) return
  if (name === 'arcox_execute_bridge' && isNativeBridgeToken(args.token)) {
    if (MAX_TX_NATIVE > 0 && amount > MAX_TX_NATIVE) throw new Error(`Native bridge exceeds ARCOX_MAX_TX_NATIVE=${MAX_TX_NATIVE}. Reduce amount or raise local env limit.`)
    return
  }
  if (MAX_TX_USDC > 0 && amount > MAX_TX_USDC) throw new Error(`Transaction exceeds ARCOX_MAX_TX_USDC=${MAX_TX_USDC}. Reduce amount or raise local env limit.`)
  ...
}
```

**Root cause.** Both checks are guarded by `MAX_TX_USDC > 0` and `MAX_TX_NATIVE > 0`. If the operator sets either to `0` (or to a negative number, or to `NaN`), the check is **silently skipped** for all transactions. The daily limit guard has the same `DAILY_LIMIT_USDC > 0` guard.

The agent's behavior is to **throw an error** instructing the user to "raise local env limit", which is reasonable feedback, but a misconfiguration (e.g. an empty `.env` file, a forgotten secret in CI) is a much easier footgun than an explicit bypass.

**Fix.** Treat the absence of a positive cap as a hard fail-closed condition:

```javascript
if (!(MAX_TX_USDC > 0)) throw new Error('ARCOX_MAX_TX_USDC is not configured to a positive number. Refusing to execute value-moving tool.')
if (amount > MAX_TX_USDC) throw new Error(...)
```

Same for `MAX_TX_NATIVE` and `DAILY_LIMIT_USDC`. This makes "no limit" an explicit, opt-in decision rather than a default.

---

## 4. 🟡 Medium-Severity Findings

### M-API-1: `recent.js` and `health.js` Disclose Internal Configuration

**File:** `api/payments/nowpayments/recent.js`, `api/payments/nowpayments/health.js`
**CVSS Estimate:** 4.3 (Low-Medium)

```javascript
// recent.js
const limit = Number(req.query?.limit || 10)
return sendJson(res, 200, { ok: true, payments: listPayments(limit).map(paymentResponse) })
```

`health.js` returns:

```javascript
return sendJson(res, 200, { ok: true, provider: 'nowpayments', mode: cfg.mode, baseUrl: cfg.baseUrl })
```

**Issues.**

1. `recent.js` has no auth, so **anyone** can dump up to 100 payment records. The `paymentResponse` helper exposes, in plain text, the following sensitive fields:
   - `payout_wallet_address` — the merchant's NOWPayments payout wallet.
   - `arc_treasury_address` — the ARCOX Arc treasury.
   - `base_treasury_address` — the ARCOX Base treasury.
   - `nowpayments_destination_address` / `pay_address` — the live pay address for each payment.
   - `metadata_json.provider_response` — the full upstream response from NOWPayments.
   - `metadata_json.status_history` — the internal state machine transitions.
   This is enough to reconstruct treasury wallets and target them with phishing or with the simulate endpoints (M-API-3).
2. `health.js` returns the `baseUrl` (`api-sandbox.nowpayments.io` vs `api.nowpayments.io`) and the `mode`. This lets an attacker confirm the operator is in sandbox (and is therefore a smaller target) and which exact host the server talks to.

**Fix.** Require auth on both. Have `health.js` return only `{ ok: true }`. Have `recent.js` filter to the authenticated user's `user_id` only.

---

### M-API-2: `create.js` Trusts the Request Body Verbatim

**File:** `api/payments/nowpayments/create.js`
**Lines:** 10–30
**CVSS Estimate:** 4.6 (Medium)

```javascript
const body = parseJsonSafe(await readRawBody(req))
...
const input = {
  ...body,
  amount: String(body.amount || body.price_amount),
  price_currency: String(body.price_currency || cfg.defaultPriceCurrency).toLowerCase(),
  pay_currency: String(body.pay_currency || cfg.defaultPayCurrency).toLowerCase(),
  order_id: body.order_id || `ARCOX-${Date.now()}`,
}
```

**Issues.**

1. The body is **spread into the input** (`...body`). Any extra field the attacker adds (e.g. `payout_wallet_address`, `case`, `fixed_rate`, `fixed_rate_id`) is forwarded to NOWPayments. NOWPayments may honor `fixed_rate` to lock a less favorable rate to the merchant.
2. `case` is a documented NOWPayments sandbox switch for testing edge cases. Forwarding it in production allows an attacker to trigger error paths and DoS the merchant's payment flow.
3. There is no length cap on `description` / `order_description`. A multi-MB string will be POSTed to NOWPayments, blocking the request.

**Fix.** Whitelist the fields that may be forwarded (`amount`, `price_currency`, `pay_currency`, `order_id`, `order_description`, `ipn_callback_url`, `case` if sandbox only). Truncate `description` to 256 chars. Validate `amount` is finite and `< 1_000_000`.

---

### M-API-3: Simulate Endpoints Have No Authentication

**Files:**
- `api/payments/nowpayments/simulate.js`
- `api/payments/nowpayments/simulate/finish.js`
- `api/payments/nowpayments/simulate/user-arc-payment.js`
- `api/payments/nowpayments/simulate/bridge-to-base.js`
- `api/payments/nowpayments/simulate/base-treasury-send.js`
**CVSS Estimate:** 5.3 (Medium)

**Root cause.** All simulate endpoints gate only on `isSandboxMode()` returning true. If the operator forgets to set `NOWPAYMENTS_MODE=production` in prod (a single env-var miss), every attacker on the internet can:
- Force any payment to `finished` → triggers downstream business logic.
- Set arbitrary `arc_tx_hash`, `bridge_tx_hash`, `base_tx_hash` strings.
- Move a payment to `BASE_TREASURY_FUNDED` to skip the user-payment step in the merchant reconciliation UI.

**Fix.**

1. Gate simulate endpoints on `process.env.ARCOX_PAY_DEV_MODE === 'true'` **and** a secret token (`X-Arcox-Dev-Token`). Return 404 if either is missing (404 is preferable to 403 because it doesn't advertise the endpoint exists).
2. Document this clearly in `docs/arcox-pay-nowpayments-sandbox.md` and update the curl examples.

---

### M-API-4: `base-treasury-send.js` Requires a `pay_address` but the `nowpayments_destination_address` Can Be a Sentinel String

**File:** `api/payments/nowpayments/simulate/base-treasury-send.js`
**CVSS Estimate:** 3.9 (Low-Medium)

```javascript
if (!payment.nowpayments_destination_address && !payment.pay_address) {
  return sendJson(res, 400, { ok: false, error: 'NOWPayments pay_address is required before treasury send simulation' })
}
```

And in `_arcox-pay-store.mjs`:

```javascript
sandboxNowpaymentsDestinationAddress: process.env.ARCOX_SANDBOX_NOWPAYMENTS_DESTINATION_ADDRESS || '0xSANDBOX_NOWPAYMENTS_DESTINATION',
```

The default is the literal string `0xSANDBOX_NOWPAYMENTS_DESTINATION`, which is not a real address. If `attachProviderPayment` is called with no `pay_address` from the provider, the payment is silently "funded to" this sentinel, and `base-treasury-send.js` will let the simulation proceed with an invalid address. Downstream consumers of `nowpayments_destination_address` may try to actually pay the sentinel and fail.

**Fix.** Validate that the pay_address is either absent, an EVM address, or a Base58 Solana address. Reject the sentinel default at storage time.

---

### M-Contract-1: `ArcoxNativeSwapBridgeRouter.swapNativeAndBridgeUsdc` Allows Execution At Exact Deadline

**File:** `arcox-agent/contracts/ArcoxNativeSwapBridgeRouter.sol`
**Line:** 137
**CVSS Estimate:** 3.1 (Low)

```solidity
require(deadline >= block.timestamp, "DEADLINE_EXPIRED");
```

**Root cause.** The condition uses `>=`, allowing execution at the exact deadline second. This is one-second-of-sand for MEV bots and front-runners. The convention in DEX routers (Uniswap V2/V3) is `require(deadline > block.timestamp, ...)`.

**Fix.** Change to `>`. Trivial fix.

---

### M-Contract-2: `ArcoxRouter._forceApprove` Pattern Fails on Some Real ERC-20 Tokens (e.g. USDT)

**File:** `arcox-agent/contracts/ArcoxRouter.sol`
**Line:** 149
**CVSS Estimate:** 3.7 (Low)

```solidity
_forceApprove(usdc, tokenMessenger, 0);
_forceApprove(usdc, tokenMessenger, netAmount);
```

**Root cause.** The reset-to-zero-then-set pattern is a known workaround for `USDC`-style tokens (which throw on non-zero-to-non-zero approvals). However, `USDT` and a few other tokens revert on **any** approve after the first non-zero approval (the allowance is locked at the first non-zero value forever). ArcoxRouter only ever handles USDC today, so this is fine — but if `setSupportedToken` is ever called for another token, the assumption breaks.

**Fix.** Either document the USDC-only contract invariant, or use a per-token approval library (OpenZeppelin's `SafeERC20.safeIncreaseAllowance` is the standard answer).

---

### M-Contract-3: `rescueToken` and `rescueNative` Are Owner-Unbounded — Single Point of Failure

**Files:**
- `arcox-agent/contracts/ArcoxRouter.sol` (line 117)
- `arcox-agent/contracts/ArcoxNativeSwapBridgeRouter.sol` (lines 158, 162)
**CVSS Estimate:** 4.6 (Medium)

```solidity
function rescueToken(address token, address to, uint256 amount) external onlyOwner {
    require(to != address(0), "BAD_TO");
    _push(token, to, amount);
}
```

**Root cause.** A single owner key can drain the entire contract. There is no timelock, no multisig requirement, no rate limit.

**Fix.** Add a 24–72 hour timelock (via a `TimeLock` contract) for `rescueToken` / `rescueNative` / `setTreasury` / `transferOwnership`. For the testnet deployment this is acceptable, but the production deployment plan should include multisig owner and timelock.

---

### M-Script-1: `deploy-native-swap-bridge-router.mjs` Falls Back to Hardcoded Addresses When Env Is Missing

**File:** `arcox-agent/scripts/deploy-native-swap-bridge-router.mjs`
**Lines:** 32–47
**CVSS Estimate:** 3.7 (Low)

```javascript
Ethereum_Sepolia: {
  ...
  wrappedNative: firstEnv('ETHEREUM_SEPOLIA_WRAPPED_NATIVE', 'ETHEREUM_SEPOLIA_WETH', 'ETHEREUM_SEPOLIA_WETH9') || '0xfff9976782d46cc05630d1f6ebab18b2324d6b14',
  swapRouter: firstEnv('ETHEREUM_SEPOLIA_UNIVERSAL_ROUTER', 'ETHEREUM_SEPOLIA_UNISWAP_UNIVERSAL_ROUTER', 'ETHEREUM_SEPOLIA_UNISWAP_SWAP_ROUTER') || '0x3a9d48ab9751398bbfa63ad67599bb04e4bdf98b',
```

**Root cause.** If the operator forgets to set the env vars, the script deploys against hardcoded fallback addresses. The `requireContractCode` check at deployment time will catch obviously wrong addresses (no bytecode), but a wrong-but-populated address will deploy successfully. This is a **footgun for testnet/mainnet parity**, not a vulnerability per se.

The same pattern exists in `deploy-router.mjs` (the `TOKEN_MESSENGER` constant on line 15 is also hardcoded — this is the official Circle v2 address and is correct, but a future change of upstream messenger will silently keep using the old one).

**Fix.** Refuse to deploy if the env var is missing for the selected chain. Use a `requireAddress` like the script already does for `wrappedNative` and `swapRouter` on a per-chain basis.

---

### M-Script-2: `enable-router-domain.mjs` Only Supports EVM Chains Hardcoded in the File

**File:** `arcox-agent/scripts/enable-router-domain.mjs`
**CVSS Estimate:** 2.7 (Low)

The `chains` object only covers `Arc_Testnet`, `Ethereum_Sepolia`, `Base_Sepolia`, `Arbitrum_Sepolia`. There is no `HyperEVM_Testnet` and no `Solana_Devnet`. If a new chain is added to `deploy-router.mjs`, this script will silently skip it.

**Fix.** Read the list of chains from `arcox-router.testnet.json` and iterate.

---

## 5. 🟢 Low-Severity Findings & Hardening

| ID | Title | File | Note |
|----|-------|------|------|
| L-API-1 | Raw body bytes may be UTF-16 BOM-sensitive | `api/_webhook-utils.mjs` | `readRawBody` uses `toString('utf8')`. If upstream sends a different encoding, signature verification breaks. Add an explicit charset assertion. |
| L-API-2 | `health.js` doesn't check the actual upstream NOWPayments reachability | `api/payments/nowpayments/health.js` | It only echoes config. A real liveness check should issue a no-op upstream call. |
| L-API-3 | `recent.js` is unordered by default | `api/payments/nowpayments/recent.js` | `listPayments` does sort by `created_at` desc, but `created_at` is an ISO string. Document the sort order. |
| L-MCP-1 | `findAction` word match is naive | `arcox-agent/mcp/server.mjs` (`findAction`) | A prompt like "swap my ETH for fiat" could match `swap` incorrectly. Add a stricter gate. |
| L-MCP-2 | `extractFirstAddress` may pick up wrong 0x… in user input | `arcox-agent/bin/arcox-agent.mjs` | First match wins. Long prompts with example addresses could be mis-extracted. Require confirmation. |
| L-Contract-1 | No event for `setSupportedToken` parameter cleanup | `arcox-agent/contracts/ArcoxRouter.sol` | If the same address is enabled twice, the second event is emitted with the same value. Off-chain indexers may dedupe incorrectly. |

---

## 6. Confirmation of Prior Audit Items

| Prior ID | Title | Status (now) |
|----------|-------|--------------|
| C-001 | Auth token never expires | **Still present** in current `src/auth.ts` (not in scope of this delta; left for the frontend audit). |
| C-002 | Replay attack on auth signature | **Still present.** |
| C-003 | Bridge fee retry multiplier (6n) | **Still present** in `src/components/BridgePanel.tsx`. |
| C-004 | MCP debug path arbitrary write | **Largely fixed** in the new `resolveDebugPath` — it now constrains the path to `~/.arcox/logs` and rejects `..` traversals. The single-file-must-be-inside-allowed-dir invariant is correct. Keep the `homedir()` default; do not weaken it. |
| H-001 | localStorage agent poisoning | **Still present.** |
| H-002 | Bridge precision loss | **Still present.** |
| H-003 | No MCP rate limiting | **Partially fixed** — `enforceRateLimit` exists, but the key is the hardcoded literal `'local-mcp-client'`, so all clients share a single global bucket. See H-MCP-1 for the per-client cleanup and H-MCP-1 leak. |
| M-001 | Duplicate ABI/fee code | **Still present.** |
| M-002 | No try-catch on router JSON | **Fixed** in the rewrite — `routerDeployments` and `nativeSwapBridgeRouterDeployments` both have try/catch. |
| M-003 | HTML leak in error preview | **Fixed** — `src/api.ts` now has `sanitizePreview` and strips `<`/`>`. |
| M-004 | Token address hardcoded without checksum | **Still present** in `src/domain/tokens.ts`. |
| M-005 | Aggressive balance polling | **Still present** in `src/App.tsx`. |
| L-001 | `any` types | **Still present.** |
| L-002 | Un-namespaced CustomEvent | **Still present.** |
| L-003 | `kitKeyCache` never invalidated | **Still present.** |
| L-004 | i18n silent fallback to Indonesian | **Still present.** |
| L-005 | No fetch timeout | **Still present** in `src/services/swapService.ts`. |
| L-006 | Unused `App.css` | **Still present** (dead file). |
| L-007 | Missing Rustdoc on Solana router | **Still present.** |
| L-008 | No unit tests | **Still present.** |

---

## 7. Integrated Priority List (prior + this report, sorted by impact)

| Pri | Fix | File(s) | Source | Severity |
|-----|-----|---------|--------|----------|
| **P1** | Fix `readTokenExp` to read JWT **payload** (index 1), not header (index 0) | `src/auth.ts` | prior C-001 | 🔴 |
| **P2** | Add cryptographically random `nonce` + `expiresAt` to auth message, validate on backend | `src/auth.ts` + backend | prior C-002 | 🔴 |
| **P3** | Cap bridge fee retry multiplier (no more 6n), require explicit user confirmation for any >4n retry | `src/components/BridgePanel.tsx` | prior C-003 | 🔴 |
| **P4** | Replace in-memory payment store with persistent storage (Postgres / Vercel KV / Upstash) | `api/_arcox-pay-store.mjs` | **C-API-1** | 🔴 |
| **P5** | Add auth (Bearer JWT) to all `/api/payments/*` GET endpoints; require merchant binding on create | `api/payments/nowpayments/*.js` | **C-API-2** | 🔴 |
| **P6** | Implement Circle webhook signature verification (HMAC-SHA256 over `ts.body` with 5-min replay window) | `api/webhooks/circle.js` | **C-API-3** | 🔴 |
| **P7** | Use `parseUnits` from viem + cap `parseFloat`/`Math.round` usage in `bridgeEvm` | `src/components/BridgePanel.tsx` | prior H-002 | 🟠 |
| **P8** | Add HMAC integrity check on `localStorage` agent links | `src/services/agenticStore.ts` | prior H-001 | 🟠 |
| **P9** | Sign NOWPayments HMAC over **raw body**, not `stableStringify(payload)` | `api/webhooks/nowpayments.js` | **H-API-3** | 🟠 |
| **P10** | Persist `seenNotifications` to durable storage (or use a unique index in DB) | `api/webhooks/circle.js` | **H-API-1** | 🟠 |
| **P11** | Drop `console.log` of raw webhook bodies (PII + treasury addresses leak) | `api/webhooks/{nowpayments,circle}.js` | **H-API-2** | 🟠 |
| **P12** | Add periodic (chunked) sweep for `previewApprovals`, `dailySpendBuckets`, `rateLimitBuckets` | `arcox-agent/mcp/server.mjs` | **H-MCP-1** | 🟠 |
| **P13** | Fail-closed on missing/zero `MAX_TX_USDC`, `MAX_TX_NATIVE`, `DAILY_LIMIT_USDC` | `arcox-agent/mcp/server.mjs` | **H-MCP-2** | 🟠 |
| **P14** | Whitelist forwarded fields in `create.js`, truncate `description` to 256 chars | `api/payments/nowpayments/create.js` | **M-API-2** | 🟡 |
| **P15** | Auth + 404 the simulate endpoints; require `X-Arcox-Dev-Token` + `ARCOX_PAY_DEV_MODE=true` | `api/payments/nowpayments/simulate*.js` | **M-API-3** | 🟡 |
| **P16** | Change `>=` to `>` in `ArcoxNativeSwapBridgeRouter.swapNativeAndBridgeUsdc` deadline check | `arcox-agent/contracts/ArcoxNativeSwapBridgeRouter.sol` | **M-Contract-1** | 🟡 |
| **P17** | Add timelock + multisig for owner actions on routers (rescue*, setTreasury, transferOwnership) | both Solidity files | **M-Contract-3** | 🟡 |
| **P18** | Refuse deploy in `deploy-native-swap-bridge-router.mjs` when env vars are missing | `arcox-agent/scripts/deploy-native-swap-bridge-router.mjs` | **M-Script-1** | 🟡 |
| **P19** | Extract duplicated EVM fee/ABI helpers into a shared module | `src/components/{Bridge,Info}Panel.tsx` | prior M-001 | 🟡 |
| **P20** | Atomic writes for `TX_HISTORY_FILE` and `AUTO_MINT_DIR` (temp-file + rename); supervise `spawnAutoMintWorker` | `arcox-agent/bin/arcox-agent.mjs` | **M-Agent-1** (new, see §4.1 below) | 🟡 |
| **P21** | Validate `extractFirstAddress` output against checksum; require explicit user confirmation when multiple `0x…` strings are in the prompt | `arcox-agent/bin/arcox-agent.mjs` | **M-Agent-2** (new, see §4.1 below) | 🟡 |
| **P22–P40** | All prior Medium / Low findings (L-001 through L-008, M-002 through M-005) | various | prior | 🟡/🟢 |

---

## 8. What I Did Not Audit in This Pass

- **Frontend React components** (`src/components/*` other than cross-references) — covered in the prior audit.
- **Smart contract formal verification** — none performed. The two contracts are short enough that a manual review is meaningful, but a real audit by a third party (Trail of Bits, Cyfrin, etc.) is recommended before mainnet.
- **Penetration testing** — none performed. The static review identifies the most likely issues; dynamic testing is required to confirm exploitability.
- **Backend at `https://43.163.98.128.nip.io`** — the API is **proxied through Vercel** (`vercel.json` rewrites `/api/:path*` to that host). I could not enumerate the actual Node server code behind that host. If the backend at `43.163.98.128.nip.io` has its own routes that handle `/api/auth/session`, `/api/wallet`, `/api/quote`, `/api/swap`, `/api/send`, `/api/eoa-swap-quote`, `/api/eoa-swap-prepare`, `/api/tx-history`, `/api/balance/:address`, etc., those are **out of scope of this repo and unaudited**.

---

## 9. Disclaimer

This audit is based on static code analysis of the files in this repository. It does not include dynamic testing, formal verification, or independent third-party review. Any code that handles value (smart contracts, bridge routers, payment flows) should be re-audited by an independent third party before mainnet deployment.

*For the full picture, read this report alongside `audit/CRITICAL.md`, `audit/HIGH.md`, `audit/MEDIUM.md`, `audit/LOW.md`, and `audit/RECOMMENDATIONS.md`.*
