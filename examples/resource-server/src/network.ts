// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

// BOT network resolution (networks, chain config, env helpers) comes from
// @xbot02/core - the single source of truth for chain data across the SDK.
// The resource server keeps its own copies only of the resource-specific
// price helpers below.

import {
  botNetworks,
  botNetworkFromEnv,
  envFor,
  type BotNetwork,
  type BotNetworkConfig,
} from "@xbot02/core";

export {
  botNetworks,
  botNetworkFromEnv,
  envFor,
  type BotNetwork,
  type BotNetworkConfig,
} from "@xbot02/core";

/** Default price (wei) for one HuBot task per network: 1 tBOT on testnet, 0.1 BOT on mainnet. */
export const DEFAULT_HUBOT_TASK_PRICE: Record<BotNetwork, string> = {
  testnet: "1000000000000000000", // 1 tBOT
  mainnet: "100000000000000000", // 0.1 BOT
};

/**
 * Resolves the HuBot task price in wei for the active network.
 * `HUBOT_TASK_PRICE_<NETWORK>` wins, then plain `HUBOT_TASK_PRICE`, then the
 * per-network default (1 tBOT testnet / 0.1 BOT mainnet).
 */
export function hubotTaskPriceWei(env: NodeJS.ProcessEnv, network: BotNetwork): string {
  return envFor(env, "HUBOT_TASK_PRICE", network) ?? DEFAULT_HUBOT_TASK_PRICE[network];
}

/** Default price (wei) for one market report per network: 0.5 tBOT testnet, 0.05 BOT mainnet. */
export const DEFAULT_MARKET_REPORT_PRICE: Record<BotNetwork, string> = {
  testnet: "500000000000000000", // 0.5 tBOT
  mainnet: "50000000000000000", // 0.05 BOT
};

/**
 * Resolves the market report price in wei for the active network.
 * `MARKET_REPORT_PRICE_<NETWORK>` wins, then plain `MARKET_REPORT_PRICE`, then
 * the per-network default (0.5 tBOT testnet / 0.05 BOT mainnet).
 */
export function marketReportPriceWei(env: NodeJS.ProcessEnv, network: BotNetwork): string {
  return envFor(env, "MARKET_REPORT_PRICE", network) ?? DEFAULT_MARKET_REPORT_PRICE[network];
}
