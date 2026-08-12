---
title: Getting started
description: Run the full Cosign stack end to end - deploy the contracts, boot the facilitator and resource server, and wire up the agent and guardian.
---

# Getting started

This guide runs the whole stack locally against BOT Chain testnet (chain `968`). You need Node.js 20+ (Node 26 is known good), Foundry, and a browser wallet for the console.

## 1. Deploy the contracts

The consent layer is two contracts: `AgentRegistry` and `ConsentGateway`. They hold no funds - pure policy/state.

```bash
cd contracts
forge install
forge build
forge test

# deploy to testnet (requires a funded account)
export DEPLOYER_PRIVATE_KEY=0x...
node scripts/check-balance.mjs testnet   # optional: confirm deployer funding + gas cost
forge script script/Deploy.s.sol --rpc-url bohr --broadcast --verify
```

`Deploy.s.sol` deploys both contracts and wires `registry.setConsentGateway(gateway)`. Copy the two emitted addresses into the env files below.

Get tBOT from the [faucet](https://faucet.botchain.ai/basic) before anything that needs gas.

## 2. Run the facilitator

The facilitator exposes the x402 HTTP endpoints (`/verify`, `/settle`) and the BOT Chain paymaster JSON-RPC. Default settlement mode is **self-pay**; the native paymaster is opt-in.

Every service targets a network via `BOT_NETWORK` (`testnet` default, or `mainnet`), and reads its config from the matching `_TESTNET` / `_MAINNET` suffix - e.g. `BOT_NETWORK=testnet` resolves `BOT_RPC_URL_TESTNET`. The unsuffixed form still works as a fallback.

```bash
cd facilitator
npm install
cp .env.example .env   # then fill in:
```

| Variable | Default | Notes |
|---|---|---|
| `BOT_NETWORK` | `testnet` | `testnet` or `mainnet`; selects which `_TESTNET`/`_MAINNET` vars are used |
| `BOT_RPC_URL_TESTNET` / `BOT_RPC_URL_MAINNET` | `rpc.bohr.life` / `rpc.botchain.ai` | chain read RPC for each network |
| `CHAIN_ID_TESTNET` / `CHAIN_ID_MAINNET` | `968` / `677` | chain id for each network |
| `AGENT_REGISTRY_ADDRESS_TESTNET` / `_MAINNET` | - | from Deploy.s.sol |
| `CONSENT_GATEWAY_ADDRESS_TESTNET` / `_MAINNET` | - | **required only for consent mode** - without it the facilitator boots as a plain x402 facilitator (no `ConsentGateway.isApproved` gate) |
| `SPONSOR_PRIVATE_KEY` | - | sponsor EOA that covers gas in paymaster mode; **only required when `PAYMASTER_ENABLED=1`** |
| `PAYMASTER_ENABLED` | `0` | `0` = self-pay default, `1` = native paymaster (opt-in) |
| `PAYMASTER_PORT` | `3000` | HTTP listener |

```bash
npm start
```

Health check:

```bash
curl -s http://localhost:3000 \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"pm_isSponsorable","params":[{"to":"0x…","from":"0x…","value":"0x1"}]}'
```

## 3. Run the resource server

The example paid API. Two endpoints ship, both speaking x402 v2 (HTTP `402` with a
`payment-required` header until the caller proves payment):

- `POST /hubot-task` - **consent-gated** (`extra.requireConsent: true`): dispatching a physical HuBot robot requires an on-chain `ConsentGateway` approval first. 1 tBOT testnet / 0.001 BOT mainnet by default.
- `POST /market-report` - **pure x402** (`extra.requireConsent: false`): pay **0.5 tBOT testnet / 0.015 BOT mainnet** and get the report, no consent, no guardian.

```bash
cd examples/resource-server
npm install
cp .env.example .env   # fill in RESOURCE_PAYTO (your "pay to" address)
npm start              # listens on :4000
```

| Variable | Default | Notes |
|---|---|---|
| `BOT_NETWORK` | `testnet` | `testnet` or `mainnet`; selects which `_TESTNET`/`_MAINNET` vars are used |
| `RESOURCE_PORT` | `4000` | listener |
| `RESOURCE_PAYTO` | - | **required** - recipient of the payment |
| `RESOURCE_NETWORK_TESTNET` / `_MAINNET` | `eip155:968` / `eip155:677` | payment network (CAIP-2) advertised in the 402 |
| `HUBOT_TASK_PRICE_TESTNET` / `_MAINNET` | `1000000000000000000` / `1000000000000000` | price in wei of tBOT / BOT (1 tBOT testnet, 0.001 BOT mainnet); plain `HUBOT_TASK_PRICE` is the fallback |
| `MARKET_REPORT_PRICE_TESTNET` / `_MAINNET` | `500000000000000000` / `15000000000000000` | market-report price in wei (0.5 tBOT testnet, 0.015 BOT mainnet); plain `MARKET_REPORT_PRICE` is the fallback |
| `FACILITATOR_URL` | `http://localhost:3000` | the facilitator's base URL |

## 4. Run the console (guardian web app)

```bash
cd console
npm install
cp .env.example .env
```

| Variable | Default | Notes |
|---|---|---|
| `VITE_BOT_NETWORK` | `testnet` | `testnet` or `mainnet`; selects which `VITE_*_TESTNET`/`_MAINNET` vars are used |
| `VITE_BOT_RPC_URL_TESTNET` / `_MAINNET` | `rpc.bohr.life` / `rpc.botchain.ai` | chain read RPC |
| `VITE_AGENT_REGISTRY_ADDRESS_TESTNET` / `_MAINNET` | - | from Deploy.s.sol |
| `VITE_CONSENT_GATEWAY_ADDRESS_TESTNET` / `_MAINNET` | - | **required** for the active network |
| `VITE_FROM_BLOCK_TESTNET` / `_MAINNET` | `0` | backfill start for the activity feed |

```bash
npm run dev
```

Connect the guardian wallet in the browser. The console shows a live activity feed and an approval queue for pending requests.

## 5. Wire up the MCP servers (the recommended path)

Both the agent and the guardian are available as MCP servers (`@xbot02/mcp`) that run over stdio for Claude Desktop/opencode, or over HTTP for ChatGPT-style connectors.

```bash
cd facilitator/sdk
npm install
npm run build
```

**Agent** - add to your MCP client config:

```json
{
  "mcpServers": {
    "xbot02-agent": {
      "command": "node",
      "args": ["/absolute/path/to/sdk/packages/mcp/dist/cli/agent.js"],
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

For mainnet, switch `BOT_NETWORK` to `mainnet` and use the `_MAINNET` suffixed
vars (`CONSENT_GATEWAY_ADDRESS_MAINNET`, …) - no code changes needed.

**Guardian** - same pattern with `dist/cli/guardian.js` and the guardian's key.

> **Register the agent first.** Call `registerAgent(agentAddress, spendCap, periodSeconds)` from the guardian's wallet (console or a direct contract call) so the agent has a policy.

## 6. Register the agent and run the example API

See the [walkthrough](walkthrough.md) for the three resource-server scenarios. The full
verification runbook, including unit gates and raw API checks, is in
[`GUIDE.md`](../GUIDE.md). In short:

1. Chat with the agent: “check the HuBot pickup price and trigger a task”.
2. In-policy → auto-approved and settled gas-free. High-risk → parked Pending.
3. Chat with the guardian (or the console): approve or reject.
4. Once approved, the agent pays via the facilitator and the resource server serves.

## Running the legacy agent loop

The `examples/agent/` package is the original LLM-driven loop (older than the MCP servers), defaulting to Claude but switchable via `PROVIDER`.

```bash
cd examples/agent
npm install
cp .env.example .env
npm start -- --task "Trigger a HuBot pickup task"
```

Env: `BOT_NETWORK`, `AGENT_PRIVATE_KEY`, `BOT_RPC_URL_TESTNET`/`_MAINNET`, `CONSENT_GATEWAY_ADDRESS_TESTNET`/`_MAINNET`, `RESOURCE_URL`, `TASK`, `ACTIVITY_LOG`. LLM provider: `PROVIDER` (`anthropic`/`openai`/`google`/`deepseek`/`cerebras`/`groq`), any one of `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/`GOOGLE_API_KEY`/`DEEPSEEK_API_KEY`/`CEREBRAS_API_KEY`/`GROQ_API_KEY`/`API_KEY`, optional `BASE_{PROVIDER}_URL` and `{CLAUDE|OPENAI|GOOGLE|DEEPSEEK|CEREBRAS|GROQ}_MODEL` overrides.

## Order of dependencies

```
deploy contracts → facilitator → resource server → console / MCP servers
```

The facilitator and resource server must stay separate processes - the “agent hits a real HTTP 402” story must be honest in the demo, not simulated in-process.
