---
title: AgentRegistry
description: Tracks AI agents, their human guardians, and the rolling spend policy. Pure policy - holds no funds.
---

# AgentRegistry

`contracts/src/AgentRegistry.sol`

Tracks AI agents, their human guardians, and rolling spend policy. Holds no funds.

## The policy

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

## State

| | |
|---|---|
| `policies` | `agent address → AgentPolicy` |
| `consentGateway` | the only contract allowed to record spend |
| `owner` | deployer; only they can set the gateway |

## Functions

| Function | Signature | Notes |
|---|---|---|
| `setConsentGateway` | `(address gateway)` | one-time wiring, owner only |
| `registerAgent` | `(address agent, uint256 spendCap, uint256 periodSeconds)` | a human registers an agent under their guardianship; `msg.sender` becomes the guardian. An already-active agent can only be re-registered by its own guardian - never hijacked |
| `revokeAgent` | `(address agent)` | guardian revokes their agent's privileges (`active = false`) |
| `isWithinPolicy` | `(address agent, uint256 amount) → bool` | view check; handles period rollover (spent resets once the window passes) |
| `recordSpend` | `(address agent, uint256 amount)` | `onlyGateway`; called by ConsentGateway when an action is approved (auto or human) |
| `getPolicy` | `(address agent) → AgentPolicy` | read a policy |

## Events

```solidity
event AgentRegistered(address indexed agent, address indexed guardian, uint256 spendCap, uint256 periodSeconds);
event AgentRevoked(address indexed agent, address indexed guardian);
event GatewaySet(address indexed gateway);
```

## Errors

`NotGuardian` · `NotGateway` · `AgentInactive`

## Key behaviors

- `registerAgent` requires `periodSeconds > 0`. It **resets** `spentInPeriod` and `periodStart` on every (re)registration, so re-registering with a new cap starts a fresh window.
- `recordSpend` reverts with `AgentInactive` if the agent isn't active - you cannot accrue spend for a revoked agent.
- `isWithinPolicy` returns `false` for inactive agents, and compares `spent + amount <= spendCap` with rollover handled.

## Integration notes

- The agent MCP server's `get_policy` tool and the console read `getPolicy`.
- `@xbot02/core` ships `agentRegistryAbi` for off-chain reads/writes.
