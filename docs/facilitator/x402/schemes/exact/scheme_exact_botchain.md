---
title: Scheme: exact on BOT Chain
description: Our BOT Chain binding for the exact scheme - native paymaster sponsorship with mandatory self-pay fallback. The enabled scheme.
---

# Scheme: `exact` on BOT Chain (native paymaster)

## Summary

`exact` on BOT Chain transfers a specific amount of the **native currency**
(`BOT`, `tBOT` on testnet) from a client to a resource server. Because BOT is
native and not an ERC-20, the EIP-3009/Permit2 authorization path used by the
EVM scheme does **not** apply. Instead, payments settle through BOT Chain's
native EOA paymaster (BEP-414-style) for gas-free sponsorship, with a mandatory
plain self-pay fallback.

## Networks

| Network | Chain ID | x402 network id | Asset |
|---|---|---|---|
| Testnet | `968` | `eip155:968` | `BOT` (native, tBOT) |
| Mainnet | `677` | `eip155:677` | `BOT` (native) |

The `asset` field in payment requirements is the zero address
(`0x0000000000000000000000000000000000000000`), meaning native currency.

## Payment mechanism

The client signs a **native currency transfer transaction**:

- `to` = `payTo` (resource server's receiving address)
- `value` = the exact amount from payment requirements
- `data` = empty (or a permitted consent-bound calldata, see below)
- `chainId` = the BOT Chain network id (`968` testnet / `677` mainnet)

The signed transaction is delivered to the facilitator as the payment payload
(`rawTx`). Settlement then takes one of two paths:

1. **Native paymaster (gasless)** - `pm_isSponsorable` on the paymaster
   confirms the transaction is within the sponsor policy and the consent gate;
   the client sets gas price to zero, signs, and submits via
   `eth_sendRawTransaction` to the paymaster, which wraps it in a bundle with a
   sponsor transaction covering gas.
2. **Self-pay fallback (always available)** - if sponsorship is unavailable or
   the bundle path fails, the client submits the transaction with its own gas
   and the facilitator verifies on-chain settlement. The self-pay path is not
   optional; the facilitator MUST work with plain self-paid transactions.

## Critical validation requirements

Facilitators MUST enforce the following to prevent sponsorship abuse and
payment fraud:

- **Payer/signature integrity**: the transaction signature must recover to a
  valid address and that address must be the payer.
- **Destination correctness**: `to` MUST equal the `payTo` from payment
  requirements.
- **Amount exactness**: `value` MUST exactly equal the `amount` from payment
  requirements.
- **Network binding**: the transaction `chainId` MUST match the network in the
  payment requirements.
- **Deadline**: the payment MUST settle within `maxTimeoutSeconds` of the
  payment requirements; expired payments MUST be rejected.
- **Consent binding (Cosign-specific)**: the payment MUST reference a consent
  `requestId`, and the facilitator MUST confirm `ConsentGateway.isApproved(requestId)`
  on **every** settlement path - including self-pay - before submitting. This
  is what keeps the circuit breaker (AgentRegistry + ConsentGateway) authoritative.
- **Calldata policy**: non-empty `data` is only permitted when `to` is the
  ConsentGateway (or other allowlisted contract); arbitrary calldata MUST be
  rejected to prevent sponsorship abuse.
- **Replay protection**: a payment payload whose signature or transaction hash
  has already been settled MUST be rejected (settlement ledger). Repeated
  `/settle` calls for the same payload MUST return the recorded result
  (idempotent), not re-execute.

## Gasless settlement details

- Paymaster flow per the native EOA paymaster spec:
  `pm_isSponsorable` returns `{Sponsorable, SponsorPolicy}`; the sponsor policy
  checks `ConsentGateway.isApproved(requestId)`.
- The sponsor transaction MUST cover the user transaction's gas plus margin,
  set a non-zero gas price, and use legacy EIP-155 type so builders accept the
  bundle.
- If the sponsor cannot cover gas or the bundle fails, the facilitator MUST
  fail explicitly with a "sponsorship unavailable" reason - never stall
  silently.

## References

- [Core x402 specification](../../x402-specification-v2.md)
- [HTTP transport](../../transports-v2/http.md)
- [Facilitator x402 endpoints](../../../x402.md)
- [Paymaster RPC](../../../paymaster.md)
- [Sponsor policy](../../../sponsor-policy.md)
- [Self-pay fallback](../../../selfpay-fallback.md)
