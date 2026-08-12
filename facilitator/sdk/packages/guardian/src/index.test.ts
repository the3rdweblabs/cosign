// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import { test } from "node:test";
import assert from "node:assert";
import type { Address, PublicClient } from "viem";
import { approveRequest, expireRequest, fetchRequests, getAgentPolicy, getRequestStatus, registerAgent, rejectRequest, watchGateway } from "./index.js";

const GATEWAY = "0x1111111111111111111111111111111111111111" as Address;
const REGISTRY = "0x2222222222222222222222222222222222222222" as Address;
const AGENT = "0x3333333333333333333333333333333333333333" as Address;
const TARGET = "0x4444444444444444444444444444444444444444" as Address;
const GUARDIAN = "0x5555555555555555555555555555555555555555" as Address;

interface MockLog {
  args: { requestId?: bigint };
  blockNumber?: bigint;
  transactionHash?: string;
  logIndex?: number;
}

function makeMockClient() {
  const logs: MockLog[] = [];
  const statusByRequest = new Map<bigint, number>();
  const policyByAgent = new Map<Address, readonly [Address, bigint, bigint, bigint, bigint, boolean]>();
  const writeCalls: Array<{ functionName: string; args: readonly unknown[] }> = [];
  let latestBlock = 10n;

  const client = {
    getLogs: async ({ fromBlock, event }: { fromBlock?: bigint; event?: unknown }) =>
      logs.filter((log) => (log.blockNumber ?? 0n) >= (fromBlock ?? 0n)),
    getBlockNumber: async () => latestBlock,
    readContract: async ({ functionName, args }: { functionName: string; args: readonly unknown[] }) => {
      if (functionName === "getRequest") {
        const status = statusByRequest.get(args[0] as bigint) ?? 0;
        return [AGENT, TARGET, 1_000_000_000_000_000_000n, "0x0000000000000000000000000000000000000000000000000000000000000000", 0n, status];
      }
      if (functionName === "getPolicy") {
        return policyByAgent.get(args[0] as Address) ?? ["0x0000000000000000000000000000000000000000", 0n, 0n, 0n, 0n, false];
      }
      throw new Error(`unexpected readContract ${functionName}`);
    },
  };

  return {
    client: client as unknown as PublicClient,
    logs,
    statusByRequest,
    policyByAgent,
    writeCalls,
    setLatestBlock: (n: bigint) => {
      latestBlock = n;
    },
  };
}

function makeWallet(mock: ReturnType<typeof makeMockClient>) {
  return {
    account: { address: GUARDIAN },
    chain: { id: 968 },
    writeContract: async ({ functionName, args }: { functionName: string; args: readonly unknown[] }) => {
      mock.writeCalls.push({ functionName, args });
      return `0x${functionName}-hash`;
    },
  };
}

test("getRequestStatus maps the on-chain status number to a label", async () => {
  const mock = makeMockClient();
  mock.statusByRequest.set(7n, 3);
  const status = await getRequestStatus(mock.client, GATEWAY, 7n);
  assert.equal(status, "Approved");

  mock.statusByRequest.set(7n, 5);
  assert.equal(await getRequestStatus(mock.client, GATEWAY, 7n), "Expired");
});

test("fetchRequests backfills from ActionRequested logs and resolves guardians", async () => {
  const mock = makeMockClient();
  mock.logs.push({ args: { requestId: 1n } }, { args: { requestId: 2n } });
  mock.statusByRequest.set(1n, 2);
  mock.statusByRequest.set(2n, 1);
  mock.policyByAgent.set(AGENT, [GUARDIAN, 10n, 1n, 0n, 0n, true]);

  const records = await fetchRequests({ client: mock.client, gatewayAddress: GATEWAY, registryAddress: REGISTRY });

  assert.equal(records.length, 2);
  assert.equal(records[0].requestId, 1n);
  assert.equal(records[0].status, "Pending");
  assert.equal(records[0].guardian, GUARDIAN);
  assert.equal(records[1].status, "AutoApproved");
});

test("approve/reject/expire call writeContract with the right function", async () => {
  const mock = makeMockClient();
  const wallet = makeWallet(mock) as never;

  await approveRequest({ wallet, gatewayAddress: GATEWAY }, 3n);
  await rejectRequest({ wallet, gatewayAddress: GATEWAY }, 4n);
  await expireRequest({ wallet, gatewayAddress: GATEWAY }, 5n);

  assert.deepEqual(mock.writeCalls, [
    { functionName: "approve", args: [3n] },
    { functionName: "reject", args: [4n] },
    { functionName: "expire", args: [5n] },
  ]);
});

test("registerAgent writes to the registry with agent/cap/period", async () => {
  const mock = makeMockClient();
  const wallet = makeWallet(mock) as never;

  await registerAgent(
    { wallet, gatewayAddress: GATEWAY, registryAddress: REGISTRY },
    AGENT,
    2_000_000_000_000_000_000n,
    86_400n,
  );

  assert.deepEqual(mock.writeCalls, [
    { functionName: "registerAgent", args: [AGENT, 2_000_000_000_000_000_000n, 86_400n] },
  ]);
});

test("getAgentPolicy reads the registry policy for an agent", async () => {
  const mock = makeMockClient();
  mock.policyByAgent.set(AGENT, [GUARDIAN, 5n, 100n, 0n, 0n, true]);

  const policy = await getAgentPolicy(mock.client, REGISTRY, AGENT);

  assert.equal(policy.guardian, GUARDIAN);
  assert.equal(policy.spendCap, 5n);
  assert.equal(policy.periodSeconds, 100n);
  assert.equal(policy.active, true);
});

test("watchGateway backfills then re-emits on live status events", async () => {
  const mock = makeMockClient();
  mock.logs.push({ args: { requestId: 1n }, blockNumber: 5n, transactionHash: "0xaa", logIndex: 0 });
  mock.statusByRequest.set(1n, 2);
  mock.policyByAgent.set(AGENT, [GUARDIAN, 10n, 1n, 0n, 0n, true]);

  const seen: Array<{ requestId: bigint; status: string }> = [];
  const unwatch = await watchGateway({
    client: mock.client,
    gatewayAddress: GATEWAY,
    registryAddress: REGISTRY,
    pollMs: 1,
    onRequest: (record) => seen.push({ requestId: record.requestId, status: record.status }),
  });

  assert.equal(seen.length, 1, "backfilled request emitted");
  assert.equal(seen[0].status, "Pending");

  mock.statusByRequest.set(1n, 3);
  mock.logs.push({ args: { requestId: 1n }, blockNumber: 12n, transactionHash: "0xbb", logIndex: 0 });
  mock.setLatestBlock(12n);
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(seen.length, 2, "status update re-emitted");
  assert.equal(seen[1].status, "Approved");

  unwatch();
  mock.statusByRequest.set(1n, 4);
  mock.logs.push({ args: { requestId: 1n }, blockNumber: 13n, transactionHash: "0xcc", logIndex: 0 });
  mock.setLatestBlock(13n);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(seen.length, 2, "no events after teardown");
});
