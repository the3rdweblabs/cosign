// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import { keccak256, stringToHex, type Address, type Hex } from "viem";

/** Maps a bytes32 actionType hash back to the friendly label we know about. */
export function actionTypeLabel(actionType: Hex): string {
  const known: Array<[string, string]> = [
    ["PAYMENT", "Payment"],
    ["HUBOT_TRIGGER", "HuBot trigger"],
  ];
  for (const [raw, label] of known) {
    if (keccak256(stringToHex(raw, { size: 32 })) === actionType) return label;
  }
  return `${actionType.slice(0, 10)}…`;
}

export function formatAmount(wei: bigint): string {
  const eth = Number(wei) / 1e18;
  if (eth >= 1) return `${eth.toLocaleString(undefined, { maximumFractionDigits: 4 })} tBOT`;
  return `${eth.toLocaleString(undefined, { maximumFractionDigits: 6 })} tBOT`;
}

export function shortAddress(address: Address): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function timeAgo(timestampMs: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - timestampMs) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
