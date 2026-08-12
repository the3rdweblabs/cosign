---
title: Architecture
description: How the consent layer, facilitator, paymaster, SDK and front-ends fit together - with the request and payment flows.
---

# Architecture

Cosign is four layers that each solve one problem: **what an agent may do**, **how it pays**, **how to integrate**, and **how to watch over it**.

## Layers

```
                ┌────────────────────────────────────────────────┐
                │                Human guardian                  │
                │   console (web) · guardian MCP · any wallet    │
                └───────────────▲────────────────────────────────┘
                                │ approve / reject / expire
                ┌───────────────┴────────────────────────────────┐
                │               Cosign consent layer             │
                │   ConsentGateway  ◄──►  AgentRegistry          │
                │   (holds no funds - policy/state only)         │
                └───────▲──────────────────────────────▲─────────┘
                        │ requestAction()              │ isApproved()
                ┌───────┴──────┐             ┌─────────┴───────────┐
                │  Agent SDK   │             │     Facilitator     │
                │ @xbot02/*    │             │ x402 /verify /settle│
                │  agent MCP   │             │   + EOA paymaster   │
                └───────▲──────┘             └─────────┬───────────┘
                        │ payment-signature            │ native (tBOT/BOT)
                ┌───────┴──────┐                       ▼
                │ resource-srv │ ──402──►   BOT Chain (chain 968)
                └──────────────┘
```

1. **Consent layer** (`contracts/`) - on-chain policy: who owns each agent, how much it may spend per period, and what state each action is in. **Holds no funds.** Value moves wallet-to-wallet; the contracts only record intent and approval.
2. **Facilitator** (`facilitator/`) - the payment rails. Implements x402 (`/verify`, `/settle`) and BOT Chain's native EOA paymaster JSON-RPC (`pm_isSponsorable`, `eth_sendRawTransaction`). Self-pay is the default settlement path; the native paymaster is opt-in.
3. **SDK** (`facilitator/sdk/`) - `@xbot02/core` (consent client, wallet sources, chains, ABIs), `@xbot02/fetch` (x402 payment in one wrapper), `@xbot02/guardian` (approve/reject/backfill/watch), `@xbot02/mcp` (agent + guardian MCP servers).
4. **Front-ends** - `console/` (guardian web app), `examples/agent/` (legacy Claude loop), and the MCP servers that turn any chat client into an agent or guardian.

## The consent flow (how the circuit breaker works)

```
agent ──requestAction(target, amount, actionType)──► ConsentGateway
                                                      │
        ┌────────── registry.isWithinPolicy()? ───────┤
        │ yes                                         │ no
        ▼                                             ▼
   Status = AutoApproved                       Status = Pending
   registry.recordSpend()                 ── wait for guardian ──►
   agent proceeds immediately                 guardian.approve()
                                            / reject() / expire()
```

- `AgentRegistry` stores one `AgentPolicy` per agent: `guardian`, `spendCap`, `periodSeconds`, rolling `spentInPeriod`/`periodStart`, `active`.
- `ConsentGateway.requestAction` returns `(requestId, autoApproved)` so the agent knows instantly whether to proceed or wait.
- A pending request expires after `PENDING_TIMEOUT` (15 minutes) and can be marked `Expired` permissionlessly via `expire()`.

## The payment flow (x402 + native paymaster)

```
agent ──GET/POST──► resource-server ──402 + payment-required header──► agent
agent ──sign native tBOT transfer (zero gas price first)──► facilitator /verify
facilitator: zero-gas tx  → paymaster policy (ConsentGateway.isApproved) → bundler
             normal tx    → self-pay: simulate → broadcast via public RPC
agent ──retry with payment-signature header──► resource-server
resource-server ──/verify + /settle──► facilitator ──confirmed──► serves 200
```

Design decisions that shape everything:

- **The self-pay fallback is not optional.** It is the default settlement path and ships even when the native paymaster works - we are not depending on unverified mainnet/testnet bundle infrastructure.
- **The native paymaster is opt-in** (`PAYMASTER_ENABLED=1`) and only touches zero-gas-price transactions; anything else settles self-pay.
- **The paymaster's sponsor policy** (`pm_isSponsorable`) must call `ConsentGateway.isApproved(requestId)` before agreeing to sponsor the matching transfer - so the facilitator never front-runs a human.
- **x402 network ids are self-assigned** `eip155:968` (testnet) and `eip155:677` (mainnet) (CAIP-2) since none is officially registered for BOT Chain.
- **No database.** Event logs from the contracts plus the paymaster's request log are the state.

## Status model

A request moves through one of six statuses (`ConsentGateway.Status`):

```
None → Pending → AutoApproved | Approved | Rejected | Expired
```

`isApproved()` returns `true` only for `AutoApproved` / `Approved` - a `Pending` request past its timeout is treated as expired (returns `false`).
