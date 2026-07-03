# ARCOX Repo Structure

ARCOX dipisah menjadi empat area agar bug dan secret di satu bagian tidak mengganggu area lain.

## `/home/ubuntu/arc-dex`

Frontend retail DEX:

- React/Vite web UI.
- Komponen Swap, Bridge, Send, AI Jobs, Docs.
- Browser wallet signing untuk EOA.
- Integrasi API dan history display.

Repo ini tidak menyimpan source, runtime state, atau private key MCP/terminal agent.

## `/home/ubuntu/arc-dex-api`

Backend proxy retail:

- Circle proxy wallet storage.
- Circle wallet actions.
- Quote, swap, send, bridge preparation.
- Transaction history DB JSON lokal.

Jangan simpan kode frontend atau MCP runtime di repo ini.

## `/home/ubuntu/arcox-agent`

Installer dan konfigurasi lokal agent:

- CLI `arcox-agent setup`, `doctor`, `sync`, dan `run`.
- Template environment lokal untuk signer dan credential Hermes.
- Integrasi package `arcox-mcp` tanpa menyalin runtime ke repository dApp.

Env signer lokal hanya ada di:

```text
~/.arcox/agent.env
```

## `/home/ubuntu/arcox-mcp`

Monorepo agent dan MCP:

- `packages/runtime` - core execution agent.
- `packages/mcp-server` - entrypoint MCP server untuk Hermes/Codex.
- `packages/cli` - terminal prompt wrapper.
- `packages/contracts-evm` - EVM router workspace.
- `packages/contracts-solana` - Solana router workspace.
- `docs` - panduan agent dan MCP.

Repo ini tidak memakai env frontend/backend dApp.

## Aturan Maintenance

- Fix UI hanya di `arc-dex`.
- Fix API/Circle wallet hanya di `arc-dex-api`.
- Fix installer dan konfigurasi agent hanya di `arcox-agent`.
- Fix MCP/agent/CLI hanya di `arcox-mcp`.
- Fix router contract di `arcox-mcp/packages/contracts-*`.
- Jangan campur state runtime, `.env`, `node_modules`, atau history tx ke git.
