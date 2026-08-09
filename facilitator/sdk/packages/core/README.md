# @xbot02/core

The foundation of the xBOT02 SDK family: BOT Chain configuration, the
`ConsentGateway` / `AgentRegistry` contract bindings, the agent-facing
`ConsentClient`, x402 types, the paid-API middleware, and wallet helpers.

Everything is typed, `viem`-based (no `ethers`), and ESM.

## Install

```sh
npm i @xbot02/core
```

## What you get

| Export | Purpose |
| --- | --- |
| `botChainTestnet`, `botChainMainnet` | viem `Chain` configs (chain 968 / 677) |
| `botNetworkConfig`, `botNetworkFromEnv`, `envFor`, `botChainFromEnv` | `BOT_NETWORK`-driven chain selection with `NAME_<NETWORK>` env convention |
| `CONSENT_GATEWAY_ABI`, `AGENT_REGISTRY_ABI`, `ACTION_REQUESTED_EVENT`, `actionTypeHash` | Contract bindings |
| `REQUEST_STATUS`, `STATUS`, `STATUS_NUM`, `STATUS_ORDER` | `ConsentGateway.Status` enum ↔ labels |
| `ConsentClient` | Agent calls `requestAction()`, polls for guardian decisions |
| `createWalletSource` | Private-key / mnemonic / remote json-rpc signer |
| `paymentMiddleware`, `buildPaymentRequirements`, `encodePaymentRequirements` | Turn any route into a paid x402 route |
| `PaymentDetails`, `VerifyRequest`, `VerificationResult`, `SettlementResult`, `X402_SCHEME`, `NATIVE_ASSET`, CAIP-2 ids | x402 types |
| `FeeSchedule`, `computeFeeAmount` | Facilitator surcharge math |
| `formatAmount`, `shortAddress`, `timeAgo`, `actionTypeLabel` | Display helpers |

## Quick start

### 1. Consent-gated spending (agent side)

```ts
import { createPublicClient, createWalletClient, http, privateKeyToAccount } from "viem";
import { botChainTestnet, ConsentClient } from "@xbot02/core";

const account = privateKeyToAccount("0x...");
const wallet = createWalletClient({ chain: botChainTestnet, account, transport: http() });
const publicClient = createPublicClient({ chain: botChainTestnet, transport: http() });

const consent = new ConsentClient({
  walletClient: wallet,
  publicClient,
  consentGatewayAddress: "0xAc1813a52D1d3b6fFf0080feD17362C8aD86F372", // testnet (968)
});

const { requestId, autoApproved, txHash } = await consent.requestAction({
  target: "0x...",               // where the money goes
  amount: 1000000000000000000n,   // 1 tBOT in wei
  actionType: "PAYMENT",          // hashed to bytes32 on-chain
  justification: "Buying HuBot pickup credits",
  task: "Fetch credits from the resource server",
});

if (autoApproved) {
  // in-policy: proceed immediately
} else {
  // parked Pending - wait for the human guardian
  const outcome = await consent.waitForApproval(requestId); // "Approved" | "Rejected" | "Expired"
}
```

### 2. Paid resource server (API builder side)

```ts
import { paymentMiddleware } from "@xbot02/core";

// Express-compatible signature; works with any (req, res) pair.
// Every request to this route gets a 402 + `payment-required` header.
app.get("/hubot/pickup", paymentMiddleware({
  facilitatorUrl: "http://localhost:3000", // your xBOT02 facilitator
  payTo: "0x...",                          // your wallet
  price: "0.05",                           // in BOT, decimal string
}));
```

`paymentMiddleware` only issues the 402. The actual verify/settle happens at
the facilitator, so the API builder never touches BOT Chain directly.

### 3. Wallet source (signer-agnostic)

```ts
import { createWalletSource } from "@xbot02/core";

// private-key / mnemonic / json-rpc signer from one config
const source = createWalletSource({
  kind: "mnemonic",
  mnemonic: "your seed phrase",
  accountIndex: 0,
});
source.walletClient; // viem WalletClient
source.publicClient; // viem PublicClient
source.isLocalSigner; // false for json-rpc (cannot sign offline)
```

### 4. Facilitator fee math

```ts
import { computeFeeAmount } from "@xbot02/core";

const feeWei = computeFeeAmount(10, 1000000000000000000n); // ceil(1e18 * 10 / 10000) = 1e15
```

## Live contract addresses (testnet, chain 968)

- `AgentRegistry`: `0x0cA3F183374f75e5a2d81C29A37B00Aab075be87`
- `ConsentGateway`: `0xAc1813a52D1d3b6fFf0080feD17362C8aD86F372`

Mainnet (677) addresses are not yet verified live.

## Status

v1.0.0. The consent flow is proven live on testnet. The gasless paymaster
path is pending the bundler/builder channel; until then x402 settles via
self-pay. No custody: value always moves wallet-to-wallet.

## License

GPL-3.0-only. Built by [The3rdWebLabs](https://github.com/the3rdweblabs).
