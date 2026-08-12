---
title: Examples
description: Reference implementations of the Cosign / xBOT02 / facilitator stack - the paying agent and the paid resource server.
---

# Examples

Reference implementations of each x402 role, built on the facilitator and the
`@xbot02` SDK. The code lives in `examples/` at the repo root; these pages
document how each example works.

| Example | Role | Documentation |
| --- | --- | --- |
| [`agent/`](agent/README.md) | Payer (client) | The LLM-driven autonomous agent - probes a paid endpoint, requests on-chain consent when required, pays and fetches the resource. |
| [`resource-server/`](resource-server/README.md) | Merchant (server) | The reference "paid API" - answers `HTTP 402` with payment requirements, serves content once the facilitator confirms settlement. |

Both are thin wrappers over the same building blocks you would use yourself:
[`@xbot02/core`](../sdk/core/README.md) for chains, x402 types, the consent
client, and payment middleware, plus the
[facilitator](../facilitator/README.md) for verification and settlement.
