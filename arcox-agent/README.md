# ARCOX Agent

> Legacy copy. Source utama agent/MCP sekarang ada di `/home/ubuntu/arcox-mcp`.
> Jalankan dan maintenance agent dari repo baru:
>
> ```bash
> cd /home/ubuntu/arcox-mcp
> npm run mcp
> npm run agent -- status
> npm run codex-agent -- "send 1 USDC from circle wallet to 0x..."
> ```

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

Bridge USDC EVM to EVM after checking preview:

```bash
npm run codex-agent -- "bridge 1 USDC from Arc to Arbitrum Sepolia" --yes
```

Supported CLI bridge routes: Arc Testnet, Ethereum Sepolia, Base Sepolia, Arbitrum Sepolia, HyperEVM Testnet. Solana bridge remains a web-wallet flow.

Retry pending bridge mint:

```bash
npm run codex-agent -- retry-bridge --burn-tx 0xBURN_TX --from-chain Arc_Testnet --to-chain Arbitrum_Sepolia
```

Or with natural prompt:

```bash
npm run codex-agent -- "retry bridge 0xBURN_TX from Arc to Arbitrum Sepolia" --yes
```

When a router exists in `deployments/arcox-router.testnet.json`, `send` and EVM-source `bridge` routes use `ArcoxRouter` so platform fees are enforced onchain. If a source chain has no router deployment, the agent refuses direct bridge execution instead of bypassing platform fees. Solana-source bridge routes split the USDC platform fee before the CCTP burn.

Current router deployments:

```text
Arc_Testnet: 0xDf800310443BEB589CEf91A09854203Ea36e43a7
Ethereum_Sepolia: 0x53aB114FeE64b177B8D6066056DfD03Ea38D0ef1
Base_Sepolia: 0x9425cC5b3C8B9e0FCb35beBdE737B4365A614Acc
Arbitrum_Sepolia: 0x5dCAA895dDc7350cF0f9eb69E69536a4548b0cA7
```

Pending:

```text
HyperEVM_Testnet: skipped/no native gas
Solana_Devnet: deployed
```

Solana Devnet router structure:

```bash
cd /home/ubuntu/arc-dex/arcox-agent
npm run deploy:solana-router
```

The router source lives in `solana-router/`. Solana CLI and Anchor CLI were installed locally for deployment.

Current Solana Devnet deploy status:

```text
Program ID: C7XUB3Ep67seiJAzz4Apeeus2AbxbnuqFzvodDWxqoTH
Deploy signature: bFEyV6NhtgWvN18paErxsXwWVwtc1ZsroK4Ljbx1risKDEzv2yXw5PTwu27hQE9pDwo1q6xQHH6tZSgkvjLnLrJ
Fee payer: 8BiDjZHWQiGtjuKcZ5mRv5uey9YQsXFsV8uDPseZwyQy
Remaining fee payer balance: 0.36644652 SOL
Status: deployed to Solana Devnet
```

Link this endpoint in ARCOX DEX `Agent Jobs -> AI Link`:

```text
http://127.0.0.1:8787/agent
```

Do not put private keys in the frontend root. Keep `AGENT_PRIVATE_KEY` only in this agent directory's `.env`.

## MCP context server

Skeleton MCP server for Codex/Hermes agent context:

```bash
cd /home/ubuntu/arc-dex/arcox-agent
npm run mcp
```

It exposes ARCOX Web UI pages, actions, chain support, router deployments, and retail safety rules. See `mcp/README.md`.
