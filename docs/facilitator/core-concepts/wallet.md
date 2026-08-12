---
title: Wallet
description: How wallets serve as both payment mechanism and identity in x402, and how that maps to Cosign's agent/guardian model on BOT Chain.
---

# Wallet

In x402, a wallet is both a **payment mechanism** and a **form of unique
identity** for buyers and sellers. Wallet addresses send, receive, and verify
payments, and serve as identifiers within the protocol.

## Role of the wallet

### For buyers (clients)

Buyers use wallets to:

- Store BOT (tBOT on testnet).
- Sign payment payloads.
- Authorize onchain payments programmatically.

Wallets let buyers - including AI agents - transact without account creation
or credential management.

### For sellers (resource servers)

Sellers use wallets to:

- Receive BOT payments.
- Define their payment destination within server configurations.

A seller's wallet address is included in the `payTo` field of the payment
requirements the server advertises to buyers.

## BOT Chain specifics

Nothing about the wallet role changes on BOT Chain, but the signature model
does: the canonical x402 EVM schemes sign an EIP-3009/Permit2 authorization.
Cosign's binding instead signs a **native value transfer** (`rawTx`) - the
same EOA signing, just of a plain BOT transfer rather than an ERC-20
authorization. The facilitator verifies it and settles it (via paymaster or
self-pay).

## Cosign's model: agent + guardian wallets

Cosign layers identity on top of wallets:

- **Agent wallet** - signs the payment payload (`examples/agent/src/wallet.ts`).
- **Guardian wallet** - the human who co-signs high-value or out-of-policy
  actions via the consent layer (`ConsentGateway` + `AgentRegistry`).

The payment wallet and the consent identity are the same address: an agent's
spend policy in `AgentRegistry` gates what its wallet may pay for, and
anything above the cap parks as `Pending` until the guardian approves. The
facilitator's sponsor policy checks `ConsentGateway.isApproved(requestId)`
before sponsoring the matching transfer.

## References

- [The Facilitator](./facilitator.md)
- [HTTP 402](./http-402.md)
- [Architecture](../../architecture.md) - the agent/guardian model
- [`x402 (xBOT02)` endpoints](../x402.md)
