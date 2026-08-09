// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import { test } from "node:test";
import assert from "node:assert";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex, PublicClient } from "viem";
import { SelfpayFallback, type SelfpayPaymentDetails, type VerifyRequest } from "./selfpay-fallback.js";

const PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const AGENT = privateKeyToAccount(PK);
const PAYTO = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Address;

function makeClient(overrides: Partial<Record<"call" | "sendRawTransaction" | "waitForTransactionReceipt", any>> = {}): PublicClient {
  return {
    call: overrides.call ?? (async () => {}),
    sendRawTransaction: overrides.sendRawTransaction ?? (async () => "0xabababababababababababababababababababababababababababababababab" as Hex),
    waitForTransactionReceipt: overrides.waitForTransactionReceipt ?? (async () => ({ status: "success", blockNumber: 42n })),
  } as unknown as PublicClient;
}

async function signPayment(value = 1000n): Promise<Hex> {
  return AGENT.signTransaction({
    to: PAYTO,
    value,
    gas: 21000n,
    gasPrice: 1_000_000_000n,
    nonce: 0,
    chainId: 968,
  });
}

function details(amount = "1000"): SelfpayPaymentDetails {
  return {
    scheme: "exact",
    network: "eip155:968",
    amount,
    asset: "0x0000000000000000000000000000000000000000",
    payTo: PAYTO,
  };
}

function req(rawTx: Hex, overrides: Partial<SelfpayPaymentDetails> = {}): VerifyRequest {
  return { paymentDetails: { ...details(), ...overrides }, paymentPayload: { rawTx } };
}

test("verify: accepts a correctly signed native transfer", async () => {
  const rawTx = await signPayment(1000n);
  const result = await new SelfpayFallback(makeClient(), 968).verify(req(rawTx));
  assert.equal(result.verified, true);
  assert.ok(result.txHash);
  assert.equal(result.from?.toLowerCase(), AGENT.address.toLowerCase());
});

test("verify: rejects a tx paying the wrong recipient", async () => {
  const rawTx = await signPayment(1000n);
  const result = await new SelfpayFallback(makeClient(), 968).verify(req(rawTx, { payTo: "0xcccccccccccccccccccccccccccccccccccccccc" }));
  assert.equal(result.verified, false);
  assert.match(result.message ?? "", /payTo/);
});

test("verify: rejects a tx with a mismatched amount", async () => {
  const rawTx = await signPayment(500n);
  const result = await new SelfpayFallback(makeClient(), 968).verify(req(rawTx, { amount: "1000" }));
  assert.equal(result.verified, false);
  assert.match(result.message ?? "", /amount/);
});

test("verify: rejects a wrong chain id network", async () => {
  const rawTx = await signPayment(1000n);
  const result = await new SelfpayFallback(makeClient(), 968).verify(req(rawTx, { network: "eip155:677" }));
  assert.equal(result.verified, false);
  assert.match(result.message ?? "", /network|chain/);
});

test("verify: rejects unsupported scheme", async () => {
  const rawTx = await signPayment(1000n);
  const result = await new SelfpayFallback(makeClient(), 968).verify(req(rawTx, { scheme: "deferred" }));
  assert.equal(result.verified, false);
  assert.match(result.message ?? "", /scheme/);
});

test("verify: rejects an ERC-20 asset (non-native)", async () => {
  const rawTx = await signPayment(1000n);
  const result = await new SelfpayFallback(makeClient(), 968).verify(
    req(rawTx, { asset: "0x1111111111111111111111111111111111111111" }),
  );
  assert.equal(result.verified, false);
  assert.match(result.message ?? "", /native/);
});

test("verify: rejects an unparseable raw tx", async () => {
  const result = await new SelfpayFallback(makeClient(), 968).verify(req("0xdeadbeef" as Hex));
  assert.equal(result.verified, false);
  assert.match(result.message ?? "", /parse/);
});

test("verify: rejects when simulation fails", async () => {
  const rawTx = await signPayment(1000n);
  const client = makeClient({ call: async () => { throw new Error("insufficient funds"); } });
  const result = await new SelfpayFallback(client, 968).verify(req(rawTx));
  assert.equal(result.verified, false);
  assert.match(result.message ?? "", /simulation|insufficient/i);
});

test("settle: broadcasts the raw tx and waits for a successful receipt", async () => {
  const rawTx = await signPayment(1000n);
  const client = makeClient({
    sendRawTransaction: async ({ serializedTransaction }: any) => {
      assert.equal(serializedTransaction, rawTx);
      return "0xaa00000000000000000000000000000000000000000000000000000000000000" as Hex;
    },
    waitForTransactionReceipt: async () => ({ status: "success", blockNumber: 123n }),
  });
  const result = await new SelfpayFallback(client, 968).settle(req(rawTx));
  assert.equal(result.settled, true);
  assert.equal(result.txHash, "0xaa00000000000000000000000000000000000000000000000000000000000000");
  assert.equal(result.blockNumber, 123n);
});

test("settle: reports broadcast failure", async () => {
  const rawTx = await signPayment(1000n);
  const client = makeClient({
    sendRawTransaction: async () => { throw new Error("already known"); },
  });
  const result = await new SelfpayFallback(client, 968).settle(req(rawTx));
  assert.equal(result.settled, false);
  assert.match(result.message ?? "", /broadcast|already known/i);
});
