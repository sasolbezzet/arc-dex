# ARCOX DEX User Guide

ARCOX DEX is a retail-focused Arc testnet app for wallet connection, Circle Wallet proxy usage, USDC bridge, swap, send, receive, bridge recovery, and agentic payment experiments.

## Key Concepts

- **EOA / MetaMask**: The user-owned wallet. EOA transactions must be signed by the user.
- **Circle Wallet proxy**: A managed wallet mapping stored by the backend for the connected user.
- **E balance**: EOA wallet balance, such as `E-USDC`.
- **C balance**: Circle Wallet proxy balance, such as `C-USDC`.
- **CCTP bridge**: Circle Cross-Chain Transfer Protocol flow: approve, burn, attestation, then mint/receive.

## Getting Started

1. Open the app.
2. Connect MetaMask.
3. Sign the login message.
4. Wait for Circle Wallet setup.
5. Fund the wallet with testnet USDC.
6. Use Swap, Bridge, Send, Receive, Agent Jobs, Info, or Docs.

If Circle Wallet is not visible after connection, press **Retry setup** in the header.

## Swap

Swap is used to exchange supported assets from the selected source wallet. For EOA swaps, the transaction must be signed by the connected wallet.

Always request a quote or estimate before executing a swap. If the app shows that a route is unavailable, try a different amount, pair, or retry later.

## Bridge

Bridge moves supported assets between Arc testnet and supported test networks through Circle CCTP.

Normal bridge flow:

1. Select source chain.
2. Select destination chain.
3. Select funding source.
4. Enter amount.
5. Confirm approve if required.
6. Confirm burn.
7. Wait for attestation.
8. Confirm mint/receive on the destination chain.

For Solana, use **Solana Devnet** with Solflare or Phantom Devnet. Solana bridge flows require Solana wallet signatures.

## Important: Bridge Pending And Retry

A pending bridge does **not** mean the funds are lost.

CCTP bridge has multiple steps:

1. **Approve**: Allows the bridge contract to use the token.
2. **Burn**: Destroys the source-chain token and creates a cross-chain message.
3. **Attestation**: Circle signs proof that the burn happened.
4. **Mint / Receive**: The destination chain receives the message and mints the token.

If burn is successful but mint is pending, do not immediately bridge again with the same amount. Open **Info → Bridge Retry Center**.

Use Retry Center when:

- Burn succeeded but mint failed.
- The browser closed before the mint step.
- Wallet popup was rejected during mint.
- The destination RPC was temporarily busy.
- Gas fee was too low on the destination chain.

Retry checklist:

1. Open **Info**.
2. Find the bridge record in **Bridge Retry Center**.
3. Switch wallet to the destination chain.
4. Make sure the destination wallet has gas.
5. Press **Retry Mint**.
6. Wait for confirmation.
7. Refresh balance.

If retry still fails:

- Copy the burn transaction hash.
- Wait a few minutes because attestation may still be pending.
- Retry again.
- Do not repeat the burn unless you intentionally want to start a new bridge.

## Send

Send transfers supported tokens to another address.

- Circle Wallet send uses the Circle Wallet proxy flow.
- EOA send must be signed by the connected wallet.
- Always check the destination address before sending.

## Receive

Receive displays the wallet address and can create a request link with optional amount and memo. The request link opens the app into the Send flow.

## Agent Jobs

Agent Jobs is the agentic economy experiment in ARCOX DEX.

Current flow:

1. Register an agent identity.
2. Link an AI endpoint to the agent.
3. Create a job.
4. Set budget in USDC.
5. Fund escrow.
6. Submit deliverable.
7. Verifier or evaluator completes the job.

This flow is for testnet experimentation and should not be treated as production settlement.

## Info

Info is the main diagnostics page.

It includes:

- Connected address.
- Circle Wallet ID.
- All balances.
- Bridge Retry Center.
- Bridge history.
- Explorer links.

When anything looks stuck, check **Info** first.

## Safety Notes

- This is a testnet app.
- Do not use mainnet funds.
- Always verify wallet popups before signing.
- For EOA actions, the user wallet is the signer.
- For Circle Wallet proxy actions, the backend uses the stored wallet mapping.
- Pending bridge states are normal in cross-chain systems.
