// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import { test } from "node:test";
import assert from "node:assert";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex, PublicClient } from "viem";
import { X402Adapter, isZeroGasPriceTx } from "./x402-adapter.js";
import { SelfpayFallback, type SelfpayPaymentDetails, type VerifyRequest } from "./selfpay-fallback.js";
import { BundlerNotReadyError } from "./bundler.js";
import { SponsorPolicy } from "./policy.js";

const PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const AGENT = privateKeyToAccount(PK);
const PAYTO = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Address;
const SPONSOR = "0x0000000000000000000000000000000000000001" as Hex;

function makeClient(): PublicClient {
  return {
    readContract: async () => true,
    call: async () => {},
    sendRawTransaction: async () => "0xabababababababababababababababababababababababababababababababab" as Hex,
    waitForTransactionReceipt: async () => ({ status: "success", blockNumber: 42n }),
  } as unknown as PublicClient;
}

async function signPayment(opts: { gasPrice?: bigint } = {}): Promise<Hex> {
  return AGENT.signTransaction({
    to: PAYTO,
    value: 1000n,
    gas: 21000n,
    gasPrice: opts.gasPrice ?? 1_000_000_000n,
    nonce: 0,
    chainId: 968,
  });
}

function details(): SelfpayPaymentDetails {
  return {
    scheme: "exact",
    network: "eip155:968",
    amount: "1000",
    asset: "0x0000000000000000000000000000000000000000",
    payTo: PAYTO,
  };
}

function req(rawTx: Hex, overrides: Partial<SelfpayPaymentDetails> = {}): VerifyRequest {
  return { paymentDetails: { ...details(), ...overrides }, paymentPayload: { rawTx } };
}

function policyApproving(): SponsorPolicy {
  const policy = new SponsorPolicy({ client: makeClient(), consentGatewayAddress: "0x1111111111111111111111111111111111111111" });
  policy.registerRequest({ requestId: 0n, agent: AGENT.address, target: PAYTO, amount: 1000n });
  return policy;
}

test("isZeroGasPriceTx: true for zero gas price, false otherwise", async () => {
  assert.equal(isZeroGasPriceTx(await signPayment({ gasPrice: 0n })), true);
  assert.equal(isZeroGasPriceTx(await signPayment({ gasPrice: 1_000_000_000n })), false);
  assert.equal(isZeroGasPriceTx("0xdeadbeef" as Hex), false);
});

test("adapter (default self-pay): verifies and settles a normal gas-price tx", async () => {
  const rawTx = await signPayment();
  const selfpay = new SelfpayFallback(makeClient(), 968);
  const adapter = new X402Adapter({ selfpay });

  const verified = await adapter.verify(req(rawTx));
  assert.equal(verified.verified, true);

  const settled = await adapter.settle(req(rawTx));
  assert.equal(settled.settled, true);
  assert.ok(settled.txHash);
});

test("adapter: rejects unsupported scheme and network", async () => {
  const rawTx = await signPayment();
  const adapter = new X402Adapter({ selfpay: new SelfpayFallback(makeClient(), 968) });

  const badScheme = await adapter.verify(req(rawTx, { scheme: "deferred" }));
  assert.equal(badScheme.verified, false);
  assert.match(badScheme.message ?? "", /scheme/);

  const badNetwork = await adapter.settle(req(rawTx, { network: "eip155:677" }));
  assert.equal(badNetwork.settled, false);
  assert.match(badNetwork.message ?? "", /network/);
});

test("adapter (paymaster enabled): zero-gas tx with ready bundler settles via bundler", async () => {
  const rawTx = await signPayment({ gasPrice: 0n });
  const adapter = new X402Adapter({
    selfpay: new SelfpayFallback(makeClient(), 968),
    paymaster: {
      enabled: true,
      policy: policyApproving(),
      sponsorPrivateKey: SPONSOR,
      bundler: async () => ({ bundleHash: "0xbb00000000000000000000000000000000000000000000000000000000000000" as Hex }),
    },
  });

  const verified = await adapter.verify(req(rawTx));
  assert.equal(verified.verified, true);

  const settled = await adapter.settle(req(rawTx));
  assert.equal(settled.settled, true);
  assert.equal(settled.txHash, "0xbb00000000000000000000000000000000000000000000000000000000000000");
});

test("adapter (paymaster enabled, bundler not ready): clear error, not silent self-pay", async () => {
  const rawTx = await signPayment({ gasPrice: 0n });
  const adapter = new X402Adapter({
    selfpay: new SelfpayFallback(makeClient(), 968),
    paymaster: {
      enabled: true,
      policy: policyApproving(),
      sponsorPrivateKey: SPONSOR,
      bundler: async () => { throw new BundlerNotReadyError(); },
    },
  });

  const settled = await adapter.settle(req(rawTx));
  assert.equal(settled.settled, false);
  assert.match(settled.message ?? "", /bundler|gas price|mempool/i);
});

test("adapter (paymaster enabled): a normal gas-price tx still uses self-pay", async () => {
  const rawTx = await signPayment({ gasPrice: 1_000_000_000n });
  const selfpay = new SelfpayFallback(makeClient(), 968);
  const adapter = new X402Adapter({
    selfpay,
    paymaster: { enabled: true, policy: policyApproving(), sponsorPrivateKey: SPONSOR },
  });

  const settled = await adapter.settle(req(rawTx));
  assert.equal(settled.settled, true);
  assert.ok(settled.txHash);
});

test("adapter (paymaster enabled): rejects a zero-gas payment that carries a feeRawTx", async () => {
  const rawTx = await signPayment({ gasPrice: 0n });
  const adapter = new X402Adapter({
    selfpay: new SelfpayFallback(makeClient(), 968),
    paymaster: {
      enabled: true,
      policy: policyApproving(),
      sponsorPrivateKey: SPONSOR,
      bundler: async () => ({ bundleHash: "0xbb00000000000000000000000000000000000000000000000000000000000000" as Hex }),
    },
  });
  const withFee: VerifyRequest = { paymentDetails: details(), paymentPayload: { rawTx, feeRawTx: "0xfeefee" as Hex } };

  const verified = await adapter.verify(withFee);
  assert.equal(verified.verified, false);
  assert.match(verified.message ?? "", /fee|paymaster/i);

  const settled = await adapter.settle(withFee);
  assert.equal(settled.settled, false);
  assert.match(settled.message ?? "", /fee|paymaster/i);
});
