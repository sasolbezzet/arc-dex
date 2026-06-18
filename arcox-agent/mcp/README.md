# ARCOX MCP Server

Purpose: give Codex/Hermes agents a structured view of ARCOX DEX and execute supported retail actions through MCP tools. Agents should call these MCP tools directly instead of searching the repository or running `npm run codex-agent`.

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

Tools:

- `arcox_ui_map`: returns the full static UI/action registry.
- `arcox_action_plan`: maps a user intent into an ARCOX action plan and missing slots.
- `arcox_route_status`: checks chain/source/token support and router-fee applicability.
- `arcox_agent_status`: returns the local signer address and Arc balances.
- `arcox_quote_bridge`: quotes a USDC bridge route, platform fee, and estimated receive amount.
- `arcox_execute_bridge`: executes a confirmed USDC bridge. Without `confirmed: true`, it returns a quote only.
- `arcox_retry_bridge`: retries CCTP mint for a pending bridge burn. Without `confirmed: true`, it returns a preview only.
- `arcox_quote_send`: quotes an Arc token send and platform fee.
- `arcox_execute_send`: executes a confirmed Arc token send. Without `confirmed: true`, it returns a quote only.
- `arcox_quote_swap`: quotes a Circle proxy wallet swap through the ARCOX backend.
- `arcox_execute_swap`: executes a confirmed Circle proxy wallet swap. Without `confirmed: true`, it returns a quote only.
- `arcox_pay_create_nowpayments_sandbox_payment`, `arcox_pay_get_payment_status`, and `arcox_pay_simulate_*`: create and test the ARCOX Pay NOWPayments sandbox flow without moving real funds.
- `arcox_intel_*`: request ARCOX Intel via ARCOX API/x402. MCP does not store `ARKHAM_API_KEY`.
- `arcox_agent_job`: plans and executes Agentic Economy operations: register agent, create/read job, set budget, fund, submit, and complete.

Execution safety:

- Value-moving tools must be called first as quote/preview.
- Execute tools only submit transactions when `confirmed: true`.
- EOA execution uses the local `AGENT_PRIVATE_KEY` in `arcox-agent/.env`.
- Circle proxy wallet swap uses the ARCOX backend auth session signed by the local agent key.
- Browser-wallet signing from the Web UI remains separate from terminal/MCP execution.
