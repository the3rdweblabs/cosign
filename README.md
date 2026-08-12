# Cosign

The circuit breaker for autonomous agent payments on BOT Chain.

AI agents get real spending power on-chain. Routine, in-policy actions
settle instantly and gas-free through BOT Chain's native paymaster.
Anything above a spend cap - or flagged as high-risk, like triggering a
physical HuBot action - pauses and waits for a human guardian to co-sign
before it executes.

## What's in here

- **[`contracts/`](contracts/README.md)** - `AgentRegistry.sol` (agent → human guardian mapping,
  spend policy) and `ConsentGateway.sol` (the on-chain circuit breaker:
  auto-approve in-policy, park and wait for a human otherwise). Hold no
  funds - pure policy/state.
- **[`facilitator/`](docs/facilitator/README.md)** - the actual infra piece. An x402-compatible payment
  facilitator for BOT Chain, backed by a self-built implementation of BOT
  Chain's native EOA paymaster spec (`pm_isSponsorable` /
  `eth_sendRawTransaction`), with a guaranteed self-pay fallback.
- **[`examples/`](examples/README.md)** - reference implementations of each x402 role, built on the
  facilitator + `@xbot02` SDK packages: `examples/agent/` (an autonomous agent
  that pays for and fetches resources over x402) and `examples/resource-server/`
  (a reference "paid API" that returns HTTP 402 and serves content once payment
  settles). Use them as templates for your own agent or paid API.
- **[`console/`](docs/console/README.md)** - the human-facing app: an approval queue for guardians
  and a live activity feed.

See [`docs/`](docs/README.md) for architectural context, chain configuration,
and the reasoning behind every major decision - that is the source of truth if
anything here seems to conflict with it.

## Chain config

| | Testnet | Mainnet |
|---|---|---|
| Chain ID | `968` | `677` |
| RPC | `https://rpc.bohr.life` | `https://rpc.botchain.ai` |
| Explorer | `https://scan.bohr.life` | `https://scan.botchain.ai` |
| Faucet | `https://faucet.botchain.ai/basic` | - |

Services pick a network via `BOT_NETWORK` (`testnet` default, or `mainnet`)
and read their config from matching `_TESTNET` / `_MAINNET` env vars, e.g.
`BOT_RPC_URL_TESTNET` / `BOT_RPC_URL_MAINNET`.

## Links

- Docs: https://dev-docs.botchain.ai/docs/Developers/quick-guide/
- Integration guide: https://docs.google.com/document/d/1xYzdfJlD08UOV9CKE3nV7NTSQg6lPz9B17aIW2NF5Wg/edit
- GitHub org: https://github.com/BOTChain-bot
- Bridge: https://bridge.botchain.ai/ · DEX: https://dex.botchain.ai/ · Wallet: https://wallet.botchain.ai/

## Setup

The contracts and deploy script are network-agnostic - you pick the chain per
invocation with `--rpc-url`. Services pick the chain with `BOT_NETWORK`
(`testnet` default, or `mainnet`) and read their config from matching
`_TESTNET` / `_MAINNET` env vars.

```bash
# contracts
cd contracts && forge install && forge build && forge test

# deploy (creates registry + gateway, wires setConsentGateway)
# requires DEPLOYER_PRIVATE_KEY in env, and a funded account
# pre-check the deployer balance: node scripts/check-balance.mjs testnet [0x…]
node scripts/check-balance.mjs testnet

# TESTNET (chain 968) - tBOT
forge script script/Deploy.s.sol --rpc-url bohr --broadcast

# MAINNET (chain 677) - BOT
forge script script/Deploy.s.sol --rpc-url botchain --broadcast
```

Source-verification via `--verify` is optional: it needs the target explorer
configured in `contracts/foundry.toml` (`[etherscan]`), which isn't set up for
either network yet. Save the printed `AgentRegistry` / `ConsentGateway`
addresses for the `.env` files below.

```bash
# services (facilitator / examples / console)

# TESTNET (default): cp the example .env and fill the unsuffixed or _TESTNET vars
cd facilitator && npm install && cp .env.example .env  # fill in sponsor key + contract addresses

# examples/resource-server, examples/agent, console - same pattern
cd ../examples/resource-server && npm install
cp .env.example .env  # fill in RESOURCE_PAYTO (the "pay to" address for the paid API)

cd ../agent && npm install && cp .env.example .env

# MAINNET: set BOT_NETWORK=mainnet and fill the _MAINNET vars instead
# (e.g. BOT_RPC_URL_MAINNET, CHAIN_ID_MAINNET,
#  CONSENT_GATEWAY_ADDRESS_MAINNET, AGENT_REGISTRY_ADDRESS_MAINNET, ...
#  and VITE_*_MAINNET in console/.env)
```

Get testnet tBOT from the faucet before doing anything that needs gas on the
testnet. There is **no faucet on mainnet** - fund the account directly (BOT).

## Documentation

Full docs live in `docs/` - a structured, front-matter'd tree that any
docs site can fetch and render directly:

- [docs/README.md](docs/README.md) - landing + docs map
- [docs/getting-started.md](docs/getting-started.md) - run the whole stack
- [docs/architecture.md](docs/architecture.md) - components, flows, design principles
- [docs/walkthrough.md](docs/walkthrough.md) - three example scenarios: a routine payment that
  auto-settles, a high-risk action that pauses for a human, and one that
  gets rejected outright
- Per-product reference:
  - [docs/contracts/](docs/contracts/README.md) - [agent-registry.md](docs/contracts/agent-registry.md) · [consent-gateway.md](docs/contracts/consent-gateway.md)
  - [docs/facilitator/](docs/facilitator/README.md) - [x402.md](docs/facilitator/x402.md) · [paymaster.md](docs/facilitator/paymaster.md) · [sponsor-policy.md](docs/facilitator/sponsor-policy.md) · [selfpay-fallback.md](docs/facilitator/selfpay-fallback.md)
  - [examples/](docs/examples/README.md) - [agent](docs/examples/agent/README.md) · [resource server](docs/examples/resource-server/README.md)
  - [docs/console/](docs/console/README.md)
  - [docs/sdk/](docs/sdk/README.md) - [core](docs/sdk/core/README.md) · [fetch](docs/sdk/fetch/README.md) · [guardian](docs/sdk/guardian/README.md) · [mcp](docs/sdk/mcp/README.md)
