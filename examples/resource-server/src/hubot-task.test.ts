// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import { test } from "node:test";
import assert from "node:assert";
import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import { createHubotTaskRoute } from "./routes/hubot-task.js";
import { DEFAULT_HUBOT_TASK_PRICE, hubotTaskPriceWei } from "./network.js";

const PAYTO = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Address;
const PRICE = "1000000000000000000";

async function signPayment(rawValue = 1000000000000000000n): Promise<Hex> {
  const agent = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
  return agent.signTransaction({
    to: PAYTO,
    value: rawValue,
    gas: 21000n,
    gasPrice: 1_000_000_000n,
    nonce: 0,
    chainId: 968,
  });
}

function encodeBase64(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

interface MockFacilitator {
  url: string;
  close: () => Promise<void>;
  setVerify: (fn: () => { isValid: boolean; invalidReason?: string }) => void;
  setSettle: (fn: () => { success: boolean; errorReason?: string; transaction?: string; extensions?: { blockNumber?: string | number | bigint } }) => void;
}

async function startMockFacilitator(): Promise<MockFacilitator> {
  let verifyFn = () => ({ isValid: true });
  let settleFn: () => { success: boolean; errorReason?: string; transaction?: string; extensions?: { blockNumber?: string | number | bigint } } = () => ({
    success: true,
    transaction: "0xaa00000000000000000000000000000000000000000000000000000000000000",
    extensions: { blockNumber: 42n },
  });

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    let result: unknown;
    const path = (req.url ?? "").split("?")[0];
    if (path === "/verify") result = verifyFn();
    else if (path === "/settle") result = settleFn();
    else result = { error: "not found" };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(result, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
  });

  server.listen(0);
  await once(server, "listening");
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    setVerify: (fn) => { verifyFn = fn; },
    setSettle: (fn) => { settleFn = fn; },
  };
}

async function startResourceServer(facilitatorUrl: string) {
  const route = createHubotTaskRoute({ facilitatorUrl, payTo: PAYTO, priceWei: PRICE, resourcePath: "/hubot-task" });
  const server = createServer(async (req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    if (path === "/hubot-task") {
      try {
        await route(req, res);
      } catch (err) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }));
      }
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });
  server.listen(0);
  await once(server, "listening");
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test("first request without payment -> HTTP 402 with PAYMENT-REQUIRED header", async () => {
  const facilitator = await startMockFacilitator();
  const resource = await startResourceServer(facilitator.url);
  try {
    const res = await fetch(`${resource.url}/hubot-task`, { method: "POST" });
    assert.equal(res.status, 402);
    const paymentRequired = JSON.parse(Buffer.from(res.headers.get("payment-required")!, "base64").toString("utf8"));
    assert.equal(paymentRequired.x402Version, 2);
    assert.equal(typeof paymentRequired.resource, "object");
    assert.equal(paymentRequired.resource.url, "/hubot-task");
    assert.equal(paymentRequired.accepts.length, 1);
    const option = paymentRequired.accepts[0];
    assert.equal(option.scheme, "exact");
    assert.equal(option.network, "eip155:968");
    assert.equal(option.amount, PRICE);
    assert.equal(option.payTo.toLowerCase(), PAYTO.toLowerCase());
    assert.equal(option.extra.paymentFlow, "authorization");
    assert.equal(option.extra.requireConsent, true);
  } finally {
    await resource.close();
    await facilitator.close();
  }
});

test("valid payment signature -> verified + settled -> HTTP 200 confirmed", async () => {
  const facilitator = await startMockFacilitator();
  const resource = await startResourceServer(facilitator.url);
  try {
    const rawTx = await signPayment();
    const res = await fetch(`${resource.url}/hubot-task`, {
      method: "POST",
      headers: { "payment-signature": encodeBase64({ payment: { rawTx } }) },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { status: string; task: string; txHash: string };
    assert.equal(body.status, "confirmed");
    assert.equal(body.task, "HuBot pickup task confirmed");
    assert.equal(body.txHash, "0xaa00000000000000000000000000000000000000000000000000000000000000");
    const paymentResponse = JSON.parse(Buffer.from(res.headers.get("payment-response")!, "base64").toString("utf8"));
    assert.equal(paymentResponse.receipt.txHash, "0xaa00000000000000000000000000000000000000000000000000000000000000");
    assert.equal(paymentResponse.receipt.blockNumber, "42");
  } finally {
    await resource.close();
    await facilitator.close();
  }
});

test("verify rejects payment -> HTTP 402 with error", async () => {
  const facilitator = await startMockFacilitator();
  facilitator.setVerify(() => ({ isValid: false, invalidReason: "Sponsor policy rejected" }));
  const resource = await startResourceServer(facilitator.url);
  try {
    const rawTx = await signPayment();
    const res = await fetch(`${resource.url}/hubot-task`, {
      method: "POST",
      headers: { "payment-signature": encodeBase64({ payment: { rawTx } }) },
    });
    assert.equal(res.status, 402);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "Sponsor policy rejected");
  } finally {
    await resource.close();
    await facilitator.close();
  }
});

test("settle fails -> HTTP 502 with error", async () => {
  const facilitator = await startMockFacilitator();
  facilitator.setSettle(() => ({ success: false, errorReason: "bundler not ready" }));
  const resource = await startResourceServer(facilitator.url);
  try {
    const rawTx = await signPayment();
    const res = await fetch(`${resource.url}/hubot-task`, {
      method: "POST",
      headers: { "payment-signature": encodeBase64({ payment: { rawTx } }) },
    });
    assert.equal(res.status, 502);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "bundler not ready");
  } finally {
    await resource.close();
    await facilitator.close();
  }
});

test("malformed signature -> HTTP 400", async () => {
  const facilitator = await startMockFacilitator();
  const resource = await startResourceServer(facilitator.url);
  try {
    const res = await fetch(`${resource.url}/hubot-task`, {
      method: "POST",
      headers: { "payment-signature": "!!not-base64-json!!" },
    });
    assert.equal(res.status, 400);
  } finally {
    await resource.close();
    await facilitator.close();
  }
});

test("hubotTaskPriceWei defaults per network (1 tBOT testnet / 0.1 BOT mainnet)", () => {
  assert.equal(DEFAULT_HUBOT_TASK_PRICE.testnet, "1000000000000000000");
  assert.equal(DEFAULT_HUBOT_TASK_PRICE.mainnet, "100000000000000000");
  assert.equal(hubotTaskPriceWei({}, "testnet"), DEFAULT_HUBOT_TASK_PRICE.testnet);
  assert.equal(hubotTaskPriceWei({}, "mainnet"), DEFAULT_HUBOT_TASK_PRICE.mainnet);
});

test("hubotTaskPriceWei: per-network env wins, then plain var", () => {
  assert.equal(hubotTaskPriceWei({ HUBOT_TASK_PRICE_TESTNET: "1", HUBOT_TASK_PRICE_MAINNET: "2" }, "testnet"), "1");
  assert.equal(hubotTaskPriceWei({ HUBOT_TASK_PRICE_TESTNET: "1", HUBOT_TASK_PRICE_MAINNET: "2" }, "mainnet"), "2");
  assert.equal(hubotTaskPriceWei({ HUBOT_TASK_PRICE: "7" }, "mainnet"), "7");
  assert.equal(hubotTaskPriceWei({ HUBOT_TASK_PRICE_MAINNET: "2", HUBOT_TASK_PRICE: "7" }, "mainnet"), "2");
});
