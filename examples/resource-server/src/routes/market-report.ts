// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import type { Address } from "viem";
import { createX402Route } from "./x402.js";
import { fetchChainStats, type ChainStats } from "../lib/chain-stats.js";
import type { BotNetworkConfig } from "../network.js";

export {
  nativeAsset,
  x402Version,
  x402Scheme,
  type PaymentOption,
  type ResourceInfo,
  type PaymentRequired,
} from "./x402.js";

export interface MarketReportConfig {
  facilitatorUrl: string;
  payTo: Address;
  priceWei: string;
  resourcePath: string;
  /** CAIP-2 network advertised in the 402; defaults to the active BOT network. */
  network?: string;
  /** The active BOT network; used to read real on-chain stats for the report. */
  chain: BotNetworkConfig;
  /** Override for tests: fetch chain stats from a stub instead of the RPC. */
  fetchChainStatsOverride?: (config: BotNetworkConfig) => Promise<ChainStats>;
}

/**
 * A pure x402 paid endpoint - no on-chain consent, no guardian, no circuit
 * breaker. Buying a digital report is low-risk, so this endpoint advertises
 * `requireConsent: false` in its payment requirement: the agent can simply pay
 * (0.5 tBOT testnet / 0.015 BOT mainnet) and get the report, with no
 * ConsentGateway round-trip.
 *
 * The report body is built from live BOT Chain state (latest block, block
 * time, current gas price, native supply) read straight from the network's
 * RPC at serve time - no mocked price/volume numbers. There is no on-chain
 * USD price oracle for BOT, so those fields are reported as `null` rather
 * than invented.
 */
export function createMarketReportRoute(config: MarketReportConfig) {
  return createX402Route({
    ...config,
    requireConsent: false,
    resource: {
      serviceName: "BOT Chain market report",
      description: "Live BOT Chain chain stats (latest block, gas price) - real on-chain data, no price oracle",
      mimeType: "application/json",
      tags: ["market", "report", "digital"],
    },
    success: async (receipt) => {
      const fetchStats = config.fetchChainStatsOverride ?? fetchChainStats;
      let stats: ChainStats | null = null;
      try {
        stats = await fetchStats(config.chain);
      } catch (err) {
        stats = null;
      }

      const base = {
        status: "ok",
        report: {
          date: new Date().toISOString().slice(0, 10),
          network: config.chain.network,
          chainId: config.chain.chainId,
          // There is no on-chain USD price oracle for BOT; these are honest
          // nulls rather than fabricated market data.
          priceBOT: null,
          volume24hBOT: null,
          ...(stats
            ? {
                latestBlock: stats.latestBlock.toString(),
                latestBlockTimestamp: new Date(
                  Number(stats.latestBlockTimestamp) * 1000,
                ).toISOString(),
                averageGasPrice: `${stats.averageGasPriceGwei} gwei`,
                dataSource: stats.rpcUrl,
              }
            : {
                latestBlock: null,
                averageGasPrice: null,
                dataSource: null,
                note: "On-chain stats unavailable; the report could not read the network RPC.",
              }),
        },
        txHash: receipt.txHash,
        blockNumber: receipt.blockNumber ?? null,
      };
      return base;
    },
  });
}
