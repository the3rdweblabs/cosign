// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import { useState } from "react";
import { consentGatewayAbi, botChainTestnet, chainConfig, shortAddress } from "./chain";
import { useConsent } from "./hooks/useConsent";
import { useWallet } from "./hooks/useWallet";
import { ApprovalQueue, consentGatewayConfigError } from "./ApprovalQueue";
import { ActivityFeed } from "./ActivityFeed";
import { RegisterAgent } from "./RegisterAgent";

type Tab = "approvals" | "activity" | "agents";

export default function App() {
  const consent = useConsent();
  const wallet = useWallet();
  const [tab, setTab] = useState<Tab>("approvals");
  const [busy, setBusy] = useState<bigint | null>(null);

  const submitDecision = async (requestId: bigint, decision: "approve" | "reject"): Promise<string> => {
    if (!wallet.walletClient || !wallet.address) throw new Error("Connect your wallet first");
    if (!chainConfig.consentGatewayAddress) throw new Error("Consent gateway not configured");
    setBusy(requestId);
    try {
      await wallet.ensureChain();
      const txHash = await wallet.walletClient.writeContract({
        chain: botChainTestnet,
        account: wallet.address,
        address: chainConfig.consentGatewayAddress,
        abi: consentGatewayAbi,
        functionName: decision,
        args: [requestId],
      });
      return txHash;
    } finally {
      setBusy(null);
    }
  };

  const configError = consentGatewayConfigError();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/70 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-sky-500 font-mono text-sm font-bold text-slate-950">
              C
            </span>
            <div>
              <h1 className="text-base font-bold leading-tight text-white">Cosign Console</h1>
              <p className="text-xs text-slate-400">BOT Chain testnet · chain 968</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs">
            {wallet.address && (
              <span className="rounded-full border border-slate-700 px-3 py-1 font-mono text-slate-300">
                {shortAddress(wallet.address)}
              </span>
            )}
            {chainConfig.consentGatewayAddress && (
              <a
                href={`https://scan.bohr.life/address/${chainConfig.consentGatewayAddress}`}
                target="_blank"
                rel="noreferrer"
                className="hidden rounded-full border border-slate-700 px-3 py-1 font-mono text-slate-400 hover:text-white sm:inline"
              >
                gateway {shortAddress(chainConfig.consentGatewayAddress)}
              </a>
            )}
          </div>
        </div>

        {configError && (
          <div className="mx-auto max-w-5xl px-4 pb-3">
            <p className="rounded-lg border border-amber-900 bg-amber-950/50 px-4 py-2 text-sm text-amber-400">
              {configError} - copy <code className="font-mono">.env.example</code> to <code className="font-mono">.env</code> and fill in the deployed contract addresses.
            </p>
          </div>
        )}

        <nav className="mx-auto flex max-w-5xl gap-1 px-4">
          <TabButton active={tab === "approvals"} onClick={() => setTab("approvals")}>
            Approvals{consent.requests.some((r) => r.status === "Pending") ? ` (${consent.requests.filter((r) => r.status === "Pending").length})` : ""}
          </TabButton>
          <TabButton active={tab === "activity"} onClick={() => setTab("activity")}>
            Activity
          </TabButton>
          <TabButton active={tab === "agents"} onClick={() => setTab("agents")}>
            Agents
          </TabButton>
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        {tab === "approvals" ? (
          <ApprovalQueue
            requests={consent.requests}
            connectedAddress={wallet.address}
            submitDecision={submitDecision}
            busy={busy}
            connectWallet={wallet.connect}
          />
        ) : tab === "activity" ? (
          <ActivityFeed
            requests={consent.requests}
            loading={consent.loading}
            error={consent.error}
            lastEventAt={consent.lastEventAt}
            refresh={consent.refresh}
          />
        ) : (
          <RegisterAgent
            connectedAddress={wallet.address}
            walletClient={wallet.walletClient}
            connectWallet={wallet.connect}
            ensureChain={wallet.ensureChain}
          />
        )}
      </main>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`border-b-2 px-4 py-2.5 text-sm font-medium transition ${
        active
          ? "border-emerald-400 text-white"
          : "border-transparent text-slate-400 hover:border-slate-600 hover:text-slate-200"
      }`}
    >
      {children}
    </button>
  );
}
