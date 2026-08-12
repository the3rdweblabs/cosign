---
title: Cosign
description: The circuit breaker for autonomous agent payments on BOT Chain - a consent layer, an x402 facilitator backed by a native paymaster, and an SDK that ties them together.
---

# Cosign - Documentation

**Cosign** gives AI agents real spending power on-chain, with a human circuit breaker in front of it. Routine, in-policy actions settle instantly and gas-free through BOT Chain's native paymaster. Anything above a spend cap - or flagged as high-risk, like triggering a physical HuBot action - pauses and waits for a human guardian to co-sign before it executes.

Built by [**The3rdWebLabs**](https://the3rdweblabs.com), a Nigerian-based Web3 R&D studio.

## The products in this repo

| Surface | Folder | What it is |
|---|---|---|
| **Consent layer** | `contracts/` | `AgentRegistry` + `ConsentGateway` - the on-chain circuit breaker. Pure policy/state, holds no funds. |
| **Payment rails** | `facilitator/` | An x402-compatible facilitator for BOT Chain - the first one for this chain - backed by a self-built implementation of BOT Chain's native EOA paymaster spec, with a guaranteed self-pay fallback. |
| **Integration SDK** | `facilitator/sdk/` | `@xbot02/core`, `@xbot02/fetch`, `@xbot02/guardian`, `@xbot02/mcp` - how any agent or app plugs into the consent layer and the facilitator. |
| **Agent experience** | `examples/agent/` + `sdk/packages/mcp` | An autonomous agent that reasons about tasks, requests consent, and pays to get served. |
| **Guardian experience** | `console/` + `sdk/packages/mcp` | Human oversight - an approval queue and live activity feed, plus a guardian MCP server so any chat client can act as the human. |

Supporting: `examples/resource-server/` - a reference paid API that returns HTTP `402` and serves content once payment settles, so the facilitator has something real to prove itself against.

## Documentation map

- [Roadmap](../ROADMAP.md) - the single source of truth for what we're shipping (phases 0-4 + known gaps)
- [Getting started](getting-started.md) - run the whole stack
- [Architecture](architecture.md) - components, flows, design principles
- [Walkthrough](walkthrough.md) - the three example scenarios

### Per-product reference

- [Contracts](contracts/README.md) - [AgentRegistry](contracts/agent-registry.md) · [ConsentGateway](contracts/consent-gateway.md)
- [Facilitator](facilitator/README.md) - [x402 endpoints](facilitator/x402.md) · [paymaster RPC](facilitator/paymaster.md) · [sponsor policy](facilitator/sponsor-policy.md) · [self-pay fallback](facilitator/selfpay-fallback.md)
- [Examples](examples/README.md) - [agent](examples/agent/README.md) · [resource server](examples/resource-server/README.md)
- [Console](console/README.md)
- [SDK](sdk/README.md) - [core](sdk/core/README.md) · [fetch](sdk/fetch/README.md) · [guardian](sdk/guardian/README.md) · [mcp](sdk/mcp/README.md)
- [x402 protocol (vendored, v2)](facilitator/x402/x402-specification-v2.md) - the protocol spec we build against, plus [core concepts](facilitator/core-concepts/README.md), [schemes](facilitator/x402/schemes/README.md), [transports](facilitator/x402/transports-v2/http.md), and [extensions](facilitator/x402/extensions/README.md)

## Chain configuration

| | |
|---|---|
| Testnet Chain ID | `968` |
| Testnet RPC | `https://rpc.bohr.life` |
| Testnet Explorer | `https://scan.bohr.life` |
| Testnet Faucet | `https://faucet.botchain.ai/basic` (tBOT, 10/24h) |
| Mainnet Chain ID | `677` |
| Mainnet RPC | `https://rpc.botchain.ai` |
| Native gas token | `BOT` (tBOT on testnet) |
| x402 network id | `eip155:968` (testnet) / `eip155:677` (mainnet) - self-assigned CAIP-2 |

## Quick reference

```text
402 → examples/resource-server  ──verify/settle──►  facilitator  ──►  BOT Chain
  ▲                                            │
  │ payment-signature                          │
agent ──requestAction()──► ConsentGateway ──► AgentRegistry (policy)
```