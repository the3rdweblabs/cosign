// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

/** Canonical Status enum -> label mapping, mirroring ConsentGateway.Status. */
export const requestStatus = {
  0: "None",
  1: "AutoApproved",
  2: "Pending",
  3: "Approved",
  4: "Rejected",
  5: "Expired",
} as const;
export type RequestStatus = (typeof requestStatus)[keyof typeof requestStatus];

export const statusNum = Object.fromEntries(
  Object.entries(requestStatus).map(([k, v]) => [v, Number(k)]),
) as Record<RequestStatus, number>;

/** The Status enum order the contract stores. */
export const statusOrder: RequestStatus[] = ["None", "AutoApproved", "Pending", "Approved", "Rejected", "Expired"];
