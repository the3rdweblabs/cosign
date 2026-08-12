---
title: Facilitator
description: The role of the facilitator in x402, how it is adapted for BOT Chain's native-currency + paymaster model, and the deployment paths.
---

# The Facilitator

The facilitator is an optional but recommended service that simplifies
verifying and settling payments between clients (buyers) and servers
(sellers). It is the component Cosign ships as the
[`x402 (xBOT02)` endpoints](../x402.md).

## What is a facilitator?

A service that:

- **Verifies** payment payloads submitted by clients.
- **Settles** payments on the blockchain on behalf of servers.

By using a facilitator, servers do not need direct blockchain connectivity or
their own payment-verification logic. Cosign runs its own facilitator for BOT
Chain because BOT Chain is native-currency only and there is **no third-party
paymaster or facilitator for the chain**.

## Responsibilities

- **Verify payments:** confirm the client's payment payload meets the server's
  declared payment requirements (`PaymentRequirements`).
- **Settle payments:** submit validated payments and monitor confirmation.
- **Provide responses:** return verification and settlement results so the
  server can decide whether to fulfill the request.

The facilitator does **not** hold funds or act as a custodian. It verifies
payloads and executes onchain transfers. On BOT Chain this is a native
`BOT` (tBOT on testnet) transfer routed through one of two backends: the
native EOA paymaster (gasless sponsorship, BEP-414-style) or the
[self-pay fallback](../selfpay-fallback.md).

## Choosing a deployment path

There is no single facilitator model. Three practical paths:

| Goal | Path |
| ---- | ---- |
| Fastest testnet/local quickstart | A public facilitator (e.g. `x402.org` - does **not** support BOT Chain) |
| Managed production | A production facilitator provider that supports your network |
| Full operational control | Run your own facilitator, or self-facilitate in-process |

**BOT Chain is only viable on the third path today.** No public or managed
facilitator supports `eip155:968`/`eip155:677`, so Cosign runs its own. If you
integrate a client for BOT Chain, point it at our facilitator.

## Interaction flow (HTTP)

1. Client requests a resource from a resource server.
2. Resource server responds `402 Payment Required` with a `PAYMENT-REQUIRED`
   header carrying the Base64-encoded payment requirements.
3. Client picks one accepted scheme/payment detail and builds a `PaymentPayload`.
4. Client retries the request with a `PAYMENT-SIGNATURE` header (Base64 payload).
5. Resource server verifies the payload - locally or by POSTing
   `{ x402Version, paymentRequirements, paymentPayload }` to the facilitator's
   `/verify` (the v1 `paymentDetails` field name is accepted as a back-compat alias).
6. If valid, the server performs the work; otherwise it returns `402` again.
7. The server settles - directly onchain, or by POSTing to the facilitator's
   `/settle` endpoint.
8. The facilitator submits the transfer onchain (via paymaster or self-pay),
   waits for confirmation, and returns a settlement response.
9. The resource server returns `200 OK` with a `PAYMENT-RESPONSE` header, or
   `402` with error details on failure.

The exact request/response shapes and the two backends are documented in
[`x402 (xBOT02)` endpoints](../x402.md).

## Duplicate settlement (replay protection)

On Solana a race condition allowed the same transaction to be settled
multiple times before the first submission confirmed onchain; the canonical
x402 code guards this with an in-memory `SettlementCache`.

**Cosign treats this as a hard requirement on BOT Chain too**: repeated
`/settle` calls for the same payload must be idempotent. The facilitator
rejects already-settled payloads (replay/double-spend protection) and returns
the recorded result. This closes the known "no replay/double-spend
protection" gap in the production-readiness plan.

## Summary

The facilitator is an independent verification and settlement layer. On BOT
Chain it is BOT-native, custody-free, and paymaster-backed, with a mandatory
self-pay fallback so it has no single point of failure on unproven testnet
infrastructure.

## References

- [HTTP 402](./http-402.md) - how payment requirements are communicated
- [Networks & token support](../network-and-token-support.md) - BOT Chain CAIP-2 IDs and native asset
- [Wallet](./wallet.md) - identity and payment mechanism
- [`x402 (xBOT02)` endpoints](../x402.md) - our `/verify` and `/settle`
- [Paymaster RPC](../paymaster.md) · [Sponsor policy](../sponsor-policy.md) · [Self-pay fallback](../selfpay-fallback.md)
