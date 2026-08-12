---
title: Resource server
description: Paid API examples - POST /hubot-task (consent-gated) and POST /market-report (pure x402) answer HTTP 402 until the caller proves payment, then serve. The honest HTTP-402 story for the demo.
---

# Resource server

`examples/resource-server/` - paid API examples. Each endpoint answers `HTTP 402 Payment Required` until the caller proves payment, then serves content. It keeps the "agent hits a real HTTP 402, pays, gets served" story honest: it only talks to the facilitator over HTTP, never in-process.

Two endpoints ship, exercising both ways an agent can pay:

| Endpoint | Price (default) | Consent | What it sells |
|---|---|---|---|
| `POST /hubot-task` | 1 tBOT testnet / 0.001 BOT mainnet | **required** (`requireConsent: true`) | Dispatch a physical HuBot robot |
| `POST /market-report` | **0.5 tBOT testnet / 0.015 BOT mainnet** | **none** (`requireConsent: false`) | A digital BOT Chain market report |

The `extra.requireConsent` flag is how the endpoint tells the agent which flow to
use: a pure x402 endpoint (`false`) is paid directly with no `ConsentGateway`
round-trip; a consent-gated one (`true`, or absent) requires an on-chain approval
first. The agent reads the flag from the `PAYMENT-REQUIRED` header and picks the
flow accordingly - nothing is hard-coded.

## The 402 flow (same for both endpoints)

### 1. First request - no payment

```bash
curl -s http://localhost:4000/market-report -X POST -H 'content-type: application/json' -d '{}'
```

```http
HTTP/1.1 402 Payment Required
PAYMENT-REQUIRED: <base64-encoded payment requirements>
Content-Type: application/json
```

The `PAYMENT-REQUIRED` header decodes to:

```json
{
  "x402Version": 2,
  "error": "PAYMENT-SIGNATURE header is required",
  "resource": {
    "url": "/market-report",
    "serviceName": "BOT Chain market report",
    "description": "Live BOT Chain chain stats (latest block, gas price) - real on-chain data, no price oracle",
    "mimeType": "application/json",
    "tags": ["market", "report", "digital"]
  },
  "accepts": [
    {
      "scheme": "exact",
      "network": "eip155:968",
      "amount": "500000000000000000",
      "asset": "0x0000000000000000000000000000000000000000",
      "payTo": "0x…",
      "maxTimeoutSeconds": 600,
      "extra": { "assetTransferMethod": "native", "paymentFlow": "authorization", "requireConsent": false }
    }
  ]
}
```

### 2. Retry with payment

The client signs a native tBOT transfer of exactly `amount` to `payTo` and retries with a `PAYMENT-SIGNATURE` header:

```http
PAYMENT-SIGNATURE: <base64-encoded { "payment": { "rawTx": "0x…" } }>
```

The server hands `{ x402Version, paymentRequirements, paymentPayload }` to the
facilitator's `/verify` and `/settle`. Content is served **only** once the
facilitator confirms settlement.

```http
HTTP/1.1 200 OK
PAYMENT-RESPONSE: <base64-encoded { x402Version, resource, receipt: { txHash, blockNumber } }>
```

```json
{
  "status": "ok",
  "report": {
    "date": "2026-08-11",
    "network": "testnet",
    "chainId": 968,
    "priceBOT": null,
    "volume24hBOT": null,
    "latestBlock": "19503904",
    "latestBlockTimestamp": "2026-08-11T10:41:22.000Z",
    "averageGasPrice": "20 gwei",
    "dataSource": "https://rpc.bohr.life"
  },
  "txHash": "0x…",
  "blockNumber": 12345
}
```

> **Real data, not mocked.** The report is built at serve time from live
> BOT Chain state read over the active network's RPC (`latestBlock`,
> `latestBlockTimestamp`, `averageGasPrice`). BOT has no on-chain USD price
> oracle, so `priceBOT` / `volume24hBOT` are honest `null`s rather than
> invented numbers. If the RPC is unreachable the fields are served as
> `null` with a `note` explaining why.

## Environment

`BOT_NETWORK` selects the active network (`testnet` default, or `mainnet`);
the payment network is read as `RESOURCE_NETWORK_<NETWORK>` with the
unsuffixed `RESOURCE_NETWORK` as fallback.

| Variable | Default | Notes |
|---|---|---|
| `BOT_NETWORK` | `testnet` | `testnet` or `mainnet` |
| `RESOURCE_PORT` | `4000` | listener |
| `RESOURCE_PAYTO` | - | **required** - the "pay to" address receiving the payment |
| `HUBOT_TASK_PRICE_TESTNET` / `_MAINNET` | `1000000000000000000` / `1000000000000000` | hubot-task price in wei (1 tBOT testnet, 0.001 BOT mainnet); plain `HUBOT_TASK_PRICE` is the fallback |
| `MARKET_REPORT_PRICE_TESTNET` / `_MAINNET` | `500000000000000000` / `15000000000000000` | market-report price in wei (0.5 tBOT testnet, 0.015 BOT mainnet); plain `MARKET_REPORT_PRICE` is the fallback |
| `FACILITATOR_URL` | `http://localhost:3000` | the facilitator's base URL |
| `RESOURCE_NETWORK_TESTNET` / `_MAINNET` | `eip155:968` / `eip155:677` | payment network (currently informational) |

## Running

```bash
cd examples/resource-server
npm install
cp .env.example .env   # fill in RESOURCE_PAYTO
npm start              # :4000
```

## How to extend it

Both routes are built on a shared `src/routes/x402.ts` factory
(`createX402Route`) that implements the verify/settle mechanics once. The
`PaymentRequired` object and its base64 `payment-required` header are built
by `@xbot02/core`'s payment middleware (`buildPaymentRequirements` /
`encodePaymentRequirements`) - the same building blocks an API builder would
use in their own server - and the factory only adds the facilitator
`/verify` + `/settle` orchestration on top. `src/routes/hubot-task.ts`
(`createHubotTaskRoute`, `requireConsent: true`) and `src/routes/market-report.ts`
(`createMarketReportRoute`, `requireConsent: false`) are thin wrappers that
supply the resource metadata, the price, and the 200 response body. To sell
something else, add a wrapper with your own `requireConsent` decision, price,
and resource info.
