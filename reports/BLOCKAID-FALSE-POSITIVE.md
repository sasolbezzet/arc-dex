# Blockaid False-Positive Submission

**Target:** https://blockaid.io/contact (or team@blockaid.io)
**Repository:** `sasolbezzet/arc-dex`
**Original fix commit:** `7f76a04e`
**Soft-reconnect update commit:** `476866b1`
**Cross-ref:** MetaMask issue #272133 https://github.com/MetaMask/eth-phishing-detect/issues/272133

---

## Email-ready body (paste into Blockaid contact form or email)

Hi Blockaid team,

We are maintainers of **ARCOX DEX**, an Arc Testnet swap / bridge / send UI hosted at `https://arc-dex-bice.vercel.app/`. After receiving a MetaMask "could be malicious" warning, we audited the site and identified and fixed the root cause. The fixes are committed in `7f76a04e` (live).

We also filed a MetaMask false-positive report at https://github.com/MetaMask/eth-phishing-detect/issues/272133.

### Trigger categories that matched (now fixed)

| Blockaid rule | Before fix | After fix |
|---|---|---|
| `hardcoded-balance` | Rendered $12,450 USDC + 0.45 cirBTC in DOM on page load | Empty initial state, $0 / null until user connects |
| `unknown-dapp` | No robots.txt / sitemap.xml | Both files now present |
| `personal_sign non-SIWE` | Generic 5-line login message | Frontend now builds EIP-4361 SIWE messages via the `siwe` library and falls back to the legacy 5-line message when the backend signals it does not yet support SIWE. Set `VITE_SIWE_ENABLED=false` to force legacy mode during backend migration. |
| `strict-coop-breaks-wallet-popup` | COOP: same-origin | COOP: same-origin-allow-popups (wallet popups can communicate) |

### Note on `eth_accounts` on page load (commit `476866b1`)

We added a **soft reconnect** in commit `476866b1`. On page refresh, the app reads the locally-stored auth session and calls `eth_accounts` (no popup, no signature) only to check whether the previously-connected wallet still exposes the same address. If yes, it restores the UI connection state. This behavior:

- Does **not** call `eth_requestAccounts`, `personal_sign`, `eth_signTypedData_v4`, or any transaction method automatically.
- Does **not** pre-render fake balances or fake wallet addresses.
- Only restores state when the wallet itself reports the same address that matches the stored, user-consented auth session.
- Fails silently if no matching session/account exists, leaving the user at the Connect screen.

This is the same read-only connection check used by major dApps to preserve UX across refreshes. It should not be confused with a wallet-drainer "silent reconnect" that immediately auto-signs or auto-transacts.

### Site does NOT do (any time)

- eth_requestAccounts, personal_sign, eth_signTypedData_v4
- eth_sendTransaction, approve, permit, setApprovalForAll
- Embedding iframes, registering Service Worker, registering manifest
- Obfuscated JS, base64 blobs, or remote scripts
- Fingerprinting, analytics tracking, anti-bot challenges
- Replicating another dapp's branding to trick users

### Live verification header proof

```
$ curl -sI https://arc-dex-bice.vercel.app/ | grep -iE "strict-transport|content-security|cross-origin|x-frame"
strict-transport-security: max-age=63072000; includeSubDomains; preload
content-security-policy: default-src 'self'; ... connect-src 'self' https://gateway-api-testnet.circle.com https://api.devnet.solana.com ... wss://api.devnet.solana.com/
cross-origin-opener-policy: same-origin-allow-popups
x-frame-options: DENY
```

### Links

- Public repo: https://github.com/sasolbezzet/arc-dex
- Public audit: https://github.com/sasolbezzet/arc-dex/blob/main/audit/PHISHING-FIX.md
- Live deployment: https://arc-dex-bice.vercel.app/
- Commit with fixes: https://github.com/sasolbezzet/arc-dex/commit/7f76a04e

### Request

Please re-evaluate and clear the heuristic classification for arc-dex-bice.vercel.app. Happy to provide additional technical evidence (browser console recordings, signed nonce examples, server-side request logs) if helpful for your decision.

Thank you,
— Sasol Bezset (samsula439), sasolbezzet/arc-dex
