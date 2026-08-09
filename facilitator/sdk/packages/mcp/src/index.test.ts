// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { LoggingMessageNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { buildPaymentRequirements, createWalletSource, encodePaymentRequirements, type WalletSource } from "@xbot02/core";
import { createAgentServer } from "./agent-server.js";
import { createGuardianServer } from "./guardian-server.js";

const GATEWAY = "0x9999999999999999999999999999999999999999";
const REGISTRY = "0x8888888888888888888888888888888888888888";
const AGENT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const GUARDIAN = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const TARGET = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

interface MockSource {
  source: WalletSource;
  writeCalls: Array<{ functionName: string; args: readonly unknown[] }>;
  readCalls: Array<{ functionName: string; args: readonly unknown[] }>;
  statusByRequest: Map<bigint, bigint>;
}

function makeMockSource(opts: { autoApproved?: boolean; statusByRequest?: Map<bigint, bigint> } = {}): MockSource {
  const { autoApproved = true, statusByRequest = new Map() } = opts;
  const writeCalls: Array<{ functionName: string; args: readonly unknown[] }> = [];
  const readCalls: Array<{ functionName: string; args: readonly unknown[] }> = [];

  const walletClient = {
    chain: { id: 968 },
    account: { address: AGENT, type: "local" },
    writeContract: async ({ functionName, args }: { functionName: string; args: readonly unknown[] }) => {
      writeCalls.push({ functionName, args });
      return `0x${functionName}0000000000000000000000000000000000000000000000000000000000`;
    },
  };
  const publicClient = {
    simulateContract: async ({ functionName }: { functionName: string }) => {
      readCalls.push({ functionName, args: [] });
      return { result: [1n, autoApproved] };
    },
    waitForTransactionReceipt: async () => ({ status: "success" }),
    readContract: async ({ functionName, args }: { functionName: string; args: readonly unknown[] }) => {
      readCalls.push({ functionName, args });
      if (functionName === "getRequest") {
        const requestId = args[0] as bigint;
        const status = statusByRequest.get(requestId) ?? 3n;
        return [
          AGENT,
          TARGET,
          1_000_000_000_000_000_000n,
          "0x0000000000000000000000000000000000000000000000000000000000000000",
          1_700_000_000n,
          status,
        ];
      }
      if (functionName === "getPolicy") return [GUARDIAN, 10n ** 18n, 86400n, 0n, 0n, true];
      throw new Error(`unexpected readContract ${functionName}`);
    },
    getLogs: async ({ event }: { event?: { name?: string } }) => {
      if (event?.name === "ActionRequested") return [{ args: { requestId: 1n } }, { args: { requestId: 2n } }];
      return [];
    },
  };

  const source = {
    account: walletClient.account,
    chain: walletClient.chain,
    publicClient,
    walletClient,
    isLocalSigner: true,
  } as unknown as WalletSource;

  return { source, writeCalls, readCalls, statusByRequest };
}

async function connect(server: McpServer): Promise<Client> {
  const client = new Client({ name: "test-client", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<{ text: string; isError: boolean }> {
  const res = (await client.callTool({ name, arguments: args })) as unknown as CallToolResult;
  const first = res.content[0];
  const text = first && "text" in first ? first.text : "";
  return { text, isError: res.isError === true };
}

test("agent: request_action auto-approves in-policy actions", async () => {
  const mock = makeMockSource({ autoApproved: true });
  const server = createAgentServer({ source: mock.source, consentGatewayAddress: GATEWAY });
  const client = await connect(server);

  const { text, isError } = await call(client, "request_action", {
    target: TARGET,
    amount: "1000000000000000000",
    actionType: "PAYMENT",
  });

  assert.equal(isError, false);
  const parsed = JSON.parse(text);
  assert.equal(parsed.requestId, "1");
  assert.equal(parsed.autoApproved, true);
  assert.equal(parsed.status, "AutoApproved");
  assert.equal(mock.writeCalls[0].functionName, "requestAction");
});

test("agent: request_action parks high-risk actions as Pending", async () => {
  const mock = makeMockSource({ autoApproved: false });
  const server = createAgentServer({ source: mock.source, consentGatewayAddress: GATEWAY });
  const client = await connect(server);

  const { text, isError } = await call(client, "request_action", {
    target: TARGET,
    amount: "500000000000000000000",
    actionType: "HUBOT_TRIGGER",
    justification: "Physically dispatches a HuBot",
  });

  assert.equal(isError, false);
  assert.equal(JSON.parse(text).status, "Pending");
});

test("agent: check_status maps the on-chain status", async () => {
  const mock = makeMockSource();
  mock.statusByRequest.set(3n, 3n);
  const server = createAgentServer({ source: mock.source, consentGatewayAddress: GATEWAY });
  const client = await connect(server);

  const { text, isError } = await call(client, "check_status", { requestId: "3" });
  assert.equal(isError, false);
  assert.deepEqual(JSON.parse(text), { requestId: "3", status: "Approved" });
});

test("agent: get_policy reads the agent registry (defaults to own address)", async () => {
  const mock = makeMockSource();
  const server = createAgentServer({ source: mock.source, consentGatewayAddress: GATEWAY, registryAddress: REGISTRY });
  const client = await connect(server);

  const { text, isError } = await call(client, "get_policy", {});
  assert.equal(isError, false);
  const policy = JSON.parse(text);
  assert.equal(policy.agent, AGENT);
  assert.equal(policy.guardian, GUARDIAN);
  assert.equal(policy.spendCap, "1000000000000000000");
  assert.equal(mock.readCalls.some((r) => r.functionName === "getPolicy"), true);
});

test("agent: get_policy fails without a configured registry", async () => {
  const mock = makeMockSource();
  const server = createAgentServer({ source: mock.source, consentGatewayAddress: GATEWAY });
  const client = await connect(server);

  const { isError } = await call(client, "get_policy", {});
  assert.equal(isError, true);
});

test("agent: expire_request writes the expire function", async () => {
  const mock = makeMockSource();
  const server = createAgentServer({ source: mock.source, consentGatewayAddress: GATEWAY });
  const client = await connect(server);

  const { isError } = await call(client, "expire_request", { requestId: "2" });
  assert.equal(isError, false);
  assert.equal(mock.writeCalls[0].functionName, "expire");
  assert.equal(mock.writeCalls[0].args[0], 2n);
});

test("agent: pay_uri pays through the facilitator and retries served", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    if (url.endsWith("/verify")) {
      return new Response(JSON.stringify({ result: { verified: true, txHash: "0xabc" } }), { headers: { "content-type": "application/json" } });
    }
    if (url.endsWith("/settle")) {
      return new Response(JSON.stringify({ result: { settled: true } }), { headers: { "content-type": "application/json" } });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  try {
    const baseFetch = (async (input: unknown, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (!headers.has("payment-signature")) {
        const requirements = buildPaymentRequirements({ facilitatorUrl: "http://fac", payTo: TARGET, price: "1" }, "/hubot-task");
        return new Response(JSON.stringify({ error: "payment required" }), {
          status: 402,
          headers: { "content-type": "application/json", "payment-required": encodePaymentRequirements(requirements) },
        });
      }
      return new Response(JSON.stringify({ ok: true, task: "confirmed" }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    const source = createWalletSource({ kind: "private-key", privateKey: PK });
    const server = createAgentServer({
      source,
      consentGatewayAddress: GATEWAY,
      facilitatorUrl: "http://localhost:9999",
      baseFetch,
    });
    const client = await connect(server);

    const { text, isError } = await call(client, "pay_uri", { uri: "http://localhost:7777/hubot-task" });
    assert.equal(isError, false);
    const parsed = JSON.parse(text);
    assert.equal(parsed.status, 200);
    assert.equal(parsed.served, true);
    assert.ok(parsed.body.includes("confirmed"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("agent: pay_uri refuses non-local signers", async () => {
  const mock = makeMockSource();
  const remoteSource = {
    ...mock.source,
    account: { address: AGENT, type: "json-rpc" },
    isLocalSigner: false,
  } as unknown as WalletSource;
  const server = createAgentServer({ source: remoteSource, consentGatewayAddress: GATEWAY, facilitatorUrl: "http://localhost:9999" });
  const client = await connect(server);

  const { text, isError } = await call(client, "pay_uri", { uri: "http://localhost:7777/hubot-task" });
  assert.equal(isError, true);
  assert.match(text, /local signer/);
});

test("agent: pay_uri requires a configured facilitatorUrl", async () => {
  const mock = makeMockSource();
  const server = createAgentServer({ source: mock.source, consentGatewayAddress: GATEWAY });
  const client = await connect(server);

  const { text, isError } = await call(client, "pay_uri", { uri: "http://localhost:7777/hubot-task" });
  assert.equal(isError, true);
  assert.match(text, /facilitatorUrl/);
});

test("guardian: approve/reject/expire call the right contract functions", async () => {
  const mock = makeMockSource();
  const server = createGuardianServer({ source: mock.source, consentGatewayAddress: GATEWAY });
  const client = await connect(server);

  await call(client, "approve_request", { requestId: "1" });
  await call(client, "reject_request", { requestId: "2" });
  await call(client, "expire_request", { requestId: "3" });

  assert.deepEqual(
    mock.writeCalls.map((c) => c.functionName),
    ["approve", "reject", "expire"],
  );
  assert.equal(mock.writeCalls[2].args[0], 3n);
});

test("guardian: pending_requests lists only pending requests", async () => {
  const mock = makeMockSource({ statusByRequest: new Map([[1n, 2n], [2n, 3n]]) });
  const server = createGuardianServer({ source: mock.source, consentGatewayAddress: GATEWAY, registryAddress: REGISTRY });
  const client = await connect(server);

  const { text, isError } = await call(client, "pending_requests", {});
  assert.equal(isError, false);
  const parsed = JSON.parse(text);
  assert.equal(parsed.count, 1);
  assert.equal(parsed.requests[0].requestId, "1");
  assert.equal(parsed.requests[0].status, "Pending");
  assert.equal(parsed.requests[0].guardian, GUARDIAN);
  assert.equal(parsed.requests[0].amount, "1000000000000000000");
});

test("agent: request_log records every request, newest first", async () => {
  const mock = makeMockSource({ autoApproved: true });
  const server = createAgentServer({ source: mock.source, consentGatewayAddress: GATEWAY });
  const client = await connect(server);

  await call(client, "request_action", { target: TARGET, amount: "1000000000000000000", actionType: "PAYMENT" });
  await call(client, "check_status", { requestId: "1" });

  const { text, isError } = await call(client, "request_log", {});
  assert.equal(isError, false);
  const entries = JSON.parse(text);
  assert.ok(Array.isArray(entries));
  assert.ok(entries.length >= 2, "request_action and check_status should be logged");

  const action = entries.find((e: { tool: string }) => e.tool === "request_action");
  assert.ok(action, "request_action should be logged");
  assert.equal(action.ok, true);
  assert.equal(action.args.amount, "1000000000000000000");
  assert.equal(typeof action.durationMs, "number");
  assert.ok(action.durationMs >= 0);
  assert.equal(typeof action.ts, "number");

  const status = entries.find((e: { tool: string }) => e.tool === "check_status");
  assert.ok(status, "check_status should be logged");
  assert.match(status.resultText, /Approved/);
});

test("agent: request_log records failures with ok=false and the error", async () => {
  const mock = makeMockSource();
  const server = createAgentServer({ source: mock.source, consentGatewayAddress: GATEWAY }); // no registry
  const client = await connect(server);

  const failed = await call(client, "get_policy", {});
  assert.equal(failed.isError, true);

  const { text } = await call(client, "request_log", {});
  const entries = JSON.parse(text);
  const policy = entries.find((e: { tool: string }) => e.tool === "get_policy");
  assert.ok(policy, "get_policy should be logged");
  assert.equal(policy.ok, false);
  assert.match(policy.error, /registry/i);
});

test("guardian: request_log records every decision", async () => {
  const mock = makeMockSource();
  const server = createGuardianServer({ source: mock.source, consentGatewayAddress: GATEWAY });
  const client = await connect(server);

  await call(client, "approve_request", { requestId: "1" });
  await call(client, "reject_request", { requestId: "2" });

  const { text } = await call(client, "request_log", {});
  const entries = JSON.parse(text);
  const tools = entries.map((e: { tool: string }) => e.tool);
  assert.ok(tools.includes("approve_request"));
  assert.ok(tools.includes("reject_request"));
  const approve = entries.find((e: { tool: string }) => e.tool === "approve_request");
  assert.equal(approve.args.requestId, "1");
});

test("live logging notifications stream every request to the client", async () => {
  const mock = makeMockSource({ autoApproved: true });
  const server = createAgentServer({ source: mock.source, consentGatewayAddress: GATEWAY });
  const client = await connect(server);

  const notifications: Array<{ level?: string; logger?: string; data?: { tool?: string; ok?: boolean } }> = [];
  client.setNotificationHandler(LoggingMessageNotificationSchema, (notification) => {
    const params = notification.params as { level: string; logger: string; data: { tool?: string; ok?: boolean } };
    notifications.push(params);
  });

  await call(client, "request_action", { target: TARGET, amount: "1000000000000000000", actionType: "PAYMENT" });

  assert.ok(notifications.length >= 1, "at least one logging notification should arrive");
  const last = notifications[notifications.length - 1];
  assert.equal(last.logger, "xbot02");
  assert.equal(last.level, "info");
  assert.equal(last.data?.tool, "request_action");
  assert.equal(last.data?.ok, true);
});

test("live logging notifications report errors as level=error", async () => {
  const mock = makeMockSource();
  const server = createAgentServer({ source: mock.source, consentGatewayAddress: GATEWAY }); // no registry
  const client = await connect(server);

  const notifications: Array<{ level?: string; logger?: string; data?: { tool?: string; ok?: boolean; error?: string } }> = [];
  client.setNotificationHandler(LoggingMessageNotificationSchema, (notification) => {
    const params = notification.params as { level: string; logger: string; data: { tool?: string; ok?: boolean; error?: string } };
    notifications.push(params);
  });

  await call(client, "get_policy", {});

  assert.ok(notifications.length >= 1);
  const last = notifications[notifications.length - 1];
  assert.equal(last.level, "error");
  assert.equal(last.data?.tool, "get_policy");
  assert.equal(last.data?.ok, false);
  assert.match(last.data?.error ?? "", /registry/i);
});
