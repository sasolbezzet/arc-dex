# Blockaid False-Positive Submission

**Target:** https://blockaid.io/contact (or team@blockaid.io)
**Repository:** `sasolbezzet/arc-dex`
**Fix commit:** `7f76a04e`
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
| `silent-reconnect` | eth_accounts called on mount | Removed; user presses Connect |
| `unknown-dapp` | No robots.txt / sitemap.xml | Both files now present |
| `personal_sign non-SIWE` | Generic 5-line login message | crypto.getRandomValues nonce; backend enforcement pending |

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
cross-origin-opener-policy: same-origin
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
