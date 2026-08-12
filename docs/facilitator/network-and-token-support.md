---
title: Networks & token support
description: Which network identifiers and tokens Cosign's facilitator supports on BOT Chain, and how this table will grow as we add support.
---

# Networks & Token Support

This page documents what Cosign's facilitator supports **today** on BOT Chain,
and is the place new network/token support gets recorded as we add it.

## Network identifiers (CAIP-2)

x402 uses [CAIP-2](https://chainagnostic.org/CAIPs/caip-2) identifiers
(`namespace:reference`). BOT Chain is an EVM chain, so its identifiers are
`eip155:<chainId>`. These are self-assigned (nothing is officially registered
for BOT Chain anywhere yet).

| Network | CAIP-2 ID | RPC | Explorer |
| ------- | --------- | --- | -------- |
| BOT Chain Testnet | `eip155:968` | `https://rpc.bohr.life` | `https://scan.bohr.life` |
| BOT Chain Mainnet | `eip155:677` | `https://rpc.botchain.ai` | `https://scan.botchain.ai` |

## Token support

| Asset | Transfer method | Notes |
| ----- | --------------- | ----- |
| **BOT** (tBOT on testnet) | Native value transfer (signed EOA tx) | Native currency, not ERC-20. Zero address (`0x0000000000000000000000000000000000000000`). Settled via the native EOA paymaster (gasless) or the self-pay fallback. |

BOT Chain is **native-currency only** for Cosign's facilitator. The canonical
x402 EVM transfer methods - **EIP-3009** and **Permit2** - apply to ERC-20
tokens only and do **not** apply to native BOT. Our binding replaces them with:

1. A signed native transfer at gas price zero, sponsored through the native
   EOA paymaster (BEP-414-style), or
2. A plain self-paid native transfer when sponsorship is unavailable
   (`selfpay-fallback.ts`).

## Adding support for more tokens / networks

This section is intentionally the "grow here" list. When we support
additional assets or chains, record them here:

- **Adding a token** (e.g. an ERC-20 on BOT Chain): list its CAIP-2 network,
  contract address, EIP-712 name/version (if EIP-3009) or Permit2 route,
  decimals, and transfer method. For a custom ERC-20 you need the token's
  `name()` and `version()` from the block explorer for EIP-712 signing.
- **Adding a network** (e.g. a second chain the facilitator serves): list its
  CAIP-2 ID, RPC, explorer, supported assets, and settlement path.
- **Price strings**: the canonical SDK supports `"$0.01"`-style pricing only
  on chains with a pre-configured default stablecoin. BOT Chain has **no**
  configured default, so price strings are **not** supported here - use an
  explicit `TokenAmount` (atomic units + zero asset address) instead.

## Production-readiness checklist (new EVM network)

Before treating a new network as production-ready in Cosign, confirm:

1. Which token is accepted and its transfer method (native vs ERC-20).
2. A production settlement path exists: Cosign's own facilitator, a managed
   facilitator, or self-facilitation - for BOT Chain it is Cosign's own.
3. Explicit `TokenAmount` pricing is used (no dollar-string defaults).

## References

- [The Facilitator](./core-concepts/facilitator.md)
- [HTTP 402](./core-concepts/http-402.md)
- [`x402 (xBOT02)` endpoints](./x402.md)
- [Scheme: `exact` on BOT Chain](./x402/schemes/exact/scheme_exact_botchain.md)
- [Canonical network & token support (x402)](https://github.com/x402-foundation/x402/blob/main/docs/core-concepts/network-and-token-support.mdx) - the upstream reference this page adapts
