// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import { useCallback, useEffect, useMemo, useState } from "react";
import { createWalletClient, custom, type Address, type WalletClient } from "viem";
import { chain } from "../chain";

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on?: (event: string, handler: (...args: unknown[]) => void) => void;
      removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
    };
  }
}

interface UseWalletReturn {
  address: Address | null;
  walletClient: WalletClient | null;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  ensureChain: () => Promise<void>;
}

/**
 * Guardian wallet connection. Talks to the browser's injected provider
 * (MetaMask / Bo Wallet) over EIP-1193, with a one-time switch to the active
 * BOT network so approve/reject txs are mined on the right chain.
 */
export function useWallet(): UseWalletReturn {
  const [address, setAddress] = useState<Address | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ethereum = window.ethereum;

  const walletClient = useMemo<WalletClient | null>(
    () => (ethereum ? createWalletClient({ chain, transport: custom(ethereum) }) : null),
    [ethereum],
  );

  const ensureChain = useCallback(async () => {
    if (!ethereum) throw new Error("No injected wallet found");
    try {
      await ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: `0x${chain.id.toString(16)}` }],
      });
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code === 4902) {
        const explorerUrl = chain.blockExplorers?.default?.url;
        await ethereum.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: `0x${chain.id.toString(16)}`,
              chainName: chain.name,
              nativeCurrency: chain.nativeCurrency,
              rpcUrls: chain.rpcUrls.default.http,
              blockExplorerUrls: explorerUrl ? [explorerUrl] : undefined,
            },
          ],
        });
      } else {
        throw err;
      }
    }
  }, [ethereum]);

  const connect = useCallback(async () => {
    setError(null);
    if (!walletClient) {
      setError("No injected wallet detected. Install MetaMask or Bo Wallet.");
      return;
    }
    try {
      const [account] = await walletClient.requestAddresses();
      await ensureChain();
      setAddress(account ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [walletClient, ensureChain]);

  const disconnect = useCallback(() => setAddress(null), []);

  useEffect(() => {
    if (!ethereum?.on) return;
    const onAccountsChanged = (...args: unknown[]) => {
      const accounts = args[0] as string[] | undefined;
      setAddress(accounts?.[0] ? (accounts[0] as Address) : null);
    };
    ethereum.on("accountsChanged", onAccountsChanged);
    return () => ethereum.removeListener?.("accountsChanged", onAccountsChanged);
  }, [ethereum]);

  return { address, walletClient, error, connect, disconnect, ensureChain };
}
