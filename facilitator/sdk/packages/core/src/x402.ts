// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import type { Address, Hex } from "viem";

/** Zero address = the native gas token (BOT / tBOT). */
export const nativeAsset = "0x0000000000000000000000000000000000000000" as const;

/** CAIP-2 network id for BOT Chain testnet. */
export const botTestnetCaip2 = "eip155:968" as const;

/** CAIP-2 network id for BOT Chain mainnet. */
export const botMainnetCaip2 = "eip155:677" as const;

/** The x402 payment scheme the facilitator settles. */
export const x402Scheme = "exact" as const;

/** The x402 protocol version this stack speaks (v2, per the vendored spec). */
export const x402Version = 2 as const;

/** v2 error codes defined by the x402 spec (section 9). */
export const x402Error = {
  INSUFFICIENT_FUNDS: "insufficient_funds",
  INVALID_X402_VERSION: "invalid_x402_version",
  INVALID_PAYMENT_REQUIREMENTS: "invalid_payment_requirements",
  INVALID_PAYLOAD: "invalid_payload",
  INVALID_SCHEME: "invalid_scheme",
  INVALID_NETWORK: "invalid_network",
  INVALID_TRANSACTION_STATE: "invalid_transaction_state",
  UNEXPECTED_VERIFY_ERROR: "unexpected_verify_error",
  UNEXPECTED_SETTLE_ERROR: "unexpected_settle_error",
} as const;

export type X402ErrorCode = (typeof x402Error)[keyof typeof x402Error];

/**
 * v2 `PaymentRequirements` object. One entry in a `PaymentRequired.accepts[]`
 * array, and the `accepted` field of a `PaymentPayload`.
 *
 * Reserved `extra` protocol keys: `assetTransferMethod` and `paymentFlow`
 * (see the vendored spec section 6.1). For BOT Chain `exact`:
 * `assetTransferMethod: "native"`, `paymentFlow: "authorization"`.
 */
export interface PaymentRequirements {
  scheme: string;
  network: string; // CAIP-2, e.g. "eip155:968"
  amount: string; // atomic units (wei) as a decimal string
  asset: string; // zero address = native gas token
  payTo: string;
  /** REQUIRED in v2 - maximum time allowed for payment completion (seconds). */
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

/** Back-compat alias for code written against the v1 name. */
export type PaymentDetails = PaymentRequirements;

/** v2 `ResourceInfo` object describing the protected resource. */
export interface ResourceInfo {
  url: string;
  description?: string;
  mimeType?: string;
  serviceName?: string;
  tags?: string[];
  iconUrl?: string;
}

/** v2 `PaymentRequired` object (the 402 / PAYMENT-REQUIRED payload). */
export interface PaymentRequired {
  x402Version: number;
  error?: string;
  resource: ResourceInfo;
  accepts: PaymentRequirements[];
  extensions?: Record<string, unknown>;
}

/** BOT Chain exact-scheme payload: signed native transfers. */
export interface BotChainPayload {
  rawTx: Hex;
  feeRawTx?: Hex;
}

/** v2 `PaymentPayload` object (the PAYMENT-SIGNATURE payload). */
export interface PaymentPayload {
  x402Version: number;
  resource?: ResourceInfo;
  accepted: PaymentRequirements;
  payload: BotChainPayload;
  extensions?: Record<string, unknown>;
}

/**
 * Facilitator /verify + /settle request. `paymentRequirements` is the v2 name;
 * `paymentDetails` is a back-compat alias for v1 clients.
 */
export interface VerifyRequest {
  x402Version?: number;
  paymentRequirements?: PaymentRequirements;
  paymentDetails?: PaymentRequirements;
  paymentPayload: PaymentPayload;
}

export interface VerificationResult {
  verified: boolean;
  message?: string;
  /** v2 error code (see x402Error) when the verification fails. */
  code?: X402ErrorCode;
  txHash?: Hex;
  from?: Address;
}

export interface SettlementResult {
  settled: boolean;
  message?: string;
  /** v2 error code (see x402Error) when settlement fails. */
  code?: X402ErrorCode;
  txHash?: Hex;
  blockNumber?: bigint;
}

/** v2 `/verify` response. */
export interface VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  payer?: Address;
  extra?: Record<string, unknown>;
}

/** v2 `/settle` response (`transaction` is "" on failure). */
export interface SettleResponse {
  success: boolean;
  errorReason?: string;
  payer?: Address;
  transaction: string;
  network: string;
  amount?: string;
  extensions?: Record<string, unknown>;
}

export interface SupportedKind {
  x402Version: number;
  scheme: string;
  network: string;
  extra?: Record<string, unknown>;
}

/** v2 `GET /supported` response. */
export interface SupportedResponse {
  kinds: SupportedKind[];
  extensions: string[];
  signers: Record<string, string[]>;
}
