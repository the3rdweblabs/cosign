// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import type { Address, Hex } from "viem";

/** Zero address = the native gas token (BOT / tBOT). */
export const NATIVE_ASSET = "0x0000000000000000000000000000000000000000" as const;

/** CAIP-2 network id for BOT Chain testnet. */
export const BOT_TESTNET_CAIP2 = "eip155:968" as const;

/** CAIP-2 network id for BOT Chain mainnet. */
export const BOT_MAINNET_CAIP2 = "eip155:677" as const;

/** The x402 payment scheme the facilitator settles. */
export const X402_SCHEME = "exact" as const;

export interface PaymentDetails {
  scheme: string;
  network: string; // CAIP-2, e.g. "eip155:968"
  amount: string; // atomic units (wei) as a decimal string
  asset: string; // zero address = native gas token
  payTo: string;
  maxTimeoutSeconds?: number;
}

export interface PaymentPayload {
  /** Serialized, signed native transfer. The agent pays its own gas. */
  rawTx: Hex;
  /**
   * Optional second serialized, signed native transfer covering the
   * facilitator's surcharge (see FeeSchedule). Absent when no fee applies.
   */
  feeRawTx?: Hex;
}

export interface VerifyRequest {
  paymentDetails: PaymentDetails;
  paymentPayload: PaymentPayload;
}

export interface VerificationResult {
  verified: boolean;
  message?: string;
  txHash?: Hex;
  from?: Address;
}

export interface SettlementResult {
  settled: boolean;
  message?: string;
  txHash?: Hex;
  blockNumber?: bigint;
}
