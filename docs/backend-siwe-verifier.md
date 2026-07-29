# Backend SIWE Verifier

**Audience:** Backend maintainers for the ARCOX DEX `/api/auth/session` endpoint.  
**Status:** Implemented in `arc-dex-api/server.mjs`.

---

## 1. Endpoint contract

### Request

```http
POST /api/auth/session
Content-Type: application/json
```

```typescript
{
  "address": "0x...",
  "issuedAt": "2026-07-27T12:00:00.000Z",
  "expiresAt": "2026-07-27T12:05:00.000Z",
  "nonce": "<32-hex-chars>",
  "signature": "0x...",
  "mode": "siwe" | "legacy",
  // present only when mode === "siwe"
  "message": "arcoxdex.vercel.app wants you to sign in with your Ethereum account:\n0x...\n..."
}
```

### Response

```http
200 OK
Content-Type: application/json
```

```typescript
{
  "success": true,
  "token": "<HMAC-signed-token>",
  "address": "0x..."
}
```

### Error responses

All SIWE and legacy failures currently return `400 Bad Request` with `{ error: "<message>" }`. Possible messages include:

| Error | Meaning |
|-------|---------|
| `SIWE message required` | Missing `message` when `mode === "siwe"`. |
| `Signature required` | Missing `signature`. |
| `SIWE address mismatch` | Recovered signer does not match the supplied `address`. |
| `Invalid SIWE domain` | `domain` is not in `SIWE_ALLOWED_DOMAINS`. |
| `Invalid SIWE URI` | `uri` is not a valid URL. |
| `Invalid SIWE origin` | `uri` origin is not in `ALLOWED_ORIGINS`. |
| `Invalid SIWE statement` | The statement does not match the expected ARCOX statement. |
| `Invalid chain ID` | `chainId` is not `5042002` (Arc Testnet). |
| `SIWE nonce has already been used` | Replay attempt detected. |
| `SIWE issued-at timestamp expired` | `issuedAt` is outside `LOGIN_WINDOW_MS`. |
| `SIWE message expired` | `expirationTime` is in the past. |
| `SIWE signature verification failed` | Signature did not verify against the message. |

> ⚠️ **Fallback note:** The frontend (`src/auth.ts`) currently has SIWE disabled by default (`VITE_SIWE_ENABLED=false`). When SIWE is enabled and the backend explicitly returns `501` or `{ code: "SIWE_NOT_SUPPORTED" }`, the frontend falls back to legacy mode. The current backend always accepts both modes, so it will not trigger the fallback.

---

## 2. Legacy mode (unchanged)

When `mode` is not `"siwe"`, the backend reconstructs the existing five-line message and verifies the signature exactly as before:

```text
ARCOX DEX login
Only sign this message on the official ARCOX DEX website.
Address: <address>
Issued At: <issuedAt>
Network: Arc Testnet
```

The `issuedAt` timestamp must be within `LOGIN_WINDOW_MS` (5 minutes by default).

---

## 3. SIWE mode verification

When `mode === "siwe"`, the backend parses and validates the pre-built EIP-4361 message using the `siwe` package.

### 3.1 Checks performed

| Check | Implementation |
|-------|----------------|
| Address binding | Compare recovered signer with the supplied `address`. |
| Domain allowlist | `siwe.domain` must be in `SIWE_ALLOWED_DOMAINS`. Ports are stripped before comparison. |
| Origin binding | `siwe.uri` origin must be in `ALLOWED_ORIGINS`. Paths are ignored. |
| Statement binding | `siwe.statement` must equal `Only sign this message on the official ARCOX DEX website.`. |
| Chain ID | `siwe.chainId` must be `5042002` (Arc Testnet). |
| Nonce uniqueness | Nonce is tracked in an in-memory `Map` for 24 hours. It is marked as used **before** signature verification to prevent replay attempts. |
| Issued-at window | `siwe.issuedAt` must be within `LOGIN_WINDOW_MS`. |
| Expiration | If `siwe.expirationTime` is present, it must be in the future. |
| Signature | `await siwe.validate(signature)` from the `siwe` package. |

### 3.2 Configuration

Set via environment variables:

```bash
# Comma-separated list of allowed SIWE domains (host only, no protocol)
SIWE_ALLOWED_DOMAINS=localhost,localhost:5173,localhost:4173,arcoxdex.vercel.app,43.163.98.128.nip.io

# Origins are reused from the existing CORS allowlist.
# Paths are stripped automatically, so the following are equivalent:
ALLOWED_ORIGINS=https://arcoxdex.vercel.app,https://43.163.98.128.nip.io,http://localhost:5173
```

### 3.3 In-memory nonce store

The current implementation uses an in-memory `Map` (`usedNonces`) with a 24-hour TTL. A periodic cleanup runs every hour.

```javascript
const usedNonces = new Map()
const NONCE_TTL_MS = 24 * 60 * 60 * 1000
```

**Limitations:**
- Not suitable for multi-node deployments; use Redis or a persistent cache instead.
- In a single-node process, a restart clears all recorded nonces.
- There is a small race window for concurrent requests with the same nonce.

---

## 4. Deployment checklist

- [ ] Install dependencies: `npm install siwe ethers` (already added to `arc-dex-api`).
- [ ] Ensure `SIWE_ALLOWED_DOMAINS` covers every frontend domain, including preview deployments.
- [ ] Ensure `ALLOWED_ORIGINS` covers every frontend origin.
- [ ] Set `AUTH_SECRET` and review `AUTH_TTL_MS` / `LOGIN_WINDOW_MS` values.
- [ ] Deploy the backend.
- [ ] Verify legacy mode still works with `VITE_SIWE_ENABLED=false`.
- [ ] Enable SIWE in the frontend by setting `VITE_SIWE_ENABLED=true` in Vercel.
- [ ] (Optional) Move the nonce store to Redis for horizontal scaling.
- [ ] (Optional) Refactor error responses to return `401` for authentication failures and `400` for malformed requests.

---

## 5. Security notes

- **Do not trust the `address` body alone.** Always recover the signer from the signature.
- **Domain and origin binding are both enforced.** The `domain` field and the `uri` origin must match the configured allowlists.
- **Nonces are marked as used before signature verification.** This prevents attackers from retrying the same nonce even if the signature is invalid.
- **Statement binding prevents generic SIWE reuse.** The exact ARCOX statement must be present in the message.
- **JWT secrets stay in the backend.** The frontend only stores the issued HMAC-signed token.
