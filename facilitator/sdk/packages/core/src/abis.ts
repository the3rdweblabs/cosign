// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import { keccak256, stringToHex, type Hex } from "viem";

/**
 * ConsentGateway ABI - the single source of truth for the on-chain circuit
 * breaker. Copied verbatim from the deployed contract (see contracts/src/).
 * Includes the `expire()` path so an overdue pending request can be marked
 * Expired on-chain.
 */
export const CONSENT_GATEWAY_ABI = [
  {
    type: "function",
    name: "requestAction",
    inputs: [
      { name: "target", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "actionType", type: "bytes32" },
    ],
    outputs: [
      { name: "requestId", type: "uint256" },
      { name: "autoApproved", type: "bool" },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "approve",
    inputs: [{ name: "requestId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "reject",
    inputs: [{ name: "requestId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "expire",
    inputs: [{ name: "requestId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "isApproved",
    inputs: [{ name: "requestId", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getRequest",
    inputs: [{ name: "requestId", type: "uint256" }],
    outputs: [
      { name: "agent", type: "address" },
      { name: "target", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "actionType", type: "bytes32" },
      { name: "requestedAt", type: "uint256" },
      { name: "status", type: "uint8" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "nextRequestId",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "ActionRequested",
    inputs: [
      { name: "requestId", type: "uint256", indexed: true },
      { name: "agent", type: "address", indexed: true },
      { name: "target", type: "address", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
      { name: "actionType", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ActionAutoApproved",
    inputs: [{ name: "requestId", type: "uint256", indexed: true }],
  },
  {
    type: "event",
    name: "ActionApproved",
    inputs: [
      { name: "requestId", type: "uint256", indexed: true },
      { name: "guardian", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "ActionRejected",
    inputs: [
      { name: "requestId", type: "uint256", indexed: true },
      { name: "guardian", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "ActionExpired",
    inputs: [{ name: "requestId", type: "uint256", indexed: true }],
  },
] as const;

/** AgentRegistry ABI - agent -> guardian mapping + rolling spend policy. */
export const AGENT_REGISTRY_ABI = [
  {
    type: "function",
    name: "getPolicy",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [
      { name: "guardian", type: "address" },
      { name: "spendCap", type: "uint256" },
      { name: "periodSeconds", type: "uint256" },
      { name: "spentInPeriod", type: "uint256" },
      { name: "periodStart", type: "uint256" },
      { name: "active", type: "bool" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "registerAgent",
    inputs: [
      { name: "agent", type: "address" },
      { name: "spendCap", type: "uint256" },
      { name: "periodSeconds", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "revokeAgent",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

/** The ActionRequested event object, used for log backfill in watchers. */
export const ACTION_REQUESTED_EVENT = CONSENT_GATEWAY_ABI.find(
  (item) => item.type === "event" && item.name === "ActionRequested",
)!;

/** Hashes a human-readable action label (e.g. "PAYMENT") to its on-chain bytes32 form. */
export function actionTypeHash(actionType: string): Hex {
  return keccak256(stringToHex(actionType, { size: 32 }));
}
