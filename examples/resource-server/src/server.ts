// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import { createServer } from "node:http";
import type { Address } from "viem";
import { createHubotTaskRoute } from "./routes/hubot-task.js";
import { createMarketReportRoute } from "./routes/market-report.js";
import { botNetworkFromEnv, envFor, botNetworks, hubotTaskPriceWei, marketReportPriceWei } from "./network.js";

const port = Number(process.env.RESOURCE_PORT ?? 4000);
const facilitatorUrl = process.env.FACILITATOR_URL ?? "http://localhost:3000";
const payTo = requiredEnv("RESOURCE_PAYTO") as Address;

const networkName = botNetworkFromEnv(process.env);
const network = envFor(process.env, "RESOURCE_NETWORK", networkName) ?? botNetworks[networkName].caip2;
// Price per network: 1 tBOT on testnet, 0.001 BOT on mainnet. Per-network env
// overrides (HUBOT_TASK_PRICE_TESTNET / _MAINNET) win over the plain var.
const priceWei = hubotTaskPriceWei(process.env, networkName);
// The market report is a pure x402 purchase: 0.5 tBOT testnet / 0.015 BOT mainnet, no consent needed.
const marketReportPrice = marketReportPriceWei(process.env, networkName);

const hubotTask = createHubotTaskRoute({
  facilitatorUrl,
  payTo,
  priceWei,
  resourcePath: "/hubot-task",
  network,
});

const marketReport = createMarketReportRoute({
  facilitatorUrl,
  payTo,
  priceWei: marketReportPrice,
  resourcePath: "/market-report",
  network,
  chain: botNetworks[networkName],
});

const server = createServer(async (req, res) => {
  const path = (req.url ?? "/").split("?")[0];

  const route = path === "/hubot-task" ? hubotTask : path === "/market-report" ? marketReport : null;
  if (route) {
    try {
      await route(req, res);
    } catch (err) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }));
    }
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(port, () => {
  console.log(`[resource] example paid API listening on :${port} (network ${network}, ${networkName})`);
  console.log(`[resource] POST /hubot-task    -> HTTP 402 (consent-gated, ${priceWei} wei) -> serves on settlement via ${facilitatorUrl}`);
  console.log(`[resource] POST /market-report -> HTTP 402 (pure x402, ${marketReportPrice} wei) -> serves on settlement via ${facilitatorUrl}`);
});

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}
