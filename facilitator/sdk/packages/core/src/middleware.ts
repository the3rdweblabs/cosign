// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import { parseUnits, type Address } from "viem";
import { BOT_TESTNET_CAIP2, NATIVE_ASSET, X402_SCHEME, type PaymentDetails } from "./x402.js";

export interface PaymentMiddlewareOptions {
  /** Where the xBOT02 facilitator lives, "". */
  facilitatorUrl: string;
  /** Where the money goes - the paid API's own wallet. */
  payTo: Address;
  /** Price in BOT as a decimal string, e.g. "0.05". */
  price: string;
  /** CAIP-2 network id. Defaults to BOT Chain testnet. */
  network?: string;
  asset?: Address;
  maxTimeoutSeconds?: number;
}

export interface PaymentRequirements {
  x402Version: number;
  resource: string;
  accepted: PaymentDetails[];
}

/** Builds the x402 requirements object a 402 response must carry. */
export function buildPaymentRequirements(opts: PaymentMiddlewareOptions, resource: string): PaymentRequirements {
  return {
    x402Version: 2,
    resource,
    accepted: [
      {
        scheme: X402_SCHEME,
        network: opts.network ?? BOT_TESTNET_CAIP2,
        amount: parseUnits(opts.price, 18).toString(),
        asset: opts.asset ?? NATIVE_ASSET,
        payTo: opts.payTo,
        maxTimeoutSeconds: opts.maxTimeoutSeconds ?? 600,
      },
    ],
  };
}

/** Encodes requirements into the base64 format x402 clients expect in the `payment-required` header. */
export function encodePaymentRequirements(requirements: PaymentRequirements): string {
  const json = JSON.stringify(requirements);
  const buffer = (globalThis as Record<string, unknown>)["Buffer"] as
    | { from(data: string, encoding: string): { toString(encoding: string): string } }
    | undefined;
  return buffer ? buffer.from(json, "utf8").toString("base64") : btoa(json);
}

export interface HttpLikeResponse {
  writeHead(statusCode: number, headers?: Record<string, string | number | string[]>): unknown;
  end(chunk?: unknown): unknown;
}

export interface HttpLikeRequest {
  url?: string;
}

/**
 * Drop-in middleware for a paid resource server (Express-compatible signature,
 * works with any (req, res) pair). Replies 402 with the x402 `payment-required`
 * header for every request to a protected route. The actual verify/settle work
 * happens at the facilitator, so the API builder never touches BOT Chain.
 */
export function paymentMiddleware(opts: PaymentMiddlewareOptions) {
  return (req: HttpLikeRequest, res: HttpLikeResponse): boolean => {
    const resource = req.url?.split("?")[0] ?? "/";
    const requirements = buildPaymentRequirements(opts, resource);
    res.writeHead(402, {
      "content-type": "application/json",
      "payment-required": encodePaymentRequirements(requirements),
    });
    res.end(JSON.stringify({ error: "Payment required", payment: requirements }));
    return true;
  };
}
