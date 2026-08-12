// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import { test } from "node:test";
import assert from "node:assert";
import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import { createMarketReportRoute } from "./routes/market-report.js";
import { DEFAULT_MARKET_REPORT_PRICE, marketReportPriceWei, type BotNetworkConfig } from "./network.js";
import { botChainTestnet } from "@xbot02/core";
import type { ChainStats } from "./lib/chain-stats.js";

const PAYTO = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Address;
const PRICE = "500000000000000000";

const TEST_CHAIN: BotNetworkConfig = {
  network: "testnet",
  chain: botChainTestnet,
  chainId: 968,
  caip2: "eip155:968",
  rpcUrl: "https://rpc.bohr.life",
  explorerUrl: "https://scan.bohr.life",
};

const STUB_STATS: ChainStats = {
  chainId: 968,
  network: "testnet",
  rpcUrl: "https://rpc.bohr.life",
  latestBlock: 123456n,
  latestBlockTimestamp: 1700000000n,
  averageGasPriceGwei: "1.5",
};

async function signPayment(): Promise<Hex> {
  const agent = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
  return agent.signTransaction({
    to: PAYTO,
    value: 500000000000000000n,
    gas: 21000n,
    gasPrice: 1_000_000_000n,
    nonce: 0,
    chainId: 968,
  });
}

function encodeBase64(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

interface MockFacilitator {
  url: string;
  close: () => Promise<void>;
  setVerify: (fn: () => { isValid: boolean; invalidReason?: string }) => void;
  setSettle: (fn: () => { success: boolean; errorReason?: string; transaction?: string; extensions?: { blockNumber?: string | number | bigint } }) => void;
}

async function startMockFacilitator(): Promise<MockFacilitator> {
  let verifyFn = () => ({ isValid: true });
  let settleFn: () => { success: boolean; errorReason?: string; transaction?: string; extensions?: { blockNumber?: string | number | bigint } } = () => ({
    success: true,
    transaction: "0xaa00000000000000000000000000000000000000000000000000000000000000",
    extensions: { blockNumber: 42n },
  });

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    let result: unknown;
    const path = (req.url ?? "").split("?")[0];
    if (path === "/verify") result = verifyFn();
    else if (path === "/settle") result = settleFn();
    else result = { error: "not found" };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(result, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
  });

  server.listen(0);
  await once(server, "listening");
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    setVerify: (fn) => { verifyFn = fn; },
    setSettle: (fn) => { settleFn = fn; },
  };
}

async function startResourceServer(
  facilitatorUrl: string,
  fetchChainStatsOverride?: (config: BotNetworkConfig) => Promise<ChainStats>,
) {
  const route = createMarketReportRoute({
    facilitatorUrl,
    payTo: PAYTO,
    priceWei: PRICE,
    resourcePath: "/market-report",
    chain: TEST_CHAIN,
    fetchChainStatsOverride: fetchChainStatsOverride ?? (async () => STUB_STATS),
  });
  const server = createServer(async (req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    if (path === "/market-report") {
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
  server.listen(0);
  await once(server, "listening");
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test("market report: first request -> HTTP 402 advertising pure x402 (requireConsent false, 0.5 tBOT testnet)", async () => {
  const facilitator = await startMockFacilitator();
  const resource = await startResourceServer(facilitator.url);
  try {
    const res = await fetch(`${resource.url}/market-report`, { method: "POST" });
    assert.equal(res.status, 402);
    const paymentRequired = JSON.parse(Buffer.from(res.headers.get("payment-required")!, "base64").toString("utf8"));
    assert.equal(paymentRequired.x402Version, 2);
    assert.equal(paymentRequired.resource.url, "/market-report");
    assert.equal(paymentRequired.accepts.length, 1);
    const option = paymentRequired.accepts[0];
    assert.equal(option.scheme, "exact");
    assert.equal(option.network, "eip155:968");
    assert.equal(option.amount, PRICE);
    assert.equal(option.extra.assetTransferMethod, "native");
    assert.equal(option.extra.requireConsent, false);
  } finally {
    await resource.close();
    await facilitator.close();
  }
});

test("market report: valid payment -> verified + settled -> HTTP 200 with report (no consent advertised)", async () => {
  const facilitator = await startMockFacilitator();
  const resource = await startResourceServer(facilitator.url);
  try {
    const rawTx = await signPayment();
    const res = await fetch(`${resource.url}/market-report`, {
      method: "POST",
      headers: { "payment-signature": encodeBase64({ payment: { rawTx } }) },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      status: string;
      report: {
        date: string;
        network: string;
        chainId: number;
        latestBlock: string;
        averageGasPrice: string;
        priceBOT: null;
        dataSource: string;
      };
      txHash: string;
    };
    assert.equal(body.status, "ok");
    assert.equal(typeof body.report.date, "string");
    assert.equal(body.report.network, "testnet");
    assert.equal(body.report.chainId, 968);
    assert.equal(body.report.latestBlock, "123456");
    assert.equal(body.report.averageGasPrice, "1.5 gwei");
    assert.equal(body.report.priceBOT, null);
    assert.equal(body.report.dataSource, "https://rpc.bohr.life");
    assert.equal(body.txHash, "0xaa00000000000000000000000000000000000000000000000000000000000000");
  } finally {
    await resource.close();
    await facilitator.close();
  }
});

test("market report: on-chain stats RPC down -> report serves nulls with a note, still HTTP 200", async () => {
  const facilitator = await startMockFacilitator();
  const resource = await startResourceServer(facilitator.url, async () => {
    throw new Error("rpc.bohr.life unreachable");
  });
  try {
    const rawTx = await signPayment();
    const res = await fetch(`${resource.url}/market-report`, {
      method: "POST",
      headers: { "payment-signature": encodeBase64({ payment: { rawTx } }) },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      report: { latestBlock: null; averageGasPrice: null; note: string };
    };
    assert.equal(body.report.latestBlock, null);
    assert.equal(body.report.averageGasPrice, null);
    assert.equal(typeof body.report.note, "string");
  } finally {
    await resource.close();
    await facilitator.close();
  }
});

test("marketReportPriceWei defaults to 0.5 tBOT testnet / 0.05 BOT mainnet", () => {
  assert.equal(DEFAULT_MARKET_REPORT_PRICE.testnet, "500000000000000000");
  assert.equal(DEFAULT_MARKET_REPORT_PRICE.mainnet, "50000000000000000");
  assert.equal(marketReportPriceWei({}, "testnet"), DEFAULT_MARKET_REPORT_PRICE.testnet);
  assert.equal(marketReportPriceWei({}, "mainnet"), DEFAULT_MARKET_REPORT_PRICE.mainnet);
  assert.equal(marketReportPriceWei({ MARKET_REPORT_PRICE_TESTNET: "1" }, "testnet"), "1");
  assert.equal(marketReportPriceWei({ MARKET_REPORT_PRICE: "7" }, "mainnet"), "7");
  assert.equal(marketReportPriceWei({ MARKET_REPORT_PRICE_MAINNET: "2", MARKET_REPORT_PRICE: "7" }, "mainnet"), "2");
});
