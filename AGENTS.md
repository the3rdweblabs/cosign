# AGENTS.md - Cosign

Read this fully before writing or changing any code. It has the decisions
already made, the reasoning behind them, and the facts we've verified about
the chain we're building on. Don't relitigate anything marked DECIDED - if
you think a decision is wrong, flag it in your response instead of silently
picking a different approach.

## What we're building

**Cosign** - a circuit breaker for autonomous agent payments on BOT Chain.
AI agents get spending power on-chain. Routine, in-policy actions settle
instantly and gas-free. Anything above a spend cap, or flagged as high-risk
(e.g. triggering a physical HuBot action), pauses and requires a human
guardian to co-sign via their own wallet before it executes.

Two things ship together:
1. An **x402-compatible facilitator** for BOT Chain - the first one for
   this chain. Standard "agent hits a 402, pays, gets served" flow.
2. A **native paymaster** (BOT Chain's own gasless-transaction primitive)
   wired underneath it, so payments are gas-free for the agent, not just
   token-free.

The on-chain consent layer (`ConsentGateway` + `AgentRegistry`) is the
actual differentiator - it's what makes this "agentic power with human
oversight" rather than just another payment facilitator.

## Team / background

- Built by The3rdWebLabs (the3rdweblabs) - a Nigerian Web3 R&D studio.
  Prior related work: [SuiOutKit](https://github.com/the3rdweblabs/suioutkit)
  (a payment SDK/toolkit on Sui).

## The chain: BOT Chain - verified facts, don't re-derive these

There are at least three unrelated projects that all use some form of the
name "BotChain" (botchain.tech / MetaBot / METAKPK, botchain.dev, and this
one). **We are building on BOT Chain at botchain.ai. Do not confuse docs
or contract addresses across these - they are not the same chain.**

- **Testnet** - Chain ID `968`, RPC `https://rpc.bohr.life`,
  Explorer `https://scan.bohr.life`,
  Faucet `https://faucet.botchain.ai/basic` (tBOT, 10/24hr limit)
- **Mainnet** - Chain ID `677`, RPC `https://rpc.botchain.ai`
- **Native gas token**: BOT (tBOT on testnet). This is a native currency,
  not an ERC-20 - no EIP-3009/Permit2 applies to it directly.
- **Consensus**: "Parlia" - this is BNB Smart Chain's consensus mechanism.
  BOT Chain is very likely a Parlia/BSC-derived fork. Practical upshot:
  BSC-flavored Hardhat/Foundry configs, tooling, and BEP references
  (below) transfer over almost unmodified.
- Supports **EIP-4844** (blob transactions). Near-full Geth JSON-RPC API
  compatibility.
- Official docs: `https://dev-docs.botchain.ai/docs/Developers/quick-guide/`
- Integration guide (Google Doc):
  `https://docs.google.com/document/d/1xYzdfJlD08UOV9CKE3nV7NTSQg6lPz9B17aIW2NF5Wg/edit`
- Explorer (mainnet-ish, separate from testnet explorer above):
  `https://scan.botchain.ai/`
- Bridge: `https://bridge.botchain.ai/` · DEX: `https://dex.botchain.ai/` ·
  Official wallet ("Bo Wallet"): `https://wallet.botchain.ai/`
- GitHub org: `https://github.com/BOTChain-bot`

## The native paymaster - this is the load-bearing technical fact

BOT Chain documents a **BEP-414-style EOA paymaster spec**
(`https://dev-docs.botchain.ai/docs/Developers/eoa-paymaster/`). It works
like this:

1. Wallet calls `pm_isSponsorable` with the pending tx (to/from/value/data/gas).
   Paymaster returns `{Sponsorable: bool, SponsorPolicy: string}`.
2. If sponsorable, the wallet sets gas price to zero, signs, and submits via
   `eth_sendRawTransaction` **to the paymaster**, not the normal mempool.
3. The paymaster wraps it in a bundle with its own sponsor transaction
   (covering gas), submits the bundle to MEV builders, a builder includes
   it, a proposer/validator picks that block. Both txs land atomically.
4. This is BEP-322 Proposer-Builder Separation underneath - validators
   don't check individual tx gas prices, builders prioritize by aggregate
   bundle gas price, so a zero-fee tx can ride alongside a sponsor tx that
   pays for both.

**Nodereal's MegaFuel is cited in BOT Chain's docs as an example
implementation of this spec - it is NOT deployed for BOT Chain.**
MegaFuel's actual endpoints are scoped to BNB Smart Chain and opBNB only
(`bsc-megafuel.nodereal.io`, `opbnb-megafuel.nodereal.io`). There is no
existing third-party paymaster for BOT Chain (chain 968).
**We are writing our own**, implementing exactly these two JSON-RPC
methods (`pm_isSponsorable`, `eth_sendRawTransaction`) ourselves.

**Open unknown, check before relying on this fully**: whether BOT Chain's
testnet builder/bundle infrastructure actually accepts external bundle
submissions today, or whether that part of the stack isn't fully live yet
on the testnet. If unconfirmed or broken, `selfpay-fallback.ts` is
the required fallback path - the facilitator MUST work with plain
self-paid transactions even if the native paymaster bundle path fails.
The self-pay fallback keeps the facilitator reliable regardless. See
`facilitator/src/selfpay-fallback.ts`.

## x402 - how we're using it

x402 is permissionless - no registration with anyone is required to run a
facilitator or define a new network. We're self-assigning CAIP-2-style
identifiers for BOT Chain (`eip155:968` for testnet, `eip155:677` for
mainnet) since none is officially registered anywhere yet.

Standard x402 flow: resource server responds `402` with payment
requirements → client pays → facilitator verifies + settles → resource
server serves the content. Normally x402's gasless "exact" scheme uses
EIP-3009 or Permit2 on an ERC-20. **We are not doing that** - we're using
BOT Chain's native paymaster instead, which is arguably a better fit since
it works on the native currency directly and needs no extra deployed
token-approval infrastructure. Treat the paymaster as the settlement
backend behind the x402-shaped `/verify` and `/settle` facilitator
endpoints - see `facilitator/src/x402-adapter.ts`.

## Contracts - already written, do not rewrite from scratch

`contracts/AgentRegistry.sol` and `contracts/ConsentGateway.sol` exist and
are considered done (extend, don't replace, unless you
find a bug). Key design point: **these contracts hold no funds.** They are
pure policy/state - agent→guardian mapping, spend caps, request approval
status. Actual value moves via direct wallet-to-wallet transfers, verified
off-chain by the facilitator/paymaster. This was a deliberate choice to
minimize the security surface - do not add custody logic
(e.g. don't make the contracts hold or forward payment value) without
raising it first.

Flow: agent calls `ConsentGateway.requestAction(target, amount, actionType)`
→ auto-approves and records spend if within the agent's policy in
`AgentRegistry` → otherwise parks as `Pending` until the guardian calls
`approve()` or `reject()`, or it expires after `PENDING_TIMEOUT` (15 min
default). The facilitator's paymaster policy (`pm_isSponsorable` logic)
should call `ConsentGateway.isApproved(requestId)` before agreeing to
sponsor the matching transaction.

## Tech stack / conventions

- Solidity `^0.8.24`, Foundry for contracts (chain 968 config in
  `contracts/foundry.toml`).
- TypeScript throughout the off-chain services. Use `viem`, not `ethers`,
  for consistency across `facilitator/`, `examples/`, and `console/`.
- Facilitator and resource server: keep them separate processes/ports even
  in dev, so the "agent hits a real HTTP 402" - end to end
  over HTTP, not simulated in-process.
- `console/` is a single React app (Vite), Tailwind for styling. No routing
  library needed - two views, tab-switch is enough.
- Don't add a database. Event logs from the contracts plus the paymaster's
  own request log are enough state. If you think you
  need persistence beyond that, flag it rather than reaching for one.

## Repo map

```
cosign/
├── contracts/
│   ├── src/AgentRegistry.sol        # agent→guardian mapping, spend policy (no custody)
│   ├── src/ConsentGateway.sol       # requestAction/approve/reject - on-chain circuit breaker
│   ├── script/Deploy.s.sol          # deploys registry + gateway, wires setConsentGateway
│   ├── test/ConsentGateway.t.sol    # auto-approve, pending, timeout, reject paths
│   └── foundry.toml                 # chain 968 / rpc.bohr.life config
├── facilitator/
│   ├── src/server.ts            # entrypoint - paymaster RPC + x402 HTTP facade
│   ├── src/paymaster.ts         # pm_isSponsorable + eth_sendRawTransaction
│   ├── src/x402-adapter.ts      # 402 flow <-> paymaster / selfpay backend
│   ├── src/policy.ts            # sponsor policy, checks ConsentGateway.isApproved()
│   ├── src/bundler.ts           # sponsor+user bundle submission (self-pay fallback gated)
│   ├── src/selfpay-fallback.ts  # default settlement path - plain self-paid txs
│   ├── src/chain.ts             # viem client, chain 968 config, contract addresses
│   └── sdk/                     # @xbot02/core, @xbot02/fetch, @xbot02/guardian, @xbot02/mcp
├── examples/
│   ├── resource-server/
│   │   ├── src/server.ts            # reference paid API - returns 402, serves after payment
│   │   └── src/routes/hubot-task.ts # "pay to trigger a HuBot pickup task" endpoint
│   ├── agent/
│   │   ├── src/agent.ts             # main loop - decides to act, calls the resource server
│   │   ├── src/reasoning.ts         # provider-agnostic LLM call (anthropic/openai/google/deepseek/cerebras/groq), produces the justification
│   │   ├── src/consent-client.ts    # ConsentGateway.requestAction(), both paths
│   │   └── src/wallet.ts            # agent signing key (viem)
│   └── README.md                    # what the examples demonstrate
├── console/
│   ├── src/App.tsx              # console shell (approval queue + activity feed)
│   ├── src/ApprovalQueue.tsx    # guardian approves/rejects pending requests
│   ├── src/ActivityFeed.tsx     # live feed of auto-approved / pending / approved / rejected
│   ├── src/StatusBadge.tsx      # status rendering
│   └── src/chain.ts             # viem client + contract bindings
├── docs/
│   ├── README.md                # landing + docs map
│   ├── architecture.md          # components, flows, design principles
│   ├── walkthrough.md           # the three example scenarios
│   └── {contracts,facilitator,resource-server,agent,console,sdk}/ - per-product reference
└── README.md
```

## Non-negotiables

- Never fabricate a BOT Chain RPC method or endpoint that isn't confirmed
  in this file or in the official docs above. If you need a capability
  that isn't documented, say so instead of guessing at a plausible-looking
  API.
- Don't add token custody to the contracts.
- The self-pay fallback path is not optional - it ships even if the
  native paymaster works, so the facilitator has no single point
  of failure on unproven testnet infra.
