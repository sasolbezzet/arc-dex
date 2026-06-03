# ARCOX Codex CLI Agent

This is the local-first ARCOX agent interface intended for Codex CLI or Hermes-style usage.

The user keeps the private key in their own `.env` file. ARCOX DEX never receives the private key.

## Setup

```bash
cd /home/ubuntu/arc-dex/arcox-agent
cp .env.example .env
```

Edit `.env`:

```env
AGENT_PRIVATE_KEY=0xYOUR_LOCAL_AGENT_PRIVATE_KEY
AGENT_NAME=ARCOX Codex Retail Agent
AGENT_PORT=8787
ARC_RPC=https://rpc.testnet.arc.network/
ARCOX_API_URL=https://arc-dex-bice.vercel.app
ARC_AGENT_ID=
```

## Check Identity

```bash
npm run codex-agent -- identity
```

The output includes:

- `local_agent_id`
- `arc_agent_id`
- owner wallet
- local endpoint
- Arc Identity Registry contract
- ERC-8183 Agentic Commerce contract
- capabilities

## Connect To ARCOX DEX

```bash
npm run codex-agent -- connect
```

Then start the local endpoint:

```bash
npm run codex-agent -- serve --port 8787
```

Open ARCOX DEX:

```text
https://arc-dex-bice.vercel.app/
```

In `Agent Jobs -> AI Link`:

```text
Endpoint: http://127.0.0.1:8787/agent
```

Use the same owner wallet and sign the link message.

## Natural Commands

Preview only:

```bash
npm run codex-agent -- "send 1 USDC to 0x0000000000000000000000000000000000000001"
```

Execute after checking the preview:

```bash
npm run codex-agent -- "send 1 USDC to 0x0000000000000000000000000000000000000001" --yes
```

Create an ERC-8183 job:

```bash
npm run codex-agent -- "create job audit ARCOX DEX for 1 USDC" --yes
```

Plan a swap:

```bash
npm run codex-agent -- "swap 10 USDC to EURC"
```

Plan a bridge:

```bash
npm run codex-agent -- "bridge 5 USDC from Arbitrum Sepolia to Arc"
```

Swap and bridge are currently recognized as intents. CLI execution stays disabled until a route adapter returns quote, allowance, fee, route, and destination data.

## Direct Job Commands

```bash
npm run codex-agent -- register --metadata-uri ipfs://YOUR_METADATA
npm run codex-agent -- read-agent --agent-id 1
npm run codex-agent -- read-job --job-id 1
npm run codex-agent -- set-budget --job-id 1 --amount 1
npm run codex-agent -- fund --job-id 1 --amount 1
npm run codex-agent -- submit --job-id 1 --deliverable "completed"
npm run codex-agent -- complete --job-id 1 --reason "approved"
```

## Safety Model

The CLI signs only with `AGENT_PRIVATE_KEY` from the local `.env`.

Use preview mode first. Add `--yes` only after checking the action, amount, recipient, and route.
