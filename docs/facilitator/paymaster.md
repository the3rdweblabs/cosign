---
title: Paymaster RPC
description: The BOT Chain native EOA paymaster - pm_isSponsorable and eth_sendRawTransaction, request/response shapes and error codes.
---

# Paymaster RPC (BEP-414-style)

`facilitator/src/paymaster.ts` implements BOT Chain's native EOA paymaster spec - exactly the two documented JSON-RPC methods, served on `POST /` of the facilitator (default port `3000`).

## `pm_isSponsorable`

Asks “will you sponsor this transaction?” - i.e. cover its gas via a sponsor bundle.

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "pm_isSponsorable",
  "params": [
    { "to": "0x…", "from": "0x…", "value": "0xde0b6b3a7640000", "data": "0x", "gas": "0x5208" }
  ]
}
```

| Param | Type | Notes |
|---|---|---|
| `to` | hex string | **required** |
| `from` | hex string | **required** - the payer/sender |
| `value` | hex string | **required** - value in wei, hex-encoded |
| `data` | hex string | optional |
| `gas` | hex string | optional |

Response:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": { "Sponsorable": true, "SponsorPolicy": "cosign-consent-gateway" }
}
```

`Sponsorable` is `true` only when the transaction matches a registered consent request **and** `ConsentGateway.isApproved(requestId)` is `true`. See [sponsor policy](sponsor-policy.md).

## `eth_sendRawTransaction`

The wallet flow per spec: if `pm_isSponsorable` says yes, the wallet sets gas price to **zero**, signs, and submits the raw tx **here** (not the normal mempool).

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "eth_sendRawTransaction",
  "params": ["0xf86b…"]
}
```

The facilitator:
1. Parses the raw tx and **requires a zero gas price** (non-zero → rejected).
2. Recovers the sender.
3. Re-checks `pm_isSponsorable` - the sponsor policy must still accept it.
4. Builds and submits the sponsor bundle (`bundler.ts`).
5. Returns the bundle hash.

```json
{ "jsonrpc": "2.0", "id": 2, "result": "0x…" }
```

## Error codes

| Code | Meaning |
|---|---|
| `-32700` | parse error |
| `-32600` | invalid request |
| `-32601` | method not found |
| `-32602` | invalid params |
| `-32603` | internal error |
| `-32001` | sponsor policy rejected the transaction (e.g. non-zero gas price, or `isApproved == false`) |
| `-32000` | bundler not ready - the zero-gas path cannot settle; re-sign with a normal gas price (self-pay) |

## Example - full zero-gas sponsorship

```bash
curl -s http://localhost:3000 \
  -H 'content-type: application/json' \
  -d '{
    "jsonrpc": "2.0", "id": 1, "method": "pm_isSponsorable",
    "params": [{ "to": "0x…", "from": "0x…", "value": "0xde0b6b3a7640000" }]
  }'
# -> { "result": { "Sponsorable": true, "SponsorPolicy": "cosign-consent-gateway" } }

curl -s http://localhost:3000 \
  -H 'content-type: application/json' \
  -d '{ "jsonrpc": "2.0", "id": 2, "method": "eth_sendRawTransaction", "params": ["0xf86b…"] }'
# -> { "result": "0x…" }
```

## Design notes

- The paymaster path is **opt-in** (`PAYMASTER_ENABLED=1`). The default is self-pay because BOT Chain testnet builder/bundle infrastructure is not yet proven - see [self-pay fallback](selfpay-fallback.md).
- A non-zero-gas-price tx is never touched - the facilitator only sponsors true zero-gas submissions, which is the whole point of the BEP-414 flow.
