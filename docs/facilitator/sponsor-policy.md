---
title: Sponsor policy
description: The gatekeeper between a zero-gas transaction and the bundler - every sponsorship must clear ConsentGateway.isApproved first.
---

# Sponsor policy

`facilitator/src/policy.ts` - `SponsorPolicy`

The sponsor policy is the enforcement point that ties the payment rails back to the consent layer. Before the facilitator sponsors (pays gas for) any transaction, this policy must accept it.

## How it decides

```text
incoming tx (to, from, value)
        │
        ▼
match against the most recent registered consent request
  (same agent/from, same target/to, same amount/value)
        │
        ├─ no match  ──────────────►  { Sponsorable: false }
        │
        ▼
ConsentGateway.isApproved(requestId)
        │
        ├─ true  ──────────────────►  { Sponsorable: true }
        └─ false ──────────────────►  { Sponsorable: false }
```

- The match must be **exact**: `from == request.agent`, `to == request.target`, and the hex `value` must equal the request amount.
- `isApproved` is `true` only for `AutoApproved` / `Approved` requests. A `Pending` request past its 15-minute timeout counts as `false`.

## API

```ts
new SponsorPolicy({ client, consentGatewayAddress })

checkSponsorable({ to, from, value }): Promise<{ Sponsorable: boolean; SponsorPolicy: string }>
```

- `client` - a viem `PublicClient` for chain 968.
- `consentGatewayAddress` - the deployed `ConsentGateway`.
- The policy name is surfaced in the RPC response (`SponsorPolicy: "cosign-consent-gateway"`) so callers can see which policy was evaluated.

## Where it's enforced

1. **`pm_isSponsorable`** - the wallet's pre-check (`paymaster.ts`).
2. **`eth_sendRawTransaction`** - re-checked on submission, so a tx can't be sponsored after the request expired or was rejected mid-flight.
3. **x402 `/verify`** for zero-gas payloads - routed through the same policy via the x402 adapter.

## Guarantees

- A transaction can **never be gas-free** unless a human (or the policy) already cleared the underlying consent request on-chain.
- The facilitator can't be used to send arbitrary sponsored value: no matching approved request → rejected.
- No consent contract deployed at `CONSENT_GATEWAY_ADDRESS` → the read reverts → sponsorship fails closed (never sponsor blindly).
