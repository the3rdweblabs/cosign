// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { approveRequest, expireRequest, fetchRequests, rejectRequest } from "@xbot02/guardian";
import type { WalletSource } from "@xbot02/core";
import type { Address } from "viem";
import { recordToJson } from "./json.js";
import { registerLogged, RequestLog } from "./request-log.js";

export interface GuardianServerDeps {
  /** The guardian's signing wallet (any source: private-key, mnemonic, or remote json-rpc signer). */
  source: WalletSource;
  consentGatewayAddress: Address;
  /** Optional - includes each request's guardian address in listings. */
  registryAddress?: Address;
  /** Optional - backfill start block for pending_requests (default 0). */
  fromBlock?: bigint;
  /** Shared request log. Defaults to a fresh in-memory log. */
  log?: RequestLog;
}

const OK = (text: string): CallToolResult => ({ content: [{ type: "text", text }] });
const ERR = (text: string): CallToolResult => ({ content: [{ type: "text", text }], isError: true });

const requestIdSchema = z.object({ requestId: z.string().describe("Numeric request id as a string") });

/**
 * Builds the Cosign **guardian** MCP server: tools that let any MCP client act
 * as the human oversight for agent spending - approve/reject/expire pending
 * consent requests and list what's waiting for a decision.
 *
 * Every request is recorded in the server's RequestLog and streamed live to
 * connected clients (see `request_log` and the notifications/message stream).
 */
export function createGuardianServer(deps: GuardianServerDeps): McpServer {
  const { source, consentGatewayAddress } = deps;
  const log = deps.log ?? new RequestLog();
  const options = { wallet: source.walletClient, gatewayAddress: consentGatewayAddress };

  const server = new McpServer({ name: "xbot02-guardian", version: "0.1.0" }, { capabilities: { logging: {} } });

  const decision = (
    name: "approve_request" | "reject_request" | "expire_request",
    description: string,
    fn: (requestId: bigint) => Promise<Address | string>,
  ) =>
    registerLogged(
      server,
      log,
      name,
      {
        title: description,
        description: `${description} Pending request.`,
        inputSchema: requestIdSchema,
      },
      async (args, _extra) => {
        const a = args as Record<string, unknown>;
        try {
          const requestId = BigInt(String(a.requestId));
          const txHash = await fn(requestId);
          return OK(JSON.stringify({ requestId: requestId.toString(), txHash }, null, 2));
        } catch (err) {
          return ERR(err instanceof Error ? err.message : String(err));
        }
      },
    );

  decision("approve_request", "Approve a pending consent request (guardian co-signs)", (requestId) => approveRequest(options, requestId));
  decision("reject_request", "Reject a pending consent request", (requestId) => rejectRequest(options, requestId));
  decision("expire_request", "Expire an overdue pending consent request", (requestId) => expireRequest(options, requestId));

  registerLogged(
    server,
    log,
    "pending_requests",
    {
      title: "List pending consent requests",
      description: "Backfills all known consent requests and returns the ones still waiting on a guardian decision.",
      inputSchema: z.object({}),
    },
    async (_args, _extra) => {
      try {
        const records = await fetchRequests({
          client: source.publicClient,
          gatewayAddress: consentGatewayAddress,
          registryAddress: deps.registryAddress,
          fromBlock: deps.fromBlock,
        });
        const pending = records.filter((r) => r.status === "Pending");
        return OK(JSON.stringify({ count: pending.length, requests: pending.map(recordToJson) }, null, 2));
      } catch (err) {
        return ERR(err instanceof Error ? err.message : String(err));
      }
    },
  );

  registerLogged(
    server,
    log,
    "request_log",
    {
      title: "Live request log",
      description: "Return the most recent requests this server has handled - the live activity log anyone connected can read.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(200).optional().describe("Max entries (default 50)") }),
    },
    async (args, _extra) => {
      const a = args as Record<string, unknown>;
      const limit = typeof a.limit === "number" ? a.limit : 50;
      return OK(JSON.stringify(log.recent(limit), null, 2));
    },
  );

  return server;
}
