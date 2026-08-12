// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import { keccak256, parseTransaction, recoverTransactionAddress, type Address, type Hex, type PublicClient, type TransactionReceipt } from "viem";
import { nativeAsset, x402Error, type PaymentPayload, type PaymentRequirements, type SettlementResult, type VerificationResult, type VerifyRequest, type X402ErrorCode } from "@xbot02/core";
import { simulateFeeTx, validateFeeTx, type FeeConfig } from "./fee.js";

export {
  nativeAsset,
  type PaymentRequirements as SelfpayPaymentDetails,
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

  /** Verified-at timestamps keyed by payment tx hash, for maxTimeoutSeconds enforcement. */
  private readonly verifiedAt = new Map<string, number>();

  async verify(req: VerifyRequest): Promise<VerificationResult> {
    const requirements = req.paymentRequirements ?? req.paymentDetails;
    const rawTx = payloadRawTx(req.paymentPayload);

    if (!requirements) {
      return { verified: false, code: x402Error.INVALID_PAYMENT_REQUIREMENTS, message: "Missing paymentRequirements (or legacy paymentDetails)" };
    }
    if (requirements.scheme !== "exact") {
      return { verified: false, code: x402Error.INVALID_SCHEME, message: `SelfpayFallback only supports scheme "exact", got "${requirements.scheme}"` };
    }
    if (!rawTx) {
      return { verified: false, code: x402Error.INVALID_PAYLOAD, message: "Payment payload is missing payload.rawTx" };
    }
    if (requirements.asset.toLowerCase() !== nativeAsset) {
      return { verified: false, code: x402Error.INVALID_PAYMENT_REQUIREMENTS, message: "SelfpayFallback only supports native gas-token payments (zero asset address)" };
    }
    if (!isPositiveMaxTimeout(requirements.maxTimeoutSeconds)) {
      return { verified: false, code: x402Error.INVALID_PAYMENT_REQUIREMENTS, message: "maxTimeoutSeconds is required in v2 and must be a positive number" };
    }
    const expectedChainId = parseChainId(requirements.network);
    if (expectedChainId === null || expectedChainId !== this.chainId) {
      return { verified: false, code: x402Error.INVALID_NETWORK, message: `Network ${requirements.network} does not match configured chain id ${this.chainId}` };
    }

    let tx;
    try {
      tx = parseTransaction(rawTx);
    } catch (err) {
      return { verified: false, code: x402Error.INVALID_PAYLOAD, message: `Could not parse rawTx: ${err instanceof Error ? err.message : String(err)}` };
    }

    if (tx.to === undefined || tx.to === null) {
      return { verified: false, code: x402Error.INVALID_PAYLOAD, message: "rawTx is a contract creation, not a payment transfer" };
    }

    if (tx.chainId !== undefined && tx.chainId !== this.chainId) {
      return { verified: false, code: x402Error.INVALID_NETWORK, message: `rawTx chain id ${tx.chainId} does not match configured chain id ${this.chainId}` };
    }

    let from: Address;
    try {
      from = await recoverTransactionAddress({ serializedTransaction: rawTx } as never);
    } catch (err) {
      return { verified: false, code: x402Error.INVALID_PAYLOAD, message: `Could not recover sender: ${err instanceof Error ? err.message : String(err)}` };
    }

    const to = tx.to.toLowerCase();
    const payTo = requirements.payTo.toLowerCase();
    if (to !== payTo) {
      return { verified: false, code: x402Error.INVALID_PAYLOAD, message: `rawTx to ${tx.to} does not match payTo ${requirements.payTo}` };
    }

    const amount = BigInt(requirements.amount);
    const value = tx.value ?? 0n;
    if (value !== amount) {
      return { verified: false, code: x402Error.INVALID_PAYLOAD, message: `rawTx value ${value} does not match exact amount ${amount}` };
    }

    const simulate = await this.client
      .call({ account: from, to: tx.to, value, data: tx.data ?? "0x" })
      .then(() => true)
      .catch((err) => err instanceof Error ? err.message : String(err));
    if (simulate !== true) {
      const reason = String(simulate);
      return { verified: false, code: classifySimulationFailure(reason), message: `Simulation failed: ${reason}` };
    }

    if (this.fee) {
      const feeCheck = await this.checkFee(payloadFeeRawTx(req.paymentPayload), amount, from);
      if (!feeCheck.ok) {
        return { verified: false, code: x402Error.INVALID_PAYLOAD, message: feeCheck.message };
      }
    }

    const txHash = keccak256(rawTx);
    this.verifiedAt.set(txHash, Date.now());

    return { verified: true, txHash, from };
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
    const requirements = req.paymentRequirements ?? req.paymentDetails;
    const rawTx = payloadRawTx(req.paymentPayload);

    if (!requirements) {
      return { settled: false, code: x402Error.INVALID_PAYMENT_REQUIREMENTS, message: "Missing paymentRequirements (or legacy paymentDetails)" };
    }
    if (!rawTx) {
      return { settled: false, code: x402Error.INVALID_PAYLOAD, message: "Payment payload is missing payload.rawTx" };
    }

    const txHash = keccak256(rawTx);
    const verifiedAt = this.verifiedAt.get(txHash);
    if (verifiedAt !== undefined && isPositiveMaxTimeout(requirements.maxTimeoutSeconds)) {
      const maxMs = requirements.maxTimeoutSeconds * 1000;
      if (Date.now() - verifiedAt > maxMs) {
        return {
          settled: false,
          code: x402Error.INVALID_PAYLOAD,
          message: `Payment timed out: maxTimeoutSeconds (${requirements.maxTimeoutSeconds}s) elapsed since verification`,
        };
      }
    }

    let broadcastHash: Hex;
    try {
      broadcastHash = await this.client.sendRawTransaction({ serializedTransaction: rawTx });
    } catch (err) {
      return { settled: false, code: x402Error.INVALID_TRANSACTION_STATE, message: `Broadcast failed: ${err instanceof Error ? err.message : String(err)}` };
    }

    try {
      const receipt = await this.client.waitForTransactionReceipt({ hash: broadcastHash });
      if (receipt.status !== "success") {
        return { settled: false, txHash: broadcastHash, code: x402Error.INVALID_TRANSACTION_STATE, message: "Transaction reverted" };
      }

      logSettled("payment", receipt, parseTransaction(rawTx));

      if (this.fee) {
        const feeRawTx = payloadFeeRawTx(req.paymentPayload);
        if (feeRawTx) {
          const feeResult = await this.broadcastFee(feeRawTx);
          if (!feeResult.settled) {
            return { settled: false, txHash: broadcastHash, code: x402Error.INVALID_TRANSACTION_STATE, message: feeResult.message };
          }
        }
      }

      return { settled: true, txHash: broadcastHash, blockNumber: receipt.blockNumber };
    } catch (err) {
      return { settled: false, txHash: broadcastHash, code: x402Error.UNEXPECTED_SETTLE_ERROR, message: `No confirmation: ${err instanceof Error ? err.message : String(err)}` };
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

function isPositiveMaxTimeout(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * v2 nests the signed txs under `payload.rawTx`; accept the v1 flat shape
 * (`rawTx` directly on the payment payload) as a back-compat alias.
 */
export function payloadRawTx(payload: PaymentPayload): Hex | undefined {
  return payload.payload?.rawTx ?? (payload as unknown as { rawTx?: Hex }).rawTx;
}

export function payloadFeeRawTx(payload: PaymentPayload): Hex | undefined {
  return payload.payload?.feeRawTx ?? (payload as unknown as { feeRawTx?: Hex }).feeRawTx;
}

function classifySimulationFailure(message: string): X402ErrorCode {
  return /insufficient|exceeds|funds|balance|gas/i.test(message)
    ? x402Error.INSUFFICIENT_FUNDS
    : x402Error.INVALID_TRANSACTION_STATE;
}
