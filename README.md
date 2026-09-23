# ARCOX DEX

Retail DEX + AI-agent wallet frontend for Arc Network, using Circle App Kit,
CCTP v2, WalletConnect/MetaMask, Solana Devnet, and passkey-backed Agent
Wallets (MSCA).

**Live app: https://arcoxdex.vercel.app**

Frontend is the only Vercel project. It is a Vite SPA; the backend
(`arc-dex-api`) runs outside Vercel and is reached through the rewrites in
`vercel.json`.

```text
Frontend         : https://arcoxdex.vercel.app
Public MCP       : https://arcoxdex.vercel.app/mcp
API via frontend : https://arcoxdex.vercel.app/api/*
OpenAI-compat API: https://arcoxdex.vercel.app/v1
Backend upstream : https://43.134.14.43.nip.io   (internal, behind Vercel rewrites)
```

## Local development

```bash
cd /home/ubuntu/arc-dex
npm install
npm run dev          # Vite dev server, /api/* diproksi ke http://localhost:3001
```

Backend (repo terpisah):

```bash
cd /home/ubuntu/arc-dex-api
npm install
node --env-file=.env server.mjs
```

Repo ini bukan monorepo frontend/backend: source frontend ada di `src/`
langsung, backend di repo `arc-dex-api`.

## Pages

```text
/                 intro/dashboard
/portfolio        saldo per chain
/swap             swap
/bridge           CCTP bridge
/send             kirim
/receive          request pembayaran
/unified-balance  Circle Gateway unified balance
/ai-router        ARCOX AI Router (OpenAI-compatible)
/plugin           Agent Wallet + konektor MCP (menu Plugin)
/agent-jobs       ERC-8004 / ERC-8183 agent jobs
/intel            ARCOX Intel (x402 berbayar)
/cards            agent cards
/connect          merchant/payment connect
/pay, /pay/status public USDC invoice + x402 status
/info, /docs      info & dokumentasi in-app
```

## Menu Plugin (Agent Wallet + MCP)

Halaman `/plugin` adalah pintu masuk semua agent (Hermes, Grok, Claude,
ChatGPT, Codex). Tiga alur yang harus dibedakan dengan jelas:

| Alur | Trigger | Proof yang dibutuhkan |
|---|---|---|
| **Buat Wallet Baru** | kartu agent → `Buat Wallet Baru` | SIWE (owner) + passkey baru; deploy/otorisasi di Arc + Base Sepolia + Arbitrum Sepolia |
| **Relogin (setelah Cabut Akses)** | kartu agent → `Relogin` | passkey saja; delegate dirotasi, binding lama dipakai lagi |
| **Login Passkey (setelah Hapus/Clear)** | kartu agent → `Login Passkey` | passkey + SIWE; binding dibuat ulang |

Aturan teknis yang berlaku sekarang:

- Satu agent = satu `clientId` = satu Agent Wallet (MSCA) + limit harian,
  scope audit, dan state revoke sendiri.
- Nama passkey selalu menyertakan agent dan nomor unik, mis.
  `Agent Wallet Grok #01`, `Agent Wallet Hermes #01`, sehingga beberapa wallet
  pada agent yang sama tidak tertukar saat memilih di dialog passkey.
- Clear/Hapus menghapus kartu agent (kedua namespace baris Hermes sekaligus);
  Revoke hanya menonaktifkan akses tanpa menghapus wallet.
- Agent non-Hermes biasanya terhubung dari sisi agent (OAuth ke
  `https://arcoxdex.vercel.app/mcp`), sehingga halaman approval di `/plugin`
  harus diselesaikan dengan passkey sampai redirect balik ke agent.

Policy proof per alur terpusat di `src/services/sessionProofPolicy.ts`
(dipakai `agentSession.ts`), sehingga perubahan aturan tidak tersebar.

Sesi dashboard juga disimpan per agent di `arx_oauth_vault_token:<clientId>`.
Sesi ini berumur 24 jam dan bisa kedaluwarsa lebih dulu daripada sesi global,
sehingga aksi kartu (Relogin/Revoke/Clear) mencoba kandidat token berikutnya
setelah `401`/`403`, lalu membuang token yang ditolak (`forgetVaultToken`) dan
menulis ulang slot agent saat Relogin berhasil. Aturan itu ada di
`src/services/agentTokenSelection.ts` — tanpa keduanya, kartu akan terus
menjawab "Sesi berakhir. Masuk kembali dengan passkey." walaupun passkey baru
saja dipakai login.

Jika agent mengaku "terhubung" tetapi tidak menemukan tool ARCOX, jalankan
diagnosa dari repo backend:

```bash
cd /home/ubuntu/arc-dex-api
npm run diag:mcp -- --agent grok
```

## ARCOX Agent

Agent lokal adalah repo & paket npm terpisah:

```text
/home/ubuntu/arcox-agent
https://github.com/sasolbezzet/arcox-agent
```

```bash
npm install -g arcox-agent
arcox-agent setup
ARCOX_MCP_URL=https://arcoxdex.vercel.app/mcp arcox-agent connect --prompt-token
arcox-agent doctor
```

Token koneksi dibuat dari kartu agent di halaman Plugin. Untuk Grok, Claude,
dan ChatGPT, agent memakai OAuth remote MCP ke `/mcp` (bukan token tempel).
Detail: https://github.com/sasolbezzet/arcox-agent#readme

## Authentication

- SIWE (EIP-4361) aktif untuk koneksi owner pertama; sesi owner yang sudah
  terverifikasi dipakai ulang oleh alur Plugin (tidak perlu tanda tangan
  berulang). Matikan/hidupkan lewat `VITE_SIWE_ENABLED`.
- Agent Wallet memakai passkey (WebAuthn) sebagai signer; private key tidak
  pernah dikirim ke browser atau backend.
- Token koneksi/MCP disimpan backend sebagai bearer dengan masa berlaku 24 jam
  (refresh 30 hari) dan bisa dicabut per agent.
- Spesifikasi verifier SIWE backend: `docs/backend-siwe-verifier.md`.

## Circle webhooks

Daftarkan URL backend ini di Circle Console (verifikasi signature ada di
backend, bukan di Vercel):

```text
https://43.134.14.43.nip.io/api/webhooks/circle
https://43.134.14.43.nip.io/api/webhooks/circle-wallet
```

Env terkait:

```bash
ARCOX_PAY_BASE_URL=https://arcoxdex.vercel.app
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

## x402 / ARCOX Pay

ARCOX x402 memakai invoice internal, amount USDC Arc Testnet yang unik, dan
reconciliation lewat Arc Transaction Memo. Buka `/pay/status` untuk membuat
invoice dan memantau status.

- Backend memakai `rpc.testnet.arc.network` (RPC publik sinkron) sebagai
  fallback; jangan pakai node tertinggal.
- `eth_getLogs` di-chunk 2.000–8.000 block agar aman terhadap batas RPC.
- Invoice `expired` tetap di-reconcile bila ada bukti on-chain.
- `IntelPanel` memakai retry dengan `paymentId` setelah status `paid`.

## AI Router

```text
Connect wallet -> Deposit USDC ke Unified Balance -> Auto Pay ON -> Create API Key -> Pakai AI Router
```

```text
base_url = https://arcoxdex.vercel.app/v1
api_key  = arx_sk_...
model    = arcox/auto
```

Auto Pay dilacak per chain sumber dana. Agent Identity dideteksi otomatis dari
Arc Testnet ERC-8004 (`docs/agent-identity.md`).

## Tests & checks

```bash
npm run typecheck    # tsc --noEmit
npm test             # typecheck + vitest (unit/regresi frontend)
npm run build        # vite build
```

Vitest mengunci perilaku kritis: `agentSession`, `sessionProofPolicy`,
`modularWallet` (nama passkey per agent), `agentReadiness`, `mscaPolicy`,
`walletConnect`, dan isolasi state antar agent.

## Deploy

```bash
cd /home/ubuntu/arc-dex
vercel --prod
```

`vercel.json` membangun dengan `VITE_BASE_PATH=/`, menjalankan `npm test`
sebelum build, dan me-rewrite `/api/*`, `/v1/*`, `/mcp`,
`/.well-known/*`, dan `/health` ke backend. Jika backend pindah, ubah
destinasi rewrite — URL publik MCP tetap `https://arcoxdex.vercel.app/mcp`.

Security notes:

- Aksi Circle Wallet butuh autentikasi tanda tangan MetaMask.
- Token dikirim sebagai `Authorization: Bearer <token>`.
- Endpoint mint server-signed nonaktif kecuali `ENABLE_SERVER_SIGNED_MINT=true`.
- Simpan secret Circle/backend hanya di env backend, jangan di Vercel frontend.

## Mainnet

Status & prasyarat Arc mainnet (kontrak yang sudah ada, passkey LIVE,
Gas Station policy, dual network key) ada di
[`docs/mainnet-readiness.md`](docs/mainnet-readiness.md).

## Referensi internal

- `docs/repo-structure.md` — peta repo.
- `docs/agent-identity.md` — ERC-8004 di Arc.
- `docs/mainnet-readiness.md` — checklist mainnet.
- `MAINTENANCE.md` — operasional harian.
- `audit/` — laporan audit historis (host backend di dalamnya sudah tidak
  berlaku; lihat catatan di `audit/README.md`).
