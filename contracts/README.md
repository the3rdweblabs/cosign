# Cosign contracts

The on-chain consent layer of Cosign - a circuit breaker for autonomous agent
payments on BOT Chain. Two Solidity `^0.8.24` contracts built and deployed
with Foundry:

- **`src/AgentRegistry.sol`** - who owns each agent, and the rolling spend policy.
- **`src/ConsentGateway.sol`** - the circuit breaker: approve in-policy actions
  instantly, park high-risk ones until a human guardian decides.

> **Design rule (do not regress): the contracts hold no funds.** They are pure
> policy/state. Value moves via direct wallet-to-wallet transfers verified
> off-chain by the facilitator/paymaster. No custody logic lives here.

```
cosign/
├── src/AgentRegistry.sol        # agent→guardian mapping, spend policy (no custody)
├── src/ConsentGateway.sol       # requestAction/approve/reject - on-chain circuit breaker
├── script/Deploy.s.sol          # deploys registry + gateway, wires setConsentGateway
├── scripts/check-deploy.mjs     # HTTP verification of deploy records (testnet + mainnet)
├── scripts/check-balance.mjs    # native BOT/tBOT balances + deploy gas-cost estimate
├── test/ConsentGateway.t.sol    # 20 forge tests - all flow paths
├── foundry.toml                 # solc 0.8.24, bohr/botchain RPCs, fs_permissions
├── .env.example                 # BOT_NETWORK + DEPLOYER_PRIVATE_KEY template
└── README.md                    # this file
```

## Why these two contracts

AI agents get spending power on-chain. Routine, in-policy actions settle
instantly and gas-free. Anything above a spend cap, or flagged high-risk
(e.g. triggering a physical HuBot action), pauses and requires a human
guardian to co-sign before it executes.

The facilitator's paymaster policy calls `ConsentGateway.isApproved()` before
agreeing to sponsor a matching transaction - meaning a transaction can never
be gas-free unless a human (or policy) already cleared it on-chain. That is
what makes "agentic power with human oversight" enforceable rather than
advisory.

## AgentRegistry

`src/AgentRegistry.sol` - tracks AI agents, their human guardians, and rolling
spend policy. Holds no funds.

### The policy

```solidity
struct AgentPolicy {
    address guardian;       // human wallet that owns/oversees this agent
    uint256 spendCap;       // max value (wei) the agent can auto-spend per period
    uint256 periodSeconds;  // rolling window length, e.g. 1 days
    uint256 spentInPeriod;  // running total spent in the current window
    uint256 periodStart;    // timestamp the current window began
    bool active;
}
```

`mapping(address => AgentPolicy) public policies` - one policy per agent address.

### State

| | |
|---|---|
| `policies` | `agent address → AgentPolicy` |
| `consentGateway` | the only contract allowed to record spend |
| `owner` | deployer; only they can set the gateway |

### Functions

| Function | Signature | Notes |
|---|---|---|
| `setConsentGateway` | `(address gateway)` | one-time wiring, owner only |
| `registerAgent` | `(address agent, uint256 spendCap, uint256 periodSeconds)` | a human registers an agent under their guardianship; `msg.sender` becomes the guardian. An already-active agent can only be re-registered by its own guardian - never hijacked |
| `revokeAgent` | `(address agent)` | guardian revokes their agent's privileges (`active = false`) |
| `isWithinPolicy` | `(address agent, uint256 amount) → bool` | view check; handles period rollover (spent resets once the window passes) |
| `recordSpend` | `(address agent, uint256 amount)` | `onlyGateway`; called by ConsentGateway when an action is approved (auto or human) |
| `getPolicy` | `(address agent) → AgentPolicy` | read a policy |

### Events / errors

`AgentRegistered(agent, guardian, spendCap, periodSeconds)` ·
`AgentRevoked(agent, guardian)` · `GatewaySet(gateway)`

Errors: `NotGuardian` · `NotGateway` · `AgentInactive`

### Key behaviors

- `registerAgent` requires `periodSeconds > 0`. It **resets** `spentInPeriod`
  and `periodStart` on every (re)registration, so re-registering with a new cap
  starts a fresh window.
- `recordSpend` reverts with `AgentInactive` if the agent isn't active - you
  cannot accrue spend for a revoked agent.
- `isWithinPolicy` returns `false` for inactive agents, and compares
  `spent + amount <= spendCap` with rollover handled.

## ConsentGateway

`src/ConsentGateway.sol` - the circuit breaker. Agents call `requestAction()`
before spending. In-policy actions auto-approve instantly. Out-of-policy
actions park as **Pending** until the human guardian approves or rejects.
Holds no funds.

### Status model

```solidity
enum Status { None, AutoApproved, Pending, Approved, Rejected, Expired }
```

| Status | Meaning |
|---|---|
| `None` | never existed / default |
| `AutoApproved` | within policy at request time - agent may proceed immediately |
| `Pending` | above cap or high-risk - waiting on the guardian |
| `Approved` | guardian co-signed |
| `Rejected` | guardian said no; the request id cannot be retried |
| `Expired` | `Pending` past `PENDING_TIMEOUT`, marked by anyone |

### The request

```solidity
struct ActionRequest {
    address agent;
    address target;      // who/what the value is going to
    uint256 amount;      // value in wei
    bytes32 actionType;  // keccak256("PAYMENT"), keccak256("HUBOT_TRIGGER"), …
    uint256 requestedAt;
    Status status;
}
```

`uint256 public constant PENDING_TIMEOUT = 15 minutes;`

### Functions

| Function | Signature | Notes |
|---|---|---|
| `requestAction` | `(address target, uint256 amount, bytes32 actionType) → (uint256 requestId, bool autoApproved)` | agent calls this before acting. Reverts `AgentNotActive` if the agent has no active policy. Returns `autoApproved` so the caller knows whether to proceed or wait |
| `approve` | `(uint256 requestId)` | guardian approves a pending request; calls `registry.recordSpend` |
| `reject` | `(uint256 requestId)` | guardian rejects a pending request |
| `expire` | `(uint256 requestId)` | permissionless; marks an overdue `Pending` request `Expired` |
| `isApproved` | `(uint256 requestId) → bool` | **what the paymaster checks before settling** - `true` only for `AutoApproved` / `Approved`; overdue `Pending` counts as `false` |
| `getRequest` | `(uint256 requestId) → ActionRequest` | read any request |

### Events / errors

`ActionRequested(requestId, agent, target, amount, actionType)` ·
`ActionAutoApproved(requestId)` · `ActionApproved(requestId, guardian)` ·
`ActionRejected(requestId, guardian)` · `ActionExpired(requestId)`

Errors: `NotGuardianOfAgent` · `RequestNotPending` · `RequestExpired` · `AgentNotActive`

### Behavior notes

- `requestAction` mints the request id, then auto-approves **only** if
  `registry.isWithinPolicy(agent, amount)` - and immediately calls
  `recordSpend`. Otherwise it returns `autoApproved = false` and the request
  sits `Pending`.
- `approve` / `reject` require: status is `Pending`, not past
  `PENDING_TIMEOUT`, and `msg.sender` is the agent's guardian in the registry.
- `expire` silently does nothing for non-pending or in-time requests
  (idempotent cleanup).
- `isApproved` treats an overdue `Pending` as expired - so the facilitator
  refuses to settle anything a human hasn't cleared on time.

## The full flow

```
agent calls ConsentGateway.requestAction(target, amount, actionType)
  │
  ├─ in-policy → auto-approves + records spend → agent proceeds, paymaster sponsors
  │
  └─ out-of-policy → parks as Pending (15 min)
        ├─ guardian approves → spend recorded → paymaster sponsors
        ├─ guardian rejects  → dead id
        └─ nobody acts       → expired, never sponsorable
```

## Building and testing

```bash
forge install     # pulls forge-std (see .gitmodules)
forge build
forge test        # 20 tests in test/ConsentGateway.t.sol
```

`foundry.toml` pins `solc 0.8.24` with optimizer (200 runs). Both RPCs are
declared there:

```toml
[rpc_endpoints]
bohr = "https://rpc.bohr.life"      # BOT Chain testnet (chain 968)
botchain = "https://rpc.botchain.ai" # BOT Chain mainnet (chain 677)
```

`fs_permissions = [{ access = "read-write", path = "." }]` is set so the deploy
script may write its deployment record via `vm.writeJson`.

## Deploying

`script/Deploy.s.sol` is network-aware. It reads `BOT_NETWORK` (`testnet`
default | `mainnet`), **verifies the connected chain id matches** (`968` /
`677`, otherwise it reverts), deploys `AgentRegistry`, then
`ConsentGateway(registry)`, then calls `registry.setConsentGateway(gateway)`,
and after success writes a **deployment record** to `deploy.{BOT_NETWORK}.json`
in the project root.

```bash
export DEPLOYER_PRIVATE_KEY=0x...   # funded account (see .env.example)

# testnet (chain 968) - BOT_NETWORK defaults to testnet
forge script script/Deploy.s.sol --rpc-url bohr --broadcast --verify

# mainnet (chain 677)
BOT_NETWORK=mainnet forge script script/Deploy.s.sol --rpc-url botchain --broadcast --verify
```

Example record (`deploy.testnet.json`):

```json
{
  "network": "testnet",
  "chainId": 968,
  "rpcUrl": "https://rpc.bohr.life",
  "explorerUrl": "https://scan.bohr.life",
  "deployer": "0x…",
  "deployedAtBlock": 19049795,
  "deployedAtTimestamp": 1786122594,
  "agentRegistry": "0x…",
  "consentGateway": "0x…",
  "agentRegistryEnv": "AGENT_REGISTRY_ADDRESS_TESTNET",
  "consentGatewayEnv": "CONSENT_GATEWAY_ADDRESS_TESTNET"
}
```

The record carries both addresses plus the exact env var names each service
reads, so you can copy the values straight into the service `.env` files.

- Records are gitignored (`deploy.*.json`) - they are regenerated per deploy,
  never committed.
- Dry-run (no `--broadcast`) is a simulation only: no transactions are sent.
  Preview the flow with `forge script script/Deploy.s.sol --rpc-url bohr`.
- Broadcast logs (with tx hashes) live in
  `broadcast/Deploy.s.sol/{chainId}/dry-run/run-latest.json`.

### Verifying a deployment (network-ready check)

`scripts/check-deploy.mjs` reads each `deploy.{network}.json` record and
verifies it over HTTP - no recompiling, no redeploying. For every present
record it checks the RPC's chain id against the record, that both contracts
have code on-chain (`eth_getCode`), and that both are source-verified on the
chain's explorer (`module=contract&action=getsourcecode`). It then prints the
direct explorer URLs and the env var names each service reads.

```bash
node scripts/check-deploy.mjs            # every present record (testnet + mainnet)
node scripts/check-deploy.mjs testnet    # just testnet (chain 968)
node scripts/check-deploy.mjs mainnet    # just mainnet (chain 677)
```

- The script uses **only the data in the record files** - `rpcUrl`,
  `explorerUrl`, `chainId`, `agentRegistry`, `consentGateway` - so it is
  network-ready for any deployment without hardcoding chain details.
- Requires Node 18+ (global `fetch`); no dependencies.
- Exit code `0` only when every checked record passes chain id, has code
  on-chain, and both contracts are verified.

### Checking balances / deploy funding

`scripts/check-balance.mjs` checks native BOT/tBOT balances and prints the
cost of one full deployment at the live gas price, so you can confirm the
deployer is funded **before** running `Deploy.s.sol`. Gas numbers are the
measured values from the testnet broadcast (AgentRegistry CREATE 482,402 ·
ConsentGateway CREATE 807,998 · `setConsentGateway` 47,234 = 1,337,634 total).

It reads the deployer from the `deploy.{network}.json` record when present and
accepts extra addresses on the command line. With no record yet (e.g. before
the first mainnet deploy) it falls back to the built-in RPC for that network.

```bash
node scripts/check-balance.mjs                    # deployer, every present record
node scripts/check-balance.mjs mainnet            # deployer, just mainnet
node scripts/check-balance.mjs mainnet 0xDeployer 0xAgent   # explicit addrs, pre-deploy
```

Output includes the live gas price, per-tx and total deploy cost in BOT, each
address's balance, and an "enough for deploy" flag (balance vs. total cost).

```text
=== MAINNET ===
  gas price   20 gwei
  deploy cost 0.026752 BOT (1,337,634 gas)
    -   482,402 gas  0.009648 BOT  (482k)
    -   807,998 gas  0.016159 BOT  (807k)
    -    47,234 gas  0.000944 BOT  (47k)
  deployer (from record)      0.100000 BOT  0x…  (enough for deploy)
```

- Requires Node 18+ (global `fetch`); no dependencies.
- Exit code is informational (always `0`) - balance checks don't gate anything.

### Environment

See `.env.example`:

| Variable | Purpose |
|---|---|
| `BOT_NETWORK` | `testnet` (default) or `mainnet`; must match the `--rpc-url` chain id or the script reverts |
| `DEPLOYER_PRIVATE_KEY` | deployer EOA; must hold tBOT (testnet, from the [faucet](https://faucet.botchain.ai/basic)) or BOT (mainnet) for gas |

## Contract address environment variables (services)

All services read these per network as `NAME_<NETWORK>` (e.g.
`CONSENT_GATEWAY_ADDRESS_MAINNET`), falling back to the unsuffixed `NAME`.
`BOT_NETWORK` selects the network.

| Variable | Used by |
|---|---|
| `CONSENT_GATEWAY_ADDRESS` / `_TESTNET` / `_MAINNET` | facilitator, agent, agent MCP, guardian MCP, console |
| `AGENT_REGISTRY_ADDRESS` / `_TESTNET` / `_MAINNET` | facilitator, agent MCP, guardian MCP, console |

## Contracts vs. the x402 flow

The contracts never see the payment. They only decide *whether* an action is
approved. Once approved, the money flow is:

```
agent signs native tBOT transfer ──► facilitator /verify + /settle ──► BOT Chain
```

## Network reference

| | Testnet | Mainnet |
|---|---|---|
| Chain ID | `968` | `677` |
| RPC | `https://rpc.bohr.life` | `https://rpc.botchain.ai` |
| Explorer | `https://scan.bohr.life` | `https://scan.botchain.ai` |
| Gas token | tBOT | BOT |
