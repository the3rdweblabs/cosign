// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import { useEffect, useState } from "react";
import type { Address } from "viem";
import { actionTypeLabel, chainConfig, formatAmount, shortAddress, timeAgo } from "./chain";
import { StatusBadge } from "./StatusBadge";
import type { ConsentRequestRecord } from "./hooks/useConsent";

interface ActivityFeedProps {
  requests: ConsentRequestRecord[];
  loading: boolean;
  error: string | null;
  lastEventAt: number | null;
  refresh: () => Promise<void>;
}

export function ActivityFeed({ requests, loading, error, lastEventAt, refresh }: ActivityFeedProps) {
  const [now, setNow] = useState(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);

  const doRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Activity feed</h2>
          <p className="text-sm text-slate-400">
            Every consent request and its status, live off ConsentGateway events on BOT Chain {chainConfig.network}.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastEventAt !== null && (
            <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
              </span>
              live
            </span>
          )}
          <button
            onClick={() => void doRefresh()}
            disabled={refreshing}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-300 transition hover:border-slate-500 hover:text-white disabled:opacity-50"
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded-lg border border-rose-900 bg-rose-950/50 p-4 text-sm text-rose-400">{error}</p>
      )}

      {loading ? (
        <div className="mt-6 rounded-lg border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">
          Loading requests from the chain…
        </div>
      ) : requests.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">
          No consent requests yet. Fire an agent action and watch it appear here.
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-lg border border-slate-700">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-800/60 text-xs uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3 font-medium">Request</th>
                <th className="px-4 py-3 font-medium">Agent</th>
                <th className="px-4 py-3 font-medium">To</th>
                <th className="px-4 py-3 font-medium">Action</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Requested</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <FeedRow key={r.requestId.toString()} request={r} now={now} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function FeedRow({ request, now }: { request: ConsentRequestRecord; now: number }) {
  const requestedMs = Number(request.requestedAt) * 1000;
  return (
    <tr className="border-b border-slate-800 last:border-0 hover:bg-slate-800/30">
      <td className="px-4 py-3 font-mono font-semibold text-white">#{request.requestId.toString()}</td>
      <td className="px-4 py-3">
        <a
          href={`${chainConfig.explorerUrl}/address/${request.agent}`}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-slate-300 hover:text-white"
        >
          {shortAddress(request.agent as Address)}
        </a>
      </td>
      <td className="px-4 py-3 font-mono text-slate-400">{shortAddress(request.target)}</td>
      <td className="px-4 py-3 text-slate-300">{actionTypeLabel(request.actionType)}</td>
      <td className="px-4 py-3 font-mono text-slate-300">{formatAmount(request.amount, chainConfig.network === "mainnet" ? "BOT" : "tBOT")}</td>
      <td className="px-4 py-3">
        <StatusBadge status={request.status} />
      </td>
      <td className="px-4 py-3 text-slate-400">{timeAgo(requestedMs, now)}</td>
    </tr>
  );
}
