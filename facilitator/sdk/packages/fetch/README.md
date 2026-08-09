# @xbot02/fetch

A drop-in `fetch` wrapper that makes any client **pay-to-play**: when a
resource server answers `402`, the wrapper automatically signs a BOT Chain
payment for the listed price, settles it through the xBOT02 facilitator, and
retries the request with the proof. The caller just gets served - it never
sees a `402`.

## Install

```sh
npm i @xbot02/fetch @xbot02/core
```

## Usage

```ts
import { withBOT02 } from "@xbot02/fetch";
import { privateKeyToAccount } from "viem/accounts";
import { botChainTestnet } from "@xbot02/core";

const paidFetch = withBOT02({
  account: privateKeyToAccount("0x..."),   // the agent's signing key
  chain: botChainTestnet,                  // or botChainMainnet
  facilitatorUrl: "http://localhost:3000", // your xBOT02 facilitator
});

// Just fetch. A 402 is handled for you.
const res = await paidFetch("https://api.example.com/hubot/pickup", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ jobId: 42 }),
});
const data = await res.json();
```

## How it works

1. The request goes out untouched.
2. If the server answers `402` with a `payment-required` header, the wrapper
   picks the matching payment option (`scheme=exact`, native BOT asset, your
   network).
3. It fetches the facilitator's fee schedule (`GET /v1/fee`) and signs a
   native transfer for the price - plus a second transfer for the fee when one
   is charged - with a **zero gas price first** (the BOT Chain paymaster path).
4. It submits them to the facilitator (`/verify` then `/settle`).
5. If the zero-gas route is refused (bundler not ready / policy rejection),
   it re-signs with a normal gas price and settles **self-pay** instead.
6. It retries the original request with the `payment-signature` header the
   resource server expects, and returns that final response.

## Options

```ts
withBOT02({
  account,            // viem LocalAccount - required
  chain,              // botChainTestnet | botChainMainnet
  facilitatorUrl,     // e.g. "http://localhost:3000"
  network?,           // CAIP-2 id; defaults to the active BOT_NETWORK
  getGasPrice?,       // () => bigint | Promise<bigint> for the self-pay path
  baseFetch?,         // override the underlying fetch (tests, proxies)
});
```

## Lower-level helpers

- `encodePaymentSignature({ payment: { rawTx, feeRawTx? } })` - base64-encode
  the signed payment payload for the `payment-signature` header, if you want
  to drive the flow yourself.

## Status

v1.0.0. Proven end-to-end on testnet (a live payment of 1 tBOT + fee settled
on-chain). Note: until the bundler/builder channel is confirmed, payments
settle via the self-pay fallback (the agent pays gas). The wrapper handles
both paths automatically.

## License

GPL-3.0-only. Built by [The3rdWebLabs](https://github.com/the3rdweblabs/).
