// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import type { Address, Hex, PublicClient } from "viem";
import { actionRequestedEvent, agentRegistryAbi, consentGatewayAbi, requestStatus, type RequestStatus } from "@xbot02/core";

export interface ConsentRequestRecord {
  requestId: bigint;
  agent: Address;
  target: Address;
  amount: bigint;
  actionType: Hex;
  requestedAt: bigint;
  status: RequestStatus;
  guardian?: Address;
}

/**
 * Minimal signer surface the guardian SDK needs. Deliberately not viem's
 * `WalletClient` type so consumers (console, agent) can pass their own viem
 * instance even when it resolves to a different copy of the library.
 */
export interface GuardianWallet {
  chain?: unknown;
  account?: unknown;
  writeContract: (args: any) => Promise<Hex>;
}

export interface GuardianOptions {
  wallet: GuardianWallet;
  gatewayAddress: Address;
}

const GATEWAY_EVENTS = ["ActionRequested", "ActionAutoApproved", "ActionApproved", "ActionRejected", "ActionExpired"] as const;

/** Guardian signs an approval for a pending high-risk request. */
export async function approveRequest(options: GuardianOptions, requestId: bigint): Promise<Hex> {
  return write(options, "approve", requestId);
}

/** Guardian rejects a pending request. */
export async function rejectRequest(options: GuardianOptions, requestId: bigint): Promise<Hex> {
  return write(options, "reject", requestId);
}

/** Marks an overdue pending request Expired (permissionless on-chain). */
export async function expireRequest(options: GuardianOptions, requestId: bigint): Promise<Hex> {
  return write(options, "expire", requestId);
}

export interface RegisterAgentOptions extends GuardianOptions {
  /** AgentRegistry contract address (owns registerAgent / getPolicy). */
  registryAddress: Address;
}

/** Guardian registers an agent under their guardianship with a spend policy. */
export async function registerAgent(
  options: RegisterAgentOptions,
  agent: Address,
  spendCap: bigint,
  periodSeconds: bigint,
): Promise<Hex> {
  return options.wallet.writeContract({
    chain: options.wallet.chain,
    account: options.wallet.account ?? null,
    address: options.registryAddress,
    abi: agentRegistryAbi,
    functionName: "registerAgent",
    args: [agent, spendCap, periodSeconds],
  });
}

export interface AgentPolicy {
  guardian: Address;
  spendCap: bigint;
  periodSeconds: bigint;
  spentInPeriod: bigint;
  periodStart: bigint;
  active: boolean;
}

/** Reads an agent's current policy. Guardian is 0x0 when the agent is unregistered. */
export async function getAgentPolicy(client: PublicClient, registryAddress: Address, agent: Address): Promise<AgentPolicy> {
  const policy = await client.readContract({
    address: registryAddress,
    abi: agentRegistryAbi,
    functionName: "getPolicy",
    args: [agent],
  });
  return {
    guardian: policy[0] as Address,
    spendCap: policy[1] as bigint,
    periodSeconds: policy[2] as bigint,
    spentInPeriod: policy[3] as bigint,
    periodStart: policy[4] as bigint,
    active: policy[5] as boolean,
  };
}

async function write(options: GuardianOptions, functionName: "approve" | "reject" | "expire", requestId: bigint): Promise<Hex> {
  return options.wallet.writeContract({
    chain: options.wallet.chain,
    account: options.wallet.account ?? null,
    address: options.gatewayAddress,
    abi: consentGatewayAbi,
    functionName,
    args: [requestId],
  });
}

/** Reads a request's current on-chain status label. */
export async function getRequestStatus(client: PublicClient, gatewayAddress: Address, requestId: bigint): Promise<RequestStatus> {
  const request = await client.readContract({
    address: gatewayAddress,
    abi: consentGatewayAbi,
    functionName: "getRequest",
    args: [requestId],
  });
  return requestStatus[request[5] as keyof typeof requestStatus];
}

async function resolveRecord(
  client: PublicClient,
  gatewayAddress: Address,
  registryAddress: Address | undefined,
  requestId: bigint,
): Promise<ConsentRequestRecord | null> {
  try {
    const request = await client.readContract({
      address: gatewayAddress,
      abi: consentGatewayAbi,
      functionName: "getRequest",
      args: [requestId],
    });
    const [agent, target, amount, actionType, requestedAt, statusNum] = request;

    let guardian: Address | undefined;
    if (registryAddress) {
      try {
        const policy = await client.readContract({
          address: registryAddress,
          abi: agentRegistryAbi,
          functionName: "getPolicy",
          args: [agent],
        });
        guardian = policy[0] as Address;
      } catch {
        guardian = undefined;
      }
    }

    return {
      requestId,
      agent: agent as Address,
      target: target as Address,
      amount: amount as bigint,
      actionType: actionType as Hex,
      requestedAt: requestedAt as bigint,
      status: requestStatus[statusNum as keyof typeof requestStatus] ?? "None",
      guardian,
    };
  } catch {
    return null;
  }
}

export interface FetchRequestsOptions {
  client: PublicClient;
  gatewayAddress: Address;
  registryAddress?: Address;
  fromBlock?: bigint;
}

/** Backfills every known request from ActionRequested logs (most recent last). */
export async function fetchRequests(options: FetchRequestsOptions): Promise<ConsentRequestRecord[]> {
  const { client, gatewayAddress, registryAddress, fromBlock } = options;
  const logs = await client.getLogs({
    address: gatewayAddress,
    event: actionRequestedEvent,
    fromBlock: fromBlock ?? 0n,
    toBlock: "latest",
  });
  const records: ConsentRequestRecord[] = [];
  for (const log of logs) {
    const requestId = log.args?.requestId;
    if (requestId === undefined) continue;
    const record = await resolveRecord(client, gatewayAddress, registryAddress, requestId);
    if (record) records.push(record);
  }
  return records;
}

export interface WatchGatewayOptions {
  client: PublicClient;
  gatewayAddress: Address;
  registryAddress?: Address;
  fromBlock?: bigint;
  pollMs?: number;
  onRequest: (record: ConsentRequestRecord) => void;
  onError?: (err: Error) => void;
}

/**
 * Framework-agnostic live view of the consent gateway: backfills existing
 * requests, then subscribes to every ConsentGateway event and re-resolves the
 * affected request (so status transitions like Pending -> Approved -> Expired
 * flow through `onRequest`). Returns a function that tears the watcher down.
 */
export async function watchGateway(options: WatchGatewayOptions): Promise<() => void> {
  const { client, gatewayAddress, registryAddress, fromBlock, pollMs = 2000, onRequest, onError } = options;
  let disposed = false;

  const push = async (requestId: bigint): Promise<void> => {
    if (disposed) return;
    const record = await resolveRecord(client, gatewayAddress, registryAddress, requestId);
    if (record) onRequest(record);
  };

  const initial = await fetchRequests(options);
  if (disposed) return () => undefined;
  for (const record of initial) onRequest(record);

  const watch = (eventName: (typeof GATEWAY_EVENTS)[number]) =>
    client.watchContractEvent({
      address: gatewayAddress,
      abi: consentGatewayAbi,
      eventName,
      pollingInterval: pollMs,
      onLogs: (logs) =>
        logs.forEach((log) => {
          const requestId = log.args?.requestId;
          if (requestId !== undefined) {
            void push(requestId).catch((err) => onError?.(err instanceof Error ? err : new Error(String(err))));
          }
        }),
      onError: (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
    });

  const unwatches = GATEWAY_EVENTS.map(watch);

  return () => {
    disposed = true;
    unwatches.forEach((unwatch) => unwatch());
  };
}
