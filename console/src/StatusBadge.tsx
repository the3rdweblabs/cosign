// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import type { RequestStatus } from "./chain";

const STYLES: Record<RequestStatus, string> = {
  None: "bg-slate-500/15 text-slate-400 ring-slate-500/30",
  AutoApproved: "bg-emerald-500/15 text-emerald-400 ring-emerald-500/30",
  Pending: "bg-amber-500/15 text-amber-400 ring-amber-500/30",
  Approved: "bg-sky-500/15 text-sky-400 ring-sky-500/30",
  Rejected: "bg-rose-500/15 text-rose-400 ring-rose-500/30",
  Expired: "bg-slate-500/15 text-slate-400 ring-slate-500/30",
};

export function StatusBadge({ status }: { status: RequestStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${STYLES[status]}`}>
      {status}
    </span>
  );
}
