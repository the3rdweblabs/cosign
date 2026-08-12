// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import type { Address } from "viem";

export const ACTION_TYPES = {
  PAYMENT: "PAYMENT",
  HUBOT_TRIGGER: "HUBOT_TRIGGER",
} as const;
export type ActionType = (typeof ACTION_TYPES)[keyof typeof ACTION_TYPES];

export interface AgentDecision {
  actionType: ActionType;
  target: Address;
  amount: bigint; // wei
  justification: string; // short plain-language reason, surfaced in the console
}

export interface ReasoningInput {
  task: string;
  /** The exact target + amount from the resource server's payment requirements. */
  payTo: Address;
  amountWei: string;
}

export interface FailureReasoningInput {
  task: string;
  /** Plain-language description of which service is down and why. */
  diagnosis: string;
}

export interface ResourceReasoningInput {
  task: string;
  /** The served resource content (parsed JSON body or text) received after payment. */
  content: unknown;
}

/** A single chat turn in the interactive session's conversation history. */
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatContext {
  /** The agent's wallet address on BOT Chain, so it can report facts truthfully. */
  walletAddress?: string;
}

export interface ChatReply {
  /** The model's text answer to the user's message. */
  reply: string;
  /** A paid task to run, when the model decided the user asked for one. */
  actionTask?: string;
}

/** The LLM providers the reasoning layer can drive. */
export type Provider = "anthropic" | "openai" | "google" | "deepseek" | "cerebras" | "groq";

interface ProviderDefaults {
  baseUrl: string;
  modelEnv: string;
  defaultModel: string;
}

const PROVIDER_DEFAULTS: Record<Provider, ProviderDefaults> = {
  anthropic: {
    baseUrl: "https://api.anthropic.com",
    modelEnv: "CLAUDE_MODEL",
    defaultModel: "claude-sonnet-4-20250514",
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    modelEnv: "OPENAI_MODEL",
    defaultModel: "gpt-4o-mini",
  },
  google: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    modelEnv: "GOOGLE_MODEL",
    defaultModel: "gemini-2.0-flash",
  },
  deepseek: {
    baseUrl: "https://api.deepseek.com",
    modelEnv: "DEEPSEEK_MODEL",
    defaultModel: "deepseek-v4-flash",
  },
  cerebras: {
    baseUrl: "https://api.cerebras.ai/v1",
    modelEnv: "CEREBRAS_MODEL",
    defaultModel: "gpt-oss-120b",
  },
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    modelEnv: "GROQ_MODEL",
    defaultModel: "llama-3.3-70b-versatile",
  },
};

/** The API key may come from any of these (provider-specific or a generic one). */
const KEY_ENV_VARS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY", "DEEPSEEK_API_KEY", "CEREBRAS_API_KEY", "GROQ_API_KEY", "API_KEY"] as const;

/**
 * Resolves the provider from `PROVIDER` (default `anthropic`). Anything other
 * than `anthropic|openai|google|deepseek|cerebras|groq` is rejected so a typo
 * can't silently pick a different model.
 */
export function providerFromEnv(env: Record<string, unknown> = process.env): Provider {
  const raw = typeof env.PROVIDER === "string" ? env.PROVIDER.trim().toLowerCase() : "";
  if (raw === "anthropic" || raw === "openai" || raw === "google" || raw === "deepseek" || raw === "cerebras" || raw === "groq") return raw;
  if (raw === "") return "anthropic";
  throw new Error(`PROVIDER must be "anthropic", "openai", "google", "deepseek", "cerebras", or "groq"; got "${String(env.PROVIDER)}"`);
}

/** First set API key among the known key env vars (any one works). */
export function apiKeyFromEnv(env: Record<string, unknown> = process.env): string | undefined {
  for (const name of KEY_ENV_VARS) {
    const value = env[name];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return undefined;
}

/**
 * Base URL for a provider: `BASE_<PROVIDER>_URL` (e.g. `BASE_OPENAI_URL`)
 * overrides the provider's default so you can point at a compatible proxy or
 * alternate endpoint.
 */
export function baseUrlFor(provider: Provider, env: Record<string, unknown> = process.env): string {
  const override = env[`BASE_${provider.toUpperCase()}_URL`];
  if (typeof override === "string" && override.trim() !== "") return override.trim().replace(/\/+$/, "");
  return PROVIDER_DEFAULTS[provider].baseUrl;
}

const SYSTEM_PROMPT = `You are the reasoning core of an autonomous AI agent on BOT Chain.
A task was given to you. Decide the single action to take and write a short,
plain-language justification (max ~2 sentences) explaining why the action is
warranted. Return ONLY valid JSON with exactly these fields:
{"actionType":"PAYMENT"|"HUBOT_TRIGGER","justification":"..."}
The actionType must be one of the two literals. Do not include markdown fences,
explanations, or extra fields.`;

/**
 * Calls the configured LLM provider (anthropic / openai / google / deepseek /
 * cerebras / groq) to decide the action and produce the human-readable
 * justification that gets logged alongside the on-chain request id for the
 * console later.
 *
 * The target and amount are passed in from the resource server's payment
 * requirements - the reasoning layer only picks the action TYPE and writes the
 * justification; it does not invent price or recipient.
 *
 * Env: `PROVIDER` selects the provider, `BASE_<PROVIDER>_URL` overrides its
 * base URL, and the API key is read from any of the key env vars.
 */
export async function reasonAbout(
  input: ReasoningInput,
  env: Record<string, unknown> = process.env,
): Promise<AgentDecision> {
  const provider = providerFromEnv(env);
  const apiKey = apiKeyFromEnv(env);
  if (!apiKey) {
    return fallbackDecision(
      input,
      `No API key configured for provider "${provider}" (set any of ANTHROPIC_API_KEY / OPENAI_API_KEY / GOOGLE_API_KEY / DEEPSEEK_API_KEY / API_KEY); fell back to a default decision`,
    );
  }

  const model = readModel(provider, env);

  let text: string;
  try {
    text = await requestCompletion({
      provider,
      baseUrl: baseUrlFor(provider, env),
      apiKey,
      model,
      system: SYSTEM_PROMPT,
      task: input.task,
    });
  } catch (err) {
    return fallbackDecision(input, `${provider} call failed (${describeError(err)}); fell back to a default decision`);
  }

  const parsed = parseDecision(text);
  if (!parsed) {
    return fallbackDecision(input, `${provider} returned unparseable output; fell back to a default decision`);
  }

  return {
    actionType: parsed.actionType,
    target: input.payTo,
    amount: BigInt(input.amountWei),
    justification: parsed.justification,
  };
}

function readModel(provider: Provider, env: Record<string, unknown>): string {
  const { modelEnv, defaultModel } = PROVIDER_DEFAULTS[provider];
  const configured = env[modelEnv];
  return typeof configured === "string" && configured.trim() !== "" ? configured : defaultModel;
}

const FAILURE_SYSTEM_PROMPT = `You are an autonomous AI agent on BOT Chain. A task you were
given could not be completed because of a service problem (a server you depend on is
unreachable or misbehaving). Speak in the first person, as the agent ("I"). Write a
short, plain-language explanation (max 2 sentences) of what went wrong and what you
did instead, based ONLY on the diagnosis provided in the message. Do not invent facts,
and do not claim you did anything the diagnosis does not mention (no logging, retrying,
notifying, or other actions). Return ONLY the plain explanation - no markdown fences, no JSON.`;

/**
 * Asks the LLM to phrase why a task could not run (e.g. the resource server or
 * the settlement facilitator is down) and what the agent decided. Falls back
 * to a deterministic message when no API key is configured or the provider is
 * unreachable - the agent must reason about failures even when its own brain
 * (the LLM) is offline.
 */
export async function reasonAboutFailure(
  input: FailureReasoningInput,
  env: Record<string, unknown> = process.env,
): Promise<string> {
  const provider = providerFromEnv(env);
  const apiKey = apiKeyFromEnv(env);
  if (!apiKey) {
    return fallbackFailureMessage(input, `No API key configured for provider "${provider}"`);
  }

  const model = readModel(provider, env);
  try {
    const text = await requestCompletion({
      provider,
      baseUrl: baseUrlFor(provider, env),
      apiKey,
      model,
      system: FAILURE_SYSTEM_PROMPT,
      task: input.task,
      diagnosis: input.diagnosis,
    });
    const cleaned = text.trim().replace(/^```(?:text)?\s*/i, "").replace(/\s*```$/, "").trim();
    if (cleaned.length === 0) return fallbackFailureMessage(input, `${provider} returned an empty explanation`);
    return cleaned;
  } catch (err) {
    return fallbackFailureMessage(input, `${provider} call failed (${describeError(err)})`);
  }
}

function fallbackFailureMessage(input: FailureReasoningInput, note: string): string {
  return `${note}; fell back to a default explanation: ${input.diagnosis}. Task "${input.task}" was not performed.`;
}

const RESOURCE_SYSTEM_PROMPT = `You are an autonomous AI agent on BOT Chain. You paid for and
received a resource from a paid x402 API. Use the received resource content to answer the
task the user gave you. Speak in the first person, as the agent ("I"). Be concise (max ~3
sentences). Base your answer ONLY on the task and the resource content provided - do not
invent facts or numbers that are not in the content. Return ONLY the plain answer - no
markdown fences, no JSON.`;

/**
 * Asks the LLM to synthesize an answer from the resource content the agent
 * received after paying. This is the "we actually used what we paid for" step:
 * it proves the full 402 -> pay -> settle -> serve -> consume loop end to end.
 * Falls back to a raw pass-through of the content when no API key is
 * configured or the provider is unreachable, so the served content is never
 * silently dropped.
 */
export async function reasonAboutResource(
  input: ResourceReasoningInput,
  env: Record<string, unknown> = process.env,
): Promise<string> {
  const provider = providerFromEnv(env);
  const apiKey = apiKeyFromEnv(env);
  const content = typeof input.content === "string" ? input.content : JSON.stringify(input.content, null, 2);
  if (!apiKey) {
    return fallbackResourceMessage(input, content, `No API key configured for provider "${provider}"`);
  }

  const model = readModel(provider, env);
  try {
    const text = await requestCompletion({
      provider,
      baseUrl: baseUrlFor(provider, env),
      apiKey,
      model,
      system: RESOURCE_SYSTEM_PROMPT,
      task: input.task,
      content,
    });
    const cleaned = text.trim().replace(/^```(?:text)?\s*/i, "").replace(/\s*```$/, "").trim();
    if (cleaned.length === 0) return fallbackResourceMessage(input, content, `${provider} returned an empty answer`);
    return cleaned;
  } catch (err) {
    return fallbackResourceMessage(input, content, `${provider} call failed (${describeError(err)})`);
  }
}

function fallbackResourceMessage(input: ResourceReasoningInput, content: string, note: string): string {
  const preview = content.length > 600 ? `${content.slice(0, 600)}\n... (${content.length} chars total)` : content;
  return `${note}; fell back to a raw pass-through of the paid resource:\n${preview}`;
}

const CHAT_SYSTEM_PROMPT = `You are the reasoning core of an autonomous AI agent on BOT Chain
(Cosign agent). You are talking to your human operator. You have a wallet on BOT Chain and can
pay for and fetch resources from paid x402 APIs, with on-chain human-oversight consent for
physical actions.

REAL ACTIONS you can actually perform (only these - nothing else is real):
1. "get market report"      -> a paid market report endpoint that returns live BOT Chain
                              chain stats (latest block, gas price). Pure x402, no consent.
2. "dispatch hubot pickup"  -> a consent-gated endpoint that dispatches a HuBot robot to pick
                              up a package. Requires on-chain consent approval.
Nothing else is an executable action. You cannot trade, transfer tokens, send transactions
yourself, or access the internet beyond these two endpoints.

HOW TO ACT:
- If the user asks for one of the real actions above, reply with a short lead-in sentence,
  then append a single JSON action tag on its own line, exactly like:
  {"action":{"task":"get market report"}}
  or {"action":{"task":"dispatch hubot pickup"}}
  The task string must be one of the two verbs above.
- For everything else - greetings, questions, summaries, jokes, small talk, explaining the
  system - just chat normally and DO NOT emit an action tag.

TRUTHFULNESS:
- Never invent payment results, tx hashes, request ids, block numbers, or market data that you
  did not actually receive in this conversation. If you are asked about something you have not
  done, say so.
- When an action result is shown to you in the conversation, base your answer ONLY on that
  content. Do not fabricate numbers.
- Be concise (a few sentences). Keep the same autonomous-agent persona.`;

/**
 * Drives the interactive chat session. The model answers the user's message and
 * decides whether it is plain chat (reply only) or a request for one of the
 * agent's real paid actions (reply + `{"action":{"task":...}}` tag). The agent
 * layer then runs the tagged task through the normal x402 flow.
 */
export async function reasonAboutChat(
  input: { messages: ChatMessage[]; context?: ChatContext },
  env: Record<string, unknown> = process.env,
): Promise<ChatReply> {
  const provider = providerFromEnv(env);
  const apiKey = apiKeyFromEnv(env);
  if (!apiKey) {
    return fallbackChatReply(input.messages, `No API key configured for provider "${provider}"`);
  }

  const system = input.context?.walletAddress
    ? `${CHAT_SYSTEM_PROMPT}\n\nYour wallet on BOT Chain: ${input.context.walletAddress}`
    : CHAT_SYSTEM_PROMPT;

  let text: string;
  try {
    text = await requestCompletion({
      provider,
      baseUrl: baseUrlFor(provider, env),
      apiKey,
      model: readModel(provider, env),
      system,
      messages: input.messages,
      task: "",
    });
  } catch (err) {
    return fallbackChatReply(input.messages, `${provider} call failed (${describeError(err)})`);
  }

  const action = extractChatAction(text);
  const reply = text.replace(/^\s*\{["']action["']:\s*\{["']task["']:.*\}\}\s*$/m, "").trim();
  if (reply.length === 0) return fallbackChatReply(input.messages, `${provider} returned an empty reply`);
  return action ? { reply, actionTask: action } : { reply };
}

/** Pulls `{"action":{"task":"..."}}` out of the model's output. */
function extractChatAction(text: string): string | undefined {
  const match = text.match(/\{["']action["']\s*:\s*\{["']task["']\s*:\s*["']([^"']+)["']\}\}/);
  return match?.[1]?.trim() || undefined;
}

function fallbackChatReply(messages: ChatMessage[], note: string): ChatReply {
  const last = messages[messages.length - 1];
  return { reply: `${note}; fell back to a default reply. You said: ${last?.content ?? ""}` };
}

interface CompletionRequest {
  provider: Provider;
  baseUrl: string;
  apiKey: string;
  model: string;
  system: string;
  task: string;
  diagnosis?: string;
  /** Served resource content, when reasoning about what the agent received after payment. */
  content?: string;
  /** Multi-turn conversation history (chat mode). When present, task/diagnosis/content are ignored. */
  messages?: ChatMessage[];
}

/** Builds the user message: the task, plus the failure diagnosis or the paid resource content when present. */
function userPrompt(task: string, diagnosis?: string, content?: string): string {
  let msg = `Task: ${task}`;
  if (diagnosis) msg += `\n\nFailure diagnosis: ${diagnosis}`;
  if (content) msg += `\n\nResource content received after payment:\n${content}`;
  return msg;
}

/** Single user turn for the non-chat reasoning calls. */
function singleUserTurn(task: string, diagnosis?: string, content?: string): ChatMessage {
  return { role: "user", content: userPrompt(task, diagnosis, content) };
}

/**
 * Formats an error for logs, unwrapping Node's `TypeError: fetch failed` cause
 * chain (e.g. `fetch failed -> getaddrinfo ENOTFOUND api.cerebras.ai`) so a
 * bare "fetch failed" never hides the real transport error.
 */
export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const seen = new Set<string>([err.message]);
  const parts = [err.message];
  let cause: unknown = (err as { cause?: unknown }).cause;
  while (cause instanceof Error && !seen.has(cause.message)) {
    seen.add(cause.message);
    parts.push(cause.message);
    cause = (cause as { cause?: unknown }).cause;
  }
  return parts.join(" -> ");
}

/**
 * Extracts a useful message from an API error response body. Providers disagree
 * on the shape: OpenAI/DeepSeek use `error.message`, Cerebras puts the message
 * at the top level (`message`), some return a plain string.
 */
export function apiErrorMessage(data: unknown, status: number): string {
  const d = data as { error?: unknown; message?: string };
  if (typeof d?.message === "string" && d.message.trim() !== "") return d.message;
  if (typeof d?.error === "string" && d.error.trim() !== "") return d.error;
  if (d?.error && typeof d.error === "object") {
    const e = d.error as { message?: string };
    if (typeof e.message === "string" && e.message.trim() !== "") return e.message;
  }
  return `HTTP ${status}`;
}

async function requestCompletion(req: CompletionRequest): Promise<string> {
  switch (req.provider) {
    case "anthropic":
      return requestAnthropic(req);
    case "openai":
    case "deepseek": // OpenAI-compatible chat/completions API
    case "cerebras": // OpenAI-compatible chat/completions API
    case "groq": // OpenAI-compatible chat/completions API
      return requestOpenAI(req);
    case "google":
      return requestGoogle(req);
  }
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
}
interface AnthropicResponse {
  content?: AnthropicContentBlock[];
  error?: { message?: string };
}

async function requestAnthropic({ baseUrl, apiKey, model, system, task, diagnosis, content, messages }: CompletionRequest): Promise<string> {
  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      authorization: `Bearer ${apiKey}`,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 300,
      system,
      messages: messages ?? [singleUserTurn(task, diagnosis, content)],
    }),
  });
  const data = (await response.json().catch(() => ({}))) as AnthropicResponse;
  if (!response.ok) throw new Error(apiErrorMessage(data, response.status));
  return data.content?.filter((b) => b.type === "text").map((b) => b.text ?? "").join("") ?? "";
}

interface OpenAIResponse {
  choices?: { message?: { content?: string; reasoning?: string; reasoning_content?: string } }[];
  error?: { message?: string };
}

async function requestOpenAI({ provider, baseUrl, apiKey, model, system, task, diagnosis, content: resourceContent, messages }: CompletionRequest): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const body: Record<string, unknown> = {
      model,
      max_tokens: 300,
      messages: [
        { role: "system", content: system },
        ...(messages ?? [singleUserTurn(task, diagnosis, resourceContent)]),
      ],
    };
    // Reasoning models (e.g. Groq's gpt-oss family) can burn the whole budget on
    // chain-of-thought and return empty `content`. Retry once with low reasoning
    // effort so the actual answer always comes back. Non-reasoning models reject
    // the param, so only send it when the first response proved reasoning was used.
    if (attempt === 1 && provider === "groq") body.reasoning_effort = "low";
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as OpenAIResponse;
    if (!response.ok) throw new Error(apiErrorMessage(data, response.status));
    const message = data.choices?.[0]?.message;
    const content = message?.content ?? "";
    if (content.trim() !== "") return content;
    const reasoning = message?.reasoning ?? message?.reasoning_content;
    if (attempt === 0 && provider === "groq" && typeof reasoning === "string" && reasoning.trim() !== "") continue;
    return "";
  }
  return "";
}

interface GoogleResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  error?: { message?: string };
}

async function requestGoogle({ baseUrl, apiKey, model, system, task, diagnosis, content, messages }: CompletionRequest): Promise<string> {
  const contents = (messages ?? [singleUserTurn(task, diagnosis, content)]).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const response = await fetch(`${baseUrl}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: { maxOutputTokens: 300 },
    }),
  });
  const data = (await response.json().catch(() => ({}))) as GoogleResponse;
  if (!response.ok) throw new Error(apiErrorMessage(data, response.status));
  return data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
}

/** Extracts {actionType, justification} from the model's text, tolerating fences. */
export function parseDecision(text: string): Pick<AgentDecision, "actionType" | "justification"> | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const obj = JSON.parse(cleaned) as { actionType?: string; justification?: string };
    if (
      (obj.actionType !== ACTION_TYPES.PAYMENT && obj.actionType !== ACTION_TYPES.HUBOT_TRIGGER) ||
      typeof obj.justification !== "string" ||
      obj.justification.trim().length === 0
    ) {
      return null;
    }
    return { actionType: obj.actionType, justification: obj.justification.trim() };
  } catch {
    return null;
  }
}

function fallbackDecision(input: ReasoningInput, note: string): AgentDecision {
  const actionType: ActionType = /hubot|pickup|robot|hub/i.test(input.task) ? ACTION_TYPES.HUBOT_TRIGGER : ACTION_TYPES.PAYMENT;
  return {
    actionType,
    target: input.payTo,
    amount: BigInt(input.amountWei),
    justification: `${note}: acting on "${input.task}"`,
  };
}
