// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import type { Address, Hex } from "viem";
import { botNetworkFromEnv, envFor, type WalletSourceConfig, type BotNetwork } from "@xbot02/core";

/**
 * Reads a WalletSourceConfig from environment variables so any Cosign MCP
 * server can be pointed at a private key, a mnemonic, or a remote signer
 * without code changes:
 *
 *   WALLET_KIND=private-key           (default)  + AGENT_PRIVATE_KEY
 *   WALLET_KIND=mnemonic                         + AGENT_MNEMONIC [+ WALLET_ACCOUNT_INDEX]
 *   WALLET_KIND=json-rpc                         + WALLET_ADDRESS + WALLET_RPC (signing RPC)
 *
 * BOT_NETWORK picks the chain (testnet default, or mainnet) and
 * BOT_RPC_URL_{BOT_NETWORK} sets the chain read RPC for all kinds.
 */
export function walletSourceFromEnv(env: NodeJS.ProcessEnv): WalletSourceConfig {
  const kind = env.WALLET_KIND ?? "private-key";
  const network = botNetworkFromEnv(env);
  const rpcUrl = envFor(env, "BOT_RPC_URL", network);
  switch (kind) {
    case "private-key":
      return { kind, privateKey: env.AGENT_PRIVATE_KEY as Hex | undefined, rpcUrl, chainRpcUrl: rpcUrl };
    case "mnemonic":
      return {
        kind,
        mnemonic: env.AGENT_MNEMONIC,
        rpcUrl,
        chainRpcUrl: rpcUrl,
        accountIndex: env.WALLET_ACCOUNT_INDEX ? Number(env.WALLET_ACCOUNT_INDEX) : undefined,
      };
    case "json-rpc":
      return { kind, address: env.WALLET_ADDRESS as Address | undefined, rpcUrl: env.WALLET_RPC, chainRpcUrl: rpcUrl };
    default:
      throw new Error(`WALLET_KIND must be private-key, mnemonic, or json-rpc; got "${kind}"`);
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

/** Reads `NAME_<NETWORK>` (e.g. `CONSENT_GATEWAY_ADDRESS_MAINNET`), falling back to plain `NAME`. */
export function envForNetwork(env: NodeJS.ProcessEnv, name: string, network: BotNetwork): string | undefined {
  return envFor(env, name, network);
}

export function requireEnvFor(env: NodeJS.ProcessEnv, name: string, network: BotNetwork): string {
  const value = envFor(env, name, network);
  if (!value) {
    throw new Error(`Missing required env var: ${name}_${network.toUpperCase()} (or ${name})`);
  }
  return value;
}
