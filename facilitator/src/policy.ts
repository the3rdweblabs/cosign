// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import type { Address, PublicClient } from "viem";
import { actionRequestedEvent } from "@xbot02/core";
import { consentGatewayAbi } from "./chain.js";

export const SPONSOR_POLICY_NAME = "cosign-consent-gateway";

export interface SponsorableParams {
  to: string;
  from: string;
  value: string;
  data?: string;
  gas?: string;
}

export interface SponsorVerdict {
  Sponsorable: boolean;
  SponsorPolicy: string;
}

export interface RegisteredRequest {
  requestId: bigint;
  agent: Address;
  target: Address;
  amount: bigint;
}

export interface SponsorPolicyOptions {
  client: PublicClient;
  /** ConsentGateway address; undefined = consent layer not configured (see
   *  ROADMAP.md decision). When undefined the isApproved gate always passes. */
  consentGatewayAddress?: Address;
  policyName?: string;
  /** First block to scan for ActionRequested logs when resolving requests on-chain. */
  fromBlock?: bigint;
}

/**
 * Sponsor policy for the BOT Chain native EOA paymaster.
 *
 * A transaction is only sponsorable when the sending agent has an approved
 * consent request that matches (from == agent, to == target, value == amount).
 * "Approved" means `ConsentGateway.isApproved(requestId)` is true on-chain -
 * i.e. the action was auto-approved in-policy or co-signed by the human
 * guardian. Pending / rejected / expired requests are never sponsored.
 *
 * The request log is the paymaster's own state (no DB, per AGENTS.md).
 * The x402-adapter (or consent-client) calls `registerRequest()` whenever a
 * `requestAction()` result comes back, so the paymaster can map an incoming
 * sponsorship attempt back to a requestId and verify it on-chain.
 */
export class SponsorPolicy {
  private readonly client: PublicClient;
  private readonly consentGatewayAddress?: Address;
  private readonly fromBlock: bigint;
  readonly policyName: string;

  private readonly log: RegisteredRequest[] = [];

  constructor(options: SponsorPolicyOptions) {
    this.client = options.client;
    this.consentGatewayAddress = options.consentGatewayAddress;
    this.policyName = options.policyName ?? SPONSOR_POLICY_NAME;
    this.fromBlock = options.fromBlock ?? 0n;
  }

  registerRequest(request: RegisteredRequest): void {
    this.log.push(request);
  }

  async checkSponsorable(params: SponsorableParams): Promise<SponsorVerdict> {
    // Consent layer not configured: plain x402 facilitator, gate always passes.
    if (!this.consentGatewayAddress) {
      return { Sponsorable: true, SponsorPolicy: this.policyName };
    }

    const request =
      this.latestMatchingRequest(params) ??
      (await this.latestMatchingOnChainRequest(this.consentGatewayAddress, params));
    if (!request) {
      return { Sponsorable: false, SponsorPolicy: this.policyName };
    }

    const approved = await this.client.readContract({
      address: this.consentGatewayAddress,
      abi: consentGatewayAbi,
      functionName: "isApproved",
      args: [request.requestId],
    });

    return { Sponsorable: approved, SponsorPolicy: this.policyName };
  }

  private latestMatchingRequest(params: SponsorableParams): RegisteredRequest | undefined {
    const from = params.from.toLowerCase();
    const to = params.to.toLowerCase();
    const value = hexToBigInt(params.value);

    for (let i = this.log.length - 1; i >= 0; i--) {
      const request = this.log[i];
      if (
        request.agent.toLowerCase() === from &&
        request.target.toLowerCase() === to &&
        request.amount === value
      ) {
        return request;
      }
    }
    return undefined;
  }

  /**
   * Resolves the newest matching consent request straight off the ConsentGateway
   * `ActionRequested` logs, so the paymaster works fully live (no in-memory
   * seeding needed): the agent's on-chain requestAction() is picked up as-is.
   */
  private async latestMatchingOnChainRequest(
    gateway: Address,
    params: SponsorableParams,
  ): Promise<RegisteredRequest | undefined> {
    const from = params.from.toLowerCase();
    const to = params.to.toLowerCase();
    const value = hexToBigInt(params.value);

    let logs;
    try {
      logs = await this.client.getLogs({
        address: gateway,
        event: actionRequestedEvent,
        fromBlock: this.fromBlock,
        toBlock: "latest",
      });
    } catch {
      return undefined;
    }

    for (let i = logs.length - 1; i >= 0; i--) {
      const log = logs[i];
      const agent = log.args?.agent;
      const target = log.args?.target;
      const amount = log.args?.amount;
      const requestId = log.args?.requestId;
      if (
        typeof agent === "string" &&
        typeof target === "string" &&
        amount !== undefined &&
        requestId !== undefined &&
        agent.toLowerCase() === from &&
        target.toLowerCase() === to &&
        amount === value
      ) {
        return { requestId, agent, target, amount };
      }
    }
    return undefined;
  }
}

function hexToBigInt(hex: string): bigint {
  const normalized = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  return BigInt(`0x${normalized || "0"}`);
}
