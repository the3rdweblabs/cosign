// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import { createPublicClient, createWalletClient, http, type Address, type Chain, type Hex, type LocalAccount, type PublicClient, type Transport, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { botNetworkConfig } from "@xbot02/core";

export interface AgentWallet {
  account: LocalAccount;
  address: Address;
  publicClient: PublicClient;
  walletClient: WalletClient<Transport, Chain, LocalAccount>;
}

/**
 * Builds the agent's signing identity: a viem local account from the private
 * key env var, plus read/write clients for the active BOT network (testnet
 * chain 968 by default). The agent is the EOA that signs consent requests and
 * x402 payments.
 */
export function createAgentWallet(privateKey: Hex): AgentWallet {
  const account = privateKeyToAccount(privateKey);
  const { chain, rpcUrl } = botNetworkConfig();

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  const walletClient = createWalletClient({
    chain,
    account,
    transport: http(rpcUrl),
  });

  return {
    account,
    address: account.address,
    publicClient,
    walletClient,
  };
}

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export function consentGatewayAddress(): Address {
  const network = botNetworkConfig().network;
  const value = process.env[`CONSENT_GATEWAY_ADDRESS_${network.toUpperCase()}`] ?? process.env.CONSENT_GATEWAY_ADDRESS;
  if (!value) {
    throw new Error(`Missing required env var: CONSENT_GATEWAY_ADDRESS_${network.toUpperCase()} (or CONSENT_GATEWAY_ADDRESS)`);
  }
  return value as Address;
}
