// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import { test } from "node:test";
import assert from "node:assert";
import type { Address, PublicClient } from "viem";
import { SponsorPolicy } from "./policy.js";

const GATEWAY = "0x1111111111111111111111111111111111111111" as Address;
const AGENT = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address;
const TARGET = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Address;

interface ActionRequestedLog {
  args: {
    requestId?: bigint;
    agent?: Address;
    target?: Address;
    amount?: bigint;
  };
}

/**
 * Mock client: no in-memory registerRequest seeding - the policy must resolve
 * the request from the on-chain ActionRequested logs, exactly as it does live.
 */
function makeClient(approvedIds: bigint[], logs: ActionRequestedLog[]): PublicClient {
  const approved = new Set(approvedIds.map((r) => r.toString()));
  return {
    getLogs: async () => logs,
    readContract: async ({ args }: { args: readonly unknown[] }) => approved.has((args[0] as bigint).toString()),
  } as unknown as PublicClient;
}

function makePolicy(client: PublicClient): SponsorPolicy {
  return new SponsorPolicy({ client, consentGatewayAddress: GATEWAY, fromBlock: 0n });
}

test("on-chain log fallback: matching request + approved -> sponsorable", async () => {
  const policy = makePolicy(
    makeClient([7n], [{ args: { requestId: 7n, agent: AGENT, target: TARGET, amount: 1_000n } }]),
  );
  const verdict = await policy.checkSponsorable({ to: TARGET, from: AGENT, value: "0x3e8" });
  assert.deepEqual(verdict, { Sponsorable: true, SponsorPolicy: "cosign-consent-gateway" });
});

test("on-chain log fallback: matching request but not approved -> not sponsorable", async () => {
  const policy = makePolicy(
    makeClient([], [{ args: { requestId: 7n, agent: AGENT, target: TARGET, amount: 1_000n } }]),
  );
  const verdict = await policy.checkSponsorable({ to: TARGET, from: AGENT, value: "0x3e8" });
  assert.equal(verdict.Sponsorable, false);
});

test("on-chain log fallback: no matching request -> not sponsorable", async () => {
  const policy = makePolicy(makeClient([7n], [{ args: { requestId: 7n, agent: AGENT, target: TARGET, amount: 999n } }]));
  const verdict = await policy.checkSponsorable({ to: TARGET, from: AGENT, value: "0x3e8" });
  assert.equal(verdict.Sponsorable, false);
});

test("on-chain log fallback: newest matching request wins", async () => {
  const policy = makePolicy(
    makeClient(
      [7n],
      [
        { args: { requestId: 5n, agent: AGENT, target: TARGET, amount: 1_000n } },
        { args: { requestId: 7n, agent: AGENT, target: TARGET, amount: 1_000n } },
      ],
    ),
  );
  const verdict = await policy.checkSponsorable({ to: TARGET, from: AGENT, value: "0x3e8" });
  assert.equal(verdict.Sponsorable, true);
});

test("on-chain log fallback: getLogs failure degrades to not sponsorable", async () => {
  const client = {
    getLogs: async () => {
      throw new Error("rpc down");
    },
    readContract: async () => false,
  } as unknown as PublicClient;
  const policy = makePolicy(client);
  const verdict = await policy.checkSponsorable({ to: TARGET, from: AGENT, value: "0x3e8" });
  assert.equal(verdict.Sponsorable, false);
});

test("in-memory registerRequest still takes precedence (existing fast path)", async () => {
  const policy = makePolicy(makeClient([9n], []));
  policy.registerRequest({ requestId: 9n, agent: AGENT, target: TARGET, amount: 1_000n });
  const verdict = await policy.checkSponsorable({ to: TARGET, from: AGENT, value: "0x3e8" });
  assert.equal(verdict.Sponsorable, true);
});
