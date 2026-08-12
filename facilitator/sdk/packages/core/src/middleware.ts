// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import { parseUnits, type Address } from "viem";
import { botTestnetCaip2, nativeAsset, x402Scheme, x402Version, type PaymentRequired, type PaymentRequirements, type ResourceInfo } from "./x402.js";
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
  /** Optional ResourceInfo overrides (serviceName, description, mimeType, ...). */
  resource?: Partial<Omit<ResourceInfo, "url">>;
  /** Extra keys merged into the advertised payment option, e.g. `{ requireConsent: true }`. */
  extra?: Record<string, unknown>;
}

/**
 * Builds the v2 `PaymentRequired` object a 402 response must carry.
 * BOT Chain `exact` mechanism: native value transfer via the EOA paymaster /
 * self-pay, default `authorization` payment flow (verify -> resource ->
 * settle -> respond), advertised through the reserved `extra` keys.
 */
export function buildPaymentRequirements(opts: PaymentMiddlewareOptions, resourceUrl: string): PaymentRequired {
  return {
    x402Version: x402Version,
    error: "PAYMENT-SIGNATURE header is required",
    resource: {
      url: resourceUrl,
      ...opts.resource,
    },
    accepts: [
      {
        scheme: x402Scheme,
        network: opts.network ?? botTestnetCaip2,
        amount: parseUnits(opts.price, 18).toString(),
        asset: opts.asset ?? nativeAsset,
        payTo: opts.payTo,
        maxTimeoutSeconds: opts.maxTimeoutSeconds ?? 600,
        extra: {
          assetTransferMethod: "native",
          paymentFlow: "authorization",
          ...opts.extra,
        },
      } satisfies PaymentRequirements,
    ],
  };
}

/** Encodes the v2 PaymentRequired object into the base64 `payment-required` header format. */
export function encodePaymentRequirements(requirements: PaymentRequired): string {
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
