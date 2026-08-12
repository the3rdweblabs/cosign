---
title: @xbot02/fetch
description: withBOT02 - wrap any fetch and automatically pay x402 bills through the facilitator. The agent never sees a 402.
---

# `@xbot02/fetch`

The one-call x402 integration. `withBOT02()` wraps **any** fetch-compatible function (Node undici, browser, whatever) so a 402 → pay → retry → served cycle happens automatically. The caller never sees a 402.

## Usage

```ts
import { withBOT02 } from "@xbot02/fetch";
import { createWalletSource, botChainTestnet } from "@xbot02/core";

const source = createWalletSource({ kind: "private-key", privateKey: process.env.AGENT_KEY });

const paidFetch = withBOT02({
  account: source.account,          // viem LocalAccount - must be able to sign offline
  chain: botChainTestnet,          // chain to sign against
  facilitatorUrl: "http://localhost:3000",
  // network, getGasPrice, baseFetch - all optional (see options below)
});

const res = await paidFetch("http://localhost:4000/hubot-task", { method: "POST" });
console.log(res.status); // 200
```

## How it works

```
1. first request  → sent untouched
2. got a 402?     → parse the PAYMENT-REQUIRED header, pick a matching option
3. sign          → native tBOT transfer for the exact amount
                   · + a second transfer for the facilitator's fee (GET /v1/fee) if one is charged
                   · zero gas price first (BOT Chain paymaster path)
                   · if the facilitator refuses, re-sign with a normal gas price (self-pay)
4. settle        → POST /verify + /settle to the facilitator
5. retry         → original request with the PAYMENT-SIGNATURE header → return the response
```

The payment option is selected by `scheme === "exact"`, matching `network` (default: the active BOT network - `eip155:968` on testnet / `eip155:677` on mainnet), and `asset ===` native token.

## Facilitator fees

Before signing, `withBOT02` fetches the facilitator's schedule from
`GET {facilitatorUrl}/v1/fee`. If a fee is advertised (`bps > 0` and a
`receiver`), the client signs a **second transfer** of
`ceil(amount * bps / 10000)` wei to the fee receiver (nonce = main tx + 1) and
includes it as `feeRawTx` in the payment payload. Fees always settle via the
self-pay path - the zero-gas paymaster route rejects them, and the SDK then
re-signs with a normal gas price. See [facilitator fees](../../facilitator/README.md#environment).

## Options

| Option | Default | Notes |
|---|---|---|
| `account` | - | **required** - viem `LocalAccount` |
| `chain` | - | **required** - `botChainTestnet` / `botChainMainnet` |
| `facilitatorUrl` | - | **required** - the facilitator's base URL |
| `network` | active BOT network (`botNetworkConfig().caip2`) | CAIP-2 id to match against the payment requirements |
| `getGasPrice` | `1 gwei` | supplies gas price for the self-pay re-sign |
| `baseFetch` | `globalThis.fetch` | override the underlying fetch |

## Failure modes

- No acceptable payment option in the `PAYMENT-REQUIRED` header → throws (`no acceptable payment option…`).
- Facilitator won't verify/settle even self-pay → throws (`payment not verified by facilitator…`).
- Requires a **local signer** - a `json-rpc` wallet source cannot sign payments offline.

## Related

- Facilitator side: [x402 endpoints](../../facilitator/x402.md) and [self-pay fallback](../../facilitator/selfpay-fallback.md).
- Used by the agent MCP server's `pay_uri` tool (see [mcp](../mcp/README.md)).
