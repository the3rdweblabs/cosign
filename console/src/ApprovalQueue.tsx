// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import { useState } from "react";
import type { Address } from "viem";
import { chainConfig, formatAmount, shortAddress, type RequestStatus } from "./chain";
import { StatusBadge } from "./StatusBadge";
import type { ConsentRequestRecord } from "./hooks/useConsent";

interface ApprovalQueueProps {
  requests: ConsentRequestRecord[];
  connectedAddress: Address | null;
  submitDecision: (requestId: bigint, decision: "approve" | "reject") => Promise<string>;
  busy: bigint | null;
  connectWallet: () => Promise<void>;
}

const PENDING: RequestStatus = "Pending";

export function ApprovalQueue({ requests, connectedAddress, submitDecision, busy, connectWallet }: ApprovalQueueProps) {
  const [result, setResult] = useState<{ requestId: bigint; txHash: string } | null>(null);
  const pending = requests.filter((r) => r.status === PENDING).sort((a, b) => (a.requestId > b.requestId ? -1 : 1));

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Approval queue</h2>
          <p className="text-sm text-slate-400">
            High-risk or out-of-policy agent actions waiting for a guardian co-sign.
          </p>
        </div>
        <button
          onClick={() => void connectWallet()}
          className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-slate-200"
        >
          {connectedAddress ? `Guardian: ${shortAddress(connectedAddress)}` : "Connect wallet"}
        </button>
      </div>

      {!connectedAddress && (
        <p className="mt-4 rounded-lg border border-slate-700 bg-slate-800/50 p-4 text-sm text-slate-300">
          Connect your wallet to review and co-sign pending agent requests. Only the agent's registered guardian can approve or reject.
        </p>
      )}

      {result && (
        <p className="mt-4 rounded-lg border border-slate-700 bg-slate-800/50 p-3 text-sm text-emerald-400">
          Submitted #{result.requestId.toString()} - tx {shortAddress(result.txHash as Address)}
        </p>
      )}

      <div className="mt-6 space-y-3">
        {pending.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">
            No pending requests. The queue is clear.
          </div>
        ) : (
          pending.map((r) => (
            <RequestRow
              key={r.requestId.toString()}
              request={r}
              connectedAddress={connectedAddress}
              submitDecision={submitDecision}
              busy={busy}
              onSubmitted={(txHash) => setResult({ requestId: r.requestId, txHash })}
            />
          ))
        )}
      </div>
    </section>
  );
}

function RequestRow({
  request,
  connectedAddress,
  submitDecision,
  busy,
  onSubmitted,
}: {
  request: ConsentRequestRecord;
  connectedAddress: Address | null;
  submitDecision: (requestId: bigint, decision: "approve" | "reject") => Promise<string>;
  busy: bigint | null;
  onSubmitted: (txHash: string) => void;
}) {
  const isGuardian = connectedAddress !== null && request.guardian !== undefined && connectedAddress.toLowerCase() === request.guardian.toLowerCase();
  const isBusy = busy === request.requestId;

  const decide = async (decision: "approve" | "reject") => {
    const txHash = await submitDecision(request.requestId, decision);
    onSubmitted(txHash);
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-700 bg-slate-800/40 p-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold text-white">#{request.requestId.toString()}</span>
          <StatusBadge status={request.status} />
        </div>
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-sm">
          <dt className="text-slate-500">Agent</dt>
          <dd className="font-mono text-slate-300">{shortAddress(request.agent)}</dd>
          <dt className="text-slate-500">To</dt>
          <dd className="font-mono text-slate-300">{shortAddress(request.target)}</dd>
          <dt className="text-slate-500">Amount</dt>
          <dd className="font-mono text-slate-300">{formatAmount(request.amount)}</dd>
          <dt className="text-slate-500">Guardian</dt>
          <dd className="font-mono text-slate-300">
            {request.guardian ? shortAddress(request.guardian) : <span className="text-slate-500">unknown (registry unset?)</span>}
          </dd>
        </dl>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {isBusy ? (
          <span className="animate-pulse text-sm text-slate-400">broadcasting…</span>
        ) : (
          <>
            <button
              onClick={() => void decide("approve")}
              disabled={!isGuardian}
              title={isGuardian ? "Approve and record spend" : "Only the registered guardian can approve"}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
            >
              Approve
            </button>
            <button
              onClick={() => void decide("reject")}
              disabled={!isGuardian}
              title={isGuardian ? "Reject this request" : "Only the registered guardian can reject"}
              className="rounded-lg bg-rose-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-600 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
            >
              Reject
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function consentGatewayConfigError(): string | null {
  if (!chainConfig.consentGatewayAddress)
    return `Missing VITE_CONSENT_GATEWAY_ADDRESS_${chainConfig.network.toUpperCase()} (or unsuffixed) in console/.env`;
  if (!chainConfig.agentRegistryAddress)
    return `Missing VITE_AGENT_REGISTRY_ADDRESS_${chainConfig.network.toUpperCase()} (or unsuffixed) in console/.env`;
  return null;
}
