# ARCOX Pay NOWPayments Sandbox

ARCOX Pay is a USDC-first payment simulation for Arc Testnet. The current sandbox flow is public and test-only:

1. User wallet pays/mock-pays USDC on Arc.
2. ARCOX Arc Treasury receives the user payment.
3. ARCOX simulates bridge/rebalance from Arc to Base.
4. ARCOX Base Treasury simulates sending USDC Base to the NOWPayments `pay_address`.
5. NOWPayments IPN marks the ARCOX order paid.

NOWPayments payout wallet is the merchant/ARCOX settlement wallet. NOWPayments `pay_address` is created by NOWPayments in the payment response. In sandbox, if the provider does not return a real `pay_address`, ARCOX uses `ARCOX_SANDBOX_NOWPAYMENTS_DESTINATION_ADDRESS`.

## Env

```bash
NOWPAYMENTS_API_KEY=
NOWPAYMENTS_PUBLIC_KEY=
NOWPAYMENTS_IPN_SECRET=
NOWPAYMENTS_VERIFY_IPN=false
NOWPAYMENTS_BASE_URL=https://api-sandbox.nowpayments.io/v1
NOWPAYMENTS_MODE=sandbox

ARCOX_PAY_BASE_URL=https://arc-dex-bice.vercel.app
ARCOX_DEFAULT_PAY_CURRENCY=usdcbase
ARCOX_DEFAULT_PRICE_CURRENCY=usd
ARCOX_ARC_TREASURY_ADDRESS=
ARCOX_BASE_TREASURY_ADDRESS=
ARCOX_SANDBOX_NOWPAYMENTS_DESTINATION_ADDRESS=0xSANDBOX_NOWPAYMENTS_DESTINATION

CIRCLE_API_KEY=
CIRCLE_BASE_URL=https://api-sandbox.circle.com
CIRCLE_ENV=TEST
CIRCLE_VERIFY_WEBHOOK=false
```

For production later:

```bash
NOWPAYMENTS_BASE_URL=https://api.nowpayments.io/v1
NOWPAYMENTS_MODE=production
```

## Web UI

Open:

```txt
https://arc-dex-bice.vercel.app/pay/sandbox
```

Test flow:

1. Create NOWPayments Sandbox Payment.
2. Check the 3-wallet flow.
3. Simulate User Paid Arc Treasury.
4. Simulate Bridge Arc to Base.
5. Simulate Base Treasury Sent to NOWPayments.
6. Simulate NOWPayments Finished.

## Curl

```bash
curl -i https://arc-dex-bice.vercel.app/api/webhooks/nowpayments

curl -i -X POST https://arc-dex-bice.vercel.app/api/webhooks/nowpayments \
  -H "Content-Type: application/json" \
  -d '{"payment_id":"test_123","payment_status":"finished","order_id":"ARCOX-TEST-001","price_amount":"1","price_currency":"usd","pay_amount":"1","pay_currency":"usdcbase"}'

curl -i -X POST https://arc-dex-bice.vercel.app/api/payments/nowpayments/create \
  -H "Content-Type: application/json" \
  -d '{"amount":1,"price_currency":"usd","pay_currency":"usdcbase","order_id":"ARCOX-TEST-001","description":"ARCOX Pay USDC Base sandbox test","user_id":"demo_user"}'

curl -i -X POST https://arc-dex-bice.vercel.app/api/payments/nowpayments/simulate/user-arc-payment \
  -H "Content-Type: application/json" \
  -d '{"payment_id":"PAYMENT_ID_HERE","user_wallet_address":"0xUSER","amount":"1.00","arc_tx_hash":"0xmockarc"}'

curl -i -X POST https://arc-dex-bice.vercel.app/api/payments/nowpayments/simulate/bridge-to-base \
  -H "Content-Type: application/json" \
  -d '{"payment_id":"PAYMENT_ID_HERE","bridge_tx_hash":"0xmockbridge"}'

curl -i -X POST https://arc-dex-bice.vercel.app/api/payments/nowpayments/simulate/base-treasury-send \
  -H "Content-Type: application/json" \
  -d '{"payment_id":"PAYMENT_ID_HERE","base_tx_hash":"0xmockbase"}'

curl -i -X POST https://arc-dex-bice.vercel.app/api/payments/nowpayments/simulate/finish \
  -H "Content-Type: application/json" \
  -d '{"payment_id":"PAYMENT_ID_HERE"}'

curl -i https://arc-dex-bice.vercel.app/api/webhooks/circle

curl -I https://arc-dex-bice.vercel.app/api/webhooks/circle

curl -i -X POST https://arc-dex-bice.vercel.app/api/webhooks/circle \
  -H "Content-Type: application/json" \
  -d '{"id":"circle_tx_inbound_test_123","type":"transactions.inbound","data":{"transactionId":"tx_in_123","walletId":"wallet_123","status":"CONFIRMED","amount":"1.00","currency":"USDC","chain":"BASE","txHash":"0xinbound","sourceAddress":"0xsource","destinationAddress":"0xdestination"}}'

curl -i -X POST https://arc-dex-bice.vercel.app/api/webhooks/circle \
  -H "Content-Type: application/json" \
  -d '{"id":"circle_gateway_mint_test_123","type":"gateway.mint.finalized","subscriptionId":"sub_test_123","data":{"sourceChain":"ARC","destinationChain":"BASE","amount":"1.00","currency":"USDC","txHash":"0xtestmint","status":"FINALIZED"}}'
```

## MCP Tools

The ARCOX MCP server exposes:

- `arcox_pay_create_nowpayments_sandbox_payment`
- `arcox_pay_get_payment_status`
- `arcox_pay_simulate_user_arc_payment`
- `arcox_pay_simulate_bridge_to_base`
- `arcox_pay_simulate_base_treasury_send`
- `arcox_pay_simulate_nowpayments_finished`
- `arcox_pay_simulate_nowpayments_status`
- `arcox_pay_list_recent_payments`

These tools call ARCOX Pay API endpoints. They do not ask for private keys and do not move real funds in sandbox simulation.

## Production Notes

The current ledger is an in-memory sandbox fallback. It is not production persistence. Before production, move `arcox_payments`, `webhook_events`, and `arcox_mcp_payment_sessions` to PostgreSQL/Redis or another durable store.

Circle webhook verification is disabled by default for testing. Enable only after the exact signature headers and secret are configured.
