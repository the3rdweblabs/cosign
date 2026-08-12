// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import { test } from "node:test";
import assert from "node:assert";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex, PublicClient } from "viem";
import { computeFeeAmount } from "@xbot02/core";
import { feeSchedule, readFeeConfig, validateFeeTx, type FeeConfig } from "./fee.js";
import { SelfpayFallback, type SelfpayPaymentDetails, type VerifyRequest } from "./selfpay-fallback.js";

const PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const AGENT = privateKeyToAccount(PK);
const PAYTO = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Address;
const RECEIVER = "0x9999999999999999999999999999999999999999" as Address;

const FEE: FeeConfig = { bps: 100, receiver: RECEIVER };

function env(values: Record<string, string>): NodeJS.ProcessEnv {
  return { BOT_NETWORK: "testnet", ...values } as NodeJS.ProcessEnv;
}

function makeClient(overrides: Partial<Record<"call" | "sendRawTransaction" | "waitForTransactionReceipt", any>> = {}): PublicClient {
  return {
    call: overrides.call ?? (async () => {}),
    sendRawTransaction: overrides.sendRawTransaction ?? (async () => "0xabababababababababababababababababababababababababababababababab" as Hex),
    waitForTransactionReceipt: overrides.waitForTransactionReceipt ?? (async () => ({ status: "success", blockNumber: 42n })),
  } as unknown as PublicClient;
}

async function signFeeTx(value: bigint, to = RECEIVER): Promise<Hex> {
  return AGENT.signTransaction({
    to,
    value,
    gas: 21000n,
    gasPrice: 1_000_000_000n,
    nonce: 1,
    chainId: 968,
  });
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
    maxTimeoutSeconds: 120,
  };
}

function req(rawTx: Hex, feeRawTx?: Hex): VerifyRequest {
  const requirements = details();
  return {
    paymentRequirements: requirements,
    paymentPayload: {
      x402Version: 2,
      accepted: requirements,
      payload: feeRawTx ? { rawTx, feeRawTx } : { rawTx },
    },
  };
}

test("computeFeeAmount rounds up (ceil) so the facilitator never under-collects", () => {
  assert.equal(computeFeeAmount(0, 1_000_000_000n), 0n);
  assert.equal(computeFeeAmount(100, 1_000_000_000_000_000_000n), 10_000_000_000_000_000n); // 1% of 1 ETH
  assert.equal(computeFeeAmount(100, 1n), 1n); // ceil(0.000001) = 1 wei
  assert.equal(computeFeeAmount(1, 5_000n), 1n); // ceil(0.5) = 1
  assert.equal(computeFeeAmount(250, 1_000n), 25n); // 2.5% of 1000
});

test("readFeeConfig: no fee when unset or bps = 0", () => {
  assert.equal(readFeeConfig(env({})), undefined);
  assert.equal(readFeeConfig(env({ FEE_BPS: "0" })), undefined);
});

test("readFeeConfig: parses FEE_BPS and requires FEE_RECEIVER", () => {
  const config = readFeeConfig(env({ FEE_BPS: "100", FEE_RECEIVER: RECEIVER }));
  assert.deepEqual(config, { bps: 100, receiver: RECEIVER });
  assert.throws(() => readFeeConfig(env({ FEE_BPS: "100" })), /FEE_RECEIVER/);
});

test("readFeeConfig: rejects an invalid receiver address", () => {
  assert.throws(() => readFeeConfig(env({ FEE_BPS: "100", FEE_RECEIVER: "not-an-address" })), /FEE_RECEIVER/);
});

test("readFeeConfig: FEE_PERCENT is converted to bps and rejects out-of-range", () => {
  assert.equal(readFeeConfig(env({ FEE_PERCENT: "1", FEE_RECEIVER: RECEIVER }))?.bps, 100);
  assert.equal(readFeeConfig(env({ FEE_PERCENT: "0.01", FEE_RECEIVER: RECEIVER }))?.bps, 1);
  assert.throws(() => readFeeConfig(env({ FEE_BPS: "10001", FEE_RECEIVER: RECEIVER })), /Invalid FEE_BPS/);
});

test("feeSchedule: advertises no fee by default, the configured fee otherwise", () => {
  assert.deepEqual(feeSchedule(undefined, "eip155:968"), { bps: 0, receiver: null, network: "eip155:968", asset: "0x0000000000000000000000000000000000000000" });
  assert.deepEqual(feeSchedule(FEE, "eip155:968"), { bps: 100, receiver: RECEIVER, network: "eip155:968", asset: "0x0000000000000000000000000000000000000000" });
});

test("validateFeeTx: accepts a correct fee tx", async () => {
  const result = await validateFeeTx({ feeRawTx: await signFeeTx(computeFeeAmount(FEE.bps, 1000n)), fee: FEE, amount: 1000n, expectedSender: AGENT.address, chainId: 968 });
  assert.deepEqual(result, { ok: true });
});

test("validateFeeTx: rejects wrong receiver / value / chain / sender", async () => {
  const badReceiver = await validateFeeTx({ feeRawTx: await signFeeTx(computeFeeAmount(FEE.bps, 1000n), PAYTO), fee: FEE, amount: 1000n, expectedSender: AGENT.address, chainId: 968 });
  assert.equal(badReceiver.ok, false);
  assert.match(badReceiver.message ?? "", /receiver/);

  const badValue = await validateFeeTx({ feeRawTx: await signFeeTx(1n), fee: FEE, amount: 1000n, expectedSender: AGENT.address, chainId: 968 });
  assert.equal(badValue.ok, false);
  assert.match(badValue.message ?? "", /value/);

  const badChain = await validateFeeTx({ feeRawTx: await AGENT.signTransaction({ to: RECEIVER, value: computeFeeAmount(FEE.bps, 1000n), gas: 21000n, gasPrice: 1_000_000_000n, nonce: 1, chainId: 677 }), fee: FEE, amount: 1000n, expectedSender: AGENT.address, chainId: 968 });
  assert.equal(badChain.ok, false);
  assert.match(badChain.message ?? "", /chain/);

  const other = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex);
  const badSender = await validateFeeTx({ feeRawTx: await other.signTransaction({ to: RECEIVER, value: computeFeeAmount(FEE.bps, 1000n), gas: 21000n, gasPrice: 1_000_000_000n, nonce: 1, chainId: 968 }), fee: FEE, amount: 1000n, expectedSender: AGENT.address, chainId: 968 });
  assert.equal(badSender.ok, false);
  assert.match(badSender.message ?? "", /sender/);
});

test("selfpay verify: requires the fee tx when a fee is configured", async () => {
  const fallback = new SelfpayFallback(makeClient(), 968, FEE);
  const rawTx = await signPayment();
  const missing = await fallback.verify(req(rawTx));
  assert.equal(missing.verified, false);
  assert.match(missing.message ?? "", /feeRawTx/);

  const wrong = await fallback.verify(req(rawTx, await signFeeTx(1n)));
  assert.equal(wrong.verified, false);
  assert.match(wrong.message ?? "", /value/);
});

test("selfpay verify: accepts the payment when the fee tx is correct", async () => {
  const fallback = new SelfpayFallback(makeClient(), 968, FEE);
  const rawTx = await signPayment();
  const result = await fallback.verify(req(rawTx, await signFeeTx(computeFeeAmount(FEE.bps, 1000n))));
  assert.equal(result.verified, true);
  assert.equal(result.from, AGENT.address);
});

test("selfpay verify: no fee configured means no feeRawTx requirement (backward compatible)", async () => {
  const fallback = new SelfpayFallback(makeClient(), 968);
  const rawTx = await signPayment();
  assert.equal((await fallback.verify(req(rawTx))).verified, true);
});

test("selfpay settle: broadcasts both the payment and the fee tx", async () => {
  const sent: Hex[] = [];
  const client = makeClient({
    sendRawTransaction: async ({ serializedTransaction }: { serializedTransaction: Hex }) => {
      sent.push(serializedTransaction);
      return "0x" + "cd".repeat(32) as Hex;
    },
  });
  const fallback = new SelfpayFallback(client, 968, FEE);
  const rawTx = await signPayment();
  const feeRawTx = await signFeeTx(computeFeeAmount(FEE.bps, 1000n));
  assert.equal((await fallback.verify(req(rawTx, feeRawTx))).verified, true);

  const result = await fallback.settle(req(rawTx, feeRawTx));
  assert.equal(result.settled, true);
  assert.equal(sent.length, 2, "payment and fee are both broadcast");
  assert.equal(sent[0], rawTx);
  assert.equal(sent[1], feeRawTx);
});

test("selfpay settle: reports when the fee broadcast fails", async () => {
  const client = makeClient({
    sendRawTransaction: async ({ serializedTransaction }: { serializedTransaction: Hex }) => {
      if (serializedTransaction !== (await signPayment())) throw new Error("fee broadcast rejected by mempool");
      return "0x" + "cd".repeat(32) as Hex;
    },
  });
  const fallback = new SelfpayFallback(client, 968, FEE);
  const rawTx = await signPayment();
  const feeRawTx = await signFeeTx(computeFeeAmount(FEE.bps, 1000n));
  const result = await fallback.settle(req(rawTx, feeRawTx));
  assert.equal(result.settled, false);
  assert.match(result.message ?? "", /fee/i);
});
