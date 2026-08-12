---
title: Contracts
description: The Cosign consent layer - AgentRegistry and ConsentGateway. Pure policy and state, holds no funds.
---

# Contracts - the Cosign consent layer

> Self-contained reference: [`contracts/README.md`](../../contracts/README.md) covers build, test, deploy, env vars, and both contracts in full.

The on-chain core of Cosign. Two Solidity `^0.8.24` contracts deployed with Foundry (see `contracts/foundry.toml`):

- [**AgentRegistry**](agent-registry.md) - who owns each agent, and the rolling spend policy.
- [**ConsentGateway**](consent-gateway.md) - the circuit breaker itself: approve in-policy actions instantly, park high-risk ones until a human decides.

## Design rules

- **The contracts hold no funds.** They are pure policy/state. Value moves via direct wallet-to-wallet transfers, verified off-chain by the facilitator/paymaster. No custody logic.
- `ConsentGateway` is the **only** contract that may record spend in the registry (`onlyGateway`).
- The paymaster's sponsor policy (`pm_isSponsorable`) reads `ConsentGateway.isApproved()` before agreeing to sponsor a matching transaction.

## Deployment

```bash
cd contracts
forge install
forge build
forge test

export DEPLOYER_PRIVATE_KEY=0x...

# testnet (chain 968) - BOT_NETWORK defaults to testnet
forge script script/Deploy.s.sol --rpc-url bohr --broadcast --verify

# mainnet (chain 677)
BOT_NETWORK=mainnet forge script script/Deploy.s.sol --rpc-url botchain --broadcast --verify
```

`Deploy.s.sol` reads `BOT_NETWORK` (`testnet` default | `mainnet`), verifies the
connected chain id matches (`968` / `677`), deploys `AgentRegistry`, then
`ConsentGateway(registry)`, then calls `registry.setConsentGateway(gateway)`.
After a successful deployment it writes a **deployment record** to
`contracts/deploy.{BOT_NETWORK}.json`:

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

The record carries the two contract addresses plus the exact env var names each
service reads, so you can copy the values straight into the service `.env`
files (`CONSENT_GATEWAY_ADDRESS` and, where needed, `AGENT_REGISTRY_ADDRESS`).
The dry-run broadcast logs (with tx hashes) live in
`contracts/broadcast/Deploy.s.sol/{chainId}/dry-run/run-latest.json`.

**Verify a record without redeploying** with the network-ready HTTP checker
(`contracts/scripts/check-deploy.mjs`): `node scripts/check-deploy.mjs
[testnet|mainnet]` checks chain id, on-chain code, and explorer source
verification for every present `deploy.{network}.json`, then prints the
explorer URLs. See [`contracts/README.md`](../../contracts/README.md).

**Check deployer funding before a deploy** with
`contracts/scripts/check-balance.mjs`: `node scripts/check-balance.mjs
[testnet|mainnet] [0xDeployer 0xAgent …]` reads the deployer from the
`deploy.{network}.json` record (or uses explicit addresses / a built-in RPC
pre-deploy), prints the live gas price, the full deploy cost
(~1,337,634 gas = AgentRegistry + ConsentGateway + `setConsentGateway`), each
address's native BOT/tBOT balance, and an "enough for deploy" flag.

## Contract address environment variables

All services read these per network as `NAME_<NETWORK>` (e.g.
`CONSENT_GATEWAY_ADDRESS_MAINNET`), falling back to the unsuffixed `NAME`.
`BOT_NETWORK` selects the network (`testnet` default, or `mainnet`).

| Variable | Used by |
|---|---|
| `CONSENT_GATEWAY_ADDRESS` / `_TESTNET` / `_MAINNET` | facilitator, agent, agent MCP, guardian MCP, console |
| `AGENT_REGISTRY_ADDRESS` / `_TESTNET` / `_MAINNET` | facilitator, agent MCP, guardian MCP, console |

## Contracts vs. the x402 flow

The contracts never see the payment. They only decide *whether* an action is approved. Once approved, the money flow is:

```
agent signs native tBOT transfer ──► facilitator /verify + /settle ──► BOT Chain
```
