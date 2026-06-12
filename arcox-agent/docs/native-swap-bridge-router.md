# ARCOX Native Swap Bridge Router

`ArcoxNativeSwapBridgeRouter` is the source-chain router for native-token payment into Arc.

Flow:

1. User sends native gas token to the router, for example ETH on Ethereum Sepolia.
2. Router wraps native token into WETH-like token.
3. Router calls Uniswap Universal Router with a bundled `WRAP_ETH -> V3_SWAP_EXACT_IN` command.
4. Router takes the ARCOX platform fee in USDC.
5. Router approves Circle `TokenMessengerV2`.
6. Router calls CCTP `depositForBurn`.
7. ARCOX waits for Circle attestation.
8. ARCOX mints USDC to the receiver on Arc.

This bundles the source-chain `wrap -> swap -> fee -> burn` into one user transaction.
The attestation and destination mint cannot be inside the same source-chain transaction because they depend on Circle signing the burn message and the destination chain accepting the mint.

## Supported scope

EVM source chains only:

- Ethereum Sepolia native ETH, using the official Uniswap Universal Router if no env override is set
- Base Sepolia native ETH, using the official Uniswap Universal Router if no env override is set
- Arbitrum Sepolia native ETH, only if a Universal Router-compatible deployment is provided in env
- HyperEVM Testnet native HYPE, only if a WETH-like wrapper and Uniswap-compatible router/pool exist

Solana native SOL requires a separate Solana adapter/program. Do not route SOL through this EVM contract.

## Required environment

Set the source chain wrapped-native token and Uniswap Universal Router address before deploy.
Ethereum Sepolia and Base Sepolia have checked defaults in the deploy script, but env overrides are still supported:

```text
ETHEREUM_SEPOLIA_WRAPPED_NATIVE=
ETHEREUM_SEPOLIA_UNIVERSAL_ROUTER=

BASE_SEPOLIA_WRAPPED_NATIVE=
BASE_SEPOLIA_UNIVERSAL_ROUTER=

ARBITRUM_SEPOLIA_WRAPPED_NATIVE=
ARBITRUM_SEPOLIA_UNIVERSAL_ROUTER=

HYPEREVM_TESTNET_WRAPPED_NATIVE=
HYPEREVM_TESTNET_UNIVERSAL_ROUTER=
```

Only use verified official router addresses and confirm the wrapped-native/USDC pool has liquidity. Uniswap docs warn not to assume deployments are the same across chains. The deploy script checks that the configured router and wrapped-native addresses have bytecode before deploying.

## Compile

```bash
npm --prefix arcox-agent run compile:router
```

## Deploy

```bash
DEPLOY_CHAINS=Ethereum_Sepolia,Base_Sepolia npm --prefix arcox-agent run deploy:native-swap-bridge-router
```

Deployment output is written to:

```text
arcox-agent/deployments/arcox-native-swap-bridge-router.testnet.json
```

## Current testnet deployments

- Ethereum Sepolia: `0x8fE3d887cD7D08D5A45bEaa57D061FFf9192EB59`
- Base Sepolia: `0x3c5beFa0c208F0732D2c357f26EB897E727da498`
- Arbitrum Sepolia: pending. The official Uniswap Universal Router deploy-address list does not include Arbitrum Sepolia, and no `ARBITRUM_SEPOLIA_UNIVERSAL_ROUTER` env override is set.
- Solana Devnet: not applicable for this EVM router. The existing Solana router program `C7XUB3Ep67seiJAzz4Apeeus2AbxbnuqFzvodDWxqoTH` handles USDC fee transfer flows, not SOL-native swap-and-bridge.

## Safety

- `amountOutMinimum` must come from a quote with slippage protection.
- Never use `amountOutMinimum = 0` in production.
- If the Uniswap route is illiquid, the transaction must revert before CCTP burn.
- Native token bridge UI must stay disabled until router deployment and route quote are configured.
