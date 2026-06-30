# ARCOX API Pass

Each new AI Router API key is bound to a non-transferable ERC-5192-style API Pass on Arc Testnet.

Flow:

1. Connect the owner wallet and enable Unified Balance Auto Pay.
2. Create an API key. The wallet mints a locked API Pass.
3. Run `arcox-agent serve --port 8787` locally.
4. Configure Hermes/OpenClaw with `http://127.0.0.1:8787/v1` and the one-time displayed `arx_sk_...` key.
5. The local proxy signs a short-lived session challenge with the owner or an on-chain authorized session delegate.

The API key secret and AI prompts are never stored on-chain. Deleting a key disables it before asking the wallet to burn its API Pass. A failed burn leaves the key disabled and can be retried.
