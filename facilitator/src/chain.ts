// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import { createPublicClient, http, type Address } from "viem";
import { CONSENT_GATEWAY_ABI, botNetworkConfig, envFor } from "@xbot02/core";

export { CONSENT_GATEWAY_ABI };

export function createChainClient() {
  const { chain, rpcUrl } = botNetworkConfig();
  return createPublicClient({
    chain,
    transport: http(rpcUrl),
  });
}

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export function consentGatewayAddress(): Address {
  const network = botNetworkConfig().network;
  const value = envFor(process.env, "CONSENT_GATEWAY_ADDRESS", network);
  if (!value) {
    throw new Error(`Missing required env var: CONSENT_GATEWAY_ADDRESS_${network.toUpperCase()} (or CONSENT_GATEWAY_ADDRESS)`);
  }
  return value as Address;
}
