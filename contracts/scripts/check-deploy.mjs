#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

// check-deploy.mjs - verify a deployment record end-to-end over HTTP.
//
// Reads the deploy.{network}.json records produced by script/Deploy.s.sol and
// checks, for each present record:
//   1. the RPC reports the expected chain id (network correctness),
//   2. both contracts have code on-chain (eth_getCode),
//   3. both contracts are source-verified on the chain's explorer
//      (module=contract&action=getsourcecode).
//
// Then prints explorer URLs so the deployment is easy to inspect/share.
// Network-ready: pass no arg to check every present record, or a single
// network name to check only that one.
//
// Usage:
//   node scripts/check-deploy.mjs              # testnet + mainnet records present
//   node scripts/check-deploy.mjs testnet      # only testnet
//   node scripts/check-deploy.mjs mainnet      # only mainnet
//
// Exit code 0 when every present record passes chain-id, has code on-chain,
// and both contracts are verified. Non-zero otherwise.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NETWORKS = ["testnet", "mainnet"];
const CONTRACTS = [
  { key: "agentRegistry", env: "agentRegistryEnv" },
  { key: "consentGateway", env: "consentGatewayEnv" },
];

const only = process.argv[2]?.toLowerCase();
const RETRIES = 3;

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

async function explorerGet(explorerUrl, params) {
  const url = `${explorerUrl.replace(/\/$/, "")}/api?${new URLSearchParams(params)}`;
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`explorer ${url}: HTTP ${res.status}`);
  return res.json();
}

function addressUrl(explorerUrl, address) {
  return `${explorerUrl.replace(/\/$/, "")}/address/${address}`;
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

async function checkContract(record, entry) {
  const address = record[entry.key];
  const result = { ...entry, address, code: false, verified: false, name: null, compiler: null, error: null };

  const code = await rpc(record.rpcUrl, "eth_getCode", [address, "latest"]);
  result.code = code && code !== "0x";
  if (!result.code) return result;

  let api;
  try {
    api = await explorerGet(record.explorerUrl, {
      module: "contract",
      action: "getsourcecode",
      address,
    });
  } catch (error) {
    result.error = `${errorDetail(error)} (${record.explorerUrl})`;
    return result;
  }
  if (api.message === "NOTOK" && api.result === "Max rate limit reached") {
    result.error = `explorer rate-limited, try again shortly (${record.explorerUrl})`;
    return result;
  }
  const row = api.result?.[0];
  if (!row) {
    result.error = `no sourcecode response: ${JSON.stringify(api)}`;
    return result;
  }
  result.verified = Boolean(row.SourceCode);
  result.name = row.ContractName || null;
  result.compiler = row.CompilerVersion || null;
  return result;
}

async function checkNetwork(entry) {
  const { network, record, error: loadError } = entry;
  console.log(`\n=== ${network.toUpperCase()} (chain ${record?.chainId ?? "?"}) ===`);

  if (loadError) {
    console.log(`  ! could not parse deploy.${network}.json: ${loadError}`);
    return false;
  }
  for (const k of ["rpcUrl", "explorerUrl", "agentRegistry", "consentGateway"]) {
    if (!record[k]) {
      console.log(`  ! deploy.${network}.json is missing "${k}"`);
      return false;
    }
  }

  let ok = true;

  try {
    const chainIdHex = await rpc(record.rpcUrl, "eth_chainId");
    const chainId = Number.parseInt(chainIdHex, 16);
    const match = chainId === Number(record.chainId);
    console.log(`  chain id    ${match ? "OK " : "MISMATCH"} rpc=${chainId} record=${record.chainId} (${record.rpcUrl})`);
    if (!match) ok = false;
  } catch (error) {
    console.log(`  chain id    ERROR ${errorDetail(error)}`);
    ok = false;
  }

  for (const entry of CONTRACTS) {
    try {
      const c = await checkContract(record, entry);
      const status = c.code ? (c.verified ? "verified" : "on-chain, NOT verified") : "NO CODE on-chain";
      console.log(`  ${entry.key.padEnd(13)} ${status}`);
      console.log(`      address   ${c.address}`);
      console.log(`      env var   ${record[entry.env] ?? "?"}`);
      if (c.name) console.log(`      name      ${c.name}`);
      if (c.compiler) console.log(`      compiler  ${c.compiler}`);
      console.log(`      explorer  ${addressUrl(record.explorerUrl, c.address)}`);
      if (c.error) console.log(`      error     ${c.error}`);
      if (!c.code || !c.verified) ok = false;
    } catch (error) {
      console.log(`  ${entry.key}    ERROR ${errorDetail(error)}`);
      ok = false;
    }
  }

  return ok;
}

const targets = NETWORKS.filter((n) => !only || n === only).map(loadRecord).filter(Boolean);

if (targets.length === 0) {
  console.log(`No deploy.{network}.json records found in ${ROOT}.`);
  console.log("Deploy first, or check a record exists for:", only ?? "testnet/mainnet");
  process.exit(1);
}

console.log(`Checking ${targets.length} deployment record(s) over HTTP...`);

const results = await Promise.all(targets.map(checkNetwork));
const allOk = results.every(Boolean);

console.log(`\n${allOk ? "ALL RECORDS VERIFIED" : "SOME CHECKS FAILED"}`);
process.exit(allOk ? 0 : 1);
