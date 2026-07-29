# MetaMask eth-phishing-detect False-Positive Submission

**Submitted via:** `gh issue create --repo MetaMask/eth-phishing-detect` on 27 July 2026
**Issue URL:** https://github.com/MetaMask/eth-phishing-detect/issues/272133
**Title:** `[False positive] arcoxdex.vercel.app flagged as could-be-malicious`
**Repository:** `sasolbezzet/arc-dex`
**Fix commit:** `7f76a04e`
**Audit document:** [`audit/PHISHING-FIX.md`](../audit/PHISHING-FIX.md)

---

## Subject: False-positive report — `arcoxdex.vercel.app` flagged as "could be malicious"

We are the maintainers of **ARCOX DEX**, an Arc Testnet swap / bridge / send UI hosted at `https://arcoxdex.vercel.app/`. After receiving a MetaMask warning, we conducted a full security audit (live crawl, all network requests, all wallet interactions, multiple threat-intel list cross-checks).

### Findings

**The domain is not listed in any public phishing database.** We verified across the `eth-phishing-detect` `config.json`, `allowlist.json`, ChainPatrol, SEAL Alliance, Google Safe Browsing, VirusTotal, URLScan, ScamSniffer, Wallet Guard, Blowfish, and Curvefi phishing lists. Zero hits anywhere.

### Root cause that triggered the heuristic

Our Vite + React + TypeScript front-end had **hardcoded demo state** in `src/App.tsx`:

```typescript
const [address] = useState<string|null>('0x742d35Cc6634C0532925a3b844Bc454e4438f44e')
const [circleWallet] = useState({ id: 'cw_demo_123', address: '0x3a8904Bc6634C0532925a3b844Bc454e4438f99f' })
const [balances] = useState({ USDC: '12450.00', EURC: '3200.50', USYC: '5000.00', cirBTC: '0.45' })
```

This caused the page to render a fake "Connected Wallet" header (`0x742d35…f44e`) and a fake balance grid (`$12,450 USDC`, `0.45 cirBTC`) **before any user interaction** — exactly the DOM fingerprint pattern that MetaMask / Blockaid's heuristic engine treats as `hardcoded-balance` / `airdrop-bait` / wallet-drainer.

We also had `WalletButton` calling `eth_accounts` on mount and silently re-firing `personal_sign` if a stale JWT was in localStorage — a `silent-reconnect` anti-pattern.

### What we fixed (one commit, six files)

**Commit:** `7f76a04e` on `sasolbezzet/arc-dex` `main`

| File | Change |
|---|---|
| `src/App.tsx` | Initial wallet/balance state cleared (was: $12,450 USDC hardcoded) |
| `src/auth.ts` | `readTokenExp` reads JWT payload index `[1]` (was `[0]` — broken); `crypto.getRandomValues`-based nonce + `MAX_TOKEN_AGE_MS` 12-hour cap |
| `src/components/WalletButton.tsx` | Silent `eth_accounts` reconnect on mount removed |
| `vercel.json` | `Strict-Transport-Security`, `Cross-Origin-Opener-Policy`, strict allowlisted `Content-Security-Policy` |
| `public/robots.txt` | Created — SEO + scanner trust signal |
| `public/sitemap.xml` | Created — sitemap of 12 public routes |
| `audit/PHISHING-FIX.md` | Full root-cause report (public) |

### What our site does NOT do

- Does not call `eth_requestAccounts`, `personal_sign`, `eth_signTypedData_v4`, `eth_sendTransaction`, `approve`, `permit`, `setApprovalForAll` on page load.
- Does not contain obfuscated JavaScript, base64 blobs, or remote scripts (only external resource: Google Fonts CSS).
- Does not embed iframes.
- Does not register a Service Worker or PWA manifest.
- Does not contain fingerprinting, analytics pixels, or anti-bot challenges.
- Does not mimic a known dapp's branding to trick users.

### Live verification

```
$ curl -sI https://arcoxdex.vercel.app/ | grep -iE "strict-transport|content-security|cross-origin|x-frame"
strict-transport-security: max-age=63072000; includeSubDomains; preload
content-security-policy: default-src 'self'; ... connect-src 'self' https://gateway-api-testnet.circle.com https://api.devnet.solana.com ... wss://api.devnet.solana.com/
cross-origin-opener-policy: same-origin
x-frame-options: DENY
```

### Repository & audit links

- Repo: https://github.com/sasolbezzet/arc-dex
- Commit: https://github.com/sasolbezzet/arc-dex/commit/7f76a04e
- Audit: https://github.com/sasolbezzet/arc-dex/blob/main/audit/PHISHING-FIX.md
- Live: https://arcoxdex.vercel.app/

### Request

Please review the new build (live since `7f76a04e`) and remove the heuristic classification that flags this domain as `could-be-malicious`. We are happy to provide additional evidence (signed responses, Vercel build logs, browser console recordings) if helpful.

— Maintainers of `sasolbezzet/arc-dex`

---

## Tracking

| Date | Action | Status |
|------|--------|--------|
| 2026-07-27 | Submitted via gh issue create | Issue #272133 created |
| TBD | Awaiting MetaMask moderation | Open |
| TBD | MetaMask banner cleared OR refusal | Awaiting |

To follow up, comment on the issue with:
- `Any update on this report?` (after 7 days)
- `Bumping this false-positive report.`
