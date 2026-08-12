---
title: x402 Extensions
description: Vendored x402 extension specs (from x402-foundation/x402) - which ones apply to the Cosign facilitator on BOT Chain.
---

# x402 Extensions

Vendored from [x402-foundation/x402](https://github.com/x402-foundation/x402)
`specs/extensions/` (MIT). These extend the core v2 protocol.

## Included (relevant to us)

| Extension | What it does | Relevance to Cosign |
|---|---|---|
| [bazaar.md](bazaar.md) | Resource discovery/cataloging - resource servers declare endpoint specs so facilitators can index them in a discovery service | **High** - backs the Phase 4 discovery/Bazaar + dashboard catalog |
| [payment_identifier.md](payment_identifier.md) | Clients attach an `id` used as an idempotency key across resource server and facilitator | **High** - maps to the Phase 1 settlement-ledger / replay-protection work |
| [extension-offer-and-receipt.md](extension-offer-and-receipt.md) | Server-side signatures: signed offers (commits to `accepts[]` terms) and signed receipts (proof of payment+delivery) | **Medium** - dispute evidence / auditability for our consent-gated payments |
| [http-message-signatures.md](http-message-signatures.md) | Establishes the paying agent's identity via RFC 9421 HTTP Message Signatures | **Medium** - useful for per-payer rate limiting / attribution |
| [extension-auth-hints.md](extension-auth-hints.md) | Server tells clients which `accepts[]` entries need authentication and how to obtain credentials before paying | **Medium** - relevant once our resource-server stack gates paid endpoints behind auth |
| [sign-in-with-x.md](sign-in-with-x.md) | CAIP-122 wallet-based auth - identify returning users, skip payment for previously-paid addresses | **Low-Medium** - optional "returning customer" UX on top of the consent layer |
| [builder_code.md](builder_code.md) | ERC-8021 on-chain attribution - appends a builder code suffix to settlement calldata to attribute the app + facilitator | **Low** - analytics attribution nicety, adds calldata constraints we must weigh against our calldata policy |

## Not included (decided)

- `eip2612_gas_sponsoring.md`, `erc20_gas_sponsoring.md` - ERC-20 gas-sponsoring
  schemes. BOT is a **native** currency and we use BOT Chain's native EOA
  paymaster instead; these don't apply.
- `builder_code.md` was kept because it is cheap to adopt and useful for
  analytics attribution, but it adds calldata constraints - if the calldata
  policy (see [`scheme_exact_botchain.md`](../schemes/exact/scheme_exact_botchain.md)) ever conflicts, drop it.
