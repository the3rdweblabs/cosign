---
title: x402 Schemes
description: The x402 payment schemes Cosign documents and enables on BOT Chain - currently only exact, with its core, EVM, and BOT Chain bindings.
---

# x402 Schemes

A scheme defines *how* a payment is made. Each scheme has a core spec, an EVM
binding (the canonical implementation), and a BOT Chain binding - Cosign's
adaptation for a native-currency chain with a native EOA paymaster.

| Scheme | Core | EVM binding | BOT Chain binding | Status on BOT Chain |
| --- | --- | --- | --- | --- |
| `exact` | [scheme_exact.md](exact/scheme_exact.md) | [EVM](exact/scheme_exact_evm.md) | [BOT Chain](exact/scheme_exact_botchain.md) | **Enabled** - the shipping scheme |

## Which schemes are enabled?

Only `exact`. It settles immediately in the same HTTP round trip via the
native paymaster or self-pay - see [the binding](exact/scheme_exact_botchain.md).
`GET /supported` advertises it for both networks (`eip155:968` testnet,
`eip155:677` mainnet), and the facilitator rejects any other scheme with
`invalid_scheme`.

## Schemes reviewed but not implemented

The other schemes defined by the x402 protocol - [`upto`](https://github.com/x402-foundation/x402/blob/main/specs/schemes/upto/scheme_upto.md), [`auth-capture`](https://github.com/x402-foundation/x402/blob/main/specs/schemes/auth-capture/scheme_auth_capture.md), and
[`batch-settlement`](https://github.com/x402-foundation/x402/blob/main/specs/schemes/batch-settlement/scheme_batch_settlement.md) - were evaluated and deliberately not implemented. Each
conflicts with Cosign's core thesis that no party holds funds: `upto` requires
a surplus/refund window, `auth-capture` locks funds in escrow until capture, and
`batch-settlement` (capital-backed) uses on-chain channel deposits. If the
upstream protocol later defines a scheme compatible with this thesis, it will be
evaluated and added here.

## What's different on BOT Chain

The EVM binding relies on EIP-3009/Permit2 (ERC-20 authorizations). BOT is
**native** (not ERC-20), so the BOT Chain binding instead:

1. Uses a **signed native value transfer** (`rawTx`) at gas price zero.
2. Settles it through the **native EOA paymaster** (BEP-414-style) for gasless
   sponsorship, with the **mandatory self-pay fallback**.
3. Verifies the consent gate (`ConsentGateway.isApproved(requestId)`) before
   any settlement path - including self-pay.
4. Keeps `asset` as the zero address (native BOT/tBOT).

## References

- [Scheme specs (vendored)](https://github.com/x402-foundation/x402/tree/main/specs/schemes) - the upstream source
- [x402 specification v2](../x402-specification-v2.md)
- [Core concepts](../../core-concepts/README.md)
