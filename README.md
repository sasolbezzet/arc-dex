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
