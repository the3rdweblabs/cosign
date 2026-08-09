// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import type { Address } from "viem";

/**
 * Facilitator surcharge schedule, advertised at `GET {facilitator}/v1/fee`.
 *
 * The facilitator charges the CLIENT a fee on top of the resource price, as a
 * SECOND direct wallet-to-wallet transfer to `receiver` (same no-custody model
 * as the payment itself - no fee-collector contract). `bps` is in basis
 * points (100 = 1%). `bps <= 0` means no fee.
 */
export interface FeeSchedule {
  bps: number;
  receiver: Address | null;
  network: string;
  asset: string;
}

/**
 * Fee owed for a payment, in wei. Rounded UP so the facilitator never collects
 * less than the advertised rate: ceil(amount * bps / 10000).
 */
export function computeFeeAmount(bps: number, amount: bigint): bigint {
  if (bps <= 0) return 0n;
  return (amount * BigInt(bps) + 9999n) / 10000n;
}
