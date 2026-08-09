// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import type { ConsentRequestRecord } from "@xbot02/guardian";

/** Serializes a consent request record to a JSON-safe shape (bigints -> strings). */
export function recordToJson(record: ConsentRequestRecord): Record<string, unknown> {
  return {
    requestId: record.requestId.toString(),
    agent: record.agent,
    target: record.target,
    amount: record.amount.toString(),
    actionType: record.actionType,
    requestedAt: record.requestedAt.toString(),
    status: record.status,
    ...(record.guardian ? { guardian: record.guardian } : {}),
  };
}
