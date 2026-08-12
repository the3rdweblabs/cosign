---
title: Console
description: The human-facing guardian app - an approval queue for pending consent requests and a live activity feed. One product, web front-end.
---

# Console

`console/` - the guardian's web app: an **approval queue** for pending consent requests and a **live activity feed** of everything happening on-chain. It is the human side of Cosign - the “circuit breaker lever” in a browser.

> The guardian experience also ships as a guardian MCP server (see [SDK → mcp](../sdk/mcp/README.md)) so any chat client can be the human. The console and the MCP server are two front-ends over the same `@xbot02/guardian` SDK.

## Views

| View | File | What it shows |
|---|---|---|
| **Approval queue** | `ApprovalQueue.tsx` | every `Pending` request with agent, target, amount, action type - connect a guardian wallet, then approve or reject |
| **Activity feed** | `ActivityFeed.tsx` | live feed of `AutoApproved / Pending / Approved / Rejected / Expired` events (backfill + `watchGateway`) |
| Status badge | `StatusBadge.tsx` | status → color mapping (green/amber/red) |

## Stack

- React 19 + Vite, Tailwind.
- **viem** for wallet connect and chain reads.
- Chain config, ABIs, status mapping and formatting all come from `@xbot02/core` - the console has no duplicated chain knowledge.

## Environment (Vite)

`VITE_BOT_NETWORK` selects the active network (`testnet` default, or `mainnet`);
each config var is read as `NAME_<NETWORK>` (e.g. `VITE_BOT_RPC_URL_TESTNET`).

| Variable | Default | Notes |
|---|---|---|
| `VITE_BOT_NETWORK` | `testnet` | `testnet` or `mainnet` |
| `VITE_BOT_RPC_URL_TESTNET` / `_MAINNET` | `rpc.bohr.life` / `rpc.botchain.ai` | chain read RPC |
| `VITE_AGENT_REGISTRY_ADDRESS_TESTNET` / `_MAINNET` | - | deployed `AgentRegistry` |
| `VITE_CONSENT_GATEWAY_ADDRESS_TESTNET` / `_MAINNET` | - | **required** for the active network - deployed `ConsentGateway` |
| `VITE_FROM_BLOCK_TESTNET` / `_MAINNET` | `0` | backfill start block for the activity feed |

## Running

```bash
cd console
npm install
cp .env.example .env
npm run dev          # dev server
npm run build        # production build
```

## What the guardian can do

1. **Connect** the guardian wallet (the same address registered as `guardian` in `AgentRegistry`).
2. See every pending request in the queue - amounts, targets, justifications.
3. **Approve** (co-sign) or **reject** - each writes on-chain, flips the status, and (on approve) lets the agent's payment become sponsorable.
4. Watch the feed react in real time as requests move `Pending → Approved / Rejected / Expired`.
