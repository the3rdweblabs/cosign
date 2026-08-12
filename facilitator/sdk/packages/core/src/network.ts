// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import type { Chain } from "viem";
import { botChainTestnet, botChainMainnet } from "./chain.js";
import { botTestnetCaip2, botMainnetCaip2 } from "./x402.js";

/**
 * Which BOT Chain network a process / app targets.
 *
 * Every service reads `BOT_NETWORK` from its environment (`testnet` default,
 * or `mainnet`). Network-specific config vars are then read with a
 * `NAME_<NETWORK>` suffix - e.g. `BOT_RPC_URL_TESTNET`, `BOT_RPC_URL_MAINNET`,
 * `CONSENT_GATEWAY_ADDRESS_MAINNET` - via `envFor()`. The unsuffixed `NAME`
 * form still works as a fallback so single-network setups don't break.
 */
export type BotNetwork = "testnet" | "mainnet";

export const defaultBotNetwork: BotNetwork = "testnet";

export interface BotNetworkConfig {
  network: BotNetwork;
  chain: Chain;
  chainId: number;
  /** CAIP-2 network id, e.g. "eip155:968". */
  caip2: string;
  /** Default public RPC for the network. */
  rpcUrl: string;
  explorerUrl: string;
}

export const botNetworks: Record<BotNetwork, BotNetworkConfig> = {
  testnet: {
    network: "testnet",
    chain: botChainTestnet,
    chainId: 968,
    caip2: botTestnetCaip2,
    rpcUrl: "https://rpc.bohr.life",
    explorerUrl: "https://scan.bohr.life",
  },
  mainnet: {
    network: "mainnet",
    chain: botChainMainnet,
    chainId: 677,
    caip2: botMainnetCaip2,
    rpcUrl: "https://rpc.botchain.ai",
    explorerUrl: "https://scan.botchain.ai",
  },
};

function nodeEnv(): Record<string, unknown> {
  return typeof process !== "undefined" && process.env ? process.env : {};
}

export function isBotNetwork(value: string | undefined): value is BotNetwork {
  return value === "testnet" || value === "mainnet";
}

/**
 * Resolves `BOT_NETWORK` from an env object. Unset / empty falls back to
 * `testnet` (the demo default); anything else that is not `testnet|mainnet`
 * is rejected so a typo can't silently pick the wrong chain.
 */
export function botNetworkFromEnv(
  env: Record<string, unknown> = nodeEnv(),
  fallback: BotNetwork = defaultBotNetwork,
): BotNetwork {
  const raw = typeof env.BOT_NETWORK === "string" ? env.BOT_NETWORK.trim().toLowerCase() : undefined;
  if (raw === undefined || raw === "") return fallback;
  if (isBotNetwork(raw)) return raw;
  throw new Error(`BOT_NETWORK must be "testnet" or "mainnet"; got "${String(env.BOT_NETWORK)}"`);
}

/**
 * Reads a config var from env using the `NAME_<NETWORK>` suffix convention:
 * `envFor(env, "BOT_RPC_URL", "testnet")` looks up `BOT_RPC_URL_TESTNET`, then
 * falls back to the unsuffixed `BOT_RPC_URL`.
 */
export function envFor(env: Record<string, unknown>, name: string, network: BotNetwork): string | undefined {
  const suffixed = env[`${name}_${network.toUpperCase()}`];
  if (typeof suffixed === "string" && suffixed.trim() !== "") return suffixed;
  const plain = env[name];
  return typeof plain === "string" && plain.trim() !== "" ? plain : undefined;
}

/** Full per-network config, with `BOT_RPC_URL_{NETWORK}` applied when set. */
export function botNetworkConfig(env: Record<string, unknown> = nodeEnv()): BotNetworkConfig {
  const network = botNetworkFromEnv(env);
  return {
    ...botNetworks[network],
    rpcUrl: envFor(env, "BOT_RPC_URL", network) ?? botNetworks[network].rpcUrl,
  };
}

export function botChainFromEnv(env: Record<string, unknown> = nodeEnv()): Chain {
  return botNetworkConfig(env).chain;
}
