---
title: Walkthrough
description: Three end-to-end scenarios - a routine payment that auto-settles, a high-risk action that pauses for a human guardian, and one that gets rejected.
---

# Walkthrough

Three scenarios, one stage: the agent in a chat client, the guardian in another (or the console), and a HuBot that costs 1 tBOT per pickup task.

## Setup

- [Deployed contracts + facilitator + resource server](getting-started.md) all running.
- Agent registered in `AgentRegistry` with a policy the guardian controls.
- Two chat clients (or one + console) with the `@xbot02/mcp` agent and guardian servers.

---

## Scenario 1 - Routine payment, auto-settled (green)

**The boring, beautiful case: the agent just pays.**

1. Chat with the agent: *“What does it cost to trigger a HuBot pickup task, and can you do it?”*
2. Agent probes `POST /hubot-task` → gets `402` with a `payment-required` header (1 tBOT).
3. Agent calls `requestAction(target, 1 tBOT, "PAYMENT")` → within the spend cap → **AutoApproved** on-chain, spend recorded. No human involved.
4. Agent signs the payment (zero gas price first), the facilitator's sponsor policy confirms `isApproved`, and settlement succeeds. If the zero-gas path is refused, the agent re-signs self-pay.
5. Agent retries with `payment-signature` → resource server verifies + settles via the facilitator → serves `200` **“HuBot pickup task confirmed”**.

**What the audience sees:** on-chain `ActionAutoApproved` event, a settlement tx, and served content - all without a human touching anything.

---

## Scenario 2 - High-risk action, human-gated (amber)

**The differentiator: the agent must wait for a human.**

1. Agent requests something **above the spend cap** (e.g. 500 tBOT) or with `actionType = HUBOT_TRIGGER`.
2. `ConsentGateway.requestAction` returns `autoApproved = false` → status **Pending**.
3. The agent reports back in chat: *“This needs my guardian - awaiting approval.”*
4. The guardian - via their MCP server or the console - approves. The console's live activity feed shows `Pending → Approved`.
5. `recordSpend` runs, the agent's payment becomes sponsorable (`isApproved == true`), and Scenario 1's steps 4-5 complete.

**What the audience sees:** the amber pause - the whole point of Cosign. An agent with spending power that a human can stop or allow.

---

## Scenario 3 - Rejected (red)

**The circuit breaker trips.**

1. Agent requests a high-risk action (or the guardian just doesn't like the justification).
2. Status **Pending**.
3. Guardian rejects → status **Rejected**. The request id is spent - the agent cannot retry the same id.
4. The facilitator's sponsor policy refuses the payment (`isApproved == false`), so the money never moves even if the agent tries to bypass consent.

**What the audience sees:** a rejected action that stays on-chain, visible in the console feed, with no settlement.

---

## Bonus - expiry

Set a request `Pending`, wait past `PENDING_TIMEOUT` (15 min, or shorten it in `ConsentGateway.sol`), and call `expire()`. It flips to `Expired` - permissionless, so anyone can clean it up - and `isApproved` now returns `false`.

## Key talking points

- **First x402 facilitator for BOT Chain**, wired to the chain's own native EOA paymaster (implemented by us - no third-party paymaster existed for this chain).
- **Self-pay fallback is always on**, so the facilitator has no single point of failure on unproven bundle infra.
- **The SDK is the adoption story**: `withBOT02()` turns any fetch into a paying fetch, and the MCP servers let ChatGPT/Claude Desktop/opencode become agent or guardian in a config file.
- **No custody**: contracts hold no funds, minimizing security surface - value moves wallet-to-wallet under verifiable on-chain approval.
