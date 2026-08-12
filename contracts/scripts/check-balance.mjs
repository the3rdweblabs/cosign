#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

// check-balance.mjs - native BOT/tBOT balances + deploy gas-cost estimate.
//
// Checks the native balance of the deployer (from deploy.{network}.json) and
// any extra addresses you pass, on the testnet and/or mainnet RPC, and prints
// the cost of one full deployment at the live gas price so you know the
// deployer is funded before you run Deploy.s.sol.
//
// Gas numbers are measured from the testnet broadcast
// (broadcast/Deploy.s.sol/968/run-latest.json): AgentRegistry CREATE 482,402,
// ConsentGateway CREATE 807,998, setConsentGateway 47,234 -> 1,337,634 total.
//
// Usage:
//   node scripts/check-balance.mjs                    # deployer, every record present
//   node scripts/check-balance.mjs mainnet            # deployer, only mainnet
//   node scripts/check-balance.mjs mainnet 0xAgent 0xSponsor 0xPayee
//
// Exit code 0 always (balance checks are informational).

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NETWORKS = ["testnet", "mainnet"];
const DEFAULT_RPC = {
  testnet: "https://rpc.bohr.life",
  mainnet: "https://rpc.botchain.ai",
};
const WEI_PER_BOT = 1_000_000_000_000_000_000n;
const DEPLOY_GAS = {
  total: 1_337_634n,
  txs: [
    { label: "AgentRegistry CREATE", gas: 482_402n },
    { label: "ConsentGateway CREATE", gas: 807_998n },
    { label: "setConsentGateway", gas: 47_234n },
  ],
};
const RETRIES = 3;

const networkArg = process.argv[2]?.toLowerCase();
const addressArgs = process.argv.slice(3);

function errorDetail(error) {
  const cause = error?.cause;
  const code = cause?.code || cause?.message || "";
  return `${error?.message || String(error)}${code ? ` (${code})` : ""}`;
}

async function fetchWithRetry(url, options = {}) {
  let last;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      return await fetch(url, options);
    } catch (error) {
      last = error;
      if (attempt < RETRIES) {
        await new Promise((r) => setTimeout(r, attempt * 800));
      }
    }
  }
  throw last;
}

async function rpc(rpcUrl, method, params = []) {
  const res = await fetchWithRetry(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
}

function bot(wei) {
  const amount = BigInt(wei);
  const whole = amount / WEI_PER_BOT;
  const frac = amount % WEI_PER_BOT;
  const fracStr = frac.toString().padStart(18, "0").slice(0, 6);
  return `${whole.toLocaleString("en-US")}.${fracStr}`;
}

function loadRecord(network) {
  const file = resolve(ROOT, `deploy.${network}.json`);
  if (!existsSync(file)) return null;
  try {
    return { network, record: JSON.parse(readFileSync(file, "utf8")) };
  } catch (error) {
    return { network, record: null, error: error.message };
  }
}

function normalizeAddress(value) {
  if (typeof value !== "string") return null;
  const addr = value.trim().toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(addr) ? addr : null;
}

async function checkNetwork(entry) {
  const { network, record, error: loadError, note } = entry;
  console.log(`\n=== ${network.toUpperCase()} ===`);
  if (note) console.log(`  ${note}`);

  if (loadError) {
    console.log(`  ! could not parse deploy.${network}.json: ${loadError}`);
    return;
  }
  if (!record?.rpcUrl) {
    record.rpcUrl = DEFAULT_RPC[network];
    if (!record.rpcUrl) {
      console.log(`  ! no RPC for ${network} (deploy.${network}.json is missing "rpcUrl")`);
      return;
    }
  }

  const rpcUrl = record.rpcUrl;
  const addresses = [];

  if (record.deployer) {
    addresses.push({ label: "deployer (from record)", address: record.deployer });
  }
  for (const key of ["agentRegistry", "consentGateway"]) {
    if (record[key]) addresses.push({ label: key, address: record[key] });
  }
  for (const arg of addressArgs) {
    const addr = normalizeAddress(arg);
    if (addr) {
      addresses.push({ label: "extra", address: addr });
    } else {
      console.log(`  ! ignoring non-address arg: ${arg}`);
    }
  }

  if (addresses.length === 0) {
    console.log(`  no deploy.${network}.json record and no address args - nothing to check`);
    return;
  }

  try {
    const gasPrice = BigInt(await rpc(rpcUrl, "eth_gasPrice"));
    const gasPriceGwei = Number(gasPrice) / 1e9;
    const deployCost = DEPLOY_GAS.total * gasPrice;
    console.log(`  gas price   ${gasPriceGwei} gwei`);
    console.log(`  deploy cost ${bot(deployCost)} BOT (${DEPLOY_GAS.total.toLocaleString("en-US")} gas)`);
    for (const { gas } of DEPLOY_GAS.txs) {
      console.log(`    - ${gas.toLocaleString("en-US").padStart(9)} gas  ${bot(gas * gasPrice)} BOT  (${gas / 1000n}k)`);
    }
    for (const { label, address } of addresses) {
      try {
        const balance = BigInt(await rpc(rpcUrl, "eth_getBalance", [address, "latest"]));
        const enough = balance >= deployCost;
        console.log(`  ${label.padEnd(27)} ${bot(balance)} BOT  ${address}${enough ? "  (enough for deploy)" : "  (LOW - below deploy cost)"}`);
      } catch (error) {
        console.log(`  ${label.padEnd(27)} ERROR ${errorDetail(error)}`);
      }
    }
  } catch (error) {
    console.log(`  ERROR ${errorDetail(error)}`);
  }
}

const requested = networkArg ? [networkArg] : NETWORKS;
const targets = [];
for (const n of requested) {
  const loaded = loadRecord(n);
  if (loaded) {
    targets.push(loaded);
  } else if (networkArg) {
    // Explicit network with no deploy record yet (e.g. pre-mainnet-deploy):
    // fall back to the built-in RPC and rely on explicit address args.
    targets.push({ network: n, record: { rpcUrl: DEFAULT_RPC[n] }, note: `no deploy.${n}.json record (built-in RPC)` });
  }
}

if (targets.length === 0) {
  console.log(`No deploy.{network}.json records found in ${ROOT}.`);
  console.log("Deploy first, or pass addresses directly:");
  console.log("  node scripts/check-balance.mjs mainnet 0xDeployer 0xAgent");
  process.exit(1);
}

console.log(`Checking balances on ${targets.length} network(s)...`);

await Promise.all(targets.map(checkNetwork));

console.log(`\nDone.`);
