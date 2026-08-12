// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import type { Address } from "viem";
import { createX402Route } from "./x402.js";

export {
  nativeAsset,
  x402Version,
  x402Scheme,
  type PaymentOption,
  type ResourceInfo,
  type PaymentRequired,
} from "./x402.js";

export interface HubotTaskConfig {
  facilitatorUrl: string;
  payTo: Address;
  priceWei: string;
  resourcePath: string;
  /** CAIP-2 network advertised in the 402; defaults to the active BOT network. */
  network?: string;
}

/**
 * The consent-gated "HuBot pickup task" paid API. Dispatching a physical robot
 * is a high-risk action, so this endpoint advertises `requireConsent: true` in
 * its payment requirement - the agent must obtain an on-chain ConsentGateway
 * approval (and a guardian sign-off when out of policy) before it can pay.
 */
export function createHubotTaskRoute(config: HubotTaskConfig) {
  return createX402Route({
    ...config,
    requireConsent: true,
    resource: {
      serviceName: "HuBot pickup task",
      description: "Dispatch a HuBot robot to pick up your package",
      mimeType: "application/json",
    },
    success: (receipt) => ({
      status: "confirmed",
      task: "HuBot pickup task confirmed",
      message: "Robot #HUB-07 has been dispatched. It will pick up your package and return a delivery receipt.",
      txHash: receipt.txHash,
      blockNumber: receipt.blockNumber ?? null,
    }),
  });
}
