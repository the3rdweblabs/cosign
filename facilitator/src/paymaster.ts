// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { parseTransaction, recoverTransactionAddress, type Hex } from "viem";
import type { SponsorPolicy, SponsorableParams } from "./policy.js";
import { BundlerNotReadyError, submitBundle, type BundleSubmission } from "./bundler.js";
import type { X402Adapter } from "./x402-adapter.js";

const JSONRPC_ERROR = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
  SPONSOR_POLICY: -32001,
  BUNDLER: -32000,
} as const;

export class RpcError extends Error {
  readonly code: number;
  readonly data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "RpcError";
    this.code = code;
    this.data = data;
  }
}

const ANSI_RESET = "\x1b[0m";
const ANSI_GREEN = "\x1b[32m";
const ANSI_RED = "\x1b[31m";

const useColor = process.stderr.isTTY || process.env.FORCE_COLOR === "1";

function paint(code: string, text: string): string {
  return useColor ? `${code}${text}${ANSI_RESET}` : text;
}

function summarizeParams(params: unknown): string {
  if (params === undefined) return "";
  const json = JSON.stringify(params, (_key, value: unknown) =>
    typeof value === "string" && value.length > 48 ? `${value.slice(0, 24)}\u2026[${value.length} chars]` : value,
  );
  return ` params=${json}`;
}

function logRequest(ok: boolean, method: string, path: string, detail: string, ms: number, remote?: string): void {
  const line = `[facilitator] ${method} ${path}${detail ? ` ${detail}` : ""} from ${remote ?? "?"} (${ms.toFixed(1)}ms)`;
  console.error(ok ? paint(ANSI_GREEN, line) : paint(ANSI_RED, line));
}

interface JsonRpcRequest {
  jsonrpc: string;
  id: string | number | null;
  method: string;
  params?: unknown;
}

export interface PaymasterOptions {
  policy: SponsorPolicy;
  /** Sponsor EOA key for the paymaster bundle. Optional: when unset the server
   *  still serves pm_isSponsorable, but eth_sendRawTransaction fails with a
   *  clear error (self-pay-only operation). */
  sponsorPrivateKey?: Hex;
  bundler?: (input: BundleSubmission) => Promise<{ bundleHash: Hex }>;
  x402?: X402Adapter;
  /** Surcharge schedule advertised at GET /v1/fee (see fee.ts). */
  feeSchedule?: import("@xbot02/core").FeeSchedule;
}

/**
 * BOT Chain native EOA paymaster (BEP-414-style).
 *
 * Implements exactly the two JSON-RPC methods documented in the BOT Chain
 * EOA Paymaster spec:
 *
 *   pm_isSponsorable({to, from, value, data, gas})
 *     -> { Sponsorable: bool, SponsorPolicy: string }
 *
 *   eth_sendRawTransaction(signedRawTx)
 *     -> 32-byte tx hash (of the bundled user+sponsor tx)
 *
 * The wallet flow (per spec): call pm_isSponsorable first; if sponsorable,
 * set gas price to zero, sign, and submit the raw tx HERE instead of the
 * normal mempool. We never touch a non-zero-gas-price tx.
 */
export function createPaymasterServer(options: PaymasterOptions) {
  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const started = performance.now();
    const path = (req.url ?? "").split("?")[0];
    const method = req.method ?? "?";
    const remote = req.socket.remoteAddress;
    let detail = "";

    const originalEnd = res.end.bind(res);
    res.end = ((...args: unknown[]) => {
      const body = typeof args[0] === "string" ? args[0] : "";
      const ok = !body.includes('"error"');
      logRequest(ok, method, path, detail, performance.now() - started, remote);
      return originalEnd(...(args as never[]));
    }) as unknown as ServerResponse["end"];

    try {
      // Facilitator fee schedule (surcharge the client signs for) - GET /v1/fee
      if (req.method === "GET" && path === "/v1/fee") {
        detail = "fee schedule";
        writeResponse(res, { result: options.feeSchedule ?? { bps: 0, receiver: null, network: null, asset: null } });
        return;
      }

      if (req.method !== "POST") {
        detail = "unsupported method";
        writeResponse(res, { jsonrpc: "2.0", id: null, error: { code: JSONRPC_ERROR.INVALID_REQUEST, message: "Only POST is supported" } });
        return;
      }

      let body = "";

      for await (const chunk of req) body += chunk;

      if (options.x402) {
        if (path === "/verify" || path === "/settle") {
          detail = `${path.slice(1)} request`;
          await handleX402(options.x402, path, body, res);
          return;
        }
      }
      let rpc: JsonRpcRequest;
      try {
        rpc = JSON.parse(body);
      } catch {
        detail = "malformed JSON";
        writeResponse(res, { jsonrpc: "2.0", id: null, error: { code: JSONRPC_ERROR.PARSE, message: "Parse error" } });
        return;
      }
      if (!rpc || typeof rpc !== "object" || rpc.jsonrpc !== "2.0" || !rpc.method) {
        writeResponse(res, { jsonrpc: "2.0", id: null, error: { code: JSONRPC_ERROR.INVALID_REQUEST, message: "Invalid Request" } });
        return;
      }

      detail = `${rpc.method} id=${rpc.id ?? "null"}${summarizeParams(rpc.params)}`;

      try {
        const result = await dispatch(rpc, options);
        writeResponse(res, { jsonrpc: "2.0", id: rpc.id, result });
      } catch (err) {
        if (err instanceof RpcError) {
          writeResponse(res, { jsonrpc: "2.0", id: rpc.id, error: { code: err.code, message: err.message, data: err.data } });
        } else {
          writeResponse(res, {
            jsonrpc: "2.0",
            id: rpc.id,
            error: { code: JSONRPC_ERROR.INTERNAL, message: err instanceof Error ? err.message : "Internal error" },
          });
        }
      }
    } catch (err) {
      if (!res.writableEnded) {
        writeResponse(res, {
          jsonrpc: "2.0",
          id: null,
          error: { code: JSONRPC_ERROR.INTERNAL, message: err instanceof Error ? err.message : "Internal error" },
        });
      }
    }
  };

  return createServer(handler);
}

export async function dispatch(rpc: JsonRpcRequest, options: PaymasterOptions): Promise<unknown> {
  const params = Array.isArray(rpc.params) ? rpc.params : [];

  switch (rpc.method) {
    case "pm_isSponsorable":
      return handleIsSponsorable(options.policy, params);
    case "eth_sendRawTransaction":
      return handleSendRawTransaction(options, params);
    default:
      throw new RpcError(JSONRPC_ERROR.METHOD_NOT_FOUND, `Method not found: ${rpc.method}`);
  }
}

interface X402HttpBody {
  paymentDetails?: unknown;
  paymentPayload?: unknown;
}

async function handleX402(adapter: X402Adapter, path: string, body: string, res: ServerResponse): Promise<void> {
  let parsed: X402HttpBody;
  try {
    parsed = JSON.parse(body) as X402HttpBody;
  } catch {
    writeResponse(res, { error: { code: JSONRPC_ERROR.PARSE, message: "Parse error" } });
    return;
  }
  if (!parsed.paymentDetails || !parsed.paymentPayload) {
    writeResponse(res, { error: { code: JSONRPC_ERROR.INVALID_PARAMS, message: "Expected { paymentDetails, paymentPayload }" } });
    return;
  }

  const request = {
    paymentDetails: parsed.paymentDetails,
    paymentPayload: parsed.paymentPayload,
  } as Parameters<X402Adapter["verify"]>[0];

  try {
    const result = path === "/verify" ? await adapter.verify(request) : await adapter.settle(request);
    writeResponse(res, { result });
  } catch (err) {
    if (res.writableEnded) return;
    writeResponse(res, { error: { code: JSONRPC_ERROR.INTERNAL, message: err instanceof Error ? err.message : "Internal error" } });
  }
}

async function handleIsSponsorable(policy: SponsorPolicy, params: unknown[]): Promise<{ Sponsorable: boolean; SponsorPolicy: string }> {
  const tx = params[0] as Partial<SponsorableParams> | undefined;
  if (!tx || typeof tx !== "object") {
    throw new RpcError(JSONRPC_ERROR.INVALID_PARAMS, "pm_isSponsorable expects a tx object");
  }
  for (const field of ["to", "from", "value"] as const) {
    if (typeof tx[field] !== "string") {
      throw new RpcError(JSONRPC_ERROR.INVALID_PARAMS, `pm_isSponsorable expects "${field}" as hex string`);
    }
  }
  return policy.checkSponsorable(tx as SponsorableParams);
}

async function handleSendRawTransaction(options: PaymasterOptions, params: unknown[]): Promise<Hex> {
  const raw = params[0];
  if (typeof raw !== "string" || !raw.startsWith("0x")) {
    throw new RpcError(JSONRPC_ERROR.INVALID_PARAMS, "eth_sendRawTransaction expects a signed raw tx (0x-prefixed hex)");
  }

  if (!options.sponsorPrivateKey) {
    throw new RpcError(
      JSONRPC_ERROR.BUNDLER,
      "Sponsor not configured: set SPONSOR_PRIVATE_KEY (paymaster sponsorship disabled)",
    );
  }

  let tx;
  try {
    tx = parseTransaction(raw as Hex);
  } catch {
    throw new RpcError(JSONRPC_ERROR.INVALID_PARAMS, "Could not parse raw transaction");
  }

  const gasPrice = effectiveGasPrice(tx);
  if (gasPrice !== 0n) {
    throw new RpcError(JSONRPC_ERROR.SPONSOR_POLICY, "Transaction gas price must be zero for sponsorship");
  }

  let from: Hex;
  try {
    from = await recoverTransactionAddress({ serializedTransaction: raw as Hex } as never);
  } catch {
    throw new RpcError(JSONRPC_ERROR.INVALID_PARAMS, "Transaction sender (from) could not be recovered");
  }

  const to = tx.to ?? "0x";
  const value = tx.value ?? 0n;

  const verdict = await options.policy.checkSponsorable({
    to,
    from,
    value: `0x${value.toString(16)}`,
  });
  if (!verdict.Sponsorable) {
    throw new RpcError(
      JSONRPC_ERROR.SPONSOR_POLICY,
      `Sponsor policy "${verdict.SponsorPolicy}" rejected this transaction`,
    );
  }

  try {
    const bundler = options.bundler ?? submitBundle;
    const { bundleHash } = await bundler({ userRawTx: raw as Hex, sponsorPrivateKey: options.sponsorPrivateKey });
    return bundleHash;
  } catch (err) {
    if (err instanceof BundlerNotReadyError) {
      throw new RpcError(JSONRPC_ERROR.BUNDLER, err.message);
    }
    throw err;
  }
}

function effectiveGasPrice(tx: ReturnType<typeof parseTransaction>): bigint {
  const gasPrice = (tx as { gasPrice?: bigint }).gasPrice;
  if (gasPrice !== undefined) return gasPrice;

  const maxFeePerGas = (tx as { maxFeePerGas?: bigint }).maxFeePerGas;
  if (maxFeePerGas !== undefined) return maxFeePerGas;

  return 0n;
}

function writeResponse(res: ServerResponse, payload: unknown): void {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(payload, (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value)));
}
