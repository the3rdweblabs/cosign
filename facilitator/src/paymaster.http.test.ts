// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import { test } from "node:test";
import assert from "node:assert";
import { once } from "node:events";
import type { Address, Hex, PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { SponsorPolicy } from "./policy.js";
import { createPaymasterServer } from "./paymaster.js";
import { X402Adapter } from "./x402-adapter.js";
import { SelfpayFallback } from "./selfpay-fallback.js";

const GATEWAY = "0x1111111111111111111111111111111111111111" as Address;
const AGENT = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address;
const TARGET = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Address;
const SPONSOR = "0x0000000000000000000000000000000000000001" as `0x${string}`;

const client = {
  readContract: async () => true,
} as unknown as PublicClient;

const policy = new SponsorPolicy({ client, consentGatewayAddress: GATEWAY });
policy.registerRequest({ requestId: 0n, agent: AGENT, target: TARGET, amount: 1000n });

test("HTTP: pm_isSponsorable over the wire", async () => {
  const server = createPaymasterServer({ policy, sponsorPrivateKey: SPONSOR });
  server.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const { port } = address;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "pm_isSponsorable",
        params: [{ to: TARGET, from: AGENT, value: "0x3e8", data: "0x", gas: "0x5208" }],
      }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual(body, { jsonrpc: "2.0", id: 1, result: { Sponsorable: true, SponsorPolicy: "cosign-consent-gateway" } });
  } finally {
    server.close();
  }
});

test("HTTP: GET rejected as invalid request", async () => {
  const server = createPaymasterServer({ policy, sponsorPrivateKey: SPONSOR });
  server.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const { port } = address;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    const body = await res.json();
    assert.equal(res.status, 200);
    const error = (body as { error: { code: number } }).error;
    assert.equal(error.code, -32600);
  } finally {
    server.close();
  }
});

test("HTTP: eth_sendRawTransaction errors clearly when no sponsor key is configured", async () => {
  const server = createPaymasterServer({ policy });
  server.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const { port } = address;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_sendRawTransaction",
        params: ["0x02"],
      }),
    });
    const body = (await res.json()) as { error: { code: number; message: string } };
    assert.equal(res.status, 200);
    assert.equal(body.error.code, -32000);
    assert.match(body.error.message, /Sponsor not configured/);
  } finally {
    server.close();
  }
});

test("HTTP: x402 /verify and /settle route to the self-pay adapter", async () => {
  const PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
  const agent = privateKeyToAccount(PK);
  const payTo = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Address;

  const rawTx = await agent.signTransaction({
    to: payTo,
    value: 1000n,
    gas: 21000n,
    gasPrice: 1_000_000_000n,
    nonce: 0,
    chainId: 968,
  });

  const selfpayClient = {
    call: async () => {},
    sendRawTransaction: async () => "0xaa00000000000000000000000000000000000000000000000000000000000000" as Hex,
    waitForTransactionReceipt: async () => ({ status: "success", blockNumber: 77n }),
  } as unknown as PublicClient;

  const server = createPaymasterServer({
    policy,
    sponsorPrivateKey: SPONSOR,
    x402: new X402Adapter({ selfpay: new SelfpayFallback(selfpayClient, 968) }),
  });
  server.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const { port } = address;

  const paymentDetails = {
    scheme: "exact",
    network: "eip155:968",
    amount: "1000",
    asset: "0x0000000000000000000000000000000000000000",
    payTo,
  };

  try {
    const verifyRes = await fetch(`http://127.0.0.1:${port}/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paymentDetails, paymentPayload: { rawTx } }),
    });
    const verifyBody = (await verifyRes.json()) as { result: { verified: boolean } };
    assert.equal(verifyBody.result.verified, true);

    const settleRes = await fetch(`http://127.0.0.1:${port}/settle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paymentDetails, paymentPayload: { rawTx } }),
    });
    const settleBody = (await settleRes.json()) as { result: { settled: boolean; txHash?: string } };
    assert.equal(settleBody.result.settled, true);
    assert.equal(settleBody.result.txHash, "0xaa00000000000000000000000000000000000000000000000000000000000000");
  } finally {
    server.close();
  }
});
