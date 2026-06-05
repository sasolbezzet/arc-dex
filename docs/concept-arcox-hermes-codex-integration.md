# Konsep Integrasi ARCOX Agent dengan Hermes/Codex TUI

## Ringkasan Eksekutif

Dokumen ini menjelaskan konsep integrasi ARCOX Terminal AI Agent dengan **Hermes CLI** (Nous Research) dan **Codex CLI** (OpenAI) agar pengguna dapat memerintahkan AI agent untuk melakukan:

- **ARC Job Management**: `create job`, `accept job`, `submit deliverable`, `complete job`
- **Retail DeFi Actions**: `swap`, `bridge`, `send`

**Hanya melalui perintah natural language di terminal TUI** — tanpa membuka browser atau ARCOX DEX web UI.

---

## 1. Analisis Kondisi Saat Ini (Current State)

### 1.1 Arcox Agent (Existing)
Komponen yang sudah ada di `arcox-agent/`:

| File | Fungsi |
|------|--------|
| `bin/arcox-codex-cli.mjs` | Wrapper CLI entrypoint, parsing natural language prompts |
| `bin/arcox-agent.mjs` | Core logic: onchain signer via local `AGENT_PRIVATE_KEY`, viem wallet client |
| `profile/arcox-agent-profile.json` | Metadata capabilities agent |

**Capabilitas Existing:**
- ✅ `send` — Transfer ERC-20 di Arc Testnet (USDC, EURC, USYC, cirBTC)
- ✅ `create job` — Create ERC-8183 job via `AgenticCommerce.createJob()`
- ✅ `set-budget`, `fund` — Set budget & fund escrow
- ✅ `submit` — Provider submit deliverable hash
- ✅ `complete` — Evaluator complete job
- ✅ `read-job`, `read-agent` — Read onchain state
- ✅ `serve` — Local HTTP endpoint (`/agent`, `/health`, `/metadata`)

**Capabilitas Partial:**
- ⚠️ `swap` — Dikenali sebagai intent, tapi eksekusi CLI dimatikan (butuh quote/adapter)
- ⚠️ `bridge` — Dikenali sebagai intent, tapi eksekusi CLI dimatikan (butuh CCTP adapter)

**Capabilitas Missing:**
- ❌ `accept job` — Tidak ada fungsi `accept()` di smart contract `AgenticCommerce` (ERC-8183). Provider "accept" implisit saat `submit()`. Konsep perlu memperjelas mekanisme ini.
- ❌ Swap execution via CLI
- ❌ Bridge execution via CLI

### 1.2 ARCOX DEX Web App
Web app (`src/`) menyediakan UI untuk:
- Swap via AppKit SDK (EOA & Circle wallet)
- Bridge CCTP v2 via AppKit (Arc ↔ Sepolia/Base/Arbitrum/Solana)
- Send via `eoaTransactions.ts`
- Agent Jobs UI via `AgenticPanel.tsx`

**Gap**: Web UI memerlukan browser + MetaMask popup. CLI Agent tidak bisa menggunakan AppKit (browser-only SDK).

### 1.3 Hermes CLI (External)
- TUI agent framework dari Nous Research
- Berbasis "skills" modular di `~/.hermes/skills/`
- Mendukung MCP (Model Context Protocol)
- Agent loop: `Observe -> Reason -> Act -> Reflect`
- Bisa spawn sub-agent atau delegate ke CLI tools lain

### 1.4 Codex CLI (External)
- CLI coding agent dari OpenAI
- Bekerja dalam mode chat/interactive di terminal
- Bisa execute shell commands
- Tidak punya skill system formal seperti Hermes

---

## 2. Visi Target (Target State)

Pengguna membuka terminal dan mengetik:

```bash
# Hermes mode
/hermes> /agent arcox "create job audit smart contract for 5 USDC with provider 0xABC evaluator 0xDEF"
/hermes> /agent arcox "accept job #42"
/hermes> /agent arcox "swap 10 USDC to EURC"
/hermes> /agent arcox "bridge 5 USDC from Arbitrum Sepolia to Arc"
/hermes> /agent arcox "send 2 USDC to 0x123..."

# Codex mode (natural chat)
codex> Ask arcox to create a job for security audit, budget 5 USDC
codex> Ask arcox to swap my 10 USDC to EURC
```

**Hasil**: Agent mengeksekusi transaksi onchain menggunakan local private key, menampilkan preview sebelum eksekusi (safety), dan mengembalikan tx hash + explorer link — semua di dalam terminal.

---

## 3. Arsitektur Konsep

### 3.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         USER TERMINAL                                │
│  ┌──────────────┐      ┌──────────────┐      ┌──────────────────┐   │
│  │ Hermes CLI   │      │ Codex CLI    │      │ ARCOX CLI        │   │
│  │ (TUI)        │      │ (Chat)       │      │ (Standalone)     │   │
│  └──────┬───────┘      └──────┬───────┘      └──────────────────┘   │
│         │                     │                                      │
│         └──────────┬──────────┘                                      │
│                    │                                                 │
│         ┌──────────▼──────────┐                                       │
│         │  ARCOX Agent Bridge │  ← NEW: Interface layer               │
│         │  (MCP / Skill /     │     untuk Hermes/Codex                │
│         │   Sub-process)      │                                       │
│         └──────────┬──────────┘                                       │
│                    │                                                 │
│         ┌──────────▼──────────┐                                       │
│         │  ARCOX Agent Core   │  ← EXISTING: arcox-agent.mjs          │
│         │  - Intent parser    │                                       │
│         │  - Wallet signer    │                                       │
│         │  - Onchain exec     │                                       │
│         └──────────┬──────────┘                                       │
│                    │                                                 │
│    ┌───────────────┼───────────────┐                                 │
│    │               │               │                                  │
│ ┌──▼───┐     ┌────▼────┐    ┌────▼────┐                            │
│ │ Arc   │     │ AppKit  │    │ Circle  │                            │
│ │ RPC   │     │ Bridge  │    │ API     │                            │
│ │       │     │ Adapter │    │         │                            │
│ └───────┘     └─────────┘    └─────────┘                            │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 Integration Patterns

#### Pattern A: MCP Server (Model Context Protocol) — Recommended for Hermes
Hermes CLI mendukung MCP. ARCOX Agent bisa diekspos sebagai **MCP Server** yang menyediakan tools:

```json
{
  "tools": [
    {
      "name": "arcox_send",
      "description": "Send tokens on Arc network",
      "parameters": {
        "amount": "string",
        "token": "enum[USDC,EURC,USYC,cirBTC]",
        "to": "address"
      }
    },
    {
      "name": "arcox_create_job",
      "description": "Create ERC-8183 job on Arc",
      "parameters": {
        "description": "string",
        "provider": "address",
        "evaluator": "address",
        "budget_usdc": "string",
        "expires_in_hours": "number"
      }
    },
    {
      "name": "arcox_swap",
      "description": "Swap tokens on Arc Testnet",
      "parameters": {
        "amount_in": "string",
        "token_in": "string",
        "token_out": "string"
      }
    },
    {
      "name": "arcox_bridge",
      "description": "Bridge USDC via CCTP",
      "parameters": {
        "amount": "string",
        "from_chain": "string",
        "to_chain": "string"
      }
    },
    {
      "name": "arcox_accept_job",
      "description": "Accept/open job as provider",
      "parameters": {
        "job_id": "string"
      }
    }
  ]
}
```

**Keunggulan**: Hermes bisa "melihat" capabilities agent secara dinamis, auto-generate prompts, dan melakukan tool-calling loop.

#### Pattern B: Hermes Skill — Native Integration
Membuat skill resmi `arcox-agent` di `~/.hermes/skills/`:

```
~/.hermes/skills/arcox-agent/
├── skill.json          # Metadata, dependencies
├── prompts/
│   └── system.txt      # System prompt untuk sub-agent
├── tools/
│   ├── send.sh
│   ├── swap.sh
│   ├── bridge.sh
│   ├── job.sh
│   └── status.sh
└── README.md
```

Setiap tool script adalah thin wrapper yang memanggil:
```bash
node /path/to/arcox-agent/bin/arcox-agent.mjs run --prompt "$1" --yes
```

**Keunggulan**: Native Hermes experience, bisa dikombinasikan dengan skill lain.

#### Pattern C: Codex CLI Sub-agent — Simplest for Codex
Codex CLI tidak punya skill system formal. Cara termudah:

1. **Wrapper script** `arcox-codex-bridge.mjs` yang menerima JSON dari Codex, parse, lalu delegate ke `arcox-agent.mjs`.
2. **System prompt injection** saat start Codex CLI dengan konteks ARCOX Agent.

Contoh integrasi:
```bash
# Di dalam session Codex
$ ./arcox-agent/bin/arcox-codex-bridge.mjs '{"action":"send","amount":"1","token":"USDC","to":"0x..."}'
```

Atau lebih natural — Codex bisa langsung spawn subprocess:
```
codex> Run this command: npm run codex-agent -- "send 1 USDC to 0x..." --yes
```

---

## 4. Command Mapping Detail

### 4.1 Job Management (ERC-8183)

| User Intent | Agent Action | Contract Function | Role |
|-------------|--------------|-------------------|------|
| "create job ... for X USDC" | `create-job` + `set-budget` + `fund` | `createJob()`, `setBudget()`, `fund()` | Client |
| "accept job #42" | **Perlu klifikasi** — Di ERC-8183 tidak ada `accept()`. Provider "accept" implisit saat `submit()`. Konsep: `accept` = update offchain metadata + notify client. Opsional: wrap dengan hook contract. | N/A (offchain) atau hook | Provider |
| "submit job #42" | `submit` | `submit(deliverableHash)` | Provider |
| "complete job #42" | `complete` | `complete(reasonHash)` | Evaluator |
| "read job #42" | `read-job` | `getJob()` | Anyone |

**Catatan Penting**: Fungsi `accept` perlu didiskusikan. Jika smart contract tidak mendukung `accept` eksplisit, ada 3 opsi:
1. **Offchain accept**: Agent update status lokal/database offchain, provider signal readiness.
2. **Hook-based accept**: Deploy custom hook contract yang memiliki fungsi `accept()` sebagai pre-condition sebelum `submit()`.
3. **Re-interpret accept**: "accept job" di TUI sebenarnya berarti "saya siap mengerjakan" → tidak ada tx onchain, hanya logging.

Rekomendasi konsep: **Opsi 3 untuk MVP** (offchain signal), **Opsi 2 untuk v2** (custom hook contract).

### 4.2 Retail DeFi Actions

| User Intent | Current State | Target State | Technical Requirement |
|-------------|---------------|--------------|----------------------|
| "send X USDC to 0x..." | ✅ Working | ✅ Working | Existing `executeSend()` |
| "swap X USDC to EURC" | ⚠️ Planning only | ✅ Full execution | **Swap CLI Adapter** (Section 5.1) |
| "bridge X USDC from A to B" | ⚠️ Planning only | ✅ Full execution | **Bridge CLI Adapter** (Section 5.2) |

---

## 5. Adapter Teknis yang Diperlukan

### 5.1 Swap CLI Adapter

**Masalah**: AppKit SDK (`@circle-fin/app-kit`) adalah browser-only SDK yang memerlukan `window.ethereum`. Tidak bisa digunakan di Node.js CLI.

**Solusi**: Buat adapter yang menggunakan viem wallet client langsung:

```typescript
// Konsep: arcox-agent/adapters/swapAdapter.mjs

interface SwapCliAdapter {
  // 1. Get quote dari ARCOX API
  getQuote(tokenIn, tokenOut, amountIn): Promise<Quote>

  // 2. Check allowance
  getAllowance(owner, spender): Promise<bigint>

  // 3. Build approve tx if needed
  buildApproveTx(token, spender, amount): Promise<TxRequest>

  // 4. Build swap tx via API prepared tx atau direct contract call
  buildSwapTx(quote: Quote): Promise<TxRequest>

  // 5. Estimate gas
  estimateGas(tx): Promise<GasEstimate>

  // 6. Execute with viem walletClient
  execute(walletClient, tx): Promise<TxReceipt>
}
```

**Option A — ARCOX API Backend** (Recommended):
- Endpoint backend `/api/swap-prepare` yang menerima `{tokenIn, tokenOut, amountIn, fromAddress}`
- Return: `{to, data, value, estimatedGas, amountOut}`
- CLI hanya perlu `walletClient.sendTransaction({to, data, value})`

**Option B — Direct DEX Contract**:
- Jika ada DEX router contract di Arc Testnet, CLI bisa call router langsung tanpa API.
- Butuh ABI router + path finding.

### 5.2 Bridge CLI Adapter

**Masalah**: CCTP v2 bridge memerlukan:
1. Burn message di source chain (MetaMask popup/browser wallet)
2. Poll attestation dari Circle Iris API
3. Mint di destination chain

**Solusi**: Buat adapter Node.js yang menggantikan AppKit browser flow:

```typescript
// Konsep: arcox-agent/adapters/bridgeAdapter.mjs

interface BridgeCliAdapter {
  // Source chain: approve + burn
  burn({fromChain, toChain, amount, token}): Promise<BurnReceipt>

  // Poll Circle attestation API
  fetchAttestation(messageHash, timeout): Promise<Attestation>

  // Destination chain: mint/receiveMessage
  mint({toChain, attestation, message}): Promise<MintReceipt>

  // Full flow orchestration
  bridge({fromChain, toChain, amount}): Promise<BridgeResult>
}
```

**Chain Support untuk CLI**:
- Arc Testnet (EVM) → viem wallet client
- Arbitrum/Base/Ethereum Sepolia → viem wallet client (butuh RPC masing-masing)
- Solana Devnet → `@solana/kit` atau `@solana/web3.js` (butuh keypair, bukan window.solflare)

**Challenge**: Solana dari CLI butuh private key/keypair, tidak bisa paket wallet extension. Ini berarti bridge ke/from Solana dari CLI memerlukan Solana wallet file terpisah.

**Rekomendasi konsep**:
- **Phase 1**: Support EVM↔EVM bridge only (Arc, Arbitrum Sepolia, Base Sepolia, Ethereum Sepolia)
- **Phase 2**: Add Solana support via additional `SOLANA_PRIVATE_KEY` env

---

## 6. Safety & Security Model

Prinsip utama: **Private key tidak pernah keluar dari local machine**.

| Layer | Mekanisme |
|-------|-----------|
| **Preview First** | Semua command harus preview sebelum `--yes`. TUI Hermes/Codex harus menampilkan preview dalam format yang jelas. |
| **Local Key Only** | `AGENT_PRIVATE_KEY` di `.env` local. Tidak dikirim ke Hermes server, Codex server, atau ARCOX API. |
| **No Auto-approve** | Tidak ada mode "auto-approve all". Setiap transaksi onchain memerlukan konfirmasi eksplisit (kecuali flag `--yes` disetelah review). |
| **Spend Limit** | Opsional: `.env` bisa punya `MAX_SPEND_USDC_PER_TX` dan `MAX_SPEND_USDC_PER_DAY`. |
| **Rate Limit** | Opsional: Prevent accidental loop — max N transactions per minute. |

---

## 7. Roadmap Implementasi

### Phase 1: Foundation (No-brainer)
1. **MCP Server scaffold** — Buat `arcox-agent/mcp-server.mjs` dengan stdio transport
2. **Expose existing tools** — send, create-job, read-job, submit, complete, set-budget, fund
3. **Hermes integration test** — Register MCP server di Hermes, test tool calling
4. **Codex integration test** — Buat wrapper script, test natural language delegation

### Phase 2: Job Accept Mechanism
5. **Definisi accept job** — Tentukan apakah offchain signal atau custom hook
6. **Implement `accept-job` command** — Update CLI + MCP tools
7. **Dokumentasi flow** — Client create → Provider accept → Provider submit → Evaluator complete

### Phase 3: Swap Execution
8. **Swap API endpoint** — `POST /api/swap-prepare` di backend (atau gunakan existing AppKit API jika tersedia)
9. **Swap CLI adapter** — `arcox-agent/adapters/swapAdapter.mjs`
10. **Integrasi ke core** — `executeSwap()` di `arcox-agent.mjs`
11. **Test E2E** — Hermes/Codex → "swap 10 USDC to EURC" → onchain tx

### Phase 4: Bridge Execution
12. **Bridge CLI adapter** — `arcox-agent/adapters/bridgeAdapter.mjs` (EVM only)
13. **Multi-chain wallet support** — Env untuk RPC Sepolia/Base/Arbitrum
14. **Attestation polling** — Integrasi Circle Iris API
15. **Test E2E** — Hermes/Codex → "bridge 5 USDC from Arbitrum Sepolia to Arc"

### Phase 5: Polish
16. **Human-readable TUI output** — Rich formatting untuk preview & receipt
17. **Job status monitoring** — `watch-job` command untuk polling status
18. **Batch operations** — "create job + fund + accept" dalam satu command

---

## 8. Format Output TUI

### Preview Mode (Before --yes)
```
┌─ ARCOX Agent Preview ─────────────────────────┐
│ Action:     SWAP                              │
│ From:       10 USDC                           │
│ To:         ~9.85 EURC                        │
│ Rate:       1 USDC = 0.985 EURC               │
│ Fee:        0.15 USDC                         │
│ Gas:        ~0.002 USDC                       │
│ Min out:    9.80 EURC                         │
│ Slippage:   0.5%                              │
│                                               │
│ ⚠️  Review di atas. Re-run dengan --yes       │
└───────────────────────────────────────────────┘
```

### Execution Mode (After --yes)
```
┌─ ARCOX Agent Receipt ─────────────────────────┐
│ ✅ SWAP Executed                              │
│ Tx Hash:  0xabc...def                         │
│ Explorer: https://testnet.arcscan.app/tx/...  │
│ From:     10 USDC                              │
│ To:       9.84 EURC                            │
│ Fee:      0.15 USDC                            │
│ Gas Used: 125000                               │
│ Block:    #4,521,003                           │
└───────────────────────────────────────────────┘
```

---

## 9. Decision Points (Butuh Diskusi)

| # | Pertanyaan | Opsi | Rekomendasi |
|---|-----------|------|-------------|
| 1 | **Apa mekanisme "accept job"?** | A. Offchain signal only<br>B. Custom hook contract<br>C. Re-interpret (accept = siap mengerjakan) | **C untuk MVP, B untuk production** |
| 2 | **Swap: API backend atau direct contract?** | A. API prepare tx<br>B. Direct router ABI | **A** — lebih aman, API bisa validasi route |
| 3 | **Bridge: Support Solana dari CLI?** | A. EVM only Phase 1<br>B. EVM + Solana | **A** — Solana butuh keypair terpisah |
| 4 | **Hermes integration: MCP atau Skill?** | A. MCP Server<br>B. Native Skill<br>C. Keduanya | **C** — MCP untuk compatibility, Skill untuk native feel |
| 5 | **Codex integration: Wrapper atau direct?** | A. Wrapper JSON-RPC<br>B. Direct subprocess | **B** — Codex bisa spawn shell commands natively |

---

## 10. Kesimpulan

Integrasi ARCOX Agent dengan Hermes/Codex TUI adalah **natural extension** dari arsitektur local-first yang sudah ada. Konsep ini mempertahankan prinsip keamanan (local key, preview-before-execute) sambil menambahkan layer aksesibilitas melalui terminal AI agents.

**Deliverables konsep**:
- MCP Server sebagai interface universal
- Swap/Bridge CLI Adapter untuk menutup gap eksekusi
- Job Accept mechanism (offchain signal untuk MVP)
- Rich TUI output untuk preview dan receipt

**Langkah selanjutnya**: Setelah konsep disetujui, implementasi bisa dimulai dari Phase 1 (MCP Server + Hermes integration test) dan Phase 2 (Job Accept), dilanjutkan ke Phase 3-4 untuk swap/bridge execution.
