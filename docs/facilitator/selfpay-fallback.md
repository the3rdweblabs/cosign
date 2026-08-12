---
title: Self-pay fallback
description: The required default settlement path - plain x402 that settles with a normal signed transaction over the public RPC. No bundler, no unproven infrastructure.
---

# Self-pay fallback

`facilitator/src/selfpay-fallback.ts` - `SelfpayFallback`

**This path is not optional**. It is the default settlement backend: plain, standalone x402 that settles with a **normal** signed transaction. The agent sends tBOT to the seller and pays its own gas through the ordinary chain RPC. No bundler, no zero-gas-price tx, no dependency on BOT Chain's (unproven) builder/bundle infrastructure.

The [resource-server](/cosign/examples/resource-server/) example does not have a single point of failure on both testnet and mainnet - so the facilitator works even if the native paymaster path is completely dead.

## Flow

### `verify()` - validate + simulate

1. Scheme must be `exact`; asset must be the native gas token (zero address).
2. `network` must parse to the configured chain id (`eip155:968` → `968`, `eip155:677` → `677`).
3. Parse the raw tx, recover the sender.
4. **Match the details:** `to == payTo` and `value == amount` (exact).
5. `eth_call`-simulate the tx - it must succeed before we call it verified.

```ts
{ verified: true, txHash: keccak256(rawTx), from }        // good
{ verified: false, message: "Simulation failed: …" }      // rejected
```

### `settle()` - broadcast and wait

1. `eth_sendRawTransaction` on the public RPC.
2. Wait for the receipt; the tx must end `success`.
3. Return the tx hash + block number (the resource server echoes these in its `PAYMENT-RESPONSE` header).

```ts
{ settled: true, txHash, blockNumber }       // good
{ settled: false, txHash, message: "Transaction reverted" }
```

## Why it matters

| | Self-pay (default) | Native paymaster (opt-in) |
|---|---|---|
| Gas | paid by the agent | sponsored (zero-gas for the agent) |
| Dependencies | public RPC only | sponsor key + builder/bundle infra |
| Guaranteed to ship | ✅ yes | ⚠️ only if builder access is confirmed |

`x402-adapter.ts` picks self-pay for any transaction that isn't a zero-gas-price tx, and falls back to it whenever the bundler errors. The `@xbot02/fetch` client does the same on its side: zero-gas first, re-sign self-pay on refusal.
