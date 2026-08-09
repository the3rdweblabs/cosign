# xBOT02 SDK

An x402 SDK family for **BOT Chain** (chain 968 testnet / 677 mainnet), built
around the Cosign consent layer (`ConsentGateway` + `AgentRegistry`) so AI
agents get spend-bounded wallets and paid APIs get paid.

| Package | What it is |
| --- | --- |
| [`@xbot02/core`](./packages/core/README.md) | Chain config, contract ABIs, `ConsentClient`, x402 types, paid-API middleware, wallet source |
| [`@xbot02/fetch`](./packages/fetch/README.md) | Drop-in `fetch` wrapper: pays on `402` automatically, then retries |
| [`@xbot02/guardian`](./packages/guardian/README.md) | Human-oversight helpers: approve/reject/watch the consent layer |
| [`@xbot02/mcp`](./packages/mcp/README.md) | MCP servers + CLIs that turn any agent/chat client into a consent-aware actor |

## Status (read this before building on it)

- v1.0.0, ESM + TypeScript, `viem`-based. Test suites ship with every package.
- The **consent flow is proven live on testnet (968)**: an agent registered
  under a guardian, requested an action (auto-approved), paid 1 tBOT plus
  fee, and was served - all on-chain.
- **Gasless is not live yet.** The paymaster/bundler path depends on BOT
  Chain's builder submission channel, which is still being confirmed. Until
  then x402 settles via **self-pay** (the payer covers gas). The SDK handles
  both automatically, but don't advertise "gas-free" to users yet.
- **Testnet-only proof.** Mainnet (677) chain config exists; the consent
  contracts are not verified live there yet.
- Contracts hold **no funds**. Value always moves wallet-to-wallet.

## Development

```sh
npm install          # workspace install
npm run build        # tsc -> dist in every package
npm run typecheck
npm test
```

## License

GPL-3.0-only. Built by [The3rdWebLabs](https://github.com/the3rdweblabs).
