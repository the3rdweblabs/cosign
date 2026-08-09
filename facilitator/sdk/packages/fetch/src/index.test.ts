// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import { test } from "node:test";
import assert from "node:assert";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import { parseTransaction, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { botChainTestnet, buildPaymentRequirements, encodePaymentRequirements } from "@xbot02/core";
import { withBOT02, encodePaymentSignature } from "./index.js";

const AGENT = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const PAYTO = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const PRICE = "1.5";

function requirementsHeader(resource = "/paid-endpoint"): string {
  return encodePaymentRequirements(
    buildPaymentRequirements({ facilitatorUrl: "http://x", payTo: PAYTO, price: PRICE }, resource),
  );
}

type FacilitatorBehavior = (rawTx: Hex, feeRawTx?: Hex) => { verified: boolean; settled: boolean };

function startFacilitator(behavior: FacilitatorBehavior, fee?: { bps: number; receiver: string }) {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const path = (req.url ?? "").split("?")[0];
    if (req.method === "GET" && path === "/v1/fee") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          result: fee ?? { bps: 0, receiver: null, network: "eip155:968", asset: "0x0000000000000000000000000000000000000000" },
        }),
      );
      return;
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    const parsed = JSON.parse(body) as { paymentPayload?: { rawTx?: string; feeRawTx?: string } };
    const rawTx = (parsed.paymentPayload?.rawTx ?? "0x") as Hex;
    const feeRawTx = parsed.paymentPayload?.feeRawTx as Hex | undefined;
    const decision = behavior(rawTx, feeRawTx);
    const result =
      path === "/verify"
        ? { verified: decision.verified }
        : { settled: decision.settled, txHash: "0xab" };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ result }));
  });
  server.listen(0);
  return once(server, "listening").then(() => {
    const { port } = server.address() as { port: number };
    return {
      url: `http://127.0.0.1:${port}`,
      close: () =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    };
  });
}

function startResourceServer() {
  const calls: Array<{ input: string; headers: Headers }> = [];
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (calls.length === 0) {
      calls.push({ input: req.url ?? "", headers: new Headers(req.headers as Record<string, string>) });
      res.writeHead(402, { "payment-required": requirementsHeader(req.url ?? "/") });
      res.end("{}");
      return;
    }
    calls.push({ input: req.url ?? "", headers: new Headers(req.headers as Record<string, string>) });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: "served" }));
  });
  server.listen(0);
  return once(server, "listening").then(() => {
    const { port } = server.address() as { port: number };
    return {
      url: `http://127.0.0.1:${port}`,
      getCalls: () => calls,
      close: () =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    };
  });
}

test("auto-pays a 402 and retries with a zero-gas payment-signature", async () => {
  const facilitator = await startFacilitator(() => ({ verified: true, settled: true }));
  const resource = await startResourceServer();
  try {
    const wrapped = withBOT02({ account: AGENT, chain: botChainTestnet, facilitatorUrl: facilitator.url });
    const res = await wrapped(`${resource.url}/paid-endpoint`, { method: "GET" });

    assert.equal(res.status, 200);

    const calls = resource.getCalls();
    assert.equal(calls.length, 2, "exactly one retry after the 402");

    const sigHeader = calls[1].headers.get("payment-signature");
    assert.ok(sigHeader, "retry must carry the payment-signature header");
    const rawTx = decodeSignature(sigHeader);
    const tx = parseTransaction(rawTx);
    assert.equal(tx.to, PAYTO);
    assert.equal(tx.value, BigInt(Math.round(1.5 * 1e18)));
    assert.equal((tx as { gasPrice?: bigint }).gasPrice ?? 0n, 0n, "paymaster path uses a zero-gas-price tx");
  } finally {
    await facilitator.close();
    await resource.close();
  }
});

test("falls back to a normal gas-price tx when the zero-gas route is refused", async () => {
  const facilitator = await startFacilitator((rawTx) => {
    const tx = parseTransaction(rawTx);
    const zeroGas = ((tx as { gasPrice?: bigint }).gasPrice ?? 0n) === 0n;
    return zeroGas ? { verified: false, settled: false } : { verified: true, settled: true };
  });
  const resource = await startResourceServer();
  try {
    const wrapped = withBOT02({
      account: AGENT,
      chain: botChainTestnet,
      facilitatorUrl: facilitator.url,
      getGasPrice: () => 2_000_000_000n,
    });
    const res = await wrapped(`${resource.url}/paid-endpoint`, { method: "GET" });

    assert.equal(res.status, 200);

    const calls = resource.getCalls();
    assert.equal(calls.length, 2, "exactly one retry after the 402");

    const sigHeader = calls[1].headers.get("payment-signature");
    assert.ok(sigHeader);
    const tx = parseTransaction(decodeSignature(sigHeader));
    assert.equal((tx as { gasPrice?: bigint }).gasPrice, 2_000_000_000n, "self-pay fallback uses a real gas price");
  } finally {
    await facilitator.close();
    await resource.close();
  }
});

test("signs a second fee tx when the facilitator charges a surcharge", async () => {
  const FEE_RECEIVER = "0xcccccccccccccccccccccccccccccccccccccccc";
  const facilitator = await startFacilitator(
    (rawTx, feeRawTx) => {
      const tx = parseTransaction(rawTx);
      const zeroGas = ((tx as { gasPrice?: bigint }).gasPrice ?? 0n) === 0n;
      // A fee cannot ride the zero-gas paymaster path: reject it so the SDK
      // re-signs both txs with a normal gas price (self-pay).
      if (zeroGas) return { verified: false, settled: false };
      assert.ok(feeRawTx, "fee tx must be included in the payload");
      const feeTx = parseTransaction(feeRawTx);
      assert.equal(feeTx.to, FEE_RECEIVER);
      assert.equal(feeTx.value, 1_500_000_000_000_000_000n / 100n); // 1% of 1.5e18 → ceil
      assert.equal((feeTx as { gasPrice?: bigint }).gasPrice, 2_000_000_000n);
      return { verified: true, settled: true };
    },
    { bps: 100, receiver: FEE_RECEIVER },
  );
  const resource = await startResourceServer();
  try {
    const wrapped = withBOT02({
      account: AGENT,
      chain: botChainTestnet,
      facilitatorUrl: facilitator.url,
      getGasPrice: () => 2_000_000_000n,
    });
    const res = await wrapped(`${resource.url}/paid-endpoint`, { method: "GET" });

    assert.equal(res.status, 200);

    const calls = resource.getCalls();
    const sigHeader = calls[1].headers.get("payment-signature");
    assert.ok(sigHeader);
    const signature = JSON.parse(Buffer.from(sigHeader, "base64").toString("utf8")) as {
      payment?: { rawTx?: string; feeRawTx?: string };
    };
    assert.ok(signature.payment?.rawTx, "signature carries the price tx");
    assert.ok(signature.payment?.feeRawTx, "signature carries the fee tx");
    const feeTx = parseTransaction(signature.payment.feeRawTx);
    assert.equal(feeTx.to, FEE_RECEIVER);
  } finally {
    await facilitator.close();
    await resource.close();
  }
});

test("no fee tx when the facilitator advertises bps = 0", async () => {
  const facilitator = await startFacilitator(() => ({ verified: true, settled: true }), { bps: 0, receiver: null });
  const resource = await startResourceServer();
  try {
    const wrapped = withBOT02({ account: AGENT, chain: botChainTestnet, facilitatorUrl: facilitator.url });
    const res = await wrapped(`${resource.url}/paid-endpoint`, { method: "GET" });
    assert.equal(res.status, 200);

    const sigHeader = resource.getCalls()[1].headers.get("payment-signature");
    const signature = JSON.parse(Buffer.from(sigHeader!, "base64").toString("utf8")) as {
      payment?: { rawTx?: string; feeRawTx?: string };
    };
    assert.ok(signature.payment?.rawTx);
    assert.equal(signature.payment?.feeRawTx, undefined);
  } finally {
    await facilitator.close();
    await resource.close();
  }
});

test("encodes the payment-signature header shape resource servers expect", () => {
  const rawTx = "0x02f86b01808085000000000082520894bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb880de0b6b3a7640000808080";
  const encoded = encodePaymentSignature({ payment: { rawTx } });
  const parsed = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as { payment?: { rawTx?: string } };
  assert.equal(parsed.payment?.rawTx, rawTx);
});

function decodeSignature(header: string): Hex {
  const parsed = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as { payment?: { rawTx?: string } };
  return (parsed.payment?.rawTx ?? "0x") as Hex;
}
