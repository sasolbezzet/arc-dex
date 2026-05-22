# Arc DEX

A decentralized exchange prototype for bridging USDC across chains using Arc AppKit Bridge & Circle CCTP.

## Features
- Bridge USDC on EVM chains and Solana via Circle CCTP
- Swap within Arc Testnet using Viem and Arc SDK
- Near-instant testnet transactions

## Getting Started

Install deps:
```bash
pnpm i
```

Start Arc DEX API (backend):
```bash
cd arc-dex-api
node server.mjs
```

Start Frontend Next.js:
```bash
cd frontend
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Testing
Run the unit tests
```bash
pnpm test
```

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:


```js
// eslint.config.js
export default defineConfig([
 globalIgnores(['dist']),
 {
   languageOptions: {
     parserOptions: {
       projectService: true,
       tsconfigRootDir: import.meta.dirname,
     },
   },
 }
 // other options...
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

---

# Solana Devnet Bridge (Circle CCTP)

Arc DEX sekarang mendukung **Circle CCTP bridge** ke jaringan **Solana Devnet** (domain 1). Integrasi backend menggunakan Arc AppKit Bridge + Circle Iris attestation polling.

*Catatan:* Setelah proses burn selesai, wallet Solflare akan otomatis menampilkan popup untuk mint USDC. Pastikan wallet sudah terhubung sebelum memulai bridge.

## Config Cepat Local
- Chain: `Solana_Devnet` sudah ditambahkan ke `CCTP` config di `arc-dex-api/server.mjs`
- Domain Circle CCTP: 1
- USDC devnet address: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
- Circle services:
  - tokenMessenger: `CirXL1Ljxok6y32zhM3C5C22AevqEM95aERkf36de22`
  - messageTransmitter: `CirAct9xT5NfB5f6pZD5s9sE3o4bxCF58UHk3gHJAVR`


## Endpoints baru
POST `/api/prepare-bridge-solana`<br>
Trigger: initiate USDC burn on Arc Testnet → return burnTxHash dan explorer url Arc

POST `/api/mint-cctp-solana`<br>
Expected: `{ "burnTxHash": "0x...", "toAddress": "G5fNzNsjeqc7L7ZcKwF3K9a..." }`<br>
Poll Circle Iris attestation → mint GAGAL via transaction receiveMessage di Solana → return txHash Solana & explorer urls

Contoh curling (backend sudah berjalan di localhost:3001):
```bash
# 1. Start backend
cd arc-dex-api && node server.mjs

# 2. Inisiasi burn
curl -s -X POST http://localhost:3001/api/prepare-bridge-solana \
  -H 'Content-Type: application/json' \
  -d '{"metamaskAddress":"0xAb5801a7D398351b8bE11C439e05C5B3259aeC9","amount":"10"}'

# Ambil txHash hasil diatas lalu step 3:
curl -s -X POST http://localhost:3001/api/mint-cptp-solana \
  -H 'Content-Type: application/json' \
  -d '{"burnTxHash":"<txHash-dari-step2>","toAddress":"G5fNzNsjeqc7L7ZcKwF3K9aPuTtmZje5rv7SR2Y727i"}'
```

## Environment Variable (wajib set, jangan di-commit)
- SOLANA_DEVNET_RPC=https://api.devnet.solana.com
- OWNER_PRIVATE_KEY=0x... (opsional; kalau tidak ada, gunakan private key default aplikasi dari env Circle wallets trigger)

## Iris Attestation
Circle Iris sandbox endpoint (devnet): `https://iris-api-sandbox.circle.com/v2/messages/:domain?transactionHash=:txHash`
- Domain: `1` untuk Solana Devnet
- Poll interval: 3 detik, max 40x retries (~2 menit timeout)

## Referensi
- Circle CCTP https://developers.circle.com/cross-chain-transfer-protocol
- Arc AppKit Bridge https://docs.arc.io/app-kit/bridge
- Iris API https://developers.circle.com/stable/docs/iris-api
