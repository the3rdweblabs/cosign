---
title: x402 Core Concepts
description: The x402 protocol concepts - facilitator, HTTP 402, networks & tokens, and wallet - adapted to Cosign's BOT Chain facilitator.
---

# x402 Core Concepts

The mental model behind the protocol Cosign's facilitator implements. Adapted
from the canonical x402 docs, with BOT Chain specifics where the native
currency and paymaster change the story.

| Concept | What it covers |
| --- | --- |
| [Introduction (xBOT02)](introduction.md) | what xBOT02 is and why it's named that |
| [The Facilitator](facilitator.md) | the verification + settlement service, deployment paths, replay protection |
| [HTTP 402](http-402.md) | the status code, the three V2 payment headers, settlement timing per scheme |
| [Wallet](wallet.md) | wallets as payment + identity, agent/guardian wallets in Cosign |

## Map to this repo

| Concept | Where it lives |
| --- | --- |
| Facilitator | [`docs/facilitator/README.md`](../README.md), [`x402 endpoints`](../x402.md) |
| HTTP 402 | [`x402-specification-v2.md`](../x402/x402-specification-v2.md), [`http.md` transport](../x402/transports-v2/http.md) |
| Networks & tokens | `chain.ts`, `.env` config per network, this page |
| Wallet | `examples/agent/src/wallet.ts` (agent), `console/` (guardian) |

## References

- [Canonical core concepts](https://github.com/x402-foundation/x402/tree/main/docs/core-concepts) - the upstream docs these pages adapt
