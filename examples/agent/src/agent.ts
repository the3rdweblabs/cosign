// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import { appendFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { Address, Hex } from "viem";
import { createAgentWallet, requiredEnv, consentGatewayAddress, type AgentWallet } from "./wallet.js";
import { ConsentClient, type ActivityEntry, type RequestOutcome } from "./consent-client.js";
import { reasonAbout, reasonAboutFailure, reasonAboutResource, reasonAboutChat, type ChatMessage } from "./reasoning.js";
import { classifyFetchError, DiagnosedError, describeDiagnosis, type Diagnosis, type FailureKind, type ServiceKind } from "./errors.js";
import { botNetworkConfig, computeFeeAmount, type FeeSchedule } from "@xbot02/core";

export interface AgentOptions {
  task: string;
  resourceUrl: string;
  /** Required only when the paid endpoint requires on-chain consent (advertised in its payment requirements). */
  consentGatewayAddress?: Address;
  agentPrivateKey: Hex;
  /** Injectable for tests; defaults to a wallet derived from agentPrivateKey. */
  wallet?: AgentWallet;
  activityLogPath?: string;
  paymasterUrl?: string;
  /** The facilitator that verifies/settles the payment (for its fee schedule). */
  facilitatorUrl?: string;
  /** CAIP-2 network to pay on; defaults to the active BOT network. */
  network?: string;
  /** Chain id the payment tx is signed for; defaults to the active BOT network. */
  chainId?: number;
}

/** How a run ended: served the content, deliberately aborted (e.g. consent
 *  rejected), or failed on a service problem the agent reasoned about. */
export type AgentStatus = "served" | "aborted" | "failed";

export interface AgentFailure {
  kind: FailureKind;
  service?: ServiceKind;
  detail: string;
}

export interface AgentRunResult {
  status: AgentStatus;
  requestId: bigint;
  autoApproved: boolean;
  served: boolean;
  txHash?: string;
  justification: string;
  answer?: string;
  failure?: AgentFailure;
}

/**
 * The agent's main loop.
 *
 *   0. Pre-flight: check the paid endpoint and the settlement facilitator are
 *      reachable. If either is down the agent reasons about it and stops -
 *      no on-chain consent requested, nothing signed.
 *   1. Probe the paid endpoint -> resource server answers HTTP 402 with the
 *      exact payment requirement (network, amount, payTo). The requirement
 *      also says whether serving needs on-chain consent (`requireConsent`).
 *   2. If consent is required: reasonAbout() asks Claude to pick the action
 *      type and write a short justification, then ConsentClient.requestAction()
 *      calls ConsentGateway.requestAction() on chain 968. Auto-approved
 *      in-policy actions proceed; out-of-policy ones wait for the human
 *      guardian's approve() via waitForApproval().
 *      If consent is not required (pure x402 endpoint), the agent skips the
 *      decision + consent steps entirely and just pays.
 *   3. Once consent is granted (or not needed), the agent signs a native tBOT
 *      transfer for the exact amount and retries the endpoint with the
 *      PAYMENT-SIGNATURE header (x402 flow). The facilitator verifies +
 *      settles; we serve the content.
 *
 * Every step is logged with the on-chain request id + justification, both to
 * stdout and (when an activity log path is configured) to a JSONL file the
 * console ActivityFeed can read later.
 */
export async function runAgent(options: AgentOptions): Promise<AgentRunResult> {
  const net = botNetworkConfig();
  const network = options.network ?? net.caip2;
  const chainId = options.chainId ?? net.chainId;
  const facilitatorUrl = options.facilitatorUrl ?? process.env.FACILITATOR_URL ?? "http://localhost:3000";

  const wallet = options.wallet ?? createAgentWallet(options.agentPrivateKey);
  const logSink = makeLogSink(options.activityLogPath);

  console.log(`[agent] wallet=${wallet.address} task="${options.task}"`);

  // 0. pre-flight: is the paid endpoint and the settlement facilitator reachable?
  //    If either is down the agent reasons about it and stops BEFORE it
  //    requests on-chain consent or signs anything - no budget spent, no
  //    signing a payment it cannot settle.
  const probe = await checkServices({ resourceUrl: options.resourceUrl, facilitatorUrl });
  if (!probe.resourceUp || !probe.facilitatorUp) {
    const diagnosis = describeDiagnosis(probe.diagnoses);
    console.log(`[agent] pre-flight failed: ${diagnosis}`);
    const message = await reasonAboutFailure({ task: options.task, diagnosis });
    console.log(`[agent] ${message}`);
    return {
      status: "failed",
      requestId: 0n,
      autoApproved: false,
      served: false,
      justification: message,
      failure: {
        kind: probe.diagnoses[0]!.kind,
        service: probe.diagnoses[0]!.service,
        detail: diagnosis,
      },
    };
  }

  // 1. probe the paid endpoint for its exact payment requirements
  let payment: PaymentOption;
  try {
    payment = await probePaymentRequirements(options.resourceUrl, network);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const diagnosis = `resource endpoint misbehaving: ${detail}`;
    console.log(`[agent] pre-flight failed: ${diagnosis}`);
    const message = await reasonAboutFailure({ task: options.task, diagnosis });
    console.log(`[agent] ${message}`);
    return {
      status: "failed",
      requestId: 0n,
      autoApproved: false,
      served: false,
      justification: message,
      failure: {
        kind: err instanceof DiagnosedError ? err.kind : "unexpected",
        service: "resource",
        detail: diagnosis,
      },
    };
  }
  console.log(`[agent] resource asks: ${payment.amount} wei tBOT -> ${payment.payTo} on ${payment.network}`);

  // 1.5. Balance check: can the agent cover the payment + gas?
  const balanceOk = await checkBalance(wallet, payment);
  if (!balanceOk.ok) {
    console.log(`[agent] balance check failed: ${balanceOk.reason}`);
    const message = await reasonAboutFailure({ task: options.task, diagnosis: balanceOk.reason });
    console.log(`[agent] ${message}`);
    return {
      status: "failed",
      requestId: 0n,
      autoApproved: false,
      served: false,
      justification: message,
      failure: { kind: "balance", service: "agent", detail: balanceOk.reason },
    };
  }

  // 2. If the endpoint requires on-chain consent (its payment requirement says
  //    so), decide the action + justification (Claude), then request consent
  //    through the ConsentGateway. Pure x402 endpoints skip this entirely -
  //    the agent just pays, no circuit breaker, no guardian.
  let requestId = 0n;
  let autoApproved = false;
  let justification: string;
  if (payment.requireConsent) {
    if (!options.consentGatewayAddress) {
      const detail = `endpoint requires on-chain consent but no consent gateway address was configured`;
      console.log(`[agent] pre-flight failed: ${detail}`);
      const message = await reasonAboutFailure({ task: options.task, diagnosis: detail });
      return {
        status: "failed",
        requestId: 0n,
        autoApproved: false,
        served: false,
        justification: message,
        failure: { kind: "malformed", service: "resource", detail },
      };
    }

    const consentClient = new ConsentClient({
      walletClient: wallet.walletClient,
      publicClient: wallet.publicClient,
      consentGatewayAddress: options.consentGatewayAddress,
      logSink,
    });

    const decision = await reasonAbout({
      task: options.task,
      payTo: payment.payTo,
      amountWei: payment.amount,
    });
    console.log(`[agent] decided action=${decision.actionType} justification="${decision.justification}"`);
    justification = decision.justification;

    // 3. request on-chain consent
    const consent: RequestOutcome = await consentClient.requestAction({
      target: decision.target,
      amount: decision.amount,
      actionType: decision.actionType,
      justification: decision.justification,
      task: options.task,
    });

    if (!consent.autoApproved) {
      console.log(`[agent] request ${consent.requestId} pending guardian approval...`);
      const status = await consentClient.waitForApproval(consent.requestId);
      if (status !== "Approved") {
        console.log(`[agent] request ${consent.requestId} not approved (${status}); aborting payment`);
        return {
          status: "aborted",
          requestId: consent.requestId,
          autoApproved: false,
          served: false,
          justification,
        };
      }
      console.log(`[agent] request ${consent.requestId} approved by guardian`);
    }
    requestId = consent.requestId;
    autoApproved = consent.autoApproved;
  } else {
    justification = `Direct x402 payment of ${payment.amount} wei to ${payment.payTo} on ${payment.network}: endpoint requires no on-chain consent, so the agent paid without the circuit breaker.`;
    console.log(`[agent] endpoint requires no on-chain consent; paying directly (no ConsentGateway round-trip)`);
  }

  // 4. pay via x402 and get served
  const served = await payAndFetch({
    resourceUrl: options.resourceUrl,
    wallet,
    payment,
    chainId,
    facilitatorUrl,
  });

  if (!served.ok) {
    return {
      status: "failed",
      requestId,
      autoApproved,
      served: false,
      justification,
      failure: {
        kind: served.kind ?? "http",
        service: "resource",
        detail: served.error ?? "payment was not settled",
      },
    };
  }

  console.log(`[agent] received resource response (${served.txHash ? `tx ${served.txHash}):` : "):"}`);
  console.log(JSON.stringify(served.body, null, 2));

  // Consume the paid resource: reason over the served content to answer the
  // original task. This is what proves the whole loop worked end to end -
  // the agent paid, got served, and actually used what it bought.
  const answer = await reasonAboutResource({ task: options.task, content: served.body });
  console.log(`[agent] answer from paid resource:\n${answer}`);

  return {
    status: "served",
    requestId,
    autoApproved,
    served: true,
    txHash: served.txHash,
    justification,
    answer,
  };
}

interface PaymentOption {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: Address;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
  /** Whether serving requires an on-chain ConsentGateway approval first (absent -> true). */
  requireConsent: boolean;
}

interface PaymentRequirements {
  x402Version: number;
  resource: string | { url: string };
  accepts: PaymentOption[];
}

/** First request to the paid endpoint; resource server answers 402 with the payment requirements. */
async function probePaymentRequirements(resourceUrl: string, network: string): Promise<PaymentOption> {
  let res: Response;
  try {
    res = await fetch(resourceUrl, { method: "POST", signal: AbortSignal.timeout(8000) });
  } catch (err) {
    const { kind, detail } = classifyFetchError(err);
    throw new DiagnosedError(kind, `resource endpoint unreachable (${kind}: ${detail})`);
  }
  if (res.status !== 402) {
    throw new DiagnosedError("http", `Expected HTTP 402 from ${resourceUrl}, got ${res.status}`);
  }
  const header = res.headers.get("payment-required");
  if (!header) {
    throw new DiagnosedError("http", `HTTP 402 from ${resourceUrl} but no PAYMENT-REQUIRED header`);
  }
  await res.arrayBuffer();
  const requirements = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as PaymentRequirements;
  const accepted = requirements.accepts ?? (requirements as unknown as { accepted?: PaymentOption[] }).accepted;
  const option = accepted?.[0];
  if (!option || option.scheme !== "exact" || option.network !== network) {
    throw new DiagnosedError("malformed", `Unsupported payment requirement from ${resourceUrl} (expected network ${network}): ${JSON.stringify(requirements)}`);
  }
  return { ...option, requireConsent: option.extra?.requireConsent !== false };
}

interface ServicesProbe {
  resourceUp: boolean;
  facilitatorUp: boolean;
  diagnoses: Diagnosis[];
}

/**
 * Pre-flight reachability check against the two services the agent depends on.
 * Any HTTP response counts as "up" (the 402 from the resource endpoint is the
 * point; the facilitator answers its /v1/fee). A thrown fetch error is
 * classified so the agent can reason about exactly which service is down.
 */
async function checkServices(options: { resourceUrl: string; facilitatorUrl: string }): Promise<ServicesProbe> {
  const diagnoses: Diagnosis[] = [];
  const [resourceUp, facilitatorUp] = await Promise.all([
    probeReachable("resource", options.resourceUrl, { method: "POST" }),
    probeReachable("facilitator", `${options.facilitatorUrl.replace(/\/+$/, "")}/v1/fee`, { method: "GET" }),
  ]);
  return { resourceUp, facilitatorUp, diagnoses };

  async function probeReachable(service: ServiceKind, url: string, init: RequestInit): Promise<boolean> {
    try {
      await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
      return true;
    } catch (err) {
      diagnoses.push({ service, ...classifyFetchError(err) });
      return false;
    }
  }
}

interface PayResult {
  ok: boolean;
  txHash?: string;
  body?: unknown;
  error?: string;
  kind?: FailureKind;
}

/**
 * How long the agent waits for the resource server to serve after sending the
 * PAYMENT-SIGNATURE header. This must exceed the facilitator's worst-case
 * /verify + /settle round-trip: the facilitator bounds each RPC call to ~10s
 * (see facilitator/src/chain.ts), so verify + settle can take ~30-60s when the
 * chain is slow. Aborting earlier is both wrong and dangerous - the signed tx
 * is already in flight, so it still settles on-chain while we report a false
 * failure (and a retry would double-pay).
 */
const PAYMENT_FETCH_TIMEOUT_MS = Number(process.env.PAYMENT_FETCH_TIMEOUT_MS ?? 120_000);

/**
 * Signs a native tBOT transfer for the exact advertised amount (self-pay:
 * normal gas price, so it settles through the plain public RPC) and retries
 * the paid endpoint with the x402 PAYMENT-SIGNATURE header. The resource
 * server routes it through the facilitator's /verify + /settle and only serves
 * the content once settlement confirms.
 *
 * If the facilitator charges a surcharge (GET /v1/fee), a second transfer is
 * signed for it with the next nonce and bundled into the payment signature.
 */
async function payAndFetch(options: {
  resourceUrl: string;
  wallet: ReturnType<typeof createAgentWallet>;
  payment: PaymentOption;
  chainId: number;
  facilitatorUrl: string;
}): Promise<PayResult> {
  const { wallet, payment, chainId } = options;

  const nonce = await wallet.publicClient.getTransactionCount({ address: wallet.address });
  const gasPrice = await wallet.publicClient.getGasPrice();

  const fee = await fetchFeeSchedule(options.facilitatorUrl);

  const rawTx = await wallet.account.signTransaction({
    chainId,
    to: payment.payTo,
    value: BigInt(payment.amount),
    gas: 21000n,
    gasPrice,
    nonce,
  });

  const signaturePayload: Record<string, unknown> = { rawTx };
  if (fee && fee.bps > 0 && fee.receiver) {
    const feeRawTx = await wallet.account.signTransaction({
      chainId,
      to: fee.receiver,
      value: computeFeeAmount(fee.bps, BigInt(payment.amount)),
      gas: 21000n,
      gasPrice,
      nonce: nonce + 1,
    });
    signaturePayload.feeRawTx = feeRawTx;
  }

  const paymentSignature = Buffer.from(JSON.stringify({ payment: signaturePayload }), "utf8").toString("base64");

  let res: Response;
  try {
    res = await fetch(options.resourceUrl, {
      method: "POST",
      headers: { "payment-signature": paymentSignature },
      signal: AbortSignal.timeout(PAYMENT_FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    const { kind, detail } = classifyFetchError(err);
    return { ok: false, kind, error: `resource unreachable during payment: ${detail}` };
  }

  const body = (await res.json()) as Record<string, unknown>;
  if (res.status === 200) {
    return {
      ok: true,
      txHash: typeof body.txHash === "string" ? body.txHash : undefined,
      body,
    };
  }
  return { ok: false, kind: "http", error: typeof body.error === "string" ? body.error : `HTTP ${res.status}` };
}

/** Best-effort fetch of the facilitator's surcharge schedule; no fee on failure. */
async function fetchFeeSchedule(facilitatorUrl: string): Promise<FeeSchedule | undefined> {
  try {
    const res = await fetch(`${facilitatorUrl.replace(/\/+$/, "")}/v1/fee`);
    if (!res.ok) return undefined;
    const json = (await res.json()) as { result?: FeeSchedule } | FeeSchedule;
    const schedule = "result" in json && json.result ? json.result : (json as FeeSchedule);
    return {
      bps: Number(schedule.bps ?? 0),
      receiver: schedule.receiver ?? null,
      network: schedule.network ?? "",
      asset: schedule.asset ?? "",
    };
  } catch {
    return undefined;
  }
}

interface BalanceCheckOk {
  ok: true;
}
interface BalanceCheckFail {
  ok: false;
  reason: string;
}
type BalanceCheckResult = BalanceCheckOk | BalanceCheckFail;

/**
 * Checks whether the agent's wallet balance can cover the payment amount
 * plus estimated gas. Returns early with a clear diagnosis if not.
 */
async function checkBalance(wallet: AgentWallet, payment: PaymentOption): Promise<BalanceCheckResult> {
  try {
    const balance = await wallet.publicClient.getBalance({ address: wallet.address });
    const gasPrice = await wallet.publicClient.getGasPrice();
    const gasLimit = 21000n;
    const totalNeeded = BigInt(payment.amount) + gasLimit * gasPrice;

    if (balance < totalNeeded) {
      return {
        ok: false,
        reason: `insufficient balance: have ${balance.toString()} wei, need ${totalNeeded.toString()} wei (${payment.amount} payment + ~${(gasLimit * gasPrice).toString()} gas)`,
      };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: `balance check failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Logs activity both to stdout and, if configured, appends JSONL for the console. */
function makeLogSink(activityLogPath?: string): (entry: ActivityEntry) => void {
  return (entry: ActivityEntry) => {
    console.log(
      `[agent] requestId=${entry.requestId} status=${entry.status} action=${entry.actionType} amount=${entry.amount} target=${entry.target}\n` +
        `       justification: ${entry.justification}`,
    );
    if (activityLogPath) {
      void appendFile(activityLogPath, `${JSON.stringify(entry)}\n`).catch((err) =>
        console.warn(`[agent] could not append activity log: ${err instanceof Error ? err.message : String(err)}`),
      );
    }
  };
}

/**
 * Pick the paid endpoint for a task. The agent knows both of the example
 * resource-server endpoints and routes by keywords:
 *   - hubot/pickup/robot/dispatch/package -> /hubot-task (consent-gated)
 *   - market/report/price/stats/data       -> /market-report (pure x402)
 * An explicit RESOURCE_URL env var overrides the routing entirely.
 */
export function pickResourceUrl(task: string): string {
  const t = task.toLowerCase();
  if (/hubot|pickup|robot|dispatch|package/.test(t)) {
    return envUrl("HUBOT_TASK_URL") ?? "http://localhost:4000/hubot-task";
  }
  if (/market|report|price|stats|data/.test(t)) {
    return envUrl("MARKET_REPORT_URL") ?? "http://localhost:4000/market-report";
  }
  return envUrl("RESOURCE_URL") ?? envUrl("HUBOT_TASK_URL") ?? "http://localhost:4000/hubot-task";
}

/** Reads an env var as a URL, treating empty strings as unset (an empty
 *  RESOURCE_URL must not shadow the keyword-routed defaults). */
function envUrl(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : undefined;
}

// CLI entrypoint. Two modes:
//   - `tsx src/agent.ts "<task>"` (or TASK env) runs that one task and exits.
//   - `tsx src/agent.ts` with no task starts an interactive chat session: every
//     line you type is answered by the agent (conversation + real paid actions
//     when you ask for the market report or a HuBot pickup); "quit"/"exit" stops.
async function main(): Promise<void> {
  const task = process.argv[2] ?? process.env.TASK;
  if (task) {
    await runOnce(task);
    return;
  }

  const gateway = resolveGateway();
  await chatLoop(gateway);
}

/** Full conversational loop: history-aware chat, with paid actions triggered by
 *  an LLM-decided JSON action tag. */
async function chatLoop(gateway?: Address): Promise<void> {
  const wallet = createAgentWallet(requiredEnv("AGENT_PRIVATE_KEY") as Hex);
  const history: ChatMessage[] = [];
  const context = { walletAddress: wallet.address };

  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
  console.log("[agent] interactive chat - talk to me, ask for the market report or a HuBot pickup, or type \"quit\" to exit.");
  rl.setPrompt("agent> ");

  for (;;) {
    const line = await nextLine(rl);
    if (line === null) break;
    const prompt = line.trim();
    if (!prompt) continue;
    if (prompt === "quit" || prompt === "exit" || prompt === "bye") break;

    history.push({ role: "user", content: prompt });
    try {
      const { reply, actionTask } = await reasonAboutChat({ messages: history, context });
      if (actionTask) {
        history.push({ role: "assistant", content: reply });
        console.log(`[agent] running paid action: "${actionTask}"`);
        const result = await runAgent({
          task: actionTask,
          resourceUrl: pickResourceUrl(actionTask),
          consentGatewayAddress: gateway,
          agentPrivateKey: requiredEnv("AGENT_PRIVATE_KEY") as Hex,
          activityLogPath: process.env.ACTIVITY_LOG,
        });
        const outcome = summarizeResult(result);
        console.log(`[agent] action result: status=${result.status} requestId=${result.requestId} served=${result.served}`);
        if (result.answer) console.log(`[agent] answer: ${result.answer}`);

        // Feed the real outcome back so the model answers grounded in what
        // actually happened, then let it compose the user-facing reply.
        history.push({ role: "user", content: `[Action outcome]\n${outcome}\n\nNow answer my original request. My request: "${prompt}"` });
        const finalReply = await reasonAboutChat({ messages: history, context });
        console.log(`${finalReply.reply}`);
        history.push({ role: "assistant", content: finalReply.reply });
      } else {
        console.log(reply);
        history.push({ role: "assistant", content: reply });
      }
    } catch (err) {
      console.error(`[agent] ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  rl.close();
  console.log("[agent] bye");
}

/** Pulls the next line (or null on EOF/close) via events, avoiding readline's
 *  `for await` + `break` ERR_USE_AFTER_CLOSE crash on piped input. */
function nextLine(rl: ReturnType<typeof createInterface>): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const cleanup = () => {
      rl.off("line", onLine);
      rl.off("close", onClose);
    };
    const onLine = (line: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(line);
    };
    const onClose = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(null);
    };
    rl.on("line", onLine);
    rl.on("close", onClose);
    try {
      rl.prompt();
    } catch {
      // Input already at EOF and readline closed itself (piped input while an
      // LLM call was in flight) - treat as end of session.
      cleanup();
      resolve(null);
    }
  });
}

/** Compact, factual summary of a run, fed back into the conversation. */
function summarizeResult(result: AgentRunResult): string {
  if (result.status === "served") {
    return `Paid task completed: requestId=${result.requestId}, autoApproved=${result.autoApproved}, ` +
      `txHash=${result.txHash ?? "n/a"}. Served content:\n${JSON.stringify(result.answer ?? "{}")}`;
  }
  const failure = result.failure ? ` (${result.failure.service}/${result.failure.kind}: ${result.failure.detail})` : "";
  return `Paid task FAILED: status=${result.status}, requestId=${result.requestId}${failure}`;
}

/** Runs a single task against the endpoint its wording maps to, then reports. */
async function runOnce(task: string, gateway?: Address): Promise<void> {
  try {
    const result = await runAgent({
      task,
      resourceUrl: process.env.RESOURCE_URL ?? pickResourceUrl(task),
      consentGatewayAddress: gateway ?? resolveGateway(),
      agentPrivateKey: requiredEnv("AGENT_PRIVATE_KEY") as Hex,
      activityLogPath: process.env.ACTIVITY_LOG,
    });

    console.log(`[agent] done: status=${result.status} requestId=${result.requestId} autoApproved=${result.autoApproved} served=${result.served}`);
    if (result.failure) {
      console.log(`[agent] failure: ${result.failure.service ?? "agent"}/${result.failure.kind} - ${result.failure.detail}`);
    }
    if (!result.served) process.exitCode = 1;
  } catch (err) {
    // Last-resort guard: never leave the CLI with an unhandled stack trace.
    console.error(`[agent] unexpected failure: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

/** Consent gateway address if configured; undefined for pure x402 runs. */
function resolveGateway(): Address | undefined {
  try {
    return consentGatewayAddress();
  } catch {
    return undefined;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
