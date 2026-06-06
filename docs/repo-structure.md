# ARCOX Repo Structure

ARCOX dipisah menjadi tiga area agar bug di satu bagian tidak mengganggu area lain.

## `/home/ubuntu/arc-dex`

Frontend retail DEX:

- React/Vite web UI.
- Komponen Swap, Bridge, Send, AI Jobs, Docs.
- Browser wallet signing untuk EOA.
- Integrasi API dan history display.

Repo ini tidak menjadi tempat utama MCP/terminal agent.

## `/home/ubuntu/arc-dex-api`

Backend proxy retail:

- Circle proxy wallet storage.
- Circle wallet actions.
- Quote, swap, send, bridge preparation.
- Transaction history DB JSON lokal.

Jangan simpan kode frontend atau MCP runtime di repo ini.

## `/home/ubuntu/arcox-mcp`

Monorepo agent dan MCP:

- `packages/runtime` - core execution agent.
- `packages/mcp-server` - entrypoint MCP server untuk Hermes/Codex.
- `packages/cli` - terminal prompt wrapper.
- `packages/contracts-evm` - EVM router workspace.
- `packages/contracts-solana` - Solana router workspace.
- `docs` - panduan agent dan MCP.

Env signer lokal ada di:

```text
/home/ubuntu/arcox-mcp/packages/runtime/.env
```

## Aturan Maintenance

- Fix UI hanya di `arc-dex`.
- Fix API/Circle wallet hanya di `arc-dex-api`.
- Fix MCP/agent/CLI hanya di `arcox-mcp`.
- Fix router contract di `arcox-mcp/packages/contracts-*`.
- Jangan campur state runtime, `.env`, `node_modules`, atau history tx ke git.
