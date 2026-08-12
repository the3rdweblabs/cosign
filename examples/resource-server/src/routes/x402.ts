// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import type { IncomingMessage, ServerResponse } from "node:http";
import { formatUnits, type Address } from "viem";
import {
  buildPaymentRequirements,
  encodePaymentRequirements,
  x402Version,
  type PaymentRequired,
  type PaymentRequirements,
  type ResourceInfo,
} from "@xbot02/core";

export { nativeAsset, x402Version, x402Scheme, type ResourceInfo, type PaymentRequired } from "@xbot02/core";

/** One accepted payment option in the 402 - core's `PaymentRequirements`. */
export type PaymentOption = PaymentRequirements;

/** x402 v2 `/verify` response shape (see x402-specification-v2.md §5.4). */
interface VerificationResponse {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
}

/** x402 v2 `/settle` response shape (see x402-specification-v2.md §5.3). */
interface SettlementReceipt {
  success: boolean;
  errorReason?: string;
  payer?: string;
  transaction?: string;
  network?: string;
  amount?: string;
  extensions?: { blockNumber?: string | number | bigint };
}

export interface X402RouteConfig {
  facilitatorUrl: string;
  payTo: Address;
  priceWei: string;
  resourcePath: string;
  /** CAIP-2 network advertised in the 402; defaults to the active BOT network. */
  network?: string;
  /**
   * Whether serving this endpoint requires the client to obtain on-chain
   * consent (the Cosign circuit breaker) before paying. Advertised in the
   * payment requirement's `extra` so the agent can decide autonomously:
   * `false` -> the client just pays (pure x402), `true` -> it must get
   * a ConsentGateway approval first.
   */
  requireConsent: boolean;
  /** Metadata describing the resource the payment buys access to. `url` is taken from `resourcePath`. */
  resource: Omit<ResourceInfo, "url">;
  /**
   * Builds the HTTP 200 body once the facilitator confirms settlement. May be
   * async so an endpoint can fetch live data (e.g. on-chain stats) at serve
   * time rather than serving a static/mocked body.
   */
  success: (receipt: { txHash?: string; blockNumber?: string | number | null }) =>
    Record<string, unknown> | Promise<Record<string, unknown>>;
}

/**
 * Generic x402-flavoured route for a paid endpoint on the resource server.
 *
 *   1. First request (no `PAYMENT-SIGNATURE` header) -> HTTP 402 with a
 *      base64-encoded `PAYMENT-REQUIRED` header advertising the exact payment
 *      option: scheme "exact", network eip155:968 (BOT Chain testnet) or
 *      eip155:677 (mainnet), a price in wei of native BOT/tBOT, and the
 *      recipient address. The `extra` object tells the client whether it must
 *      obtain on-chain consent before paying.
 *   2. The client signs a native transfer of exactly that amount to `payTo`
 *      and retries with a base64 `PAYMENT-SIGNATURE` header:
 *        { "payment": { "rawTx": "0x..." } }
 *   3. We hand { paymentRequirements, paymentPayload } to the facilitator's
 *      /verify and /settle endpoints. Content is only served once the
 *      facilitator confirms settlement (returned tx hash + block number).
 *
 * The facilitator stays a separate process: this server only talks to it over
 * HTTP, keeping the "agent hits a real 402, pays, gets served" demo honest.
 */
export function createX402Route(config: X402RouteConfig) {
  // Advertise the price in wei (the atomic unit the agent signs), but build
  // through core's `buildPaymentRequirements` so the PaymentRequired object,
  // its reserved `extra` keys, and the base64 `payment-required` header all
  // come from the SDK - no hand-rolled x402 plumbing in this example.
  const paymentRequired = buildPaymentRequirements(
    {
      facilitatorUrl: config.facilitatorUrl,
      payTo: config.payTo,
      price: formatUnits(BigInt(config.priceWei), 18),
      network: config.network,
      maxTimeoutSeconds: 600,
      resource: config.resource,
      extra: { requireConsent: config.requireConsent },
    },
    config.resourcePath,
  );

  const paymentRequirements = paymentRequired.accepts[0];

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const signature = req.headers["payment-signature"];

    if (!signature || typeof signature !== "string") {
      writePaymentRequired(res, paymentRequired);
      return;
    }

    let signatureJson: Record<string, unknown>;
    try {
      signatureJson = JSON.parse(base64Decode(signature)) as Record<string, unknown>;
    } catch {
      writeJson(res, 400, { error: "Invalid PAYMENT-SIGNATURE header (expected base64 JSON)" });
      return;
    }

    const rawTx = (signatureJson.payment as { rawTx?: unknown } | undefined)?.rawTx ?? signatureJson.rawTx;
    if (typeof rawTx !== "string") {
      writeJson(res, 400, { error: "Payment signature is missing payment.rawTx" });
      return;
    }

    // The facilitator may charge a surcharge; the client signs a second
    // transfer (feeRawTx) covering it. Pass it through - the facilitator is
    // the authority on fee amount/recipient.
    const feeRawTx = (signatureJson.payment as { feeRawTx?: unknown } | undefined)?.feeRawTx;

    const paymentPayload = {
      x402Version: x402Version,
      accepted: paymentRequirements,
      payload: typeof feeRawTx === "string" ? { rawTx, feeRawTx } : { rawTx },
    };
    const requestBody = { x402Version: x402Version, paymentRequirements, paymentPayload };

    const verified = await callFacilitator<VerificationResponse>(config.facilitatorUrl, "/verify", requestBody);
    if (verified instanceof Error) {
      writeJson(res, 502, { error: `Facilitator verify failed: ${verified.message}` });
      return;
    }
    if (!verified.isValid) {
      res.writeHead(402, {
        "content-type": "application/json",
        "payment-required": encodePaymentRequirements(paymentRequired),
      });
      res.end(JSON.stringify({ error: verified.invalidReason ?? "Payment not accepted", paymentRequired }));
      return;
    }

    const settled = await callFacilitator<SettlementReceipt>(config.facilitatorUrl, "/settle", requestBody);
    if (settled instanceof Error) {
      writeJson(res, 502, { error: `Facilitator settle failed: ${settled.message}` });
      return;
    }
    if (!settled.success) {
      writeJson(res, 502, { error: settled.errorReason ?? "Settlement failed" });
      return;
    }

    const paymentResponse = {
      x402Version: x402Version,
      resource: config.resourcePath,
      receipt: { txHash: settled.transaction, blockNumber: receiptBlockNumber(settled) },
    };

    res.writeHead(200, {
      "content-type": "application/json",
      "payment-response": base64Encode(paymentResponse),
    });
    res.end(JSON.stringify(await config.success({ txHash: settled.transaction, blockNumber: receiptBlockNumber(settled) })));
  };
}

/** The settle response carries the block number in `extensions`; normalize it to a string/number/null. */
function receiptBlockNumber(settled: SettlementReceipt): string | number | null {
  const bn = settled.extensions?.blockNumber;
  if (bn === undefined || bn === null) return null;
  return typeof bn === "bigint" ? bn.toString() : bn;
}

async function callFacilitator<T>(facilitatorUrl: string, path: string, body: unknown): Promise<T | Error> {
  try {
    const res = await fetch(`${facilitatorUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as {
      error?: string | { message?: string };
      isValid?: boolean;
      invalidReason?: string;
      success?: boolean;
      errorReason?: string;
    };
    if (!res.ok) {
      const message =
        (typeof data.error === "string" && data.error) ||
        (typeof data.error === "object" && data.error?.message) ||
        data.invalidReason ||
        data.errorReason ||
        `Facilitator ${path} returned HTTP ${res.status}`;
      return new Error(message);
    }
    return data as T;
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err));
  }
}

function writePaymentRequired(res: ServerResponse, paymentRequired: PaymentRequired): void {
  res.writeHead(402, {
    "content-type": "application/json",
    "payment-required": encodePaymentRequirements(paymentRequired),
  });
  res.end(JSON.stringify({ error: "Payment required", paymentRequired }));
}

function writeJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

function base64Encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function base64Decode(value: string): string {
  return Buffer.from(value, "base64").toString("utf8");
}
