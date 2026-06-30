# ARCOX DEX

Retail testnet DEX for Arc Network using Circle App Kit, CCTP v2, MetaMask, and Solana Devnet wallets.

Live app: https://arc-dex-bice.vercel.app/

## Local Development

Frontend:

```bash
cd /home/ubuntu/arc-dex
npm install
npm run dev
```

Repo ini bukan monorepo frontend/backend. Source frontend ada langsung di `src/`, jadi tidak ada langkah `cd frontend`.

## App Pages

The UI is page-based:

- `/` intro/dashboard
- `/portfolio`
- `/swap`
- `/bridge`
- `/send`
- `/receive`
- `/unified-balance`
- `/agent-jobs`
- `/info`
- `/docs`
- `/pay?invoice=...`
- `/pay/status`

Backend:

```bash
cd /home/ubuntu/arc-dex-api
npm install
node --env-file=.env server.mjs
```

The Vite dev server proxies `/api/*` to `http://localhost:3001`.

## ARCOX Codex Agent

The local agent is separated from the frontend in:

```text
/home/ubuntu/arc-dex/arcox-agent
```

Run the local-first CLI agent:

```bash
cd /home/ubuntu/arc-dex/arcox-agent
cp .env.example .env
npm run codex-agent -- identity
npm run codex-agent -- connect
npm run codex-agent -- "send 1 USDC to 0x0000000000000000000000000000000000000001"
```

Start the local UI endpoint:

```bash
npm run codex-agent -- serve --port 8787
```

Then link `http://127.0.0.1:8787/agent` in `Agent Jobs -> AI Link`.

Full guide: `arcox-agent/docs/codex-cli-agent.md`.

## Vercel Frontend

The frontend can run on Vercel. `vercel.json` builds with `VITE_BASE_PATH=/` and rewrites `/api/*` to the current backend:

```txt
https://43.163.98.128.nip.io/api/*
```

Deploy steps:

```bash
cd /home/ubuntu/arc-dex
vercel
```

If the backend moves, update `vercel.json` rewrite destination.

ARCOX Pay webhook endpoints are Vercel serverless functions and should remain on the production frontend domain:

```txt
https://arc-dex-bice.vercel.app/api/circle/webhook
```

Webhook env:

```bash
ARCOX_PAY_BASE_URL=https://arc-dex-bice.vercel.app
ARCOX_DEFAULT_PAY_CURRENCY=usdcbase
ARCOX_DEFAULT_PRICE_CURRENCY=usd
ARCOX_ARC_TREASURY_ADDRESS=
ARCOX_BASE_TREASURY_ADDRESS=

CIRCLE_API_KEY=
CIRCLE_BASE_URL=https://api-sandbox.circle.com
CIRCLE_ENV=TEST
CIRCLE_WEBHOOK_SECRET=
CIRCLE_X402_TREASURY_WALLET_ID=
CIRCLE_X402_TREASURY_ADDRESS=
CIRCLE_X402_NETWORK=arc-testnet
X402_MODE=arc_real_testnet
X402_CHAIN_ID=5042002
X402_USDC_ADDRESS=0x3600000000000000000000000000000000000000
X402_RECIPIENT_ADDRESS=
X402_BASE_AMOUNT=0.005
X402_PAYMENT_TTL_SECONDS=300
```

ARCOX x402 uses internal invoices, exact Arc Testnet USDC amounts, and Arc Transaction Memo reconciliation. Open `/pay/status` to create an invoice, view the exact unique USDC amount, and poll paid status. There is no NowPayments flow and no manual txHash fallback.

## AI Router

Open `/ai-router` or the “AI Router” menu.

Flow:

```text
Connect wallet -> Deposit USDC to Unified Balance -> Auto Pay ON -> Create API Key -> Mint API Pass -> Use AI Router
```

AI Router pays each AI request from the user’s Unified Balance through Auto Pay. It does not ask users for provider API keys and does not use NowPayments or sandbox payments.

ARCOX API keys are not bearer credentials. Each new key is bound to a locked API Pass SBT on Arc Testnet. Hermes/OpenClaw should use the local `arcox-agent serve` proxy, which signs one short-lived session challenge with the owner or authorized session signer.

Auto Pay authorization is tracked per funded source chain. Cross-chain x402 and AI Router spends estimate Gateway fees first and spend enough for the recipient to receive the exact service amount.

Agent Identity is auto-detected from Arc Testnet ERC-8004. AI Router remains available without an identity; Agent Jobs require one. New API keys bind to the selected identity and owner wallet when available. See [docs/agent-identity.md](docs/agent-identity.md).

OpenAI-compatible client config:

```text
base_url = http://127.0.0.1:8787/v1
api_key = arx_sk_...
model = arcox/auto
```

Runtime check:

- Header app menampilkan `API online/offline`.
- Jika halaman terlihat kosong, cek asset JS di DevTools Network. Vercel harus serve `/assets/*.js` sebagai `application/javascript`, bukan fallback `index.html`.
- Jika API offline, swap/bridge/send tidak akan berjalan walaupun frontend berhasil load.

## Security Notes

- Circle Wallet actions require MetaMask signature authentication.
- Auth tokens are sent as `Authorization: Bearer <token>`.
- `/api/send`, `/api/swap`, `/api/quote`, `/api/wallet`, `/api/prepare-bridge`, and `/api/send-estimate` reject requests without a valid wallet token.
- Server-signed mint endpoints are disabled unless `ENABLE_SERVER_SIGNED_MINT=true`.
- Set a dedicated backend `AUTH_SECRET` before production.
- Keep Circle secrets and private keys only in backend env vars, never in Vercel frontend env.

Recommended backend env:

```bash
AUTH_SECRET=<random-32-byte-secret>
ALLOWED_ORIGINS=https://your-vercel-domain.vercel.app,https://43.163.98.128.nip.io
CIRCLE_API_KEY=...
CIRCLE_ENTITY_SECRET=...
KIT_KEY=...
SOLANA_DEVNET_RPC=https://api.devnet.solana.com
ENABLE_SERVER_SIGNED_MINT=false
```

## Build

VPS subpath build:

```bash
npm run build
```

Vercel/root build:

```bash
VITE_BASE_PATH=/ npm run build
```
