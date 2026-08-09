// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import { test } from "node:test";
import assert from "node:assert";
import type { Address, PublicClient } from "viem";
import { SponsorPolicy } from "./policy.js";
import { dispatch, RpcError } from "./paymaster.js";

const GATEWAY = "0x1111111111111111111111111111111111111111" as Address;
const AGENT = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address;
const TARGET = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Address;
const SPONSOR = "0x0000000000000000000000000000000000000001" as `0x${string}`;
const ZERO_TX = "0x02f872010c84000000008400000000008252089400000000000000000000000000000000000000008080c001a0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as `0x${string}`;

function makeClient(approvedRequests: bigint[]): PublicClient {
  const approved = new Set(approvedRequests.map((r) => r.toString()));
  return {
    readContract: async ({ args }: any) => {
      const requestId = args?.[0];
      return approved.has(requestId.toString());
    },
  } as unknown as PublicClient;
}

function makePolicy(approvedRequests: bigint[]): SponsorPolicy {
  const policy = new SponsorPolicy({
    client: makeClient(approvedRequests),
    consentGatewayAddress: GATEWAY,
  });
  policy.registerRequest({ requestId: 0n, agent: AGENT, target: TARGET, amount: 1000n });
  return policy;
}

test("pm_isSponsorable: true when on-chain isApproved", async () => {
  const policy = makePolicy([0n]);
  const result = await dispatch(
    { jsonrpc: "2.0", id: 1, method: "pm_isSponsorable", params: [{ to: TARGET, from: AGENT, value: "0x3e8", data: "0x", gas: "0x5208" }] },
    { policy, sponsorPrivateKey: SPONSOR },
  );
  assert.deepEqual(result, { Sponsorable: true, SponsorPolicy: "cosign-consent-gateway" });
});

test("pm_isSponsorable: false when on-chain isApproved is false", async () => {
  const policy = makePolicy([]);
  const result = await dispatch(
    { jsonrpc: "2.0", id: 1, method: "pm_isSponsorable", params: [{ to: TARGET, from: AGENT, value: "0x3e8", data: "0x", gas: "0x5208" }] },
    { policy, sponsorPrivateKey: SPONSOR },
  );
  assert.deepEqual(result, { Sponsorable: false, SponsorPolicy: "cosign-consent-gateway" });
});

test("pm_isSponsorable: false when no matching registered request", async () => {
  const policy = new SponsorPolicy({ client: makeClient([0n]), consentGatewayAddress: GATEWAY });
  const result = await dispatch(
    { jsonrpc: "2.0", id: 1, method: "pm_isSponsorable", params: [{ to: TARGET, from: AGENT, value: "0x3e8", data: "0x", gas: "0x5208" }] },
    { policy, sponsorPrivateKey: SPONSOR },
  );
  assert.deepEqual(result, { Sponsorable: false, SponsorPolicy: "cosign-consent-gateway" });
});

test("pm_isSponsorable: value amount must match registered amount", async () => {
  const policy = makePolicy([0n]);
  const result = await dispatch(
    { jsonrpc: "2.0", id: 1, method: "pm_isSponsorable", params: [{ to: TARGET, from: AGENT, value: "0x7d0", data: "0x", gas: "0x5208" }] },
    { policy, sponsorPrivateKey: SPONSOR },
  );
  assert.deepEqual(result, { Sponsorable: false, SponsorPolicy: "cosign-consent-gateway" });
});

test("pm_isSponsorable: missing required field -> invalid params", async () => {
  const policy = makePolicy([0n]);
  await assert.rejects(
    dispatch(
      { jsonrpc: "2.0", id: 1, method: "pm_isSponsorable", params: [{ to: TARGET, from: AGENT }] },
      { policy, sponsorPrivateKey: SPONSOR },
    ),
    (err: unknown) => err instanceof RpcError && err.code === -32602,
  );
});

test("unknown method -> method not found", async () => {
  const policy = makePolicy([0n]);
  await assert.rejects(
    dispatch({ jsonrpc: "2.0", id: 1, method: "eth_chainId" }, { policy, sponsorPrivateKey: SPONSOR }),
    (err: unknown) => err instanceof RpcError && err.code === -32601,
  );
});
