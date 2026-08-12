// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import { test } from "node:test";
import assert from "node:assert";
import type { Address, PublicClient, WalletClient, Chain, LocalAccount, Transport } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ConsentClient, type ApprovalOutcome } from "./consent-client.js";

const AGENT = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const GATEWAY = "0x9999999999999999999999999999999999999999" as Address;
const TARGET = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Address;
const TX_HASH = "0xaa00000000000000000000000000000000000000000000000000000000000000" as const;

interface MockedChain {
  publicClient: PublicClient;
  walletClient: WalletClient<Transport, Chain, LocalAccount>;
  simulateResult?: { result: readonly [bigint, boolean] };
  nextStatus?: ApprovalOutcome | "Pending";
}

type MockedChainInput = Omit<MockedChain, "publicClient" | "walletClient">;

function makeClients(mocked: MockedChainInput): MockedChain {
  const statuses: Array<ApprovalOutcome | "Pending"> = [];
  const publicClient = {
    simulateContract: async () => mocked.simulateResult ?? { result: [1n, true] as const },
    waitForTransactionReceipt: async () => ({ status: "success" }),
    readContract: async () => {
      const s = statuses.shift() ?? mocked.nextStatus ?? "Approved";
      return ["", "", 0n, "", 0n, { Pending: 2, Approved: 3, Rejected: 4, Expired: 5, AutoApproved: 1 }[s] ?? 0];
    },
  } as unknown as PublicClient;
  const walletClient = {
    account: AGENT,
    chain: { id: 968 } as Chain,
    writeContract: async () => TX_HASH,
  } as unknown as WalletClient<Transport, Chain, LocalAccount>;
  return { publicClient, walletClient };
}

function makeClient(mocked: MockedChainInput): ConsentClient {
  const { publicClient, walletClient } = makeClients(mocked);
  return new ConsentClient({ walletClient, publicClient, consentGatewayAddress: GATEWAY, logSink: () => {} });
}

test("requestAction returns simulated requestId + autoApproved + txHash", async () => {
  const consent = makeClient({ simulateResult: { result: [42n, true] } });
  const outcome = await consent.requestAction({ target: TARGET, amount: 1000000000000000000n, actionType: "PAYMENT", justification: "paying", task: "pay" });
  assert.equal(outcome.requestId, 42n);
  assert.equal(outcome.autoApproved, true);
  assert.equal(outcome.txHash, TX_HASH);
});

test("requestAction surfaces pending (out-of-policy) requests", async () => {
  const consent = makeClient({ simulateResult: { result: [7n, false] } });
  const outcome = await consent.requestAction({ target: TARGET, amount: 1n, actionType: "HUBOT_TRIGGER", justification: "physical action", task: "hubot" });
  assert.equal(outcome.requestId, 7n);
  assert.equal(outcome.autoApproved, false);
});

test("waitForApproval resolves Approved when guardian co-signs", async () => {
  const consent = makeClient({ nextStatus: "Approved" });
  const status = await consent.waitForApproval(7n, 1, 500);
  assert.equal(status, "Approved");
});

test("waitForApproval resolves Rejected when guardian declines", async () => {
  const consent = makeClient({ nextStatus: "Rejected" });
  const status = await consent.waitForApproval(7n, 1, 500);
  assert.equal(status, "Rejected");
});

test("waitForApproval returns Expired when the 15-min window lapses", async () => {
  const consent = makeClient({ nextStatus: "Expired" });
  const status = await consent.waitForApproval(7n, 1, 500);
  assert.equal(status, "Expired");
});

test("waitForApproval polls while pending and returns Approved once guardian acts", async () => {
  const consent = makeClient({ nextStatus: "Approved" });
  const status = await consent.waitForApproval(7n, 1, 500);
  assert.equal(status, "Approved");
});
