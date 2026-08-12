// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPublicClient, http, type PublicClient } from "viem";
import { fetchRequests, watchGateway, type ConsentRequestRecord } from "@xbot02/guardian";
import { chainConfig, chain } from "../chain";

// Consumers (ApprovalQueue, ActivityFeed) type against the same record shape.
export { type ConsentRequestRecord } from "@xbot02/guardian";

interface UseConsentReturn {
  requests: ConsentRequestRecord[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  lastEventAt: number | null;
}

export function useConsent(): UseConsentReturn {
  const gatewayAddress = chainConfig.consentGatewayAddress;
  const registryAddress = chainConfig.agentRegistryAddress;
  const fromBlock = chainConfig.fromBlock;

  const publicClient = useMemo<PublicClient | null>(
    () =>
      createPublicClient({
        chain,
        transport: http(chainConfig.rpcUrl),
      }),
    [],
  );

  const [records, setRecords] = useState<Map<string, ConsentRequestRecord>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);

  const recordsRef = useRef<Map<string, ConsentRequestRecord>>(new Map());
  const teardownRef = useRef<(() => void) | null>(null);

  const setRecordsBoth = useCallback((next: Map<string, ConsentRequestRecord>) => {
    recordsRef.current = next;
    setRecords(new Map(next));
  }, []);

  const upsert = useCallback(
    (record: ConsentRequestRecord) => {
      const next = new Map(recordsRef.current);
      next.set(record.requestId.toString(), record);
      setRecordsBoth(next);
    },
    [setRecordsBoth],
  );

  useEffect(() => {
    if (!publicClient || !gatewayAddress) {
      setLoading(false);
      return;
    }

    let disposed = false;
    // Backfilled records arrive before watchGateway resolves; only events
    // after that are "live", so lastEventAt reflects real-time activity.
    let live = false;

    const handle = (record: ConsentRequestRecord) => {
      if (disposed) return;
      upsert(record);
      if (live) setLastEventAt(Date.now());
    };

    watchGateway({
      client: publicClient,
      gatewayAddress,
      registryAddress,
      fromBlock,
      pollMs: 2000,
      onRequest: handle,
      onError: (err) => {
        if (!disposed) setError(err.message);
      },
    })
      .then((teardown) => {
        if (disposed) {
          teardown();
          return;
        }
        live = true;
        teardownRef.current = teardown;
        setLoading(false);
      })
      .catch((err) => {
        if (disposed) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });

    return () => {
      disposed = true;
      teardownRef.current?.();
      teardownRef.current = null;
    };
  }, [publicClient, gatewayAddress, registryAddress, fromBlock, upsert]);

  const refresh = useCallback(async () => {
    if (!publicClient || !gatewayAddress) return;
    setError(null);
    try {
      const all = await fetchRequests({ client: publicClient, gatewayAddress, registryAddress, fromBlock });
      const next = new Map(recordsRef.current);
      for (const record of all) next.set(record.requestId.toString(), record);
      setRecordsBoth(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [publicClient, gatewayAddress, registryAddress, fromBlock, setRecordsBoth]);

  const requests = useMemo(
    () => [...records.values()].sort((a, b) => (a.requestId > b.requestId ? -1 : 1)),
    [records],
  );

  return { requests, loading, error, refresh, lastEventAt };
}
