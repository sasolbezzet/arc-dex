# Circle/Arc SDK Bug Report: Solana Browser Signing and Delegate Consistency

## Environment

- `@circle-fin/app-kit`: `1.8.1`
- `@circle-fin/adapter-solana-kit`: `1.5.1`
- `@circle-fin/adapter-viem-v2`: `1.12.1`
- `viem`: `2.50.4`
- Source: Solana Devnet, canonical Devnet USDC
- Destination: Arc Testnet (`5042002`)
- Gateway: `https://gateway-api-testnet.circle.com`

Relevant documentation:

- https://docs.arc.network/app-kit
- https://docs.arc.network/app-kit/tutorials/unified-balance/manage-delegates
- https://developers.circle.com/gateway/quickstarts/unified-balance-solana
- https://developers.circle.com/gateway/references/solana

## Confirmed issue 1: provider factory loses the fee-payer signature

### Reproduction

1. Construct a Wallet Standard-compatible provider with `address`,
   `isConnected`, `connect`, `disconnect`, and `signTransaction`.
2. Pass it to `createSolanaKitAdapterFromProvider`.
3. Call `kit.unifiedBalance.deposit` from `Solana_Devnet`.
4. The simulation succeeds, but transaction execution fails with:

```text
Unknown blockchain error on Solana: Solana error #5663012
Could not determine this transaction's signature. Make sure that the
transaction has been signed by its fee payer.
```

The same wallet and deposit succeed when using `new SolanaKitAdapter` with a
`signTransactions` signer that returns `{ [signerAddress]: signatureBytes }`.

Successful control transaction:

```text
7kARoEhdk2iSJwtpJfL5RAXZuZckDqedxy9DhUqoMRLKn8sa6Crsp94z4z5bWshzekNbZ73GVaz1YWvmkK8ViZv
```

### Expected

`createSolanaKitAdapterFromProvider` should preserve the provider's fee-payer
signature and submit a signed transaction.

### Observed implementation detail

The provider factory exposes a `signAndSendTransactions` signer while its
provider helper calls `signTransaction`. In this version combination, the
resulting transaction reaches `executeTransaction` without a discoverable
fee-payer signature. This root-cause statement is an inference from the shipped
package source plus the A/B real-transaction test.

## Confirmed issue 2: delegate status is temporarily inconsistent after revoke/add

### Reproduction

1. Remove a Solana delegate and confirm status `none`.
2. Add the same delegate and poll until `getDelegateStatus` returns `ready`.
3. Submit a delegated spend; it succeeds.
4. Submit a second delegated spend shortly afterward.
5. Gateway returns HTTP 400:

```text
Signer is not authorized to spend funds from sourceDepositor
```

Transactions around one reproduction:

```text
remove: 3B9oDW6s4ECMJYtSzpjPArc2UxGhL9quuvKCntMcwvmTLfGyi23D5uzn3zpdKpmsomqgzwpw6rNB3F8ZrSD4jeDc
add:    Zs7dSrmZCf6qAScacGwszcM2eP2JdqjejqQpZHbVc8jRHTAZ8nQZJHcvTnrn7GSXcnGnpH2z3Scb8wbphmgEiDL
spend:  0x8730bc48a8248a8708f5f06de65f3ffbf832804d33609482fdc235c4db86cb5e
```

With an already-stable `ready` delegate and no immediate revoke/add, two
sequential spends succeed:

```text
Auto Pay: 0xb1cc7129f2a854fa9f80edc183882f33897731e59245ab31db3fb6e3abcdc2f9
x402:     0x01a3846b0ce23d29c471bfec67c9d76b65da24fed26a5e58fd4374a76d69db8c
```

### Expected

Once `getDelegateStatus` reports `ready`, consecutive delegated spends should
not receive an authorization error. If additional indexer finality is required,
the status API should remain `pending` or document the required delay.

## Needs upstream confirmation: simulation error loses RPC diagnostics

Some browser-wallet deposit failures arrive as `-32002` and are surfaced only as:

```text
the Solana program rejected the simulated transaction
```

The SDK's nested error may omit the simulation logs by the time the App Kit
operation rejects. ARCOX now captures the raw `simulateTransaction` response at
the RPC boundary. A minimal upstream reproduction still needs the exact wallet
and raw RPC payload before this should be filed as a confirmed SDK defect.

## Not yet confirmed upstream: OKX Mobile `chainId NaN`

Observed message:

```text
Provided chainId "NaN" must match the active chainId "5042002"
Version: viem@2.50.4
```

The dApp previously allowed an Arc chain definition without a normalized
numeric `id` to reach Viem. ARCOX now maps `Arc_Testnet` explicitly to `5042002`.
This must be retested on a physical OKX Mobile device with the latest production
bundle. File it upstream only if the error persists, including OKX version,
mobile OS, connected account, action, and the complete wallet RPC error.
