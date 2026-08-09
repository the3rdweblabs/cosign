// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import { createPublicClient, createWalletClient, http, type Account, type Address, type Chain, type Hex, type PublicClient, type Transport, type WalletClient } from "viem";
import { mnemonicToAccount, parseAccount, privateKeyToAccount } from "viem/accounts";
import { botChainFromEnv, botNetworkConfig } from "./network.js";

/**
 * Describes where a signer comes from. xBOT02 servers are signer-agnostic:
 *
 *  - `private-key`: an EOA private key (env var / file) - signs locally.
 *  - `mnemonic`:    an HD wallet derived from a seed phrase - signs locally.
 *  - `json-rpc`:    an address whose signing is delegated to a remote wallet
 *                   service (custodian, MPC, hardware-wallet bridge) via the
 *                   standard eth_sendTransaction / eth_signTransaction JSON-RPC
 *                   methods. Nothing secret lives in this process.
 */
export interface WalletSourceConfig {
  kind: "private-key" | "mnemonic" | "json-rpc";
  /** For `private-key`. */
  privateKey?: Hex;
  /** For `mnemonic`. */
  mnemonic?: string;
  /** For `json-rpc`: the address the remote signer manages. */
  address?: Address;
  /** Signing RPC (the wallet client's transport; where eth_sendTransaction goes). */
  rpcUrl?: string;
  /** Chain read RPC. Defaults to `rpcUrl`, then the active BOT network's RPC. */
  chainRpcUrl?: string;
  /** For `mnemonic`: which derived account to use (default 0). */
  accountIndex?: number;
}

export interface WalletSource {
  account: Account;
  chain: Chain;
  publicClient: PublicClient;
  walletClient: WalletClient<Transport, Chain, Account | undefined>;
  /**
   * True when this signer can produce offline signatures (private-key /
   * mnemonic). The x402 `pay_uri` path needs this; json-rpc signers get
   * writes but not offline payment signing.
   */
  isLocalSigner: boolean;
}

/** Builds a viem signer set from any supported wallet source. */
export function createWalletSource(config: WalletSourceConfig, chain: Chain = botChainFromEnv()): WalletSource {
  const readRpc = config.chainRpcUrl ?? config.rpcUrl ?? botNetworkConfig().rpcUrl;
  const signRpc = config.rpcUrl ?? readRpc;

  const account: Account =
    config.kind === "private-key"
      ? privateKeyToAccount(requireValue(config.privateKey, "privateKey"))
      : config.kind === "mnemonic"
        ? mnemonicToAccount(requireValue(config.mnemonic, "mnemonic"), { accountIndex: config.accountIndex ?? 0 })
        : parseAccount(requireValue(config.address, "address"));

  const publicClient = createPublicClient({ chain, transport: http(readRpc) });
  const walletClient = createWalletClient({ chain, account, transport: http(signRpc) });

  return {
    account,
    chain,
    publicClient,
    walletClient,
    isLocalSigner: "signTransaction" in account,
  };
}

function requireValue<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`createWalletSource: missing "${name}" for wallet kind`);
  return value;
}
