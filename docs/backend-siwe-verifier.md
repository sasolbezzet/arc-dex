# Backend SIWE Verifier Specification

**Audience:** Backend maintainers for the ARCOX DEX `/api/auth/session` endpoint.  
**Status:** Reference implementation for the migration from legacy `personal_sign` to EIP-4361 Sign-In with Ethereum (SIWE).

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
  "message": "arc-dex-bice.vercel.app wants you to sign in with your Ethereum account:\n0x...\n..."
}
```

### Response

```http
200 OK
Content-Type: application/json
```

```typescript
{
  "token": "<JWT>",
  "address": "0x..."
}
```

### Error responses

| HTTP status | `code` / `error` | Meaning |
|-------------|------------------|---------|
| `400` | `INVALID_SIGNATURE` | Signature does not verify against the message. |
| `400` | `MESSAGE_EXPIRED` | `expirationTime` is in the past. |
| `400` | `INVALID_NONCE` | Nonce is missing, too short, or already used. |
| `400` | `DOMAIN_MISMATCH` | `domain` in the message does not match allowed domain. |
| `400` | `ADDRESS_MISMATCH` | `address` in body does not match recovered signer. |
| `400` | `UNSUPPORTED_AUTH_MODE` / `SIWE_NOT_SUPPORTED` | Frontend asked for SIWE but backend only supports legacy. Triggers frontend fallback. |
| `401` | `UNAUTHORIZED` | Generic authentication failure. |
| `501` | `SIWE_NOT_SUPPORTED` | Explicit signal that the backend does not implement SIWE yet. |

> ⚠️ **Important for fallback:** If the backend has not been migrated, it **must** return either `501` or a `400` with `code: "SIWE_NOT_SUPPORTED"`. The frontend will then retry with legacy mode. Any other `400` is treated as a real failure and is not retried.

---

## 2. Legacy mode (unchanged)

When `mode === "legacy"`, reconstruct the existing five-line message and verify the signature exactly as before:

```text
ARCOX DEX login
Only sign this message on the official ARCOX DEX website.
Address: <address>
Issued At: <issuedAt>
Network: Arc Testnet
```

Continue to validate the `nonce` and `expiresAt` fields if the backend already supports replay/expiration checks.

---

## 3. SIWE mode verification steps

When `mode === "siwe"`, the backend receives the pre-built SIWE message string. Verify it with the `siwe` package.

### 3.1 Example Node.js/Express implementation

```typescript
import { SiweMessage, SiweErrorType } from 'siwe'
import { getAddress } from 'viem'

const ALLOWED_DOMAINS = [
  'arc-dex-bice.vercel.app',
  'localhost',
  // add preview domains as needed
]

app.post('/api/auth/session', async (req, res) => {
  const { address, mode, message, signature, nonce } = req.body

  if (mode === 'legacy') {
    // existing legacy verifier
    return verifyLegacy(req, res)
  }

  if (!message || !signature) {
    return res.status(400).json({
      code: 'INVALID_SIGNATURE',
      error: 'Missing SIWE message or signature',
    })
  }

  try {
    const siwe = new SiweMessage(message)

    // 1. Validate domain binding
    if (!ALLOWED_DOMAINS.includes(siwe.domain)) {
      return res.status(400).json({
        code: 'DOMAIN_MISMATCH',
        error: `Domain ${siwe.domain} is not allowed`,
      })
    }

    // 2. Verify signature and parse claims
    const { data: fields, success } = await siwe.verify({
      signature,
      nonce,
      // Optional: enforce domain/URI strictly
    })

    if (!success) {
      return res.status(400).json({
        code: 'INVALID_SIGNATURE',
        error: 'SIWE signature verification failed',
      })
    }

    // 3. Check expiration
    if (fields.expirationTime && new Date(fields.expirationTime) < new Date()) {
      return res.status(400).json({
        code: 'MESSAGE_EXPIRED',
        error: 'SIWE message expired',
      })
    }

    // 4. Check chain ID (Arc Testnet = 5156522, 0x4cef52)
    if (fields.chainId !== 5156522) {
      return res.status(400).json({
        code: 'CHAIN_ID_MISMATCH',
        error: `Expected chainId 5156522, got ${fields.chainId}`,
      })
    }

    // 5. Check nonce uniqueness (pseudo-code)
    if (await isNonceUsed(fields.nonce)) {
      return res.status(400).json({
        code: 'INVALID_NONCE',
        error: 'SIWE nonce already used',
      })
    }
    await markNonceUsed(fields.nonce)

    // 6. Ensure the signing address matches the supplied address
    const recovered = getAddress(fields.address)
    const expected = getAddress(address)
    if (recovered !== expected) {
      return res.status(400).json({
        code: 'ADDRESS_MISMATCH',
        error: 'SIWE signer does not match provided address',
      })
    }

    // 7. Issue JWT
    const token = issueJwt(recovered)
    return res.json({ token, address: recovered })
  } catch (err) {
    console.error('SIWE verification error:', err)
    return res.status(400).json({
      code: 'INVALID_SIGNATURE',
      error: 'SIWE verification failed',
    })
  }
})
```

### 3.2 Minimum checks summary

| Check | Why it matters |
|-------|----------------|
| Domain allowlist | Prevents a SIWE message signed for a phishing site from being reused on the legitimate backend. |
| Signature verification | `siwe.verify()` recovers the signer and parses the message. |
| Expiration | SIWE messages should be short-lived (frontend uses 5 minutes). |
| Chain ID | Binds the login to Arc Testnet. |
| Nonce uniqueness | Prevents replay of the same signature. Store used nonces in Redis/DB with TTL ≥ expiration time. |
| Address match | Confirms the provided `address` body parameter is honest. |

---

## 4. Frontend behaviour during migration

The frontend (`src/auth.ts`) does the following by default:

1. Checks whether the browser environment variable `VITE_SIWE_ENABLED` is `true`.
2. If SIWE is enabled, builds an EIP-4361 message and sends `mode: "siwe"`.
3. If the backend responds with `501` or `code: "SIWE_NOT_SUPPORTED"`, the frontend caches that the backend does not support SIWE and retries with `mode: "legacy"`.
4. If SIWE is disabled (default), it always uses legacy mode.

### Deployment checklist

- [ ] Backend implements SIWE verification as described above.
- [ ] Backend returns `501` or `SIWE_NOT_SUPPORTED` while still in legacy-only mode.
- [ ] Deploy frontend with `VITE_SIWE_ENABLED=false` to verify legacy still works.
- [ ] After backend is confirmed to support SIWE, set `VITE_SIWE_ENABLED=true` in Vercel project settings.
- [ ] Remove `legacy` branch once no clients need it.

---

## 5. Security notes

- **Do not trust the `address` body alone.** Always recover the signer from the signature.
- **Nonces must be stored server-side.** A simple in-memory `Set` is not enough across serverless cold starts; use Redis/PostgreSQL.
- **Domain allowlist must include every frontend domain** including preview deployments, or those previews will fail SIWE verification.
- **Keep JWT secrets out of the frontend.** The frontend only stores the issued JWT; signing/verification secrets live in the backend.
