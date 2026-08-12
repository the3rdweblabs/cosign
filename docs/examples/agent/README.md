---
title: Agent
description: The autonomous agent - receives a task, probes the paid endpoint, decides whether on-chain consent is required, and pays via x402 to get served.
---

# Agent

`examples/agent/` - an autonomous agent (LLM-driven: Anthropic, OpenAI, Google Gemini, DeepSeek, Cerebras, or Groq via `PROVIDER`). It receives a task, probes the paid endpoint, requests on-chain consent **only when the endpoint requires it**, then pays for and fetches the resource over x402.

> **Prefer the MCP server.** The modern way to run an agent is the `@xbot02/mcp` [agent server](../../sdk/mcp/README.md) - it turns any chat client into an agent. This package is the original Claude-loop implementation and remains a working reference / integration check.

## Main loop (`src/agent.ts`)

```
1. probe the paid endpoint        → resource server answers 402 + payment requirements
2. read extra.requireConsent      → does serving need on-chain consent?
   ├─ yes → reasonAbout() (actionType + justification), then ConsentClient.requestAction()
   │        in-policy → autoApproved, proceed immediately
   │        high-risk → wait for the guardian's approve() (waitForApproval)
   └─ no  → skip decision + consent entirely, just pay (pure x402)
3. sign native tBOT transfer      → exact amount, retry with PAYMENT-SIGNATURE
4. facilitator verifies + settles → resource server serves 200
```

The endpoint decides the flow, not the agent: the resource server advertises
`requireConsent` in its payment-requirement `extra`. `false` (e.g. the
`/market-report` endpoint) → the agent pays directly with no
`ConsentGateway` round-trip; `true`, or absent, → the full circuit-breaker flow.

## Modules

| File | Responsibility |
|---|---|
| `agent.ts` | the main loop - probe → (reason → consent)? → pay → serve |
| `reasoning.ts` | provider-agnostic LLM call (anthropic/openai/google/deepseek/cerebras/groq); picks `actionType`, writes the justification |
| `consent-client.ts` | re-exports `ConsentClient` + ABIs from `@xbot02/core` (single source of truth) |
| `wallet.ts` | the agent's signing identity (viem local account on chain 968) |

## Environment

`BOT_NETWORK` selects the active network (`testnet` default, or `mainnet`);
each config var is read as `NAME_<NETWORK>` with the unsuffixed `NAME` as
fallback (handled in `src/wallet.ts`).

| Variable | Notes |
|---|---|
| `AGENT_PRIVATE_KEY` | the agent's signing key |
| `BOT_NETWORK` | `testnet` (default) or `mainnet` |
| `BOT_RPC_URL_TESTNET` / `_MAINNET` | chain read RPC (defaults `rpc.bohr.life` / `rpc.botchain.ai`) |
| `CONSENT_GATEWAY_ADDRESS_TESTNET` / `_MAINNET` | deployed `ConsentGateway` - **only required when paying consent-gated endpoints** (e.g. `/hubot-task`); pure x402 endpoints (e.g. `/market-report`) work without it |
| `RESOURCE_URL` | the paid endpoint (e.g. `http://localhost:4000/market-report`) |
| `TASK` | the task given to the agent |
| `ACTIVITY_LOG` | optional path to append a human-readable activity log |

Examples:

```bash
# pure x402 - no consent gateway configured at all
RESOURCE_URL=http://localhost:4000/market-report npm start -- --task "Fetch today's market report"

# consent-gated
RESOURCE_URL=http://localhost:4000/hubot-task npm start -- --task "Trigger a HuBot pickup task"
```

## Reasoning provider

The reasoning layer drives whichever LLM provider you have, selected by
`PROVIDER` (`anthropic` default, `openai`, `google`, `deepseek`, `cerebras`, or `groq`).

| Variable | Notes |
|---|---|
| `PROVIDER` | `anthropic` (default), `openai`, `google`, `deepseek`, `cerebras`, or `groq` |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_API_KEY` / `DEEPSEEK_API_KEY` / `CEREBRAS_API_KEY` / `GROQ_API_KEY` / `API_KEY` | the API key - **any one** of these works, only the provider's is used |
| `BASE_ANTHROPIC_URL` / `BASE_OPENAI_URL` / `BASE_GOOGLE_URL` / `BASE_DEEPSEEK_URL` / `BASE_CEREBRAS_URL` / `BASE_GROQ_URL` | optional - overrides the provider's base URL with a compatible proxy/endpoint |
| `CLAUDE_MODEL` / `OPENAI_MODEL` / `GOOGLE_MODEL` / `DEEPSEEK_MODEL` / `CEREBRAS_MODEL` / `GROQ_MODEL` | optional model overrides (sane defaults per provider) |

Example: `PROVIDER=google GOOGLE_API_KEY=... GOOGLE_MODEL=gemini-2.0-flash`
or `PROVIDER=openai BASE_OPENAI_URL=https://my-proxy.example.com OPENAI_API_KEY=...`.
DeepSeek, Cerebras, and Groq are OpenAI-compatible: `PROVIDER=deepseek DEEPSEEK_API_KEY=...` (defaults to `deepseek-v4-flash`), `PROVIDER=cerebras CEREBRAS_API_KEY=...` (defaults to `gpt-oss-120b`), or `PROVIDER=groq GROQ_API_KEY=...` (defaults to `openai/gpt-oss-20b`).

## Running

```bash
cd examples/agent
npm install
cp .env.example .env
npm start -- --task "Trigger a HuBot pickup task"
```

## Design note

`reasonAbout()` does **not** decide the amount or recipient - those are pinned to what the resource server advertised in its `402`. The model only classifies the action type and justifies it. This keeps the on-chain record honest and prevents a hallucinated payment target. Pure x402 endpoints skip the reasoning + consent steps entirely - the agent pays what the endpoint advertises.

