# Agent Identity

ARCOX detects Arc Testnet ERC-8004 identities owned by the connected wallet. Registration through ARCOX is optional.

- AI Router works without an identity. Its API key is personal and cannot access Agent Jobs.
- When an identity is active, new `arx_sk_...` keys bind to its `agentId` and owner wallet.
- Agent Jobs require an active owned identity.
- Agentic contract calls use the Arc Memo contract. Memos contain hashes and payment/job references only, never prompts, responses, API keys, or provider secrets.
- Unified Balance remains user-owned. ARCOX treasury receives USDC only when a paid request or job executes.

References: [Arc Agentic Economy](https://docs.arc.io/build/agentic-economy), [ERC-8004 quickstart](https://docs.arc.io/arc/tutorials/register-your-first-ai-agent), and [Transaction memos](https://docs.arc.io/arc/concepts/transaction-memos).
