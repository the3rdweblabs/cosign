// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import { createPublicClient, http, type Address } from "viem";
import { consentGatewayAbi, botNetworkConfig, envFor } from "@xbot02/core";

export { consentGatewayAbi };

export function createChainClient() {
  const { chain, rpcUrl } = botNetworkConfig();
  return createPublicClient({
    chain,
    transport: http(rpcUrl, {
      // Bounded RPC calls. viem's defaults (10s timeout, 3 retries) let a single
      // flaky eth_call stall ~40s, so verify()'s two eth_call simulations could
      // hang ~75s and blow the client's payment timeout - the tx still settled
      // on-chain but the agent reported a false failure. Cap timeout + retries
      // so each call resolves within ~10s and verify/settle stay well under the
      // client's payment timeout.
      timeout: 5_000,
      retryCount: 1,
    }),
  });
}

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

/**
 * Consent gateway address for the active BOT network, or undefined when the
 * consent layer is NOT configured. Consent is optional (see ROADMAP.md):
 * without it the facilitator boots and runs as a plain x402 facilitator - the
 * sponsor policy simply passes its `isApproved` gate.
 */
export function consentGatewayAddress(): Address | undefined {
  const network = botNetworkConfig().network;
  const value = envFor(process.env, "CONSENT_GATEWAY_ADDRESS", network);
  if (!value) return undefined;
  return value as Address;
}
