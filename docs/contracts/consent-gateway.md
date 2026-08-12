---
title: ConsentGateway
description: The circuit breaker. Agents call requestAction before spending; in-policy actions auto-approve, high-risk ones pause until a human guardian decides.
---

# ConsentGateway

`contracts/src/ConsentGateway.sol`

The circuit breaker. Agents call `requestAction()` before spending. In-policy actions auto-approve instantly. Out-of-policy actions park as **Pending** until the human guardian approves or rejects. Holds no funds.

## Status model

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

## The request

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

## Functions

| Function | Signature | Notes |
|---|---|---|
| `requestAction` | `(address target, uint256 amount, bytes32 actionType) → (uint256 requestId, bool autoApproved)` | agent calls this before acting. Reverts `AgentNotActive` if the agent has no active policy. Returns `autoApproved` so the caller knows whether to proceed or wait |
| `approve` | `(uint256 requestId)` | guardian approves a pending request; calls `registry.recordSpend` |
| `reject` | `(uint256 requestId)` | guardian rejects a pending request |
| `expire` | `(uint256 requestId)` | permissionless; marks an overdue `Pending` request `Expired` |
| `isApproved` | `(uint256 requestId) → bool` | **what the paymaster checks before settling** - `true` only for `AutoApproved` / `Approved`; overdue `Pending` counts as `false` |
| `getRequest` | `(uint256 requestId) → ActionRequest` | read any request |

## Events

```solidity
event ActionRequested(uint256 indexed requestId, address indexed agent, address target, uint256 amount, bytes32 actionType);
event ActionAutoApproved(uint256 indexed requestId);
event ActionApproved(uint256 indexed requestId, address indexed guardian);
event ActionRejected(uint256 indexed requestId, address indexed guardian);
event ActionExpired(uint256 indexed requestId);
```

These events power the console activity feed and the guardian SDK's `watchGateway`.

## Errors

`NotGuardianOfAgent` · `RequestNotPending` · `RequestExpired` · `AgentNotActive`

## Behavior notes

- `requestAction` mints the request id, then auto-approves **only** if `registry.isWithinPolicy(agent, amount)` - and immediately calls `recordSpend`. Otherwise it returns `autoApproved = false` and the request sits `Pending`.
- `approve` / `reject` require: status is `Pending`, not past `PENDING_TIMEOUT`, and `msg.sender` is the agent's guardian in the registry.
- `expire` silently does nothing for non-pending or in-time requests (idempotent cleanup).
- `isApproved` treats an overdue `Pending` as expired - so the facilitator refuses to settle anything a human hasn't cleared on time.

## Why the paymaster cares

The facilitator's sponsor policy calls `isApproved(requestId)` in `pm_isSponsorable`. Only an `AutoApproved`/`Approved` request is sponsorable - meaning **a transaction can never be gas-free unless a human (or policy) already cleared it on-chain**. This is the mechanism that makes “agentic power with human oversight” enforceable rather than advisory.
