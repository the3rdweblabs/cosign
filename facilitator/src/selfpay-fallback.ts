// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import { keccak256, parseTransaction, recoverTransactionAddress, type Address, type Hex, type PublicClient, type TransactionReceipt } from "viem";
import { NATIVE_ASSET, type SettlementResult, type VerificationResult, type VerifyRequest } from "@xbot02/core";
import { simulateFeeTx, validateFeeTx, type FeeConfig } from "./fee.js";

export {
  NATIVE_ASSET,
  type PaymentDetails as SelfpayPaymentDetails,
  type PaymentPayload as SelfpayPayload,
  type VerifyRequest,
  type VerificationResult,
  type SettlementResult,
} from "@xbot02/core";

/**
 * REQUIRED fallback settlement path for the x402 facilitator (AGENTS.md:
 * "the self-pay fallback path is not optional"). This is a plain, standalone
 * x402 exact-style flow that settles with a NORMAL signed transaction: the
 * agent sends tBOT to the seller and pays its own gas via the ordinary chain
 * RPC. No bundler, no zero-gas-price tx, no dependency on unproven BOT Chain
 * builder/bundle infrastructure.
 *
 * Flow (x402-shaped):
 *   1. verify()  - parse + validate the signed raw tx against the payment
 *                  details (to == payTo, value == amount, chain id == 968),
 *                  and eth_call-simulate it so we know it will succeed.
 *   2. settle()  - broadcast the same raw tx via eth_sendRawTransaction on the
 *                  public RPC and wait for a successful receipt. Returns the
 *                  tx hash + block number for the PAYMENT-RESPONSE header.
 */
export class SelfpayFallback {
  constructor(
    private readonly client: PublicClient,
    private readonly chainId: number,
    private readonly fee?: FeeConfig,
  ) { }

  async verify(req: VerifyRequest): Promise<VerificationResult> {
    const { paymentDetails, paymentPayload } = req;

    if (paymentDetails.scheme !== "exact") {
      return { verified: false, message: `SelfpayFallback only supports scheme "exact", got "${paymentDetails.scheme}"` };
    }
    if (!paymentPayload?.rawTx) {
      return { verified: false, message: "Payment payload is missing rawTx" };
    }
    if (paymentDetails.asset.toLowerCase() !== NATIVE_ASSET) {
      return { verified: false, message: "SelfpayFallback only supports native gas-token payments (zero asset address)" };
    }
    const expectedChainId = parseChainId(paymentDetails.network);
    if (expectedChainId === null || expectedChainId !== this.chainId) {
      return { verified: false, message: `Network ${paymentDetails.network} does not match configured chain id ${this.chainId}` };
    }

    let tx;
    try {
      tx = parseTransaction(paymentPayload.rawTx);
    } catch (err) {
      return { verified: false, message: `Could not parse rawTx: ${err instanceof Error ? err.message : String(err)}` };
    }

    if (tx.to === undefined || tx.to === null) {
      return { verified: false, message: "rawTx is a contract creation, not a payment transfer" };
    }

    let from: Address;
    try {
      from = await recoverTransactionAddress({ serializedTransaction: paymentPayload.rawTx } as never);
    } catch (err) {
      return { verified: false, message: `Could not recover sender: ${err instanceof Error ? err.message : String(err)}` };
    }

    const to = tx.to.toLowerCase();
    const payTo = paymentDetails.payTo.toLowerCase();
    if (to !== payTo) {
      return { verified: false, message: `rawTx to ${tx.to} does not match payTo ${paymentDetails.payTo}` };
    }

    const amount = BigInt(paymentDetails.amount);
    const value = tx.value ?? 0n;
    if (value !== amount) {
      return { verified: false, message: `rawTx value ${value} does not match exact amount ${amount}` };
    }

    const simulate = await this.client
      .call({ account: from, to: tx.to, value, data: tx.data ?? "0x" })
      .then(() => true)
      .catch((err) => err instanceof Error ? err.message : String(err));
    if (simulate !== true) {
      return { verified: false, message: `Simulation failed: ${simulate}` };
    }

    if (this.fee) {
      const feeCheck = await this.checkFee(paymentPayload.feeRawTx, amount, from);
      if (!feeCheck.ok) {
        return { verified: false, message: feeCheck.message };
      }
    }

    return { verified: true, txHash: keccak256(paymentPayload.rawTx), from };
  }

  private async checkFee(
    feeRawTx: Hex | undefined,
    amount: bigint,
    mainFrom: Address,
  ): Promise<{ ok: boolean; message?: string }> {
    if (!this.fee) return { ok: true };
    if (!feeRawTx) {
      return { ok: false, message: `A fee is required (${this.fee.bps} bps to ${this.fee.receiver}) but no feeRawTx was provided` };
    }
    const valid = await validateFeeTx({
      feeRawTx,
      fee: this.fee,
      amount,
      expectedSender: mainFrom,
      chainId: this.chainId,
    });
    if (!valid.ok) return valid;
    return simulateFeeTx(this.client, feeRawTx);
  }

  async settle(req: VerifyRequest): Promise<SettlementResult> {
    const { paymentPayload } = req;

    let txHash: Hex;
    try {
      txHash = await this.client.sendRawTransaction({ serializedTransaction: paymentPayload.rawTx });
    } catch (err) {
      return { settled: false, message: `Broadcast failed: ${err instanceof Error ? err.message : String(err)}` };
    }

    try {
      const receipt = await this.client.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== "success") {
        return { settled: false, txHash, message: "Transaction reverted" };
      }

      logSettled("payment", receipt, parseTransaction(paymentPayload.rawTx));

      if (this.fee && paymentPayload.feeRawTx) {
        const feeResult = await this.broadcastFee(paymentPayload.feeRawTx);
        if (!feeResult.settled) {
          return { settled: false, txHash, message: feeResult.message };
        }
      }

      return { settled: true, txHash, blockNumber: receipt.blockNumber };
    } catch (err) {
      return { settled: false, txHash, message: `No confirmation: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  private async broadcastFee(feeRawTx: Hex): Promise<{ settled: boolean; message?: string }> {
    let feeHash: Hex;
    try {
      feeHash = await this.client.sendRawTransaction({ serializedTransaction: feeRawTx });
    } catch (err) {
      return { settled: false, message: `Fee broadcast failed: ${err instanceof Error ? err.message : String(err)}` };
    }
    try {
      const feeReceipt = await this.client.waitForTransactionReceipt({ hash: feeHash });
      if (feeReceipt.status !== "success") {
        return { settled: false, message: "Fee transaction reverted" };
      }
      logSettled("fee", feeReceipt, parseTransaction(feeRawTx));
      return { settled: true };
    } catch (err) {
      return { settled: false, message: `No fee confirmation: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
}

/**
 * Log the full on-chain details of a settled transaction to the facilitator
 * server log. Covers both the payment and (when configured) the fee transfer.
 */
interface LoggedTx {
  to?: Address | null;
  value?: bigint;
  data?: Hex;
  gas?: bigint;
  gasPrice?: bigint;
}

function logSettled(kind: string, receipt: TransactionReceipt, tx: LoggedTx): void {
  const gasPrice = receipt.effectiveGasPrice ?? tx.gasPrice ?? 0n;
  const feePaid = gasPrice * (receipt.gasUsed ?? 0n);
  const logs = receipt.logs ?? [];
  const lines = [
    `[facilitator][settled] ${kind} tx confirmed on-chain`,
    `  hash:          ${receipt.transactionHash ?? "-"}`,
    `  block:         ${receipt.blockNumber ?? "-"} (tx index ${receipt.transactionIndex ?? "-"})`,
    `  from:          ${receipt.from ?? "-"}`,
    `  to:            ${tx.to ?? receipt.to ?? "-"}`,
    `  value:         ${tx.value ?? 0n} wei (${formatBot(tx.value ?? 0n)} BOT)`,
    `  data:          ${tx.data ?? "0x"}`,
    `  gas:           ${receipt.gasUsed ?? 0n} used / ${tx.gas ?? 0n} limit`,
    `  gasPrice:      ${gasPrice} wei`,
    `  feePaid:       ${feePaid} wei (${formatBot(feePaid)} BOT)`,
    `  status:        ${receipt.status ?? "-"}`,
    `  logs:          ${logs.length} event(s)`,
  ];
  for (const log of logs) {
    lines.push(`    ${log.address} ${log.topics[0] ?? "-"}${log.data !== "0x" ? ` data=${log.data}` : ""}`);
  }
  console.log(lines.join("\n"));
}

function formatBot(wei: bigint): string {
  const bot = Number(wei) / 1e18;
  return bot.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

function parseChainId(network: string): number | null {
  if (!network.startsWith("eip155:")) return null;
  const id = Number(network.slice("eip155:".length));
  return Number.isSafeInteger(id) ? id : null;
}
