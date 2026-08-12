// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import type { Address } from "viem";
import { botNetworks, botNetworkFromEnv, envFor, type BotNetwork } from "@xbot02/core";

// Vite-env-specific config stays local; everything else now lives in
// @xbot02/core (single source of truth for chains, ABIs, status, formatting).
//
// Vite only exposes VITE_-prefixed vars to the browser, so the network
// selector is VITE_BOT_NETWORK and per-network vars are suffixed, e.g.
// VITE_BOT_RPC_URL_TESTNET / VITE_BOT_RPC_URL_MAINNET.
const viteEnv = import.meta.env as Record<string, unknown>;
const network: BotNetwork = botNetworkFromEnv({ ...viteEnv, BOT_NETWORK: viteEnv.VITE_BOT_NETWORK });
const net = botNetworks[network];

export const chainConfig = {
  network,
  rpcUrl: envFor(viteEnv, "VITE_BOT_RPC_URL", network) ?? net.rpcUrl,
  agentRegistryAddress: envFor(viteEnv, "VITE_AGENT_REGISTRY_ADDRESS", network) as Address | undefined,
  consentGatewayAddress: envFor(viteEnv, "VITE_CONSENT_GATEWAY_ADDRESS", network) as Address | undefined,
  fromBlock: envFor(viteEnv, "VITE_FROM_BLOCK", network) ? BigInt(envFor(viteEnv, "VITE_FROM_BLOCK", network) as string) : 0n,
  chainId: net.chainId,
  explorerUrl: net.explorerUrl,
};

/** The chain object for the active BOT network (used by hooks + wallet). */
export const chain = net.chain;

export {
  consentGatewayAbi,
  agentRegistryAbi,
  actionRequestedEvent,
  requestStatus,
  statusNum,
  statusOrder,
  type RequestStatus,
  actionTypeLabel,
  formatAmount,
  shortAddress,
  timeAgo,
} from "@xbot02/core";
