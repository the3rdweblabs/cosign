---
title: Facilitator | xBOT02
description: The x402-compatible payment facilitator for BOT Chain, backed by a self-built implementation of the native EOA paymaster spec - with a guaranteed self-pay fallback.
---

# Facilitator | xBOT02

`facilitator/` - the payment rails for BOT Chain. One process, two protocols:

1. **x402 HTTP** - `POST /verify` and `POST /settle` (the standard “agent hits a 402, pays, gets served” flow).
2. **BOT Chain native EOA paymaster JSON-RPC** - `pm_isSponsorable` and `eth_sendRawTransaction` (BEP-414-style), implemented by us. There was no third-party paymaster for BOT Chain when this was built.

It is the **first x402-compatible facilitator for this chain**, using the self-assigned CAIP-2 network ids `eip155:968` (testnet) and `eip155:677` (mainnet).

## Settlement modes

| Mode | When | How money moves |
|---|---|---|
| **Self-pay** (default) | `PAYMASTER_ENABLED=0` | Agent signs a normal tBOT transfer with its own gas; facilitator simulates + broadcasts via the public RPC |
| **Native paymaster** (opt-in) | `PAYMASTER_ENABLED=1` | Agent signs a zero-gas-price transfer; facilitator checks the sponsor policy, wraps it in a sponsor bundle, submits to builders |

The self-pay fallback is **mandatory by design**: the demo must never depend on unproven testnet bundle infrastructure. The paymaster only touches zero-gas-price transactions.

## Running

```bash
cd facilitator
npm install
cp .env.example .env   # fill in CONSENT_GATEWAY_ADDRESS_<NETWORK> (+ SPONSOR_PRIVATE_KEY only for paymaster mode)
npm start              # listens on :3000
```

## Environment

`BOT_NETWORK` selects the active network (`testnet` default, or `mainnet`);
each config var is read as `NAME_<NETWORK>` (e.g. `BOT_RPC_URL_TESTNET`) with
the unsuffixed `NAME` as fallback.

| Variable | Default | Notes |
|---|---|---|
| `BOT_NETWORK` | `testnet` | `testnet` or `mainnet` |
| `BOT_RPC_URL_TESTNET` / `BOT_RPC_URL_MAINNET` | `rpc.bohr.life` / `rpc.botchain.ai` | chain read RPC per network |
| `CHAIN_ID_TESTNET` / `CHAIN_ID_MAINNET` | `968` / `677` | must match the RPC |
| `AGENT_REGISTRY_ADDRESS_TESTNET` / `_MAINNET` | - | used by the sponsor policy resolution |
| `CONSENT_GATEWAY_ADDRESS_TESTNET` / `_MAINNET` | - | **required** for the active network - the server refuses to boot without it |
| `SPONSOR_PRIVATE_KEY` | - | sponsor EOA that pays gas in paymaster mode; **only required when `PAYMASTER_ENABLED=1`** |
| `PAYMASTER_ENABLED` | `0` | `1` turns on the native paymaster path |
| `PAYMASTER_PORT` | `3000` | HTTP listener |
| `FEE_BPS` | `0` | facilitator surcharge in basis points (100 = 1%), charged to the client |
| `FEE_PERCENT` | - | alternative to `FEE_BPS`: percentage as a number (0.01 = 0.01%) |
| `FEE_RECEIVER` | - | **required when a fee is set** - the address that receives the fee |

The fee is collected as a **second direct transfer** from the client to
`FEE_RECEIVER` (no custody, no fee-collector contract - same model as the
payment itself). The schedule is advertised at `GET /v1/fee` so clients know
the surcharge before signing; the facilitator rejects any payload that skips
it. A fee cannot ride the zero-gas paymaster path - it always settles via
self-pay.

## Endpoints in this process

| Path | Protocol | Docs |
|---|---|---|
| `POST /verify` | x402 | [x402 endpoints](x402.md) |
| `POST /settle` | x402 | [x402 endpoints](x402.md) |
| `GET /supported` | x402 | v2 discovery - `{ kinds, extensions, signers }` (which schemes/networks this facilitator serves) |
| `GET /v1/fee` | x402 | facilitator surcharge schedule (see above) |
| `POST /` (JSON-RPC) | paymaster | [paymaster RPC](paymaster.md) |

## Modules

| File | Responsibility |
|---|---|
| `server.ts` | entrypoint; wires policy + paymaster + x402 adapter |
| `x402-adapter.ts` | routes x402 payloads to the right settlement backend |
| `paymaster.ts` | the JSON-RPC server implementing `pm_isSponsorable` / `eth_sendRawTransaction` |
| `policy.ts` | the sponsor policy - gates sponsorship on `ConsentGateway.isApproved` |
| `selfpay-fallback.ts` | the required default settlement path |
| `fee.ts` | facilitator surcharge config (`FEE_BPS`/`FEE_PERCENT`/`FEE_RECEIVER`), `GET /v1/fee`, fee tx validation |
| `bundler.ts` | (stub) bundle submission to BOT Chain builders |
| `chain.ts` | viem client, chain 968 config, env helpers |

## Testing

```bash
cd facilitator
npm test        # unit + HTTP integration tests
npm run typecheck
```

## Related docs

- [x402 endpoints](x402.md) · [paymaster RPC](paymaster.md) · [sponsor policy](sponsor-policy.md) · [self-pay fallback](selfpay-fallback.md)
