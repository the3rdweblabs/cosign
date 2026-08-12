---
title: @xbot02/mcp
description: Agent and guardian MCP servers - turn any MCP client (Claude Desktop, opencode, ChatGPT-style connectors) into an on-chain agent or human guardian.
---

# `@xbot02/mcp`

Turns the SDK into **MCP servers** so any MCP client becomes either:

- **an agent** with an on-chain wallet and consent-gated spending (`xbot02-agent`), or
- **a human guardian** with approve/reject power over that agent (`xbot02-guardian`).

Every tool call is recorded in the server's request log and streamed live to connected clients as MCP logging notifications.

## Agent server - `xbot02-agent`

| Tool | What it does |
|---|---|
| `request_action` | register an on-chain consent request (`ConsentGateway.requestAction`). Returns `requestId`, `autoApproved`, `status` |
| `check_status` | current on-chain status of a request |
| `get_policy` | the agent's `AgentRegistry` policy (guardian, cap, spent, active) |
| `expire_request` | mark an overdue pending request `Expired` |
| `pay_uri` | fetch a paid URL through the facilitator - handles the 402 → pay → served cycle (requires `facilitatorUrl` + a local signer) |
| `request_log` | the most recent requests this server has handled |

## Guardian server - `xbot02-guardian`

| Tool | What it does |
|---|---|
| `approve_request` | guardian co-signs a pending request |
| `reject_request` | guardian rejects a pending request |
| `expire_request` | mark an overdue pending request `Expired` |
| `pending_requests` | backfill + list everything still waiting on a decision |
| `request_log` | the most recent requests this server has handled |

## Live activity

- Every call emits an MCP `notifications/message` (`logger: "xbot02"`, level `info`/`error`) carrying `{ tool, ok, durationMs }` - connected clients see activity in real time.
- `request_log` returns the recorded history (newest first, ring-buffered at 200 entries).

## Hosting

### stdio (Claude Desktop, opencode)

```bash
cd facilitator/sdk && npm install && npm run build
node packages/mcp/dist/cli/agent.js       # or cli/guardian.js
```

MCP client config:

```jsonc
{
  "mcpServers": {
    "xbot02-agent": {
      "command": "node",
      "args": ["/abs/path/to/sdk/packages/mcp/dist/cli/agent.js"],
      "env": {
        "WALLET_KIND": "private-key",
        "BOT_NETWORK": "testnet",
        "AGENT_PRIVATE_KEY": "0x…",
        "BOT_RPC_URL_TESTNET": "https://rpc.bohr.life",
        "CONSENT_GATEWAY_ADDRESS_TESTNET": "0x…",
        "AGENT_REGISTRY_ADDRESS_TESTNET": "0x…",
        "FACILITATOR_URL": "http://localhost:3000"
      }
    }
  }
}
```

For the guardian, use `cli/guardian.js` and the guardian's key. Switch
networks by setting `BOT_NETWORK=mainnet` and using the `_MAINNET` suffixed
vars.

### HTTP (serverless / ChatGPT-style connectors)

```ts
import { toWebHandler } from "@xbot02/mcp";
import { createAgentServer } from "@xbot02/mcp";

const handler = toWebHandler(createAgentServer({ source, consentGatewayAddress }));
// mount handler on every route/method of a path - stateless Streamable HTTP
```

## Wallet configuration

Three kinds, controlled by `WALLET_KIND` (see `env.ts`):

| `WALLET_KIND` | Extra vars |
|---|---|
| `private-key` (default) | `AGENT_PRIVATE_KEY` |
| `mnemonic` | `AGENT_MNEMONIC` + optional `WALLET_ACCOUNT_INDEX` |
| `json-rpc` | `WALLET_ADDRESS` + `WALLET_RPC` (signing RPC) + `BOT_RPC_URL` (chain reads) |

Common: `BOT_NETWORK`, `BOT_RPC_URL` (chain reads), `CONSENT_GATEWAY_ADDRESS` (required), `AGENT_REGISTRY_ADDRESS` (optional, enables `get_policy`), `FACILITATOR_URL` (optional, required for `pay_uri`). All `NAME` vars can be suffixed per network: `CONSENT_GATEWAY_ADDRESS_TESTNET` / `CONSENT_GATEWAY_ADDRESS_MAINNET`, etc.

## Enforcing consent

The agent can *ask* for consent, but the **facilitator** is what makes it binding: `pm_isSponsorable` only sponsors transfers whose request `isApproved` on-chain. So an agent MCP server cannot spend gas-free without the guardian approving - exactly the circuit-breaker property.

## Related

- SDK foundation: [core](../core/README.md), [fetch](../fetch/README.md), [guardian](../guardian/README.md).
- Server implementations: `agent-server.ts`, `guardian-server.ts`, `request-log.ts`, `http.ts`, `env.ts`.
