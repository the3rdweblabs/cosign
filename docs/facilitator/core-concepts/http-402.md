---
title: HTTP 402
description: How x402 activates the long-reserved HTTP 402 status code, the three payment headers in V2, and what is different on BOT Chain.
---

# HTTP 402

[HTTP 402](https://datatracker.ietf.org/doc/html/rfc7231#section-6.5.2)
`Payment Required` is a standard but historically unused HTTP status code.
x402 activates it:

- To inform clients (buyers or agents) that payment is required.
- To communicate payment details - amount, currency, destination.
- To give clients everything needed to pay programmatically.

## Why x402 uses 402

Frictionless, API-native payments for web resources:

- Machine-to-machine payments (e.g. AI agents).
- Pay-per-use models - API calls, paywalled content.
- Micropayments without account creation or traditional payment rails.

Keeping payments inside a standard HTTP status code makes the protocol
natively web-compatible and trivially integrable into any HTTP service.

## Payment headers in V2

| Header | Direction | Description |
|--------|-----------|-------------|
| `PAYMENT-REQUIRED` | Server → Client | Base64-encoded payment requirements (accepted schemes, price, network, payTo) |
| `PAYMENT-SIGNATURE` | Client → Server | Base64-encoded `PaymentPayload` authorizing payment |
| `PAYMENT-RESPONSE` | Server → Client | Base64-encoded `SettlementResponse` - success or error detail |

All three contain Base64-encoded JSON, which keeps values safe inside headers
regardless of special characters.

## Settlement timing depends on the scheme

Whether funds move onchain in the same HTTP round trip depends on the scheme:

- **`exact`** settles immediately.

Cosign's enabled scheme is `exact` - funds move in the same round trip via the
native paymaster or self-pay (see [schemes/README](../x402/schemes/README.md)).

## BOT Chain specifics

The generic 402 flow is unchanged, but two things are BOT-Chain-specific:

1. **Native asset**: `asset` is the zero address - BOT (tBOT on testnet) is
   native currency, not ERC-20, so there is no token approval step.
2. **Gasless settlement**: the client's signed transfer rides the native EOA
   paymaster bundle for gas-free sponsorship, with the mandatory
   [self-pay fallback](../selfpay-fallback.md) when sponsorship is unavailable.

## References

- [The Facilitator](./facilitator.md)
- [`x402 (xBOT02)` endpoints](../x402.md)
- [HTTP/1.1 Specification (RFC 7231)](https://tools.ietf.org/html/rfc7231)
- [HTTP 402 Status Code](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/402)
- [HTTP transport (vendored)](../x402/transports-v2/http.md)
