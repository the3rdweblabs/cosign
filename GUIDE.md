# Cosign - End-to-End Test Plan

This is the single runbook for testing **every piece** of the Cosign stack, from
compilation through a full paid-agent demo on BOT Chain testnet (chain `968`).

Two layers:

- **Part 2 - static / unit tests**: no network, every package must go green.
- **Parts 3–9 - live E2E**: deploy contracts, boot the real HTTP stack, and push
  real money through `402 → pay → serve`, both human-gated and auto-approved.

Reference docs: [`docs/getting-started.md`](docs/getting-started.md) (setup),
[`docs/walkthrough.md`](docs/walkthrough.md) (the three demo scenarios).

---

## 0. Stack map

| Component | Path | Port | What it is |
|---|---|---|---|
| Contracts | `contracts/` | - | `AgentRegistry` + `ConsentGateway` (policy/state, no funds) |
| Facilitator | `facilitator/` | `3000` | x402 `/verify` `/settle` + BOT paymaster JSON-RPC |
| Resource server | `examples/resource-server/` | `4000` | paid API: `/hubot-task` (402-gated) |
| Console | `console/` | `5173` | guardian web app (feed + approval queue) |
| Agent (legacy loop) | `examples/agent/` | - | LLM-driven agent CLI (Anthropic/OpenAI/Google via `PROVIDER`) |
| SDK | `facilitator/sdk/packages/*` | - | `@xbot02/core`, `fetch`, `guardian`, `mcp` |

Full trust flow: agent calls `ConsentGateway.requestAction()` → auto-approved
(in-policy) or `Pending` (guardian decides) → resource server 402s → agent signs
a zero-gas tx → facilitator settles → resource server serves.

---

## 1. Pre-requisites

- Node.js 20+ (Node 26 is known good), Foundry, a browser wallet (console).
- tBOT testnet funds from the [faucet](https://faucet.botchain.ai/basic)
  (10 tBOT / 24h - enough for the whole run).
- Keys to put in env files:
  - `DEPLOYER_PRIVATE_KEY` - deploys contracts.
  - `SPONSOR_PRIVATE_KEY` - facilitator sponsor EOA (paymaster path).
  - `AGENT_PRIVATE_KEY` - the agent's signer.
  - `GUARDIAN` - your EOA that owns the agent and approves/rejects.
- `ANTHROPIC_API_KEY` only if you run the **legacy agent CLI** (it reasons first).
  The MCP/SDK path can be driven without it.

> Fund the AGENT address too: even in paymaster mode the facilitator's
> self-pay fallback needs tBOT on the agent. In self-pay mode it is the only
> payer.

---

## 2. Static verification (no network)

Run all of these; they must pass before anything else.

```bash
# Contracts - build + full test suite (~21 tests)
cd contracts
forge install          # first time only
forge build
forge test -vvv

# SDK - build, typecheck, unit tests (~34 tests across 4 packages)
cd facilitator/sdk
npm install
npm run build
npm run typecheck
npm test

# Facilitator - unit tests (~25)
cd facilitator
npm install
npm run typecheck
npm test

# Resource server - unit tests (5)
cd examples/resource-server
npm install
npm run typecheck
npm test

# Agent - unit tests (17)
cd examples/agent
npm install
npm run typecheck
npm test

# Console - typecheck + production build
cd console
npm install
npm run typecheck
npm run build
```

Checklist:

- [x] `contracts`: `forge test` green (auto-approve, over-cap pending, approve,
      reject, expire, non-guardian reverts, rolling spend window, revocation).
- [x] `facilitator/sdk`: build + typecheck + all package tests green.
- [x] `facilitator`: paymaster, x402-adapter, selfpay-fallback, paymaster.http
      tests green.
- [x] `resource-server`: hubot-task 402/200 contract tests green.
- [x] `agent`: reasoning, consent-client, wallet tests green.
- [x] `console`: `tsc --noEmit` clean and `vite build` succeeds.

---

## 3. Deploy contracts (live testnet)

```bash
cd contracts
export DEPLOYER_PRIVATE_KEY=0x…
forge script script/Deploy.s.sol --rpc-url bohr --broadcast --verify
```

The script deploys `AgentRegistry`, then `ConsentGateway`, then wires
`registry.setConsentGateway(gateway)` and asserts both back-references.

Before deploying, confirm the deployer is funded enough to cover gas:

```bash
node scripts/check-balance.mjs testnet        # deployer from deploy.testnet.json, or
node scripts/check-balance.mjs testnet 0x…    # explicit deployer address pre-deploy
```

It prints the live gas price, the full deploy cost (AgentRegistry +
ConsentGateway + `setConsentGateway`, ~1,337,634 gas), each address's
tBOT balance, and an "enough for deploy" flag. Use the mainnet form
(`mainnet`) before the first mainnet deploy - there is no mainnet faucet,
so fund the deployer across the bridge first.

Capture the two printed addresses:

- `AgentRegistry deployed:` `0x…`
- `ConsentGateway deployed:` `0x…`

Verify on-chain wiring:

```bash
cast call <REGISTRY> "consentGateway()(address)" --rpc-url bohr
cast call <GATEWAY> "registry()(address)" --rpc-url bohr
# both should echo the other contract's address
```

Checklist:

- [x] Deploy broadcast succeeds and the script's `require` assertions pass.
- [x] `registry.consentGateway() == gateway` and `gateway.registry() == registry`.
- [x] Both addresses verified on the block explorer.

---

## 4. Boot the stack

### 4.1 Facilitator (`:3000`)

```bash
cd facilitator
cp .env.example .env
# BOT_NETWORK=testnet                          (testnet default, or mainnet)
# BOT_RPC_URL_TESTNET=https://rpc.bohr.life    (or _MAINNET / unsuffixed fallback)
# CHAIN_ID_TESTNET=968
# AGENT_REGISTRY_ADDRESS_TESTNET=<from Deploy>
# CONSENT_GATEWAY_ADDRESS_TESTNET=<from Deploy>   (required)
# SPONSOR_PRIVATE_KEY=0x…                        (required)
# PAYMASTER_ENABLED=0                     (0=self-pay default, 1=opt-in paymaster)
# PAYMASTER_PORT=3000
npm start
```

Health check (paymaster JSON-RPC up):

```bash
curl -s http://localhost:3000 \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"pm_isSponsorable","params":[{"to":"0x…","from":"0x…","value":"0x1"}]}'
```

- In both modes (`PAYMASTER_ENABLED=1` and `=0`), `pm_isSponsorable` is served and
  returns `{"Sponsorable": <bool>, "SponsorPolicy": "cosign-consent-gateway"}`:
  `Sponsorable: true` for an in-policy (approved) request, `false` otherwise.
- A genuinely unknown method still gets `-32601` (`method not found`).

### 4.2 Resource server (`:4000`)

```bash
cd examples/resource-server
cp .env.example .env
# BOT_NETWORK=testnet                      (testnet default, or mainnet)
# RESOURCE_PORT=4000
# RESOURCE_PAYTO=0x…     (required - the "pay to" address)
# HUBOT_TASK_PRICE_TESTNET=1000000000000000000  (1 tBOT)
# HUBOT_TASK_PRICE_MAINNET=100000000000000000   (0.1 BOT; plain HUBOT_TASK_PRICE is the fallback)
# FACILITATOR_URL=http://localhost:3000
# RESOURCE_NETWORK_TESTNET=eip155:968      (or RESOURCE_NETWORK_MAINNET / unsuffixed fallback)
npm start
```

Health check - unpaid call must 402:

```bash
curl -si http://localhost:4000/hubot-task \
  -H 'content-type: application/json' \
  -d '{"location":"Downtown"}'
# Expect HTTP 402 with a payment requirements JSON body (network, payee, amount)
```

### 4.3 Console (`:5173`)

```bash
cd console
cp .env.example .env
# VITE_BOT_NETWORK=testnet                     (testnet default, or mainnet)
# VITE_BOT_RPC_URL_TESTNET=https://rpc.bohr.life   (or _MAINNET)
# VITE_AGENT_REGISTRY_ADDRESS_TESTNET=<from Deploy> (or _MAINNET)
# VITE_CONSENT_GATEWAY_ADDRESS_TESTNET=<from Deploy> (or _MAINNET)
# VITE_FROM_BLOCK_TESTNET=0                     (or VITE_FROM_BLOCK_MAINNET)
npm run dev
```

Checklist:

- [ ] Facilitator boots with or without `CONSENT_GATEWAY_ADDRESS_<NETWORK>` (consent-optional; `SPONSOR_PRIVATE_KEY` is only required when `PAYMASTER_ENABLED=1`).
- [ ] `pm_isSponsorable` returns `{ Sponsorable, SponsorPolicy: "cosign-consent-gateway" }` in both modes.
- [ ] Resource server 402s an unpaid `/hubot-task`.
- [ ] Console loads and the guardian wallet connects.

---

## 5. Live E2E scenarios

### 5.0 Register the agent

Every scenario starts by giving the agent a policy. From the **guardian** wallet
(call `registerAgent(agent, spendCap, periodSeconds)`):

```bash
cd contracts
cast send <REGISTRY> \
  "registerAgent(address,uint256,uint256)(uint256)" \
  <AGENT_ADDRESS> 2000000000000000000 86400 \
  --rpc-url bohr --private-key <GUARDIAN_KEY>
```

Or, without touching `cast`: the console's **Agents** tab (register form + live
policy lookup) or the guardian SDK:

```ts
import { registerAgent } from "@xbot02/guardian";
await registerAgent({ wallet, gatewayAddress: "<GATEWAY>", registryAddress: "<REGISTRY>" },
  agent, 2_000_000_000_000_000_000n, 86_400n);
```

This registers the agent with a **2 tBOT cap per 24h** and returns an agent id.

> In-policy requests are auto-approved. Requests **over cap** (or flagged
> high-risk) park as `Pending` for guardian review - that is the human-gated
> scenario.

### 5.1 Scenario A - routine, auto-approved (in-policy)

The happy path end to end.

```bash
cd examples/agent
cp .env.example .env
# AGENT_PRIVATE_KEY=0x…            (the registered agent's key)
# BOT_NETWORK=testnet              (testnet default, or mainnet)
# BOT_RPC_URL_TESTNET=https://rpc.bohr.life   (or _MAINNET / unsuffixed fallback)
# CONSENT_GATEWAY_ADDRESS_TESTNET=<from Deploy> (or _MAINNET)
# RESOURCE_URL=http://localhost:4000/hubot-task
# TASK="Check the HuBot pickup price and trigger a task"
# PROVIDER=anthropic              (anthropic default, or openai / google / deepseek / cerebras / groq)
# ANTHROPIC_API_KEY=sk-…          (any one of ANTHROPIC/OPENAI/GOOGLE/DEEPSEEK/CEREBRAS/GROQ_API_KEY or API_KEY)
# CLAUDE_MODEL=…                   (optional, default set)
# ACTIVITY_LOG=./activity.log
npm start -- --task "Check the HuBot pickup price and trigger a task"
```

Expected (verify each):

1. Agent probes `POST /hubot-task` → **HTTP 402** (proves the "real HTTP 402"
   story is honest, not simulated).
2. Agent calls `ConsentGateway.requestAction(target, 1e18, actionType)` →
   **AutoApproved** because 1 tBOT ≤ the 2 tBOT cap.
3. Agent signs a zero-gas tx and POSTs it to the facilitator `/verify` +
   `/settle`.
4. In **self-pay mode** the facilitator pays with the agent's own tBOT →
   settlement lands, tBOT moves to `RESOURCE_PAYTO`.
5. Resource server re-checks on-chain, then **HTTP 200** with the task result.

Prove it on-chain:

```bash
cast balance <RESOURCE_PAYTO> --rpc-url bohr   # +1 tBOT vs before
cast call <GATEWAY> "getRequest(uint256)(...)" ...  # status = AutoApproved
```

### 5.2 Scenario B - high-risk, guardian-gated (pending → approve)

Drive a request **over the cap** (e.g. `TASK` that needs 3 tBOT, above the 2 tBOT
cap). The same flow now:

1. `requestAction` returns **Pending**, not auto-approved.
2. Agent's `waitForApproval` polls on-chain.
3. The console feed shows the request in the **approval queue** (or the guardian
   MCP server exposes it).
4. Guardian approves (console button, `cast send` of `approve(id)`, or MCP).
5. `waitForApproval` resolves **Approved**, the agent proceeds to
   `/verify` `/settle`, resource server serves **200**.
6. The consent request is recorded so the spend hits the cumulative cap.

### 5.3 Scenario C - rejection

Repeat Scenario B but **reject** the pending request:

1. Guardian calls `reject(id)`.
2. `waitForApproval` resolves **Rejected** - the agent must NOT sign/pay.
3. No settlement; resource server keeps 402ing; `RESOURCE_PAYTO` balance
   unchanged.
4. `ConsentGateway` forbids retrying the same id (guard against replay).

### 5.4 Scenario D - expiry

Create a pending request and wait **> 15 min** (`PENDING_TIMEOUT`):

1. `expire(id)` (permissionless) or just let time pass.
2. `waitForApproval` resolves **Expired**.
3. `approve(id)` after timeout reverts (`RequestExpired`).
4. No payment, no settlement.

### 5.5 Scenario E - self-pay fallback (default)

With `PAYMASTER_ENABLED=0`:

1. Agent submits its zero-gas signed tx to the facilitator.
2. Facilitator attempts the native paymaster path and, because the bundler is
   not live, falls back to **self-pay**: it repays gas from the agent's own
   balance and broadcasts with a real gas price.
3. Settlement confirms on-chain without paymaster sponsorship.

This is what Scenario A exercises by default - flip `PAYMASTER_ENABLED` and rerun
to compare.

### 5.6 Scenario F - paymaster path (opt-in)

With `PAYMASTER_ENABLED=1` (needs a funded `SPONSOR_PRIVATE_KEY`):

1. `pm_isSponsorable` returns `{ Sponsorable: true, SponsorPolicy: "cosign-consent-gateway" }` for an in-policy (approved) request.
2. Zero-gas `eth_sendRawTransaction`:
   - **Expected today**: bundler not live → error `-32000` (`BundlerNotReady`).
     This is the honest, asserted behavior - the sponsor-policy check
     (`pm_isSponsorable` → `isApproved`) is what's verified, not a real bundle.
3. A **non-zero** gas price tx must be rejected with `-32001`
   (only sponsored zero-gas txs are accepted).
4. `PAYMASTER_ENABLED=0` + a nonzero-gas tx → accepted (self-pay).

### 5.7 Scenario G - SDK in one call (`withBOT02`)

From `facilitator/sdk` with the stack running:

```ts
// npm run build first, then run with tsx from the SDK dir
import { withBOT02 } from "@xbot02/fetch";

const res = await withBOT02("http://localhost:4000/hubot-task", {
  method: "POST",
  body: JSON.stringify({ location: "Downtown" }),
  headers: { "content-type": "application/json" },
  wallet: { kind: "private-key", privateKey: "<AGENT_PRIVATE_KEY>" },
  consentGatewayAddress: "<GATEWAY>",
  agentRegistryAddress: "<REGISTRY>",
  facilitatorUrl: "http://localhost:3000",
  actionType: "0x…", // default PAYMENT unless overridden
});
console.log(res.status, await res.text()); // 200 + task result
```

`withBOT02` wraps the whole flow - probe, 402, `requestAction`, wait-for-approval,
sign, `/verify`, `/settle`, retry - in one call.

Checklist:

- [ ] A: auto-approved, served, `RESOURCE_PAYTO` funded.
- [ ] B: pending → guardian approve → served.
- [ ] C: pending → reject → never paid, never served.
- [ ] D: pending → 15 min → expired → `approve` reverts.
- [ ] E: `PAYMASTER_ENABLED=0` self-pay settles.
- [ ] F: `PAYMASTER_ENABLED=1` → `pm_isSponsorable` true; zero-gas tx →
      `-32000` (bundler not live); nonzero-gas tx → `-32001`.
- [ ] G: `withBOT02` returns 200 with the resource payload.

---

## 6. Raw API verification (curl)

### 6.1 Facilitator JSON-RPC (`:3000`)

```bash
# sponsor-policy check (paymaster on)
curl -s http://localhost:3000 -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"pm_isSponsorable",
       "params":[{"to":"0x…","from":"<AGENT_ADDRESS>","value":"0xde0b6b3a7640000"}]}'
# -> result:true when the request is approved / in-policy, false otherwise

# zero-gas tx -> bundler-not-ready error (paymaster on)
curl -s http://localhost:3000 -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_sendRawTransaction","params":["0x…"]}'
# -> error -32000 BundlerNotReady

# non-zero gas price -> rejected as non-sponsored
# -> error -32001 (must not be sponsored)
```

### 6.2 Facilitator x402 (`:3000`)

```bash
# /verify - submit the signed payment payload
curl -s http://localhost:3000/verify -H 'content-type: application/json' \
  -d '{"payment":{"rawTx":"0x…"},"paymentDetails":{...}}'

# /settle - after verify, settle the payment
curl -s http://localhost:3000/settle -H 'content-type: application/json' \
  -d '{"payment":{"rawTx":"0x…"}}'
```

The `rawTx` must be signed by the paying wallet (agent) with
`gasPrice = 0` for the paymaster path; `/settle` broadcasts it (self-pay or
sponsored).

### 6.3 Resource server (`:4000`)

```bash
# 1) probe unpaid -> 402 + requirements
curl -si http://localhost:4000/hubot-task -H 'content-type: application/json' \
  -d '{"location":"Downtown"}'

# 2) pay (agent signs) -> repeat the call with the PAYMENT-SIGNATURE header:
curl -si http://localhost:4000/hubot-task -H 'content-type: application/json' \
  -H "PAYMENT-SIGNATURE: <base64(payload)>" \
  -d '{"location":"Downtown","payment":{"rawTx":"0x…"}}'
# -> 200 { ok: true, ... }
```

Checklist:

- [ ] `pm_isSponsorable` true/false follows `isApproved` state.
- [ ] Zero-gas broadcast → `-32000`; nonzero-gas → `-32001`.
- [ ] `/verify` then `/settle` for a signed tx → broadcast receipt.
- [ ] `/hubot-task` 402 unpaid → 200 with valid `PAYMENT-SIGNATURE`.

---

## 7. Console manual checks (guardian web app)

Open `http://localhost:5173`, connect the guardian wallet.

1. **Activity feed** - backfills from `ActionRequested` logs (`VITE_FROM_BLOCK_TESTNET`/`_MAINNET`),
   then streams live updates on new requests/approvals/rejections/expirations.
2. **Approval queue** - while a Scenario-B request is Pending, it appears here.
3. **Approve** → on-chain tx from guardian; agent's poll sees `Approved` and pays.
4. **Reject** → agent sees `Rejected` and aborts.
5. **Expire** - an overdue Pending request flips to Expired.
6. **Agents tab** - register an agent (cap + period), verify via the live policy lookup.
7. Status labels map 1:1 with on-chain enum
   (`None → AutoApproved → Pending → Approved / Rejected / Expired`).

---

## 8. SDK checks

From `facilitator/sdk`:

```bash
npm run build && npm test   # core, fetch, guardian, mcp

# Live integration - all four packages against the running stack:
# - @xbot02/core:      ConsentClient.requestAction / waitForApproval
# - @xbot02/fetch:     withBOT02 (Scenario G)
# - @xbot02/guardian:  registerAgent, getAgentPolicy, fetchRequests,
#                     getRequestStatus, approve/reject/expire
# - @xbot02/mcp:       agent + guardian MCP servers (see getting-started §5)
```

Guardian SDK snippet (live):

```ts
import { createGuardianClient } from "@xbot02/guardian";
const g = createGuardianClient({ rpcUrl: "https://rpc.bohr.life",
  registryAddress: "<REGISTRY>", gatewayAddress: "<GATEWAY>",
  wallet: { kind: "private-key", privateKey: "<GUARDIAN_KEY>" } });
await g.approve(requestId);   // or reject(requestId), expire(requestId)
```

**MCP servers** - register both in your client (see `docs/getting-started.md` §5):

- Agent: `dist/cli/agent.js` with `WALLET_KIND`, `AGENT_PRIVATE_KEY`,
  `BOT_NETWORK`, `BOT_RPC_URL_TESTNET`/`_MAINNET`,
  `CONSENT_GATEWAY_ADDRESS_TESTNET`/`_MAINNET`,
  `AGENT_REGISTRY_ADDRESS_TESTNET`/`_MAINNET`, `FACILITATOR_URL`.
- Guardian: `dist/cli/guardian.js` with the guardian key.

Tool-check: `list_actions` for both servers; the agent server exposes
`probe_price` / `trigger_task`, the guardian server exposes
`approve_request` / `reject_request`.

---

## 9. Full verification checklist

- [ ] All Part-2 unit/typecheck/build gates green.
- [ ] Contracts deployed + wired; registry↔gateway back-references verified.
- [ ] Facilitator boots (consent-optional: no `CONSENT_GATEWAY_ADDRESS_<NETWORK>` required).
- [ ] Resource server 402s unpaid; serves after payment.
- [ ] Console connects, feeds, approves, rejects, expires.
- [ ] Scenario A: in-policy auto-approve → zero-gas pay → 200 served.
- [ ] Scenario B: out-of-policy pending → guardian approve → served.
- [ ] Scenario C: pending → reject → never paid/served.
- [ ] Scenario D: pending → 15 min → expire; late approve reverts.
- [ ] Scenario E: self-pay fallback settles (default mode).
- [ ] Scenario F: paymaster on → `pm_isSponsorable` true, zero-gas `-32000`,
      nonzero-gas `-32001`.
- [ ] Scenario G: `withBOT02` one-call 200.
- [ ] Raw curl checks: `pm_isSponsorable`, `eth_sendRawTransaction`,
      `/verify`, `/settle`, 402→pay→200.
- [ ] MCP agent + guardian servers respond to `list_actions` and drive a task.

---

## 10. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Facilitator refuses to boot | `CONSENT_GATEWAY_ADDRESS_<NETWORK>` (or unsuffixed) missing - set from Deploy.s.sol output |
| `pm_isSponsorable` → `-32601` | Only for a genuinely unknown method - `pm_isSponsorable` itself is always served (both paymaster modes) |
| `eth_sendRawTransaction` → `-32000` "Sponsor not configured" | `PAYMASTER_ENABLED=0` (no `SPONSOR_PRIVATE_KEY`) - expected; self-pay path is used |
| Zero-gas tx → `-32000` | Bundler not live - expected; self-pay fallback kicks in |
| Zero-gas tx → `-32001` | Gas price was non-zero - sponsor policy only takes 0 |
| `requestAction` reverts | Agent not registered, or revoked - re-run 5.0 |
| Auto-approve not happening | Request is over the spend cap → Pending (by design) |
| Agent MCP connection refused | SDK not built - `cd facilitator/sdk && npm run build` |
| No tBOT / out of funds | Faucet 10 tBOT/24h; fund agent + sponsor + payee |
| Console feed empty | `VITE_FROM_BLOCK_TESTNET`/`_MAINNET` too high for the deploy block |
| `/verify` `/settle` 4xx | `rawTx` not signed by the paying (agent) wallet |
