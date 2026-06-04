# ARCOX MCP Server

Purpose: give Codex/Hermes agents a structured view of ARCOX DEX Web UI, supported actions, chain routes, signing rules, and retry-bridge behavior.

Run locally:

```bash
cd /home/ubuntu/arc-dex/arcox-agent
npm run mcp
```

Example MCP config:

```json
{
  "mcpServers": {
    "arcox": {
      "command": "node",
      "args": ["/home/ubuntu/arc-dex/arcox-agent/mcp/server.mjs"],
      "env": {
        "ARCOX_WEB_URL": "https://arc-dex-bice.vercel.app/",
        "ARCOX_API_URL": "https://43.163.98.128.nip.io"
      }
    }
  }
}
```

Initial resources:

- `arcox://ui/pages`
- `arcox://ui/actions`
- `arcox://ui/chains`
- `arcox://rules/retail-safety`
- `arcox://deployments/router`

Initial tools:

- `arcox_ui_map`: returns the full static UI/action registry.
- `arcox_action_plan`: maps a user intent into an ARCOX action plan and missing slots.
- `arcox_route_status`: checks chain/source/token support and router-fee applicability.

Next build phase:

- Add optional browser snapshot tool for live DOM/screenshot inspection.
- Add authenticated read-only session status endpoint from Web UI.
- Add per-page selectors for precise UI automation.
- Keep value-moving actions behind user confirmation and wallet signature.
