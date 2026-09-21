# ARCOX Mainnet Readiness (Arc Mainnet)

Status dokumen: 17 September 2026.
Semua temuan di bawah berasal dari **probe read-only** (JSON-RPC `eth_*`, Circle Modular RPC, Circle Wallets API). Tidak ada transaksi on-chain, tidak ada wallet baru, dan tidak ada perubahan kode saat verifikasi ini.

Dokumen ini adalah catatan prasyarat. Pekerjaan kode dimulai setelah seluruh item di bagian [Prasyarat](#prasyarat) berstatus lengkap.

## Ringkasan

| Aspek | Status |
|---|---|
| Arc Mainnet live (`5042`) | ✅ terverifikasi |
| RPC mainnet | ✅ `https://rpc.mainnet.arc.io` |
| Client Key LIVE_API | ✅ ada dan berfungsi untuk bundler/paymaster/derivasi alamat |
| Slug transport mainnet (`arc`/`base`/`arbitrum`) | ✅ terverifikasi |
| Kontrak Circle di Arc mainnet (USDC, EURC, USYC, Memo, CCTP, Gateway) | ✅ ada |
| ERC-8004 IdentityRegistry mainnet | ✅ `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| Passkey mainnet (`rp_*`) | ❌ diblokir konfigurasi Console |
| Gasless paymaster mainnet | ❌ diblokir konfigurasi Console |
| Kontrak ARCOX sendiri di mainnet | ❌ belum di-deploy |
| API Key mainnet (dev-controlled wallet/webhook) | ✅ aktif |

## Keputusan scope

1. **Arc Mainnet saja dulu.** MSCA mainnet hanya di-deploy di `arc`, bukan tiga chain.
2. **Dual network (env switch).** Data dan binding testnet tidak disentuh; jaringan dipilih lewat env.
3. **Kontrak ARCOX di-deploy ulang** ke mainnet, bukan memakai alamat testnet.

Efek samping positif: karena mainnet hanya Arc, langkah otorisasi Base/Arbitrum yang sering membuat relogin/revoke testnet lambat tidak diperlukan pada mode mainnet.

## Parameter Arc Mainnet

| Parameter | Testnet | Mainnet |
|---|---|---|
| Chain ID | `5042002` (`0x4cef52`) | `5042` (`0x13b2`) |
| RPC publik | `https://rpc.testnet.arc.io` | `https://rpc.mainnet.arc.io` |
| Explorer | `testnet.arcscan.app` | `explorer.arc.io` |
| Transport slug | `arcTestnet` | `arc` |
| Gas token | USDC (18 desimal native) | sama |
| CCTP domain | 26 | 26 |
| USDC ERC-20 | `0x3600…0000` | `0x3600…0000` (sama) |
| Memo | `0x5294E9927c3306DcBaDb03fe70b92e01cCede505` | sama |
| EURC | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` | `0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1` |
| USYC | `0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C` | `0x8a5D989Bbb96929F689B0200f435f53dA42bF490` |

Dogfood: `viem` 2.54.3 yang sudah terpasang sudah menyediakan `arc` (id 5042) dan `arcTestnet`, jadi tidak perlu definisi chain manual.

## Hasil uji Client Key LIVE

Endpoint: `POST https://modular-sdk.circle.com/v1/rpc/w3s/buidl/<slug>`
Header: `Authorization: Bearer <client key>`, `X-AppInfo: platform=web;version=1.0.15;uri=arcoxdex.vercel.app`

| Probe | Key TEST → testnet | Key LIVE → mainnet |
|---|---|---|
| `eth_chainId` `arc` | `0x4cef52` ✅ | `0x13b2` ✅ |
| `eth_chainId` `base` | — | `0x2105` ✅ |
| `eth_chainId` `arbitrum` | — | `0xa4b1` ✅ |
| `eth_supportedEntryPoints` | ✅ EntryPoint v0.7 | ✅ `0x0000000071727de22e5e9d8baf0edac6f37da032` |
| `circle_getUserOperationGasPrice` | ✅ | ✅ nilai low/medium/high + `deployed`/`notDeployed` |
| `circle_getAddress` | ✅ | ✅ `state: "LIVE"`, ownership contract `0x0000000C984AFf541D6cE86Bb697e68ec57873C8` |
| `eth_getBalance` | ✅ | ✅ |
| `pm_getPaymasterStubData` | ✅ paymaster `0x03df76c8c30a88f424cf3cbbc36a1ca02763103b` | ❌ `Default policy is not found.` |
| `rp_getRegistrationOptions` | ✅ `rp.name = arcoxdex.vercel.app` | ❌ `Cannot find the entity config in the system.` |
| `rp_*` pada testnet | ✅ | ❌ ditolak (`LIVE_API` tidak untuk testnet) |

Perbandingan penting: key TEST mentok di mainnet dengan pesan `TEST_API key cannot be used with blockchain mainnets…`, dan key LIVE mentok di testnet dengan pesan sebaliknya. Jadi **satu Client Key tidak bisa dipakai dua network** — dual network wajib menyimpan dua key.

Catatan teknis yang terbukti dari probe:

- **`rp_*` dilayani di base path tanpa slug chain.** Menambahkan slug (`…/buidl/arc`) menghasilkan `Method not found`. Backend ARCOX saat ini sudah memakai base path (benar).
- **`X-AppInfo`'s `uri` terikat ke passkey domain yang terdaftar.** `uri=arcoxdex.vercel.app` diterima; `uri=localhost:5173` ditolak `Invalid credentials`. Kalau domain passkey pindah, tiga hal harus sinkron: Console (passkey domain), `circleModularProxyHeaders()` di backend, dan `VITE_*` frontend.
- **Alamat MSCA bersifat deterministik** dari (public key webauthn + `scaCore`) sehingga bisa dihitung sebelum deploy. Berguna untuk pre-flight check mainnet tanpa transaksi.

## Dua blocker mainnet (keduanya konfigurasi Console)

### 1. Passkey domain untuk environment LIVE

```text
Console → Wallets → Modular Wallets → Passkey
→ daftarkan domain arcoxdex.vercel.app untuk environment LIVE
```

Environment testnet sudah punya entitas ini (`rp.name` terisi), environment LIVE belum — karena itu jawabannya `Cannot find the entity config in the system.`

### 2. Gas policy untuk environment LIVE

```text
Console → Gas Station → buat policy
→ aktifkan Arc Mainnet (tambahkan Base/Arbitrum bila bridge keluar Arc diperlukan)
→ jadikan default policy untuk environment LIVE
```

Docs Circle menegaskan policy adalah gerbang sponsorship, dan Arc Mainnet termasuk jaringan yang didukung. Environment LIVE belum punya policy → `Default policy is not found.`

Verifikasi setelah dua langkah di atas:

```text
rp_getRegistrationOptions (LIVE)  → challenge + rp.name
pm_getPaymasterStubData  (LIVE)   → paymaster + paymasterData
```

## Kontrak di Arc Mainnet (`eth_getCode`)

| Kontrak | Alamat | Mainnet | Testnet |
|---|---|---|---|
| USDC | `0x3600…0000` | ✅ | ✅ |
| EURC | — | ✅ | ✅ |
| USYC | — | ✅ | ✅ |
| Memo | `0x5294E9927c3306DcBaDb03fe70b92e01cCede505` | ✅ | ✅ |
| ERC-8004 IdentityRegistry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | ✅ | ✗ (testnet pakai `0x8004A818…`) |
| ERC-8004 IdentityRegistry (alamat testnet) | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | ✗ | ✅ |
| CCTP TokenMessengerV2 | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | ✅ | ✗ |
| CCTP MessageTransmitterV2 | `0x81D40F21F12A8F0E3252Bccb954D722d4c464B64` | ✅ | ✗ |
| Gateway Wallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` | ✅ | ✗ |
| Gateway Minter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` | ✅ | ✗ |
| ERC-8183 Agentic Commerce | `0x0747EEf0706327138c69792bF28Cd525089e4583` | ✗ | ✅ |
| ARCOX Fee Router | `0xDf800310443BEB589CEf91A09854203Ea36e43a7` | ✗ | ✅ |
| ARCOX AMM Router | `0x9f2443691bddd8343590c68e2a2cdec5fd0b6124` | ✗ | ✅ |
| ARCOX Swap Adapter | `0xBBD70b01a1CAbc96d5b7b129Ae1AAabdf50dd40b` | ✗ | ✅ |

Kesimpulan: kontrak pihak Circle sudah ada di mainnet; yang perlu deploy sendiri adalah kontrak ARCOX dan (bila ERC-8183 dipakai di mainnet) Agentic Commerce.

ERC-8004 ValidationRegistry tidak dipakai oleh kode (`grep` = 0), jadi item lama "alamat mainnet ValidationRegistry" bisa ditutup tanpa pekerjaan.

## Prasyarat

### A. Circle Console

| # | Item | Status |
|---|---|---|
| A1 | Client Key **LIVE_API** untuk passkey/MSCA/paymaster | ✅ ada (`CIRCLE_CLIENT_KEY_LIVE`) |
| A2 | Passkey domain `arcoxdex.vercel.app` untuk environment LIVE | ❌ **blocker** |
| A3 | Gas Station default policy mencakup Arc Mainnet | ❌ **blocker** |
| A4 | Client Key **TEST_API** (agar testnet tetap jalan) | ✅ ada (`CIRCLE_CLIENT_KEY`) |
| A5 | API Key environment produksi (dev-controlled wallet, webhook) | ✅ aktif (`CIRCLE_API_KEY_MAINNET`, HTTP 200) |
| A6 | Entity secret terdaftar untuk environment produksi | perlu konfirmasi |
| A7 | Webhook signing key/ID produksi | perlu konfirmasi |

### B. Alamat per-network

| # | Item | Status |
|---|---|---|
| B1 | Deploy ulang ARCOX Fee Router + AMM Router + Swap Adapter ke Arc mainnet | ❌ belum |
| B2 | Putuskan ERC-8183 Agentic Commerce di mainnet (deploy sendiri atau matikan) | ❌ belum diputuskan |
| B3 | Alamat ERC-8004 mainnet | ✅ `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| B4 | Alamat CCTP/Gateway mainnet | ✅ terverifikasi |
| B5 | Treasury mainnet (menggantikan `ARCOX_TREASURY_WALLET_ADDRESS` testnet) | ❌ belum |

### C. Konfigurasi per-network

| # | Item | Status |
|---|---|---|
| C1 | Pemilihan Client Key per-network di backend | ❌ kode hanya baca `CIRCLE_CLIENT_KEY` |
| C2 | `VITE_CIRCLE_CLIENT_KEY` per-network di frontend | ❌ hanya berisi key TEST |
| C3 | Pemilihan API Key per-network (`CIRCLE_API_KEY_MAINNET` belum dibaca kode) | ❌ |
| C4 | Registry chain per-network (FE + BE) menggantikan hardcode `*_Testnet` | ❌ |
| C5 | Namespace penyimpanan state per-network (`arc-testnet` vs `arc-mainnet`) | ❌ |
| C6 | `CIRCLE_ENV` / `CIRCLE_BASE_URL` mengikuti network | ❌ masih sandbox |

### D. Infrastruktur

| # | Item | Status |
|---|---|---|
| D1 | RPC utama mainnet | ✅ `https://rpc.mainnet.arc.io` |
| D2 | RPC cadangan (`DRPC_KEY`) untuk mainnet | perlu ditambahkan |
| D3 | CCTP attestation/fee API produksi (`iris-api.circle.com`) | perlu verifikasi jalur `/v2/burn/...` |
| D4 | Gateway API mainnet | perlu verifikasi |

### E. Operasional

| # | Item | Status |
|---|---|---|
| E1 | Deployer key khusus mainnet (terpisah dari testnet) | ❌ belum |
| E2 | Audit singkat kontrak ARCOX sebelum mainnet | ❌ belum |
| E3 | Guard agar intent bridge lama tidak memblokir (`unresolved_source_intent`) | ❌ belum |
| E4 | Monitoring mint/paymaster + alert dana | ❌ belum |
| E5 | Rollback plan dan jalur paralel testnet | ❌ belum |

## Berkas yang perlu dibuat per-network

Frontend (`arc-dex`):

```text
src/chains.ts
src/domain/arcNetwork.ts
src/domain/bridgeRouteRegistry.ts
src/services/modularWallet.ts      # EVM_CHAIN_CONFIG, MSCA_DEPLOYMENT_CHAINS
src/services/agentic.ts            # IDENTITY_REGISTRY, AGENTIC_COMMERCE_CONTRACT
src/types/agent.ts                 # SUPPORTED_CHAINS
src/appKit.ts                      # fee router + RPC per-network
src/auth.ts                        # CHAIN_ID untuk SIWE
src/components/BridgePanel.tsx
```

Backend (`arc-dex-api`):

```text
server.mjs                          # pemilihan Client/API key per-network
src/services/chains.mjs             # 4 chain testnet → +arc mainnet
src/config/arcRpc.mjs               # PUBLIC_ARC_RPC masih testnet
src/services/sessionKeyService.mjs
src/services/agentIdentityService.mjs
src/services/agenticJobsService.mjs
src/services/arcMemoService.mjs
src/middleware/x402Middleware.mjs   # X402_CHAIN_ID / X402_MODE
src/services/mcpServer.mjs
```

Ringkas: saat ini belum ada abstraksi network mode sama sekali, sehingga penambahan mainnet harus lewat satu registry per-network, bukan literal chain yang tersebar.

## Fase pekerjaan

```text
P0  Lengkapi prasyarat Console (A2, A3) dan konfirmasi A6/A7
P1  Registry network + dual network switch (FE & BE) — nol risiko dana
P2  Key per-network (Client & API) + probe ulang passkey/mainnet paymaster
P3  MSCA/passkey Arc mainnet end-to-end
P4  Deploy ulang kontrak ARCOX ke mainnet + verifikasi di explorer.arc.io
P5  Bridge keluar Arc (setelah proof/mint tervalidasi)
P6  UI guard rail (label network, konfirmasi, pemisahan saldo)
P7  Uji mikro mainnet (create wallet, 0.01 USDC send) dengan persetujuan eksplisit
P8  Cutover + monitoring
```

## Risiko utama

- **Bug `unresolved_source_intent` / auto-mint** (kasus Hermes) di testnet masih memblokir quote, tetapi belum menelan dana karena testnet. Di mainnet ini berarti dana nyata, jadi guard-nya wajib sebelum P5.
- Passkey yang sama dapat mengontrol MSCA mainnet dan testnet; pemisahan state per-network harus tegas agar tidak salah chain.
- Kontrak ARCOX belum diaudit untuk mainnet.
- Contoh skill Circle yang terpasang (`use-arc`) masih menyatakan "Arc testnet only" — sudah stale, jangan dijadikan acuan.

## Perintah verifikasi ulang

Semua read-only; ganti `<KEY>` dengan key yang sesuai network.

```bash
# chain id + bundler
curl -sS -X POST https://modular-sdk.circle.com/v1/rpc/w3s/buidl/arc \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer <KEY>" \
  -H 'X-AppInfo: platform=web;version=1.0.15;uri=arcoxdex.vercel.app' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_supportedEntryPoints","params":[]}'

# passkey (base path, TANPA slug)
curl -sS -X POST https://modular-sdk.circle.com/v1/rpc/w3s/buidl \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer <KEY>" \
  -H 'X-AppInfo: platform=web;version=1.0.15;uri=arcoxdex.vercel.app' \
  --data '{"jsonrpc":"2.0","id":1,"method":"rp_getRegistrationOptions","params":["ArcoxProbe_01"]}'

# paymaster
curl -sS -X POST https://modular-sdk.circle.com/v1/rpc/w3s/buidl/arc \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer <KEY>" \
  -H 'X-AppInfo: platform=web;version=1.0.15;uri=arcoxdex.vercel.app' \
  --data '{"jsonrpc":"2.0","id":1,"method":"pm_getPaymasterStubData","params":[{"sender":"0x0000000000000000000000000000000000000001","nonce":"0x0","callData":"0x","callGasLimit":"0x0","verificationGasLimit":"0x0","preVerificationGas":"0x0","maxFeePerGas":"0x0","maxPriorityFeePerGas":"0x0","signature":"0x"},"0x0000000071727de22e5e9d8baf0edac6f37da032","0x13b2"]}'

# keberadaan kontrak mainnet
curl -sS -X POST https://rpc.mainnet.arc.io -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_getCode","params":["0x8004A169FB4a3325136EB29fA0ceB6D2e539a432","latest"]}'
```
