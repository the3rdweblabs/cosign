---
title: @xbot02/guardian
description: The guardian SDK - approve, reject, expire, backfill every consent request, and watch the gateway live.
---

# `@xbot02/guardian`

The guardian-side SDK. Everything a guardian app needs: make decisions on pending requests, backfill every known request, and watch the gateway live. The guardian MCP server and the console both build on it.

## Decisions

```ts
import { approveRequest, rejectRequest, expireRequest } from "@xbot02/guardian";

const options = { wallet: source.walletClient, gatewayAddress };

await approveRequest(options, requestId);  // guardian co-signs → tx hash
await rejectRequest(options, requestId);  // guardian says no
await expireRequest(options, requestId);  // permissionless; marks overdue Pending as Expired
```

All three write through the guardian's wallet client and return the tx hash.

## Reading

```ts
import { getRequestStatus, fetchRequests, watchGateway } from "@xbot02/guardian";
```

| Function | Returns | Notes |
|---|---|---|
| `getRequestStatus(client, gatewayAddress, requestId)` | status label | single request |
| `fetchRequests({ client, gatewayAddress, registryAddress?, fromBlock? })` | `ConsentRequestRecord[]` | backfills every `ActionRequested` log and resolves each to a record (most recent last) |
| `watchGateway({ client, gatewayAddress, registryAddress?, fromBlock?, pollMs?, onRequest, onError })` | `() => void` | backfill, then live events; teardown via the returned function |

### `ConsentRequestRecord`

```ts
{
  requestId: bigint;
  agent: Address;
  target: Address;
  amount: bigint;
  actionType: Hex;
  requestedAt: bigint;
  status: RequestStatus;
  guardian?: Address;   // resolved from the registry when registryAddress is provided
}
```

### Watching transitions

`watchGateway` subscribes to **all five** gateway events (`ActionRequested`, `ActionAutoApproved`, `ActionApproved`, `ActionRejected`, `ActionExpired`) and re-resolves the affected request each time, so `Pending → Approved → Expired` flows through a single `onRequest` callback - that's what powers the console's live feed.

## Related

- Used by the [guardian MCP server](../mcp/README.md) and the [console](../../console/README.md).
- Contract semantics: [ConsentGateway](../../contracts/consent-gateway.md).
