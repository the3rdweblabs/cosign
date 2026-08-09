// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import { keccak256, parseTransaction, recoverTransactionAddress, type Hex } from "viem";
import { SelfpayFallback, type SelfpayPaymentDetails, type SettlementResult, type VerificationResult, type VerifyRequest } from "./selfpay-fallback.js";
import { BundlerNotReadyError, submitBundle, type BundleSubmission } from "./bundler.js";
import type { SponsorPolicy } from "./policy.js";
import { botNetworkConfig } from "@xbot02/core";

export const SUPPORTED_SCHEME = "exact";

export interface PaymasterBackend {
  enabled: boolean;
  policy: SponsorPolicy;
  sponsorPrivateKey: Hex;
  bundler?: (input: BundleSubmission) => Promise<{ bundleHash: Hex }>;
}

export interface X402AdapterOptions {
  selfpay: SelfpayFallback;
  paymaster?: PaymasterBackend;
  /** CAIP-2 network this facilitator settles on; defaults to the active BOT network. */
  network?: string;
}

/**
 * Routes x402 payment payloads to a settlement backend.
 *
 * The self-pay fallback is the DEFAULT path - an application must work with plain, 
 * self-paid native tBOT transactions even if the
 * BOT Chain native paymaster bundle path is not live. The native paymaster is
 * therefore opt-in (PAYMASTER_ENABLED=1 in the server) and is only used for a
 * zero-gas-price tx; anything else settles by broadcasting the client's own
 * signed tx through the ordinary public RPC.
 *
 *   verify():  accepts an "exact" scheme payload on the active BOT network
 *              (eip155:968 testnet / eip155:677 mainnet). Paymaster
 *              shape verifies through SponsorPolicy (ConsentGateway.isApproved);
 *              self-pay shape is simulated via eth_call in SelfpayFallback.
 *   settle():  paymaster shape requires the bundler (submitBundle). If the
 *              bundler is not ready, the zero-gas tx cannot ride the public
 *              mempool, so we return a clear error telling the client to
 *              re-request with a normal gas-price tx. A normal (self-pay) tx
 *              is broadcast directly via eth_sendRawTransaction and awaited.
 */
export class X402Adapter {
  private readonly selfpay: SelfpayFallback;
  private readonly paymaster?: PaymasterBackend;
  private readonly network: string;

  constructor(options: X402AdapterOptions) {
    this.selfpay = options.selfpay;
    this.paymaster = options.paymaster;
    this.network = options.network ?? botNetworkConfig().caip2;
  }

  async verify(req: VerifyRequest): Promise<VerificationResult> {
    const unsupported = this.checkSchemeNetwork(req.paymentDetails);
    if (unsupported) return { verified: false, message: unsupported };

    if (this.paymaster?.enabled && isZeroGasPriceTx(req.paymentPayload.rawTx)) {
      if (req.paymentPayload.feeRawTx) {
        return {
          verified: false,
          message:
            "A fee cannot ride the zero-gas paymaster path; re-request payment and sign the fee with a normal gas price (self-pay).",
        };
      }
      return this.verifyViaPaymaster(req);
    }
    return this.selfpay.verify(req);
  }

  async settle(req: VerifyRequest): Promise<SettlementResult> {
    const unsupported = this.checkSchemeNetwork(req.paymentDetails);
    if (unsupported) return { settled: false, message: unsupported };

    if (this.paymaster?.enabled && isZeroGasPriceTx(req.paymentPayload.rawTx)) {
      if (req.paymentPayload.feeRawTx) {
        return {
          settled: false,
          message:
            "A fee cannot ride the zero-gas paymaster path; re-request payment and sign the fee with a normal gas price (self-pay).",
        };
      }
      const bundler = this.paymaster.bundler ?? submitBundle;
      try {
        const { bundleHash } = await bundler({
          userRawTx: req.paymentPayload.rawTx,
          sponsorPrivateKey: this.paymaster.sponsorPrivateKey,
        });
        return { settled: true, txHash: bundleHash };
      } catch (err) {
        if (err instanceof BundlerNotReadyError) {
          return {
            settled: false,
            message:
              "Native paymaster bundler is not ready; a zero-gas-price tx cannot be settled " +
              "through the public mempool. Re-request payment and sign with a normal gas price.",
          };
        }
        return { settled: false, message: err instanceof Error ? err.message : String(err) };
      }
    }
    return this.selfpay.settle(req);
  }

  private async verifyViaPaymaster(req: VerifyRequest): Promise<VerificationResult> {
    const { rawTx } = req.paymentPayload;
    let tx;
    try {
      tx = parseTransaction(rawTx);
    } catch (err) {
      return { verified: false, message: `Could not parse rawTx: ${err instanceof Error ? err.message : String(err)}` };
    }
    const verdict = await this.paymaster!.policy.checkSponsorable({
      to: tx.to ?? "0x",
      from: (await this.recoverFrom(rawTx)) ?? "0x",
      value: `0x${(tx.value ?? 0n).toString(16)}`,
    });
    if (!verdict.Sponsorable) {
      return { verified: false, message: `Sponsor policy "${verdict.SponsorPolicy}" rejected this payment` };
    }
    return { verified: true, txHash: keccak256(rawTx) };
  }

  private async recoverFrom(rawTx: Hex): Promise<`0x${string}` | undefined> {
    try {
      return await recoverTransactionAddress({ serializedTransaction: rawTx } as never);
    } catch {
      return undefined;
    }
  }

  private checkSchemeNetwork(details: SelfpayPaymentDetails): string | null {
    if (details.scheme !== SUPPORTED_SCHEME) {
      return `Unsupported payment scheme "${details.scheme}" (expected "${SUPPORTED_SCHEME}")`;
    }
    if (details.network !== this.network) {
      return `Unsupported payment network "${details.network}" (expected "${this.network}")`;
    }
    return null;
  }
}

export function isZeroGasPriceTx(rawTx: Hex): boolean {
  try {
    const tx = parseTransaction(rawTx) as { gasPrice?: bigint; maxFeePerGas?: bigint };
    return (tx.gasPrice ?? tx.maxFeePerGas ?? 0n) === 0n;
  } catch {
    return false;
  }
}
