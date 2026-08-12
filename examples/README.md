# Examples

Reference implementations of the Cosign / xBOT02 / facilitator stack. These
are working examples of each role in an x402 flow on BOT Chain, not shipping
products - use them as templates for building your own agent or paid API.

| Example | Role | What it does |
| --- | --- | --- |
| [`agent/`](agent/) | Payer (client) | An LLM-driven autonomous agent that probes a paid endpoint, requests on-chain consent when the endpoint requires it, then pays and fetches the resource over x402. |
| [`resource-server/`](resource-server/) | Merchant (server) | A reference "paid API" that answers `HTTP 402 Payment Required` with payment requirements, then serves content once the facilitator confirms settlement. |

Both are thin wrappers over the same building blocks you would use yourself:

- [`@xbot02/core`](../facilitator/sdk/packages/core/README.md) - chains, x402
  types, consent client, payment middleware.
- The [facilitator](../docs/facilitator/README.md) - verification and settlement
  over BOT Chain's native paymaster with the mandatory self-pay fallback.

Full documentation: [`docs/examples/agent/`](../docs/examples/agent/README.md) and
[`docs/examples/resource-server/`](../docs/examples/resource-server/README.md).
