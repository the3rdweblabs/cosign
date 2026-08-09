#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Address } from "viem";
import { createWalletSource, botNetworkFromEnv, envFor } from "@xbot02/core";
import { createAgentServer } from "../agent-server.js";
import { requireEnvFor, walletSourceFromEnv } from "../env.js";

// Runs the xBOT02 agent MCP server over stdio (Claude Desktop, opencode, etc).
// Configure via env vars - see walletSourceFromEnv for the signer options.
const source = createWalletSource(walletSourceFromEnv(process.env));
const network = botNetworkFromEnv(process.env);

const server = createAgentServer({
  source,
  consentGatewayAddress: requireEnvFor(process.env, "CONSENT_GATEWAY_ADDRESS", network) as Address,
  registryAddress: envFor(process.env, "AGENT_REGISTRY_ADDRESS", network) as Address | undefined,
  facilitatorUrl: process.env.FACILITATOR_URL,
});

const transport = new StdioServerTransport();
await server.connect(transport);
