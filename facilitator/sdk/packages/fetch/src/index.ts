// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import { parseTransaction, type Address, type Chain, type Hex, type LocalAccount } from "viem";
import {
  nativeAsset,
  x402Scheme,
  x402Version,
  botNetworkConfig,
  computeFeeAmount,
  type FeeSchedule,
  type PaymentDetails,
  type PaymentRequirements,
} from "@xbot02/core";

export interface WithBOT02Options {
  /** The agent's signing key (viem LocalAccount). */
  account: LocalAccount;
  /** The chain to sign against (botChainTestnet / botChainMainnet). */
  chain: Chain;
  /** Where the xBOT02 facilitator lives. */
  facilitatorUrl: string;
  /** CAIP-2 network id. Defaults to the active BOT network (BOT_NETWORK). */
  network?: string;
  /** Supplies the gas price for the self-pay fallback path. */
  getGasPrice?: () => Promise<bigint> | bigint;
  /** Override the underlying fetch (defaults to globalThis.fetch). */
  baseFetch?: typeof fetch;
}

export interface X402PaymentSignature {
  payment: { rawTx: Hex; feeRawTx?: Hex };
}

/**
 * Wraps any fetch-compatible function (Node undici, browser, whatever) with
 * automatic x402 handling:
 *
 *   1. First request goes out untouched.
 *   2. If the resource server answers 402 with a `payment-required` header,
 *      we pick the matching payment option, fetch the facilitator's fee
 *      schedule (GET /v1/fee), sign a native tBOT transfer for the price -
 *      and, if the facilitator charges a fee, a second transfer for it -
 *      (zero gas price first - the BOT Chain paymaster path), and submit them
 *      to the facilitator's /verify + /settle.
 *   3. If the zero-gas route is refused (e.g. bundler not ready / policy
 *      rejection / fee), we re-sign with a normal gas price and settle self-pay.
 *   4. We retry the original request with the `payment-signature` header the
 *      resource server expects, and return that final response.
 *
 * The agent never sees a 402 - it just gets served.
 */
export function withBOT02(options: WithBOT02Options): typeof fetch {
  const baseFetch = options.baseFetch ?? globalThis.fetch.bind(globalThis);
  const network = options.network ?? botNetworkConfig().caip2;
  const facilitator = options.facilitatorUrl.replace(/\/+$/, "");

  let feePromise: Promise<FeeSchedule> | undefined;
  const getFee = () => {
    if (!feePromise) feePromise = fetchFeeSchedule(facilitator, baseFetch);
    return feePromise;
  };

  return async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const first = await baseFetch(input, init);
    if (first.status !== 402) return first;

    const requirementHeader = first.headers.get("payment-required");
    if (!requirementHeader) {
      return first;
    }
    first.body?.cancel();

    const accepted = parsePaymentRequirements(requirementHeader);
    const option = pickAccepted(accepted, network);
    if (!option) {
      throw new Error(`xBOT02: no acceptable payment option for network ${network} (scheme ${x402Scheme}, native asset)`);
    }

    const fee = await getFee();
    const feeActive = fee.bps > 0 && fee.receiver !== null;

    let signed = await signPayment(options, option, 0n, feeActive ? fee : undefined);
    let verify = await callFacilitator(facilitator, "/verify", option, signed);

    if (verify?.isValid === true) {
      const settle = await callFacilitator(facilitator, "/settle", option, signed);
      if (settle?.success !== true) {
        signed = await signPayment(options, option, await gasPrice(options), feeActive ? fee : undefined);
        await settleBoth(facilitator, option, signed);
      }
    } else {
      signed = await signPayment(options, option, await gasPrice(options), feeActive ? fee : undefined);
      await settleBoth(facilitator, option, signed);
    }

    const headers = new Headers(init?.headers);
    headers.set("payment-signature", encodePaymentSignature({ payment: signed }));
    return baseFetch(input, { ...init, headers });
  };
}

interface SignedPayment {
  rawTx: Hex;
  feeRawTx?: Hex;
}

/** x402 v2 facilitator response shapes (see x402-specification-v2.md §5.3/§5.4). */
interface FacilitatorResponse {
  isValid?: boolean;
  invalidReason?: string;
  payer?: string;
  success?: boolean;
  errorReason?: string;
  transaction?: string;
  network?: string;
}

async function settleBoth(facilitatorUrl: string, option: PaymentDetails, signed: SignedPayment): Promise<void> {
  const verify = await callFacilitator(facilitatorUrl, "/verify", option, signed);
  if (verify?.isValid !== true) {
    throw new Error(`xBOT02: payment not verified by facilitator: ${verify?.invalidReason ?? "unknown reason"}`);
  }
  const settle = await callFacilitator(facilitatorUrl, "/settle", option, signed);
  if (settle?.success !== true) {
    throw new Error(`xBOT02: payment not settled by facilitator: ${settle?.errorReason ?? "unknown reason"}`);
  }
}

function gasPrice(options: WithBOT02Options): Promise<bigint> {
  return Promise.resolve(options.getGasPrice ? options.getGasPrice() : 1_000_000_000n);
}

async function signPayment(
  options: WithBOT02Options,
  option: PaymentDetails,
  gasPrice: bigint,
  fee?: FeeSchedule,
): Promise<SignedPayment> {
  const rawTx = await options.account.signTransaction({
    chain: options.chain,
    to: option.payTo as Address,
    value: BigInt(option.amount),
    gasPrice,
    type: "legacy",
  });
  if (!fee || fee.bps <= 0 || !fee.receiver) {
    return { rawTx };
  }

  const mainNonce = parseTransactionNonce(rawTx);
  const feeRawTx = await options.account.signTransaction({
    chain: options.chain,
    to: fee.receiver as Address,
    value: computeFeeAmount(fee.bps, BigInt(option.amount)),
    gasPrice,
    nonce: mainNonce + 1,
    type: "legacy",
  });
  return { rawTx, feeRawTx };
}

async function callFacilitator(
  facilitatorUrl: string,
  path: string,
  paymentDetails: PaymentRequirements,
  signed: SignedPayment,
): Promise<FacilitatorResponse | undefined> {
  const res = await fetch(`${facilitatorUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      x402Version: x402Version,
      paymentRequirements: paymentDetails,
      paymentPayload: {
        x402Version: x402Version,
        accepted: paymentDetails,
        payload: signed.feeRawTx ? { rawTx: signed.rawTx, feeRawTx: signed.feeRawTx } : { rawTx: signed.rawTx },
      },
    }),
  });
  if (!res.ok) return undefined;
  return (await res.json()) as FacilitatorResponse;
}

async function fetchFeeSchedule(facilitatorUrl: string, baseFetch: typeof fetch): Promise<FeeSchedule> {
  try {
    const res = await baseFetch(`${facilitatorUrl}/v1/fee`);
    if (!res.ok) return { bps: 0, receiver: null, network: "", asset: nativeAsset };
    const json = (await res.json()) as { result?: FeeSchedule } | FeeSchedule;
    const schedule: FeeSchedule = "result" in json && json.result ? json.result : (json as FeeSchedule);
    return {
      bps: Number(schedule.bps ?? 0),
      receiver: schedule.receiver ?? null,
      network: schedule.network ?? "",
      asset: schedule.asset ?? nativeAsset,
    };
  } catch {
    return { bps: 0, receiver: null, network: "", asset: nativeAsset };
  }
}

function parseTransactionNonce(rawTx: Hex): number {
  try {
    const tx = parseTransaction(rawTx) as { nonce?: number | bigint };
    const nonce = tx.nonce ?? 0n;
    return typeof nonce === "bigint" ? Number(nonce) : nonce;
  } catch {
    return 0;
  }
}

function parsePaymentRequirements(header: string): PaymentDetails[] {
  try {
    const parsed = JSON.parse(decodeBase64(header)) as { accepts?: unknown; accepted?: unknown };
    const list = Array.isArray(parsed.accepts) ? parsed.accepts : parsed.accepted;
    return Array.isArray(list) ? (list as PaymentDetails[]) : [];
  } catch {
    return [];
  }
}

function pickAccepted(accepted: PaymentDetails[], network: string): PaymentDetails | undefined {
  return accepted.find(
    (a) =>
      a.scheme === x402Scheme &&
      a.network.toLowerCase() === network.toLowerCase() &&
      a.asset.toLowerCase() === nativeAsset,
  );
}

export function encodePaymentSignature(payload: X402PaymentSignature): string {
  const json = JSON.stringify(payload);
  return typeof Buffer !== "undefined" ? Buffer.from(json, "utf8").toString("base64") : btoa(json);
}

function decodeBase64(value: string): string {
  return typeof Buffer !== "undefined" ? Buffer.from(value, "base64").toString("utf8") : atob(value);
}
