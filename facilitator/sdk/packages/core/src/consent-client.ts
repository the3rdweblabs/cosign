// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import type { Account, Address, Chain, Hex, PublicClient, Transport, WalletClient } from "viem";
import { consentGatewayAbi, actionTypeHash } from "./abis.js";
import { requestStatus, type RequestStatus } from "./status.js";

export type ApprovalOutcome = "Approved" | "Rejected" | "Expired";

export interface ConsentRequest {
  target: Address;
  amount: bigint;
  actionType: string; // e.g. "PAYMENT" - hashed to bytes32 on-chain
  justification: string;
  task: string;
}

export interface RequestOutcome {
  requestId: bigint;
  autoApproved: boolean;
  txHash: Hex;
}

export interface ConsentClientOptions {
  walletClient: WalletClient<Transport, Chain, Account | undefined>;
  publicClient: PublicClient;
  consentGatewayAddress: Address;
  logSink?: (entry: ActivityEntry) => void;
}

export interface ActivityEntry {
  ts: string;
  requestId: string;
  agent: Address;
  target: Address;
  amount: string;
  actionType: string;
  justification: string;
  task: string;
  status: string;
  txHash?: string;
}

const defaultLogSink = (entry: ActivityEntry): void => {
  console.log(
    `[agent] requestId=${entry.requestId} status=${entry.status} action=${entry.actionType} amount=${entry.amount} target=${entry.target}\n` +
      `       justification: ${entry.justification}`,
  );
};

/**
 * The agent-facing consent layer. Calls ConsentGateway.requestAction() on
 * BOT Chain, then branches on the result:
 *
 *   autoApproved=true  -> in-policy, proceed immediately (status AutoApproved)
 *   autoApproved=false -> parked as Pending; the human guardian must call
 *                         approve() before the payment can happen. The caller
 *                         can poll `waitForApproval()` to learn when the
 *                         guardian decides (or the 15-min expiry kicks in).
 *
 * Every request is logged with its justification alongside the on-chain
 * request id, so a console activity feed can show why the agent acted.
 */
export class ConsentClient {
  private readonly walletClient: WalletClient<Transport, Chain, Account | undefined>;
  private readonly publicClient: PublicClient;
  private readonly consentGatewayAddress: Address;
  private readonly logSink: (entry: ActivityEntry) => void;

  constructor(options: ConsentClientOptions) {
    this.walletClient = options.walletClient;
    this.publicClient = options.publicClient;
    this.consentGatewayAddress = options.consentGatewayAddress;
    this.logSink = options.logSink ?? defaultLogSink;
  }

  /**
   * Calls requestAction(target, amount, actionTypeHash) as the agent EOA.
   * Uses simulateContract to read the (requestId, autoApproved) return values
   * before broadcasting, then returns them alongside the tx hash.
   */
  async requestAction(req: ConsentRequest): Promise<RequestOutcome> {
    const args = [req.target, req.amount, actionTypeHash(req.actionType)] as const;

    const { result } = await this.publicClient.simulateContract({
      address: this.consentGatewayAddress,
      abi: consentGatewayAbi,
      functionName: "requestAction",
      args,
      account: this.walletClient.account?.address,
    });
    const requestId = BigInt(result[0]);
    const autoApproved = Boolean(result[1]);

    const txHash = await this.walletClient.writeContract({
      chain: this.walletClient.chain,
      account: this.walletClient.account ?? null,
      address: this.consentGatewayAddress,
      abi: consentGatewayAbi,
      functionName: "requestAction",
      args,
    });
    await this.publicClient.waitForTransactionReceipt({ hash: txHash });

    this.logEntry(req, requestId, txHash, autoApproved ? "auto-approved" : "pending");
    return { requestId, autoApproved, txHash };
  }

  /**
   * Polls ConsentGateway for the guardian's decision on a pending request.
   * Resolves when the request becomes Approved (guardian said yes) or
   * Rejected/Expired (no). Times out as Expired after the 15-min window.
   */
  async waitForApproval(requestId: bigint, pollMs = 2000, timeoutMs = 16 * 60 * 1000): Promise<ApprovalOutcome> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const status = await this.getStatus(requestId);
      if (status === "Approved" || status === "AutoApproved") return "Approved";
      if (status === "Rejected") return "Rejected";
      if (status === "Expired") return "Expired";
      await sleep(pollMs);
    }
    return "Expired";
  }

  async getStatus(requestId: bigint): Promise<RequestStatus> {
    const request = await this.publicClient.readContract({
      address: this.consentGatewayAddress,
      abi: consentGatewayAbi,
      functionName: "getRequest",
      args: [requestId],
    });
    return requestStatus[request[5] as keyof typeof requestStatus];
  }

  private logEntry(req: ConsentRequest, requestId: bigint, txHash: Hex, status: string): void {
    this.logSink({
      ts: new Date().toISOString(),
      requestId: requestId.toString(),
      agent: this.walletClient.account?.address ?? "0x",
      target: req.target,
      amount: req.amount.toString(),
      actionType: req.actionType,
      justification: req.justification,
      task: req.task,
      status,
      txHash,
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
