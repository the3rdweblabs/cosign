# @xbot02/mcp

Expose the Cosign consent layer, agent spending policy, and x402 payments as
**Model Context Protocol** tools. Any MCP client - Claude Desktop, opencode,
Cursor, etc. - becomes either an **agent** with a spend-bounded on-chain
wallet or a **guardian** approval console.

Ships two server builders plus ready-to-run stdio CLIs (`xbot02-agent`,
`xbot02-guardian`).

## Install

```sh
npm i @xbot02/mcp
```

## Agent server

Tools: `request_action`, `check_status`, `get_policy`, `expire_request`,
`pay_uri`, `request_log`.

```ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createAgentServer, walletSourceFromEnv } from "@xbot02/mcp";
import { createWalletSource, botNetworkFromEnv, envFor } from "@xbot02/core";

const source = createWalletSource(walletSourceFromEnv(process.env));
const network = botNetworkFromEnv(process.env);

const server = createAgentServer({
  source,
  consentGatewayAddress: envFor(process.env, "CONSENT_GATEWAY_ADDRESS", network)!,
  registryAddress: envFor(process.env, "AGENT_REGISTRY_ADDRESS", network),
  facilitatorUrl: process.env.FACILITATOR_URL, // enables pay_uri
});

await server.connect(new StdioServerTransport());
```

`pay_uri` wraps `@xbot02/fetch`: point the agent at a paid URL and it signs +
settles the payment automatically (self-pay fallback until the bundler is
live). Requires a local signer and a `facilitatorUrl`.

## Guardian server

Tools: `approve_request`, `reject_request`, `expire_request`,
`pending_requests`, `request_log`.

```ts
import { createGuardianServer } from "@xbot02/mcp";

const server = createGuardianServer({
  source,
  consentGatewayAddress,
  registryAddress,
  fromBlock, // backfill start, optional
});
```

Your chat client becomes the human oversight: "what's pending?",
"approve request 3", "reject request 4".

## Web handler

`toWebHandler(server)` adapts an MCP server to a web request handler if you
prefer HTTP transport over stdio (see `mcp/src/http.ts`).

## CLI (env-driven)

Both CLIs read all config from the environment (see the package's
`.env.example`):

- `WALLET_KIND=private-key|mnemonic|json-rpc` + the matching key material
- `BOT_NETWORK=testnet|mainnet` (default `testnet`)
- `CONSENT_GATEWAY_ADDRESS[_TESTNET|_MAINNET]`, `AGENT_REGISTRY_ADDRESS[...]`
- `FACILITATOR_URL` (agent server, for `pay_uri`)
- `FROM_BLOCK` (guardian server backfill)

Register in an MCP client, e.g. for opencode:

```json
{
  "mcpServers": {
    "xbot02-agent": {
      "command": "npx",
      "args": ["-y", "xbot02-agent"],
      "env": {
        "BOT_NETWORK": "testnet",
        "AGENT_PRIVATE_KEY": "0x...",
        "CONSENT_GATEWAY_ADDRESS_TESTNET": "0xAc1813a52D1d3b6fFf0080feD17362C8aD86F372",
        "AGENT_REGISTRY_ADDRESS_TESTNET": "0x0cA3F183374f75e5a2d81C29A37B00Aab075be87",
        "FACILITATOR_URL": "http://localhost:3000"
      }
    }
  }
}
```

## Status

v1.0.0 (servers report `1.0.0`). Proven against the live testnet consent
flow. The gasless path is pending the bundler/builder channel; `pay_uri`
currently settles self-pay.

## License

GPL-3.0-only. Built by [The3rdWebLabs](https://github.com/the3rdweblabs/).
