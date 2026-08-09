// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import type { Hex } from "viem";

export interface BundleSubmission {
  userRawTx: Hex;
  sponsorPrivateKey: Hex;
}

export interface BundleResult {
  bundleHash: Hex;
}

export class BundlerNotReadyError extends Error {
  constructor() {
    super(
      "Bundler not yet implemented: BOT Chain bundle submission endpoint (builder access) is not yet confirmed. " +
      "PBS block production is live on both chains, but the builder submission interface is still being confirmed with BOT Chain. " +
      "See the TODO in bundler.ts. Client should fall back to self-pay (selfpay-fallback.ts).",
    );
    this.name = "BundlerNotReadyError";
  }
}

/**
 * TODO(bundler): real bundle submission once builder access is confirmed.
 *
 * The BOT Chain EOA (Externally Owned Account) paymaster spec requires wrapping the user's zero-gas-price
 * signed tx together with a sponsor tx that covers gas, then submitting the
 * bundle to MEV (Maximal Extractable Value) builders (BEP-322 Proposer-Builder Separation), which pick it
 * up by aggregate bundle gas price and land both transactions atomically.
 *
 * Status: PBS/BEP-322 block production is CONFIRMED live on both testnet (968) and mainnet (677) -
 * proposers inject zero-gas-price accounting txs to the system reward contract (0x..1000) every block.
 * The remaining unknown is only the bundle SUBMISSION interface: no public eth_sendBundle / private-tx
 * endpoint exists on the public RPCs, and whether BOT Chain accepts external builders into the bid channel
 * has been asked to the BOT Chain team. Once that answer lands, this function must:
 *
 *   1. Parse `userRawTx` with viem `parseTransaction` and re-check sponsorship
 *      through `SponsorPolicy` (never bundle a tx the policy rejected).
 *   2. Build a SPONSOR transaction from `sponsorPrivateKey`:
 *        - from:    sponsor address
 *        - to:      same `to` as the user tx
 *        - value:   user tx value (so the bundle is a single atomic value move)
 *        - data:    empty
 *        - gas:     user tx gas limit, plus a margin for the sponsor tx itself
 *        - gasPrice: > 0 (builders price bundles by aggregate gas price)
 *      Sign it as a legacy EIP-155 tx on the target chain (968 testnet / 677 mainnet).
 *   3. Build the bundle = [sponsorTx, userTx] ordered so the sponsor tx's gas
 *      payment is included first, then the user tx executes against it.
 *   4. Submit the bundle to MEV builders via the BOT Chain builder RPC
 *      endpoint (TBD once confirmed - do not guess the endpoint, per AGENTS.md).
 *   5. Return the user tx hash (or bundle hash) as `bundleHash`; the caller
 *      surfaces it as the `eth_sendRawTransaction` result.
 *
 * If builder access turns out not to be live, the paymaster's
 * `eth_sendRawTransaction` must instead fall back to `selfpay-fallback.ts`
 * (plain self-paid submission) rather than failing.
 */
export async function submitBundle(_input: BundleSubmission): Promise<BundleResult> {
  throw new BundlerNotReadyError();
}
