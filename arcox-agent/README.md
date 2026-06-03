# ARCOX Agent

Standalone local-first agent profile for ARCOX DEX.

Agent env file:

```text
/home/ubuntu/arc-dex/arcox-agent/.env
```

Setup:

```bash
cd /home/ubuntu/arc-dex/arcox-agent
cp .env.example .env
npm run codex-agent -- identity
npm run codex-agent -- connect
npm run codex-agent -- serve --port 8787
```

Natural command preview:

```bash
npm run codex-agent -- "send 1 USDC to 0x0000000000000000000000000000000000000001"
```

Execute after checking preview:

```bash
npm run codex-agent -- "send 1 USDC to 0x0000000000000000000000000000000000000001" --yes
```

Link this endpoint in ARCOX DEX `Agent Jobs -> AI Link`:

```text
http://127.0.0.1:8787/agent
```

Do not put private keys in the frontend root. Keep `AGENT_PRIVATE_KEY` only in this agent directory's `.env`.
