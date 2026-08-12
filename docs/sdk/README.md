---
title: SDK
description: @xbot02 - the integration layer. How any agent or app plugs into the Cosign consent layer and the xBOT02 facilitator, in a few lines.
---

# SDK - `@xbot02/*`

The integration layer of Cosign. Everything a third party needs to plug their agent *or* their app into the consent layer and the facilitator. The agent and guardian MCP servers are thin shells over this SDK - it is upstream of the products, not a support trinket.

## Packages

| Package | Path | What it does |
|---|---|---|
| `@xbot02/core` | `facilitator/sdk/packages/core` | chains, ABIs, status model, `ConsentClient`, wallet sources, x402 types, payment middleware - the shared foundation |
| `@xbot02/fetch` | `facilitator/sdk/packages/fetch` | `withBOT02()` - turns any fetch into a paying x402 fetch in one call |
| `@xbot02/guardian` | `facilitator/sdk/packages/guardian` | approve / reject / expire, backfill, and a live `watchGateway` |
| `@xbot02/mcp` | `facilitator/sdk/packages/mcp` | agent + guardian **MCP servers** (stdio or HTTP) |

## Install

The SDK is a npm workspace at `facilitator/sdk` and is consumed via `file:` links by `facilitator/`, `examples/agent/`, `examples/resource-server/`, and `console/`. To use it in your own project:

```bash
# from the SDK workspace
cd facilitator/sdk
npm install
npm run build
```

```jsonc
// your package.json
{
  "dependencies": {
    "@xbot02/core": "file:../cosign/facilitator/sdk/packages/core",
    "@xbot02/fetch": "file:../cosign/facilitator/sdk/packages/fetch",
    "@xbot02/guardian": "file:../cosign/facilitator/sdk/packages/guardian",
    "@xbot02/mcp": "file:../cosign/facilitator/sdk/packages/mcp"
  }
}
```

Requires `viem` v2 and Node 20+.

## The two 5-line integrations

**Make any app pay for resources (x402):**

```ts
import { withBOT02 } from "@xbot02/fetch";
import { createWalletSource, botChainTestnet } from "@xbot02/core";

const source = createWalletSource({ kind: "private-key", privateKey: process.env.AGENT_KEY });
const paidFetch = withBOT02({
  account: source.account,
  chain: botChainTestnet,
  facilitatorUrl: "http://localhost:3000",
});

const res = await paidFetch("http://localhost:4000/hubot-task"); // never sees a 402
```

**Request consent on-chain:**

```ts
import { ConsentClient } from "@xbot02/core";

const consent = new ConsentClient({ walletClient: source.walletClient, publicClient: source.publicClient, consentGatewayAddress });
const { requestId, autoApproved } = await consent.requestAction({
  target, amount, actionType: "HUBOT_TRIGGER", justification: "…",
});
```

## Package docs

- [@xbot02/core →](core/README.md)
- [@xbot02/fetch →](fetch/README.md)
- [@xbot02/guardian →](guardian/README.md)
- [@xbot02/mcp →](mcp/README.md)

## Verification

```bash
cd facilitator/sdk
for p in packages/*/; do (cd "$p" && npm run typecheck && npm test); done
```
