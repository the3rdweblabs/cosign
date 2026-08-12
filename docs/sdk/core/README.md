---
title: @xbot02/core
description: The foundation - BOT Chain definitions, contract ABIs, the consent client, wallet sources, x402 types, and payment middleware.
---

# `@xbot02/core`

The shared foundation every other package (and `facilitator/`, `examples/agent/`, `console/`) builds on. It is the single source of truth for chains, ABIs, the status model, and formatting.

## Exports

### Chains & network selection

| Export | Value |
|---|---|
| `botChainTestnet` | viem `Chain` for testnet - id `968`, `https://rpc.bohr.life` |
| `botChainMainnet` | viem `Chain` for mainnet - id `677`, `https://rpc.botchain.ai` |
| `botNetworks` | `{ testnet, mainnet }` config map (chain, rpcUrl, caip2) |
| `botNetworkFromEnv(env)` | `"testnet"` (default) or `"mainnet"` from `BOT_NETWORK` |
| `botNetworkConfig(env?)` | full per-network config (chain, rpcUrl, caip2) for the active network |
| `envFor(env, name, network)` | reads `NAME_<NETWORK>` (e.g. `BOT_RPC_URL_TESTNET`), falling back to unsuffixed `NAME` |

See [`network.ts`](../../../facilitator/sdk/packages/core/src/network.ts) for the per-network env convention used by every service.

### ABIs & events

| Export | Notes |
|---|---|
| `consentGatewayAbi` | `ConsentGateway` ABI |
| `agentRegistryAbi` | `AgentRegistry` ABI |
| `actionRequestedEvent` | the `ActionRequested` event for log backfills |
| `actionTypeHash(type)` | `keccak256(bytes(type))` - what the contract stores as `actionType` |

### Status model

| Export | Notes |
|---|---|
| `requestStatus` | numeric → label map (`requestStatus[3] === "Approved"`) |
| `statusNum` | label → number lookup (`statusNum["Approved"] === 3`) |
| `statusOrder` | display order for feeds |
| `RequestStatus` | type |

### Formatting

`actionTypeLabel` · `formatAmount` · `shortAddress` · `timeAgo` - console-friendly human output.

### x402 types & constants

`nativeAsset` (zero address) · `botTestnetCaip2` (`eip155:968`) · `botMainnetCaip2` (`eip155:677`) · `x402Scheme` (`"exact"`) plus the `PaymentDetails`, `PaymentPayload`, `VerifyRequest`, `VerificationResult`, `SettlementResult` types shared by the facilitator and clients.

## `ConsentClient`

The agent-side consent API.

```ts
new ConsentClient({
  walletClient,          // viem wallet client (chain 968)
  publicClient,          // viem public client
  consentGatewayAddress,
  logSink,               // optional callback for activity entries
})
```

| Method | Notes |
|---|---|
| `requestAction({ target, amount, actionType, justification?, task? })` | calls `ConsentGateway.requestAction`; returns `{ requestId, autoApproved, status, txHash? }` |
| `getStatus(requestId)` | current status label |
| `getRequests()` | backfilled requests from events |
| `waitForApproval(requestId)` | resolves when the guardian approves (or rejects/expires) |

## `createWalletSource`

Uniform wallet creation across the project - one config, three kinds:

```ts
createWalletSource({ kind: "private-key", privateKey: "0x…", rpcUrl })          // local signer
createWalletSource({ kind: "mnemonic", mnemonic: "…", accountIndex: 0, rpcUrl })
createWalletSource({ kind: "json-rpc", address, rpcUrl, chainRpcUrl })          // remote signer

source.account        // viem account (LocalAccount for local kinds)
source.walletClient   // can sign + write
source.publicClient   // reads
source.chain
source.isLocalSigner  // false for json-rpc - offline signing unavailable
```

## Payment middleware & builders

| Export | Notes |
|---|---|
| `buildPaymentRequirements({ facilitatorUrl, payTo, price }, resourcePath)` | build the x402 `payment-required` payload |
| `encodePaymentRequirements(requirements)` | base64 for the header |
| `paymentMiddleware(options)` | middleware form for HTTP servers |

## Why one package

`examples/agent/`, `console/`, and `facilitator/` each depend on `@xbot02/core` via `file:` link - there is exactly **one** definition of the chain, the ABIs, and the status model in the whole codebase. Change it here and everything follows.
