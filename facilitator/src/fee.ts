// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import { isAddress, parseTransaction, recoverTransactionAddress, type Address, type Hex, type PublicClient } from "viem";
import { botNetworkConfig, computeFeeAmount, envFor, NATIVE_ASSET, type FeeSchedule } from "@xbot02/core";

/**
 * Facilitator surcharge configuration (read once at startup).
 *
 * Env (per network via envFor, e.g. FEE_BPS_TESTNET):
 *   FEE_BPS        basis points, 100 = 1%. Wins over FEE_PERCENT if both set.
 *   FEE_PERCENT    percentage as a number, 0.01 = 0.01%. Converted to bps.
 *   FEE_RECEIVER   address that receives the fee. Required when bps > 0.
 */
export interface FeeConfig {
  bps: number;
  receiver: Address;
}

/**
 * Reads the fee config for the active BOT network. Returns undefined when no
 * fee is configured (bps <= 0). Throws fast on a misconfigured fee so a typo
 * can't silently change how much money the facilitator collects.
 */
export function readFeeConfig(env: NodeJS.ProcessEnv = process.env): FeeConfig | undefined {
  const network = botNetworkConfig(env).network;
  const bpsRaw = envFor(env, "FEE_BPS", network);
  const pctRaw = envFor(env, "FEE_PERCENT", network);

  let bps: number;
  if (bpsRaw !== undefined) {
    bps = Math.round(Number(bpsRaw));
  } else if (pctRaw !== undefined) {
    bps = Math.round(Number(pctRaw) * 100);
  } else {
    return undefined;
  }

  if (!Number.isFinite(bps) || bps < 0 || bps > 10000) {
    throw new Error(`Invalid FEE_BPS/FEE_PERCENT (${bpsRaw ?? pctRaw}) for network ${network}: must be 0..10000 bps`);
  }
  if (bps === 0) return undefined;

  const receiver = envFor(env, "FEE_RECEIVER", network);
  if (!receiver || !isAddress(receiver)) {
    throw new Error(`FEE_RECEIVER_${network.toUpperCase()} (or FEE_RECEIVER) is required and must be a valid address when a fee is charged`);
  }
  return { bps, receiver };
}

/** The schedule advertised at GET /v1/fee so clients know the fee before signing. */
export function feeSchedule(fee: FeeConfig | undefined, network: string): FeeSchedule {
  return {
    bps: fee?.bps ?? 0,
    receiver: fee?.receiver ?? null,
    network,
    asset: NATIVE_ASSET,
  };
}

/**
 * Checks a signed fee tx against the fee config WITHOUT touching the network:
 * it must send exactly computeFeeAmount(bps, amount) wei of the native token to
 * the fee receiver, from the same account that signed the main payment, on the
 * same chain. The caller then simulates it via eth_call before accepting.
 */
export async function validateFeeTx(args: {
  feeRawTx: Hex;
  fee: FeeConfig;
  amount: bigint;
  expectedSender: Address;
  chainId: number;
}): Promise<{ ok: boolean; message?: string }> {
  let tx;
  try {
    tx = parseTransaction(args.feeRawTx);
  } catch (err) {
    return { ok: false, message: `Could not parse feeRawTx: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (tx.to === undefined || tx.to === null) {
    return { ok: false, message: "feeRawTx is a contract creation, not a transfer" };
  }
  if (tx.to.toLowerCase() !== args.fee.receiver.toLowerCase()) {
    return { ok: false, message: `feeRawTx to ${tx.to} does not match fee receiver ${args.fee.receiver}` };
  }

  const expected = computeFeeAmount(args.fee.bps, args.amount);
  if ((tx.value ?? 0n) !== expected) {
    return { ok: false, message: `feeRawTx value ${tx.value} does not match expected fee ${expected} (${args.fee.bps} bps)` };
  }

  const feeTxChainId = parseChainId(args.feeRawTx);
  if (feeTxChainId !== null && feeTxChainId !== args.chainId) {
    return { ok: false, message: `feeRawTx chain id ${feeTxChainId} does not match ${args.chainId}` };
  }

  try {
    const from = await recoverTransactionAddress({ serializedTransaction: args.feeRawTx } as never);
    if (from.toLowerCase() !== args.expectedSender.toLowerCase()) {
      return { ok: false, message: `feeRawTx sender ${from} does not match payment sender ${args.expectedSender}` };
    }
  } catch (err) {
    return { ok: false, message: `Could not recover fee tx sender: ${err instanceof Error ? err.message : String(err)}` };
  }

  return { ok: true };
}

/** eth_call-simulates the fee tx so /verify knows it will succeed before /settle. */
export async function simulateFeeTx(client: PublicClient, feeRawTx: Hex): Promise<{ ok: boolean; message?: string }> {
  const tx = parseTransaction(feeRawTx);
  const from = await recoverTransactionAddress({ serializedTransaction: feeRawTx } as never);
  try {
    await client.call({ account: from, to: tx.to ?? "0x", value: tx.value ?? 0n, data: tx.data ?? "0x" });
    return { ok: true };
  } catch (err) {
    return { ok: false, message: `Fee tx simulation failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function parseChainId(rawTx: Hex): number | null {
  try {
    const tx = parseTransaction(rawTx) as { chainId?: number };
    return typeof tx.chainId === "number" ? tx.chainId : null;
  } catch {
    return null;
  }
}
