---
title: xBOT02 - Introduction
description: xBOT02 is Cosign's x402-compatible payment facilitator for BOT Chain - the first one on the chain. What it is, what you can build with it, and how the flow works.
---

# Welcome to xBOT02

xBOT02 is **Cosign's x402-compatible facilitator for BOT Chain** - the first
facilitator for this chain. It implements the open
[x402 payment standard](../../facilitator/core-concepts/README.md), the
protocol that lets services charge for access to their APIs and content
directly over HTTP using the `402 Payment Required` status code.

## Why the name "xBOT02"?

`x402` is the protocol; the facilitator's HTTP facade is branded `xBOT02`
("x402 for BOT [Chain]") to distinguish Cosign's implementation from the
protocol itself and from other facilitators. We say "xBOT02" the way Coinbase
says "the x402 facilitator" - it is the concrete server that speaks x402 on
BOT Chain. Where a doc says "x402" it means the standard; where it says
"xBOT02" it means this facilitator.

## What xBOT02 provides

- **x402 HTTP endpoints** - `POST /verify` and `POST /settle`, the standard
  "agent hits a 402, pays, gets served" flow, over BOT Chain's native
  currency (BOT / tBOT on testnet).
- **Native EOA paymaster JSON-RPC** - `pm_isSponsorable` and
  `eth_sendRawTransaction` (BEP-414-style), implemented by us because there
  is **no third-party paymaster or facilitator for BOT Chain**.
- **Consent-gated settlement** - every settlement path (including self-pay)
  checks the onchain consent layer (`ConsentGateway.isApproved`) before value
  moves, so agents get spending power with human oversight.

## Why use x402 / xBOT02

- **No fees and minimal friction** - x402 as a standard has 0 built-in fees;
  settlement rides the native paymaster so agents pay no gas either.
- **Native machine-to-machine payments** - built for AI agents.
- **Micropayments** - pay-per-use APIs, paywalled content, per-request AI
  calls.

## Who is it for?

- **Sellers (resource servers):** monetize APIs or content on BOT Chain with
  direct, programmatic payments and minimal setup.
- **Buyers:** developers and AI agents who want to pay for services without
  accounts, sessions, or credential management.

## How it works

1. A buyer requests a resource from a server.
2. If payment is required, the server responds `402 Payment Required` with
   payment instructions (`PAYMENT-REQUIRED` header).
3. The buyer prepares and submits a payment payload (`PAYMENT-SIGNATURE`).
4. The server verifies and settles the payment - via xBOT02's `/verify` and
   `/settle`, or directly.
5. If payment is valid, the server provides the resource.

On BOT Chain the money moved is **native BOT**, and settlement is gasless for
the agent via the paymaster with a mandatory self-pay fallback.

## Get started

- [Core concepts](README.md) - facilitator, HTTP 402, networks & tokens, wallet
- [Facilitator README](../README.md) - running xBOT02, env config, endpoints
- [`x402 (xBOT02)` endpoints](../x402.md) - request/response shapes
- [Scheme: `exact` on BOT Chain](../x402/schemes/exact/scheme_exact_botchain.md) - the enabled scheme
