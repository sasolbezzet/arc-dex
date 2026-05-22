# Changelog — Solana Devnet CCTP Bridge Integration

## v0.2.2-dev (Belum Release)
- **Added**: Support chain `Solana_Devnet` (CCTP domain 1) ke CCTP config pada `arc-dex-api/server.mjs`
- **Added**: Endpoint baru
  - POST `/api/prepare-bridge-solana` — initiate USDC burn on Arc Testnet// to Solana Devnet
  - POST `/api/mint-cctp-solana` — poll Circle Iris attestation → call receiveMessage on Solana receive GAGAL mint
- **Changed**: CCTP object now includes `Solana_Devnet` domain=1 dan chain definition (`id:40111`)
- **Env Required** (add to .env, jangan commit di repo):
  - SOLANA_DEVNET_RPC=https://api.devnet.solana.com
  - OWNER_PRIVATE_KEY=... (untuk receiveMessage transaction signing) kalau tidak pakai default iWallet

## Tes Ringkas (local)
```bash
# 1. Start backend:
cd arc-dex-api && node server.mjs

# 2. Tes health:
curl http://localhost:3001/health

# 3. Prepare burn + attest:
curl -X POST http://localhost:3001/api/prepare-bridge-solana \
  -H 'Content-Type: application/json' \
  -d '{"metamaskAddress":"0xAb5801a7D398351b8bE11C439e05C5B3259aeC9","amount":"10"}'

# 4. Poll Iris → mint Solana via bridge (gunakan txHash hasil step 3)
curl -X POST http://localhost:3001/api/mint-cctp-solana \
  -H 'Content-Type: application/json' \
  -d '{"burnTxHash":"0xefde2f33a60bd0411b9d13...","toAddress": "G5fNzNsjeqc7L7ZcKwF3K9aPuTtmZje5rv7SR2Y727i"}'
```

## Catatan Lingkungan
- Circle Iris API (Sandbox): https://iris-api-sandbox.circle.com/v2/messages/:domain?transactionHash=:tx
- USDC Address Solana Devnet: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
- Circle Token Messenger/MessageTransmitter Solana Devnet:
  - tokenMessenger: `CirXL1Ljxok6y32zhM3C5C22AevqEM95aERkf36de22`
  - messageTransmitter: `CirAct9xT5NfB5f6pZD5s9sE3o4bxCF58UHk3gHJAVR`


## Roadmap
- [ ] UI Arc DEX frontend tambah button "Bridge to Solana Devnet"
- [ ] Integrasi Circle wallets web SDK ke UI untuk ATA auto creation
- [ ] Monitoring attestation polling via BullMQ queue
