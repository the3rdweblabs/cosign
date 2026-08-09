#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Address } from "viem";
import { createWalletSource, botNetworkFromEnv, envFor } from "@xbot02/core";
import { createGuardianServer } from "../guardian-server.js";
import { requireEnvFor, walletSourceFromEnv } from "../env.js";

// Runs the xBOT02 guardian MCP server over stdio. Any MCP chat client becomes
// the guardian approval console. See walletSourceFromEnv for signer options.
const source = createWalletSource(walletSourceFromEnv(process.env));
const network = botNetworkFromEnv(process.env);

const fromBlockRaw = envFor(process.env, "FROM_BLOCK", network);

const server = createGuardianServer({
  source,
  consentGatewayAddress: requireEnvFor(process.env, "CONSENT_GATEWAY_ADDRESS", network) as Address,
  registryAddress: envFor(process.env, "AGENT_REGISTRY_ADDRESS", network) as Address | undefined,
  fromBlock: fromBlockRaw ? BigInt(fromBlockRaw) : undefined,
});

const transport = new StdioServerTransport();
await server.connect(transport);
