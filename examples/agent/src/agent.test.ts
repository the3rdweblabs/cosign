// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import { test } from "node:test";
import assert from "node:assert";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import type { Address } from "viem";
import { runAgent, pickResourceUrl } from "./agent.js";
import { createAgentWallet, type AgentWallet } from "./wallet.js";

const AGENT_PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const GATEWAY = "0x9999999999999999999999999999999999999999" as Address;
const PAYTO = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Address;
const PRICE = "1000000000000000000";

function encodeBase64(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

const REQUIREMENTS = {
  x402Version: 2,
  resource: "/hubot-task",
  accepts: [{ scheme: "exact", network: "eip155:968", amount: PRICE, asset: "0x0000000000000000000000000000000000000000", payTo: PAYTO, maxTimeoutSeconds: 600, extra: { assetTransferMethod: "native", paymentFlow: "authorization", requireConsent: true } }],
};

const PURE_REQUIREMENTS = {
  x402Version: 2,
  resource: "/market-report",
  accepts: [{ scheme: "exact", network: "eip155:968", amount: PRICE, asset: "0x0000000000000000000000000000000000000000", payTo: PAYTO, maxTimeoutSeconds: 600, extra: { assetTransferMethod: "native", paymentFlow: "authorization", requireConsent: false } }],
};

type PaymentHandler = (req: IncomingMessage, rawTx?: string) => { status: number; body: Record<string, unknown> };

function startResourceServer(handler: PaymentHandler, requirements: Record<string, unknown> = REQUIREMENTS) {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const header = req.headers["payment-signature"];
    let rawTx: string | undefined;
    if (typeof header === "string" && header.length > 0) {
      rawTx = (JSON.parse(Buffer.from(header, "base64").toString("utf8")) as { payment?: { rawTx?: string } }).payment?.rawTx;
    }
    const { status, body: result } = handler(req, rawTx);
    res.writeHead(status, {
      "content-type": "application/json",
      ...(status === 402 ? { "payment-required": encodeBase64(requirements) } : {}),
    });
    res.end(JSON.stringify(result));
  });
  server.listen(0);
  return once(server, "listening").then(() => {
    const { port } = server.address() as { port: number };
    return {
      url: `http://127.0.0.1:${port}`,
      close: () => {
        server.closeAllConnections();
        return new Promise<void>((resolve) => server.close(() => resolve()));
      },
    };
  });
}

/** A wallet whose public client talks to a mock ConsentGateway on a mock chain. */
function mockWallet(autoApproved: boolean, requestId = 1n, guardianStatus = 3) {
  const wallet = createAgentWallet(AGENT_PK);
  const publicClient = {
    simulateContract: async () => ({ result: [requestId, autoApproved] as const }),
    waitForTransactionReceipt: async () => ({ status: "success" }),
    readContract: async () => ["", "", 0n, "", 0n, guardianStatus],
    getTransactionCount: async () => 5n,
    getGasPrice: async () => 1_000_000_000n,
  };
  const walletClient = {
    account: wallet.account,
    chain: { id: 968 },
    writeContract: async () => "0xaa00000000000000000000000000000000000000000000000000000000000000",
  };
  return { ...wallet, publicClient, walletClient } as unknown as AgentWallet;
}

/** A URL on a port that is guaranteed closed -> fetch throws ECONNREFUSED. */
async function closedUrl(): Promise<string> {
  const server = createServer();
  server.listen(0);
  await once(server, "listening");
  const { port } = server.address() as { port: number };
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return `http://127.0.0.1:${port}`;
}

/** A minimal facilitator answering GET /v1/fee so the pre-flight probe sees it as up. */
async function startFacilitatorServer() {
  const server = createServer((_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ result: { bps: 0, receiver: null, network: "eip155:968", asset: "0x0000000000000000000000000000000000000000" } }));
  });
  server.listen(0);
  await once(server, "listening");
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => {
      server.closeAllConnections();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** Wraps a mock wallet so any on-chain consent write is recorded. */
function trackingWallet(track: () => void): AgentWallet {
  const base = mockWallet(true);
  return {
    ...base,
    walletClient: { ...base.walletClient, writeContract: async () => (track(), "0xaa") },
  } as unknown as AgentWallet;
}

test("agent full loop: reason -> auto-approved consent -> x402 pay -> served", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  let sawPaymentHeader = false;
  const resource = await startResourceServer((_req, rawTx) => {
    if (!rawTx) {
      return { status: 402, body: { ...REQUIREMENTS, "payment-required": encodeBase64(REQUIREMENTS) } };
    }
    sawPaymentHeader = Boolean(rawTx);
    return { status: 200, body: { status: "confirmed", task: "HuBot pickup task confirmed", txHash: "0xab" } };
  });
  const facilitator = await startFacilitatorServer();
  try {
    const result = await runAgent({
      task: "Pay for the HuBot pickup task",
      resourceUrl: resource.url,
      consentGatewayAddress: GATEWAY,
      agentPrivateKey: AGENT_PK,
      wallet: mockWallet(true),
      facilitatorUrl: facilitator.url,
    });

    assert.equal(result.autoApproved, true);
    assert.equal(result.requestId, 1n);
    assert.equal(result.served, true);
    assert.equal(sawPaymentHeader, true);
  } finally {
    await resource.close();
    await facilitator.close();
  }
});

test("agent aborts payment when consent is rejected", async () => {
  const resource = await startResourceServer(() => ({ status: 402, body: REQUIREMENTS }));
  const facilitator = await startFacilitatorServer();
  try {
    const result = await runAgent({
      task: "Pay for the HuBot pickup task",
      resourceUrl: resource.url,
      consentGatewayAddress: GATEWAY,
      agentPrivateKey: AGENT_PK,
      wallet: mockWallet(false, 1n, 4),
      facilitatorUrl: facilitator.url,
    });
    assert.equal(result.status, "aborted");
    assert.equal(result.autoApproved, false);
    assert.equal(result.served, false);
  } finally {
    await resource.close();
    await facilitator.close();
  }
});

test("agent serves after waiting for guardian approval (pending -> approved)", async () => {
  let served = false;
  const resource = await startResourceServer((_req, rawTx) => {
    if (!rawTx) return { status: 402, body: REQUIREMENTS };
    served = true;
    return { status: 200, body: { status: "confirmed" } };
  });
  const facilitator = await startFacilitatorServer();
  try {
    const result = await runAgent({
      task: "Pay for the HuBot pickup task",
      resourceUrl: resource.url,
      consentGatewayAddress: GATEWAY,
      agentPrivateKey: AGENT_PK,
      wallet: mockWallet(false),
      facilitatorUrl: facilitator.url,
    });
    assert.equal(result.autoApproved, false);
    assert.equal(result.served, true);
    assert.equal(served, true);
  } finally {
    await resource.close();
    await facilitator.close();
  }
});

test("agent fails cleanly when the resource endpoint is down (no consent requested)", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  let consentRequested = false;
  const facilitator = await startFacilitatorServer();
  try {
    const result = await runAgent({
      task: "Pay for the HuBot pickup task",
      resourceUrl: await closedUrl(),
      consentGatewayAddress: GATEWAY,
      agentPrivateKey: AGENT_PK,
      wallet: trackingWallet(() => (consentRequested = true)),
      facilitatorUrl: facilitator.url,
    });
    assert.equal(result.status, "failed");
    assert.equal(result.served, false);
    assert.equal(result.requestId, 0n);
    assert.equal(result.failure?.service, "resource");
    assert.equal(result.failure?.kind, "unreachable");
    assert.equal(consentRequested, false);
    assert.match(result.justification, /resource endpoint unreachable/i);
  } finally {
    await facilitator.close();
  }
});

test("agent fails cleanly when the facilitator is down (no consent requested)", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  let consentRequested = false;
  const resource = await startResourceServer(() => ({ status: 402, body: REQUIREMENTS }));
  try {
    const result = await runAgent({
      task: "Pay for the HuBot pickup task",
      resourceUrl: resource.url,
      consentGatewayAddress: GATEWAY,
      agentPrivateKey: AGENT_PK,
      wallet: trackingWallet(() => (consentRequested = true)),
      facilitatorUrl: await closedUrl(),
    });
    assert.equal(result.status, "failed");
    assert.equal(result.served, false);
    assert.equal(result.failure?.service, "facilitator");
    assert.equal(result.failure?.kind, "unreachable");
    assert.equal(consentRequested, false);
    assert.match(result.justification, /facilitator endpoint unreachable/i);
  } finally {
    await resource.close();
  }
});

test("agent fails cleanly when both services are down", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const result = await runAgent({
    task: "Pay for the HuBot pickup task",
    resourceUrl: await closedUrl(),
    consentGatewayAddress: GATEWAY,
    agentPrivateKey: AGENT_PK,
    wallet: mockWallet(true),
    facilitatorUrl: await closedUrl(),
  });
  assert.equal(result.status, "failed");
  assert.equal(result.served, false);
  assert.equal(result.failure?.kind, "unreachable");
});

test("agent fails cleanly when the resource answers a non-402 status", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const resource = await startResourceServer(() => ({ status: 200, body: { ok: true } }));
  const facilitator = await startFacilitatorServer();
  try {
    const result = await runAgent({
      task: "Pay for the HuBot pickup task",
      resourceUrl: resource.url,
      consentGatewayAddress: GATEWAY,
      agentPrivateKey: AGENT_PK,
      wallet: mockWallet(true),
      facilitatorUrl: facilitator.url,
    });
    assert.equal(result.status, "failed");
    assert.equal(result.served, false);
    assert.equal(result.failure?.service, "resource");
    assert.equal(result.failure?.kind, "http");
  } finally {
    await resource.close();
    await facilitator.close();
  }
});

test("agent pays a pure x402 endpoint directly - no consent requested, no gateway configured", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  let consentRequested = false;
  const resource = await startResourceServer(
    (_req, rawTx) => {
      if (!rawTx) return { status: 402, body: PURE_REQUIREMENTS };
      return { status: 200, body: { status: "ok", report: { date: "2026-08-11" } } };
    },
    PURE_REQUIREMENTS,
  );
  const facilitator = await startFacilitatorServer();
  try {
    const result = await runAgent({
      task: "Fetch today's market report",
      resourceUrl: resource.url,
      agentPrivateKey: AGENT_PK,
      wallet: trackingWallet(() => (consentRequested = true)),
      facilitatorUrl: facilitator.url,
    });
    assert.equal(result.status, "served");
    assert.equal(result.served, true);
    assert.equal(result.requestId, 0n);
    assert.equal(result.autoApproved, false);
    assert.equal(consentRequested, false);
    assert.match(result.justification, /no on-chain consent/i);
  } finally {
    await resource.close();
    await facilitator.close();
  }
});

test("agent fails cleanly when a consent-gated endpoint has no gateway configured", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const resource = await startResourceServer(() => ({ status: 402, body: REQUIREMENTS }));
  const facilitator = await startFacilitatorServer();
  try {
    const result = await runAgent({
      task: "Pay for the HuBot pickup task",
      resourceUrl: resource.url,
      agentPrivateKey: AGENT_PK,
      wallet: mockWallet(true),
      facilitatorUrl: facilitator.url,
    });
    assert.equal(result.status, "failed");
    assert.equal(result.served, false);
    assert.equal(result.requestId, 0n);
    assert.equal(result.failure?.kind, "malformed");
    assert.match(result.justification, /consent/i);
  } finally {
    await resource.close();
    await facilitator.close();
  }
});

test("pickResourceUrl routes by keywords and ignores an empty RESOURCE_URL override", () => {
  const saved = { ...process.env };
  process.env.RESOURCE_URL = "";
  process.env.HUBOT_TASK_URL = "http://localhost:4000/hubot-task";
  process.env.MARKET_REPORT_URL = "http://localhost:4000/market-report";
  try {
    assert.equal(pickResourceUrl("get market report"), "http://localhost:4000/market-report");
    assert.equal(pickResourceUrl("dispatch hubot pickup"), "http://localhost:4000/hubot-task");
    assert.equal(pickResourceUrl("hello"), "http://localhost:4000/hubot-task");
  } finally {
    for (const key of Object.keys(saved)) process.env[key] = saved[key] as string;
    for (const key of ["RESOURCE_URL", "HUBOT_TASK_URL", "MARKET_REPORT_URL"]) {
      if (!(key in saved)) delete process.env[key];
    }
  }
});
