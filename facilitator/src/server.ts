// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import { createChainClient, consentGatewayAddress, requiredEnv } from "./chain.js";
import { SponsorPolicy } from "./policy.js";
import { createPaymasterServer } from "./paymaster.js";
import { X402Adapter } from "./x402-adapter.js";
import { SelfpayFallback } from "./selfpay-fallback.js";
import { submitBundle } from "./bundler.js";
import { botNetworkConfig, envFor } from "@xbot02/core";
import { feeSchedule, readFeeConfig } from "./fee.js";
import { privateKeyToAccount } from "viem/accounts";

const net = botNetworkConfig();
const port = Number(process.env.PAYMASTER_PORT ?? 3000);
const chainId = Number(envFor(process.env, "CHAIN_ID", net.network) ?? net.chainId);

const client = createChainClient();
const consentFromBlockRaw = envFor(process.env, "CONSENT_GATEWAY_FROM_BLOCK", net.network);
const consentFromBlock = consentFromBlockRaw !== undefined && consentFromBlockRaw !== "" ? BigInt(consentFromBlockRaw) : 0n;
const policy = new SponsorPolicy({
  client,
  consentGatewayAddress: consentGatewayAddress(),
  fromBlock: consentFromBlock,
});

const paymasterEnabled = process.env.PAYMASTER_ENABLED === "1";
const sponsorPrivateKey = paymasterEnabled
  ? (requiredEnv("SPONSOR_PRIVATE_KEY") as `0x${string}`)
  : undefined;

const fee = readFeeConfig(process.env);
const selfpay = new SelfpayFallback(client, chainId, fee);

const x402 = new X402Adapter({
  selfpay,
  network: net.caip2,
  ...(paymasterEnabled
    ? {
        paymaster: {
          enabled: true,
          policy,
          sponsorPrivateKey: sponsorPrivateKey as `0x${string}`,
          bundler: submitBundle,
        },
      }
    : {}),
});

const signers = paymasterEnabled
  ? [privateKeyToAccount(sponsorPrivateKey as `0x${string}`).address]
  : [];

const server = createPaymasterServer({
  policy,
  sponsorPrivateKey,
  x402,
  feeSchedule: feeSchedule(fee, net.caip2),
  network: net.caip2,
  signers,
});

server.listen(port, () => {
  const mode = paymasterEnabled ? "paymaster (opt-in)" : "self-pay (default)";
  console.log(`[facilitator] x402 facilitator + BOT Chain EOA paymaster listening on :${port} (chain ${chainId}, ${net.network})`);
  console.log(`[facilitator] settlement mode: ${mode}`);
  console.log(`[facilitator] x402 endpoints: POST /verify, POST /settle, GET /supported`);
  if (fee) {
    console.log(`[facilitator] fee: ${fee.bps} bps (${(fee.bps / 100).toFixed(2)}%) to ${fee.receiver} (GET /v1/fee)`);
  } else {
    console.log(`[facilitator] fee: none`);
  }
});

let draining = false;
function shutdown(signal: string): void {
  if (draining) return;
  draining = true;
  console.log(`[facilitator] received ${signal}, draining in-flight requests...`);
  server.close(() => {
    console.log("[facilitator] all requests drained, exiting");
    process.exit(0);
  });
  setTimeout(() => {
    console.error("[facilitator] forced exit: in-flight requests did not drain in time");
    process.exit(1);
  }, 10_000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
