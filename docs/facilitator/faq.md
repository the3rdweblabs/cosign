---
title: xBOT02 - FAQ
description: Frequently asked questions about the xBOT02 facilitator for BOT Chain - pricing, schemes, security, wallets, and troubleshooting.
---

# xBOT02 FAQ

## General

#### What is xBOT02 in a single sentence?

xBOT02 is Cosign's x402-compatible payment facilitator for BOT Chain - a
native-currency, consent-gated implementation of the open x402 standard that
turns the HTTP `402 Payment Required` status code into an onchain payment
layer for APIs, websites, and autonomous agents.

#### Is x402 a Coinbase product?

No. x402 is an open protocol (Apache-2.0) and a credibly neutral payment
standard. You need no Coinbase products to use it - and xBOT02 needs none at
all; it is BOT-native.

#### Why not just use API keys?

API keys require account setup flows, payment methods, and key management.
x402 removes those dependencies, enabling programmatic, HTTP-native payments
(ideal for AI agents) with near-zero fees and fast settlement.

#### Is xBOT02 only for crypto-native projects?

No. Any web API or content provider - crypto or web2 - can integrate x402 if
it wants a lower-cost, friction-free payment path for small or usage-based
transactions. On BOT Chain, that means paying in BOT/tBOT through xBOT02.

## Facilitator

#### Who runs facilitators today?

Anyone - the protocol is permissionless. Multiple organizations operate
production facilitators on other networks. For BOT Chain specifically, there
was **no facilitator and no third-party paymaster** before xBOT02; Cosign
runs its own (and its own native EOA paymaster implementation).

#### What stops a malicious facilitator from stealing funds or lying about settlement?

Every x402 `PaymentPayload` is **signed by the buyer** and settled onchain.
A facilitator that tampers with the transaction fails signature checks and
cannot settle it. xBOT02 also enforces **idempotent settlement** (a settled
payload can't be replayed) and the **consent gate** - no value moves unless
`ConsentGateway.isApproved(requestId)` holds.

## Pricing & Schemes

#### How should I price an endpoint?

Common patterns:

- **Flat per-call** (e.g. `0.01 BOT` per request).
- **Tiered** (`/basic` vs `/pro` endpoints at different prices).

On BOT Chain only **`exact`** is enabled today - see
[schemes](./x402/schemes/README.md).

## Assets, Networks & Fees

#### Which assets and networks does xBOT02 support?

| Network | CAIP-2 ID | Asset | Status |
| ------- | --------- | ----- | ------ |
| BOT Chain Testnet | `eip155:968` | native BOT (tBOT) | **Testnet** - supported |
| BOT Chain Mainnet | `eip155:677` | native BOT | **Mainnet** - supported |

Gas is settled via the native EOA paymaster (gasless sponsorship) with a
mandatory self-pay fallback. There are no facilitator fees by default
(`FEE_BPS`/`FEE_PERCENT` are opt-in and advertised at `GET /v1/fee`). See
[Networks & token support](./network-and-token-support.md) for the "grow here"
tables as we add assets.

#### Does x402 support fiat off-ramps or credit-card deposits?

Not natively. Facilitators or third-party gateways can wrap x402 flows with
on- and off-ramps.

## Security

#### Do I have to expose my private key to my backend?

No. **Buyers (clients/agents)** sign locally in their runtime (browser,
serverless, agent VM) using viem programmatic wallets. **Sellers** never hold
the buyer's key; they only verify signatures.

#### How do refunds work?

The **`exact`** scheme is a push payment - irreversible once executed.
Business-logic refunds are a reverse transfer from the seller to the buyer.

## Usage by AI Agents

#### How does an agent know what to pay?

1. Make a request.
2. Parse the `PAYMENT-REQUIRED` header.
3. Choose a suitable requirement and sign a payload via the client SDK
   (`@xbot02/fetch`).
4. Retry with the `PAYMENT-SIGNATURE` header.

#### Do agents need wallets?

Yes. Programmatic wallets (viem HD wallets) let agents sign `EIP-712`
payloads without exposing seed phrases. In Cosign, the **agent wallet**
signs payments and the **guardian wallet** approves out-of-policy actions via
the consent layer.

## Troubleshooting

#### I keep getting `402 Payment Required`, even after attaching `PAYMENT-SIGNATURE`. Why?

1. Signature is invalid (wrong chain id or payload fields).
2. Amount does not exactly match `amount` in the payment requirements
   (`exact` requires strict equality - no over/under payment).
3. The consent gate rejected it: `ConsentGateway.isApproved(requestId)` is
   false - out of policy, or the guardian hasn't approved the pending
   request. Approve it in the Cosign console.
4. Insufficient BOT/tBOT in the paying wallet.

Check the `error` field in the server's JSON response for details.

#### My test works on testnet but fails on mainnet - what changed?

- Ensure `network` is `eip155:677` (mainnet), not `eip155:968` (testnet).
- Confirm the wallet holds **mainnet BOT**, and check `BOT_RPC_URL_MAINNET`
  / `CONSENT_GATEWAY_ADDRESS_MAINNET` are set on the facilitator.

## Still have questions?

- Open an issue on the [x402 repo](https://github.com/x402-foundation/x402)
- For xBOT02-specifics, raise it in the Cosign project repo.
