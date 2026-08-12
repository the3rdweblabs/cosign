// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { agentRegistryAbi, ConsentClient, type WalletSource } from "@xbot02/core";
import { withBOT02 } from "@xbot02/fetch";
import { expireRequest } from "@xbot02/guardian";
import type { Address, LocalAccount } from "viem";
import { registerLogged, RequestLog } from "./request-log.js";

export interface AgentServerDeps {
  /** Where this agent's spending authority comes from (private-key, mnemonic, or remote json-rpc signer). */
  source: WalletSource;
  consentGatewayAddress: Address;
  /** Optional - enables get_policy. */
  registryAddress?: Address;
  /** Optional - required only for the pay_uri tool. */
  facilitatorUrl?: string;
  /** Override the underlying fetch (defaults to global fetch). */
  baseFetch?: typeof fetch;
  /** Shared request log. Defaults to a fresh in-memory log. */
  log?: RequestLog;
}

const OK = (text: string): CallToolResult => ({ content: [{ type: "text", text }] });
const ERR = (text: string): CallToolResult => ({ content: [{ type: "text", text }], isError: true });

const requestIdSchema = z.object({ requestId: z.string().describe("Numeric request id as a string") });

/**
 * Builds the Cosign **agent** MCP server: tools that let any MCP client act as
 * an agent with an on-chain wallet whose spending is bounded by the consent
 * layer (in-policy actions auto-approve, high-risk ones wait for a human
 * guardian), and optionally pay x402 bills through the facilitator.
 *
 * Every request is recorded in the server's RequestLog and streamed live to
 * connected clients (see `request_log` and the notifications/message stream).
 */
export function createAgentServer(deps: AgentServerDeps): McpServer {
  const { source, consentGatewayAddress } = deps;
  const log = deps.log ?? new RequestLog();

  const consent = new ConsentClient({
    walletClient: source.walletClient,
    publicClient: source.publicClient,
    consentGatewayAddress,
    logSink: () => undefined,
  });

  const server = new McpServer({ name: "xbot02-agent", version: "0.1.0" }, { capabilities: { logging: {} } });

  registerLogged(
    server,
    log,
    "request_action",
    {
      title: "Request an action",
      description:
        "Register an on-chain consent request from the agent wallet. In-policy actions are auto-approved; " +
        "high-risk ones are parked Pending until the guardian approves from their own wallet. " +
        "Returns the requestId and whether it needs human approval.",
      inputSchema: z.object({
        target: z.string().describe("Recipient address"),
        amount: z.string().describe("Amount in wei as a decimal string"),
        actionType: z.string().describe('e.g. "PAYMENT" or "HUBOT_TRIGGER"'),
        justification: z.string().optional().describe("Why the agent is acting"),
        task: z.string().optional().describe("The task being performed"),
      }),
    },
    async (args, _extra) => {
      const a = args as Record<string, unknown>;
      try {
        const amount = BigInt(String(a.amount));
        const outcome = await consent.requestAction({
          target: a.target as Address,
          amount,
          actionType: String(a.actionType),
          justification: typeof a.justification === "string" ? a.justification : "",
          task: typeof a.task === "string" ? a.task : "",
        });
        return OK(
          JSON.stringify(
            {
              requestId: outcome.requestId.toString(),
              autoApproved: outcome.autoApproved,
              status: outcome.autoApproved ? "AutoApproved" : "Pending",
              txHash: outcome.txHash,
            },
            null,
            2,
          ),
        );
      } catch (err) {
        return ERR(err instanceof Error ? err.message : String(err));
      }
    },
  );

  registerLogged(
    server,
    log,
    "check_status",
    {
      title: "Check a request's status",
      description: "Read the current on-chain status of a consent request (AutoApproved, Pending, Approved, Rejected, Expired).",
      inputSchema: requestIdSchema,
    },
    async (args, _extra) => {
      const a = args as Record<string, unknown>;
      try {
        const requestId = BigInt(String(a.requestId));
        const status = await consent.getStatus(requestId);
        return OK(JSON.stringify({ requestId: requestId.toString(), status }, null, 2));
      } catch (err) {
        return ERR(err instanceof Error ? err.message : String(err));
      }
    },
  );

  registerLogged(
    server,
    log,
    "get_policy",
    {
      title: "Get an agent's spending policy",
      description: "Read an agent's registered policy from the AgentRegistry: guardian, per-period spend cap, spent so far, active flag.",
      inputSchema: z.object({ agent: z.string().optional().describe("Agent address. Defaults to this wallet.") }),
    },
    async (args, _extra) => {
      const a = args as Record<string, unknown>;
      if (!deps.registryAddress) {
        return ERR("get_policy is unavailable: AGENT_REGISTRY_ADDRESS is not configured on this server.");
      }
      try {
        const agent = (typeof a.agent === "string" ? a.agent : source.account.address) as Address;
        const policy = await source.publicClient.readContract({
          address: deps.registryAddress,
          abi: agentRegistryAbi,
          functionName: "getPolicy",
          args: [agent],
        });
        const [guardian, spendCap, periodSeconds, spentInPeriod, periodStart, active] = policy;
        return OK(
          JSON.stringify(
            {
              agent,
              guardian,
              spendCap: spendCap.toString(),
              periodSeconds: periodSeconds.toString(),
              spentInPeriod: spentInPeriod.toString(),
              periodStart: periodStart.toString(),
              active,
            },
            null,
            2,
          ),
        );
      } catch (err) {
        return ERR(err instanceof Error ? err.message : String(err));
      }
    },
  );

  registerLogged(
    server,
    log,
    "expire_request",
    {
      title: "Expire a stale request",
      description: "Permissionlessly mark an overdue pending request as Expired on-chain.",
      inputSchema: requestIdSchema,
    },
    async (args, _extra) => {
      const a = args as Record<string, unknown>;
      try {
        const requestId = BigInt(String(a.requestId));
        const txHash = await expireRequest({ wallet: source.walletClient, gatewayAddress: consentGatewayAddress }, requestId);
        return OK(JSON.stringify({ requestId: requestId.toString(), txHash }, null, 2));
      } catch (err) {
        return ERR(err instanceof Error ? err.message : String(err));
      }
    },
  );

  registerLogged(
    server,
    log,
    "pay_uri",
    {
      title: "Pay a paid resource and get served",
      description:
        "Fetch a paid URL through the xBOT02 facilitator: on a 402, automatically signs the payment " +
        "(zero gas first for the paymaster path, self-pay fallback otherwise) and retries. Returns the served response. " +
        "Requires a local signer and a configured facilitatorUrl.",
      inputSchema: z.object({ uri: z.string().describe("The paid resource URL to fetch") }),
    },
    async (args, _extra) => {
      const a = args as Record<string, unknown>;
      if (!source.isLocalSigner) {
        return ERR("pay_uri requires a local signer (private-key or mnemonic); a json-rpc wallet cannot sign payments offline.");
      }
      if (!deps.facilitatorUrl) {
        return ERR("pay_uri is unavailable: facilitatorUrl is not configured on this server.");
      }
      try {
        const paidFetch = withBOT02({
          account: source.account as LocalAccount,
          chain: source.chain,
          facilitatorUrl: deps.facilitatorUrl,
          baseFetch: deps.baseFetch,
        });
        const res = await paidFetch(String(a.uri));
        const body = await res.text();
        return OK(JSON.stringify({ status: res.status, served: res.status !== 402, body }, null, 2));
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
