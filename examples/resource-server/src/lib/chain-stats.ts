// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import { createPublicClient, http, formatUnits } from "viem";
import type { BotNetwork, BotNetworkConfig } from "../network.js";

export interface ChainStats {
  chainId: number;
  network: BotNetwork;
  rpcUrl: string;
  latestBlock: bigint;
  latestBlockTimestamp: bigint;
  averageGasPriceGwei: string;
}

/**
 * Reads real chain state from the active BOT network's RPC: latest block,
 * block timestamp, and current gas price.
 *
 * Uses only standard JSON-RPC methods (`eth_chainId`, `eth_blockNumber`,
 * `eth_getBlockByNumber`, `eth_gasPrice`) so there is no fabricated market
 * data. There is no standard RPC method for native total supply, so the
 * report does not guess one.
 */
export async function fetchChainStats(config: BotNetworkConfig): Promise<ChainStats> {
  const client = createPublicClient({
    transport: http(config.rpcUrl, { timeout: 5_000, retryCount: 1 }),
  });

  const [chainId, latestBlock, gasPrice] = await Promise.all([
    client.getChainId(),
    client.getBlock({ blockTag: "latest" }),
    client.getGasPrice(),
  ]);

  return {
    chainId,
    network: config.network,
    rpcUrl: config.rpcUrl,
    latestBlock: latestBlock.number,
    latestBlockTimestamp: latestBlock.timestamp,
    averageGasPriceGwei: formatUnits(gasPrice, 9),
  };
}
