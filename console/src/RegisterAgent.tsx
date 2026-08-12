// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import { useMemo, useState } from "react";
import { createPublicClient, http, isAddress, parseEther, type Address, type WalletClient } from "viem";
import { getAgentPolicy, registerAgent, type AgentPolicy } from "@xbot02/guardian";
import { chain, chainConfig, formatAmount, shortAddress } from "./chain";

interface RegisterAgentProps {
  connectedAddress: Address | null;
  walletClient: WalletClient | null;
  connectWallet: () => Promise<void>;
  ensureChain: () => Promise<void>;
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * Register an agent under the connected guardian's policy (spend cap per
 * rolling period). Writes go through @xbot02/guardian's registerAgent, and
 * the live policy lookup uses getAgentPolicy from the same SDK.
 */
export function RegisterAgent({ connectedAddress, walletClient, connectWallet, ensureChain }: RegisterAgentProps) {
  const [agent, setAgent] = useState("");
  const [cap, setCap] = useState("2");
  const [period, setPeriod] = useState("86400");
  const [policy, setPolicy] = useState<AgentPolicy | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const publicClient = useMemo(() => createPublicClient({ chain, transport: http(chainConfig.rpcUrl) }), []);

  const registryAddress = chainConfig.agentRegistryAddress;
  const gatewayAddress = chainConfig.consentGatewayAddress;

  const lookup = async () => {
    setError(null);
    if (!isAddress(agent)) {
      setError("Enter a valid agent address.");
      return;
    }
    if (!registryAddress) {
      setError("Agent registry not configured - set VITE_AGENT_REGISTRY_ADDRESS_<NETWORK> in console/.env.");
      return;
    }
    try {
      setPolicy(await getAgentPolicy(publicClient, registryAddress, agent as Address));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const submit = async () => {
    setError(null);
    setTxHash(null);
    if (!connectedAddress || !walletClient) {
      setError("Connect your wallet first.");
      return;
    }
    if (!registryAddress || !gatewayAddress) {
      setError("Registry/gateway not configured - set VITE_AGENT_REGISTRY_ADDRESS_<NETWORK> and VITE_CONSENT_GATEWAY_ADDRESS_<NETWORK> in console/.env.");
      return;
    }
    if (!isAddress(agent)) {
      setError("Enter a valid agent address.");
      return;
    }
    let capWei: bigint;
    let periodSeconds: bigint;
    try {
      capWei = parseEther(cap);
      periodSeconds = BigInt(period);
    } catch {
      setError("Spend cap and period must be numbers.");
      return;
    }
    if (capWei <= 0n || periodSeconds <= 0n) {
      setError("Spend cap and period must be positive.");
      return;
    }
    setBusy(true);
    try {
      await ensureChain();
      const hash = await registerAgent(
        { wallet: walletClient, gatewayAddress, registryAddress },
        agent as Address,
        capWei,
        periodSeconds,
      );
      setTxHash(hash);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const inputClass =
    "mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none";

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Register agent</h2>
          <p className="text-sm text-slate-400">
            Give an agent a spend policy (cap per rolling period). The connected wallet becomes its guardian.
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
          Connect your wallet to register agents. Only an agent's registered guardian can manage it.
        </p>
      )}

      {error && (
        <p className="mt-4 rounded-lg border border-rose-900 bg-rose-950/50 p-3 text-sm text-rose-400">{error}</p>
      )}

      {txHash && (
        <p className="mt-4 rounded-lg border border-slate-700 bg-slate-800/50 p-3 text-sm text-emerald-400">
          Registered - tx{" "}
          <a
            href={`${chainConfig.explorerUrl}/tx/${txHash}`}
            target="_blank"
            rel="noreferrer"
            className="font-mono underline"
          >
            {shortAddress(txHash as Address)}
          </a>
        </p>
      )}

      <div className="mt-6 space-y-3">
        <div className="rounded-lg border border-slate-700 bg-slate-800/40 p-4">
          <label className="block text-sm font-medium text-slate-300">Agent address</label>
          <input
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
            placeholder="0x…"
            className={`font-mono ${inputClass}`}
          />

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-slate-300">Spend cap (tBOT per period)</label>
              <input
                value={cap}
                onChange={(e) => setCap(e.target.value)}
                type="number"
                min="0"
                step="any"
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300">Period (seconds)</label>
              <input
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                type="number"
                min="1"
                className={inputClass}
              />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={() => void lookup()}
              className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-700"
            >
              Check policy
            </button>
            <button
              onClick={() => void submit()}
              disabled={busy || !connectedAddress}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
            >
              {busy ? "broadcasting…" : "Register agent"}
            </button>
          </div>
        </div>

        {policy && (
          <div className="rounded-lg border border-slate-700 bg-slate-800/40 p-4 text-sm">
            <p className="font-semibold text-white">Policy for {shortAddress(agent as Address)}</p>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
              <dt className="text-slate-500">Guardian</dt>
              <dd className="font-mono text-slate-300">
                {policy.guardian === ZERO_ADDRESS ? "- not registered" : shortAddress(policy.guardian)}
              </dd>
              <dt className="text-slate-500">Spend cap</dt>
              <dd className="font-mono text-slate-300">
                {formatAmount(policy.spendCap)} per {policy.periodSeconds.toString()}s
              </dd>
              <dt className="text-slate-500">Spent this period</dt>
              <dd className="font-mono text-slate-300">{formatAmount(policy.spentInPeriod)}</dd>
              <dt className="text-slate-500">Active</dt>
              <dd className="font-mono text-slate-300">{policy.active ? "yes" : "no"}</dd>
            </dl>
          </div>
        )}
      </div>
    </section>
  );
}
