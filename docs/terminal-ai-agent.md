# ARCOX Terminal AI Agent

This repository includes two agent paths for ARCOX DEX Agent Jobs:

- Hosted planner agent: `/api/agent/ask`
- Local terminal/onchain agent: `npm run agent`

The hosted planner is the default UI endpoint. It works for all logged-in users and returns a job plan, budget, provider/evaluator suggestion, deliverable text, and deliverable hash. It does not sign transactions.

The agent has two modes:

- HTTP endpoint mode for the ARCOX DEX UI.
- Onchain command mode for Arc testnet jobs.

## Start The Agent Endpoint

```bash
cd /home/ubuntu/arc-dex
AGENT_PRIVATE_KEY=0xYOUR_AGENT_PRIVATE_KEY npm run agent -- serve --port 8787
```

Use this endpoint in the ARCOX DEX Agent Jobs UI:

```text
http://127.0.0.1:8787/agent
```

For normal users, keep the default hosted endpoint:

```text
/api/agent/ask
```

The endpoint accepts job prompts from the UI and returns:

- request ID
- accepted/rejected status
- suggested provider
- suggested evaluator
- suggested USDC budget
- deliverable text
- deliverable hash
- next steps

## Check Agent Wallet

```bash
AGENT_PRIVATE_KEY=0xYOUR_AGENT_PRIVATE_KEY npm run agent -- status
```

The wallet needs Arc testnet gas and USDC for actions that create, fund, submit, or complete jobs.

## Register Agent Identity

```bash
AGENT_PRIVATE_KEY=0xYOUR_AGENT_PRIVATE_KEY npm run agent -- register --metadata-uri ipfs://YOUR_METADATA
```

Copy the returned `agentId` into the ARCOX DEX Agent Jobs UI.

## Link Agent In UI

1. Open ARCOX DEX.
2. Go to `Agent Jobs`.
3. Open `AI Link`.
4. Enter the onchain Agent ID.
5. Set endpoint:

```text
http://127.0.0.1:8787/agent
```

6. Sign the link message with the owner wallet.
7. Run a simulation prompt.

The UI will POST to the terminal agent endpoint. If the agent is not running, the UI will show an endpoint error.

## Read A Job

```bash
AGENT_PRIVATE_KEY=0xYOUR_AGENT_PRIVATE_KEY npm run agent -- read-job --job-id 1
```

## Submit A Deliverable

The provider wallet should run:

```bash
AGENT_PRIVATE_KEY=0xPROVIDER_PRIVATE_KEY npm run agent -- submit --job-id 1 --deliverable "Completed deliverable proof"
```

## Complete A Job

The evaluator wallet should run:

```bash
AGENT_PRIVATE_KEY=0xEVALUATOR_PRIVATE_KEY npm run agent -- complete --job-id 1 --reason "approved"
```

## Full Test Flow

1. Start terminal agent:

```bash
AGENT_PRIVATE_KEY=0xYOUR_AGENT_PRIVATE_KEY npm run agent -- serve --port 8787
```

2. Connect ARCOX DEX UI.
3. Register or read an Agent ID.
4. Link the AI endpoint in `Agent Jobs -> AI Link`.
5. Run a prompt.
6. Use the prompt result to create a job.
7. Set budget and fund escrow.
8. Run terminal submit command.
9. Run terminal complete command.
10. Read the job again in UI or terminal.

## Security

Never commit `AGENT_PRIVATE_KEY`.

Use testnet-only keys for this flow. This agent is a local developer agent for Arc testnet experiments.

The hosted planner agent cannot approve, swap, bridge, send, submit, or complete using a user's wallet. It only creates structured intent. User-wallet actions must still be signed by the user in MetaMask or another wallet.
