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

## ARCOX Agent

The local agent is a separate repository and npm package:

```text
/home/ubuntu/arcox-agent
https://github.com/sasolbezzet/arcox-agent
```

Install and configure the local-first agent:

```bash
npm install -g arcox-agent
arcox-agent setup
nano ~/.arcox/agent.env
arcox-agent sync
arcox-agent doctor
```

`arcox-agent` automatically installs `arcox-mcp`, so end users do not need a
separate global `arcox-mcp` install for the normal Hermes/Codex flow.

For Hermes, `setup` and `sync` wire the local `arcox` MCP entry automatically.
If you also want the installer to write the ARCOX model provider into Hermes,
run:

```bash
arcox-agent sync --with-provider
```

For Codex, add a manual MCP entry that runs:

```json
{
  "mcpServers": {
    "arcox": {
      "command": "arcox-agent",
      "args": ["mcp"]
    }
  }
}
```

Signer and Hermes credentials belong only in `~/.arcox/agent.env`. They must
not be copied into this frontend repository or the dApp backend environment.

Full guide: https://github.com/sasolbezzet/arcox-agent#readme

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
Connect wallet -> Deposit USDC to Unified Balance -> Auto Pay ON -> Create API Key -> Use AI Router
```

AI Router pays each AI request from the user’s Unified Balance through Auto Pay. It does not ask users for provider API keys and does not use NowPayments or sandbox payments.

ARCOX AI Router uses standard bearer API keys. Keys are shown once, stored only as hashes, and can be revoked from the connected wallet.

Auto Pay authorization is tracked per funded source chain. Cross-chain x402 and AI Router spends estimate Gateway fees first and spend enough for the recipient to receive the exact service amount.

Agent Identity is auto-detected from Arc Testnet ERC-8004. AI Router remains available without an identity; Agent Jobs require one. New API keys bind to the selected identity and owner wallet when available. See [docs/agent-identity.md](docs/agent-identity.md).

OpenAI-compatible client config:

```text
base_url = https://arc-dex-bice.vercel.app/v1
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
