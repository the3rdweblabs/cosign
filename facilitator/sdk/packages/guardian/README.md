# @xbot02/guardian

Human-oversight helpers for the Cosign consent layer on BOT Chain. Sign
approvals/rejections for pending agent requests, register agents under a
spend policy, and build live activity views over the `ConsentGateway` /
`AgentRegistry` contracts. Framework-agnostic - works from a console app, a
CLI, a bot, or a web dashboard.

## Install

```sh
npm i @xbot02/guardian @xbot02/core
```

## Usage

```ts
import { createPublicClient, createWalletClient, http, privateKeyToAccount } from "viem";
import { botChainTestnet } from "@xbot02/core";
import { approveRequest, rejectRequest, watchGateway } from "@xbot02/guardian";

const account = privateKeyToAccount("0x..."); // the guardian's wallet
const wallet = createWalletClient({ chain: botChainTestnet, account, transport: http() });
const publicClient = createPublicClient({ chain: botChainTestnet, transport: http() });

const gatewayAddress = "0xAc1813a52D1d3b6fFf0080feD17362C8aD86F372"; // testnet (968)
const registryAddress = "0x0cA3F183374f75e5a2d81C29A37B00Aab075be87"; // testnet (968)
```

### Live approval watch

```ts
const stop = await watchGateway({
  client: publicClient,
  gatewayAddress,
  registryAddress,
  onRequest: (record) => {
    console.log(
      `request ${record.requestId} [${record.status}] ` +
        `${record.agent} -> ${record.target} of ${record.amount}`,
    );
    if (record.status === "Pending") {
      // surface to the human; they decide approve() / reject()
    }
  },
});

// later...
stop(); // tear down the watcher
```

### Sign a decision

```ts
const options = { wallet, gatewayAddress };
const txHash = await approveRequest(options, requestId);  // guardian co-signs
// or rejectRequest(options, requestId) / expireRequest(options, requestId)
```

### Register an agent under your guardianship

```ts
import { registerAgent, getAgentPolicy } from "@xbot02/guardian";

await registerAgent(
  { wallet, gatewayAddress, registryAddress },
  agentAddress,
  5n * 10n ** 18n, // spend cap: 5 BOT per period
  86400n,           // period: 24 hours
);

const policy = await getAgentPolicy(publicClient, registryAddress, agentAddress);
// { guardian, spendCap, periodSeconds, spentInPeriod, periodStart, active }
```

## API

| Export | Purpose |
| --- | --- |
| `approveRequest(options, requestId)` | Guardian approves a Pending request |
| `rejectRequest(options, requestId)` | Guardian rejects a Pending request |
| `expireRequest(options, requestId)` | Permissionlessly mark an overdue Pending request Expired |
| `registerAgent(options, agent, spendCap, periodSeconds)` | Register an agent with a spend policy (caller becomes guardian) |
| `getAgentPolicy(client, registry, agent)` | Read an agent's current policy |
| `getRequestStatus(client, gateway, requestId)` | Read the current status label |
| `fetchRequests({ client, gateway, registry?, fromBlock? })` | Backfill all requests from `ActionRequested` logs (newest last) |
| `watchGateway({ ... onRequest, pollMs? })` | Backfill + live subscribe to every gateway event; returns a stop function |

`wallet` is a minimal `{ writeContract }` surface - pass any viem
`WalletClient` (even a different copy of viem than this package uses).

## Status

v1.0.0. The approve/reject/watch paths mirror the on-chain `ConsentGateway`
flow proven live on testnet. No custody: the guardian only signs contract
writes; value never moves through these helpers.

## License

GPL-3.0-only. Built by [The3rdWebLabs](https://github.com/the3rdweblabs/).
