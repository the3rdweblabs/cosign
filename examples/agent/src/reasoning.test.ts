// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import { test } from "node:test";
import assert from "node:assert";
import { parseDecision, reasonAbout, reasonAboutFailure, reasonAboutChat, providerFromEnv, apiKeyFromEnv, baseUrlFor, describeError, apiErrorMessage, ACTION_TYPES } from "./reasoning.js";

const INPUT = { task: "Pick up the hubot order", payTo: "0x1234567890abcdef1234567890abcdef12345678" as never, amountWei: "1000000000000000000" };
const KEYS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY", "DEEPSEEK_API_KEY", "API_KEY"];

test("parseDecision accepts clean JSON", () => {
  const parsed = parseDecision('{"actionType":"PAYMENT","justification":"Routine, in-policy payment."}');
  assert.deepEqual(parsed, { actionType: "PAYMENT", justification: "Routine, in-policy payment." });
});

test("parseDecision tolerates markdown fences", () => {
  const parsed = parseDecision('```json\n{"actionType":"HUBOT_TRIGGER","justification":"Physical HuBot action needs guardian."}\n```');
  assert.deepEqual(parsed, { actionType: "HUBOT_TRIGGER", justification: "Physical HuBot action needs guardian." });
});

test("parseDecision rejects unknown action types", () => {
  assert.equal(parseDecision('{"actionType":"ATTACK","justification":"nope"}'), null);
});

test("parseDecision rejects empty justification", () => {
  assert.equal(parseDecision('{"actionType":"PAYMENT","justification":"  "}'), null);
});

test("parseDecision rejects non-JSON", () => {
  assert.equal(parseDecision("I think we should pay"), null);
});

test("reasonAbout falls back without an API key", async () => {
  for (const key of KEYS) delete process.env[key];
  const decision = await reasonAbout(INPUT);
  assert.equal(decision.actionType, ACTION_TYPES.HUBOT_TRIGGER);
  assert.equal(decision.target, INPUT.payTo);
  assert.equal(decision.amount, 1000000000000000000n);
  assert.match(decision.justification, /fell back/i);
});

test("describeError unwraps the fetch cause chain", () => {
  const cause = new Error("getaddrinfo ENOTFOUND api.cerebras.ai");
  const outer = new Error("fetch failed", { cause });
  assert.equal(describeError(outer), "fetch failed -> getaddrinfo ENOTFOUND api.cerebras.ai");
  assert.equal(describeError(new Error("plain")), "plain");
  assert.equal(describeError("nope"), "nope");
});

test("apiErrorMessage reads provider error shapes", () => {
  assert.equal(apiErrorMessage({ message: "Payment required to access this resource." }, 402), "Payment required to access this resource.");
  assert.equal(apiErrorMessage({ error: { message: "Bad key" } }, 401), "Bad key");
  assert.equal(apiErrorMessage({ error: "Insufficient Balance" }, 429), "Insufficient Balance");
  assert.equal(apiErrorMessage({}, 500), "HTTP 500");
});

test("reasonAboutChat falls back without an API key and never fabricates an action", async () => {
  for (const key of KEYS) delete process.env[key];
  const chat = await reasonAboutChat({ messages: [{ role: "user", content: "Hello" }] });
  assert.match(chat.reply, /Hello/i);
  assert.equal(chat.actionTask, undefined);
});

test("reasonAboutChat returns the model reply and extracts a trailing action tag", async () => {
  process.env.GROQ_API_KEY = "test-key";
  process.env.PROVIDER = "groq";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: "On it.\n{\"action\":{\"task\":\"get market report\"}}" } }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as typeof fetch;
  try {
    const chat = await reasonAboutChat({ messages: [{ role: "user", content: "Can I have the market report please?" }] });
    assert.equal(chat.actionTask, "get market report");
    assert.doesNotMatch(chat.reply, /\{"action"/);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.GROQ_API_KEY;
    delete process.env.PROVIDER;
  }
});

test("reasonAboutChat returns a plain reply when no action tag is present", async () => {
  process.env.GROQ_API_KEY = "test-key";
  process.env.PROVIDER = "groq";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: "Hello! I can fetch the BOT Chain market report or dispatch a HuBot pickup." } }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as typeof fetch;
  try {
    const chat = await reasonAboutChat({ messages: [{ role: "user", content: "Hello" }] });
    assert.match(chat.reply, /Hello!/i);
    assert.equal(chat.actionTask, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.GROQ_API_KEY;
    delete process.env.PROVIDER;
  }
});

test("reasonAbout falls back when Claude returns an error", async () => {  process.env.ANTHROPIC_API_KEY = "test-key";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 429 })) as typeof fetch;
  try {
    const decision = await reasonAbout({ task: "pay the invoice", payTo: "0x1234567890abcdef1234567890abcdef12345678" as never, amountWei: "1" });
    assert.equal(decision.actionType, ACTION_TYPES.PAYMENT);
    assert.match(decision.justification, /fell back/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reasonAbout returns Claude decision on success", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ content: [{ type: "text", text: '{"actionType":"PAYMENT","justification":"Paying for the API call."}' }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as typeof fetch;
  try {
    const decision = await reasonAbout({ task: "pay the invoice", payTo: "0x1234567890abcdef1234567890abcdef12345678" as never, amountWei: "5" });
    assert.equal(decision.actionType, ACTION_TYPES.PAYMENT);
    assert.equal(decision.justification, "Paying for the API call.");
    assert.equal(decision.amount, 5n);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("providerFromEnv defaults to anthropic and rejects typos", () => {
  assert.equal(providerFromEnv({}), "anthropic");
  assert.equal(providerFromEnv({ PROVIDER: "OPENAI" }), "openai");
  assert.equal(providerFromEnv({ PROVIDER: "google" }), "google");
  assert.equal(providerFromEnv({ PROVIDER: "deepseek" }), "deepseek");
  assert.equal(providerFromEnv({ PROVIDER: "cerebras" }), "cerebras");
  assert.equal(providerFromEnv({ PROVIDER: "groq" }), "groq");
  assert.throws(() => providerFromEnv({ PROVIDER: "gemini" }), /PROVIDER/);
});

test("apiKeyFromEnv accepts any of the key env vars", () => {
  assert.equal(apiKeyFromEnv({}), undefined);
  assert.equal(apiKeyFromEnv({ GOOGLE_API_KEY: "gkey" }), "gkey");
  assert.equal(apiKeyFromEnv({ DEEPSEEK_API_KEY: "dkey" }), "dkey");
  assert.equal(apiKeyFromEnv({ CEREBRAS_API_KEY: "ckey" }), "ckey");
  assert.equal(apiKeyFromEnv({ GROQ_API_KEY: "gqkey" }), "gqkey");
  assert.equal(apiKeyFromEnv({ API_KEY: "any" }), "any");
  assert.equal(apiKeyFromEnv({ OPENAI_API_KEY: "okey", GOOGLE_API_KEY: "gkey" }), "okey");
});

test("baseUrlFor honors BASE_<PROVIDER>_URL overrides", () => {
  assert.equal(baseUrlFor("anthropic", {}), "https://api.anthropic.com");
  assert.equal(baseUrlFor("openai", { BASE_OPENAI_URL: "https://proxy.example.com/" }), "https://proxy.example.com");
  assert.equal(baseUrlFor("deepseek", {}), "https://api.deepseek.com");
  assert.equal(baseUrlFor("cerebras", {}), "https://api.cerebras.ai/v1");
  assert.equal(baseUrlFor("cerebras", { BASE_CEREBRAS_URL: "https://proxy.example.com/" }), "https://proxy.example.com");
  assert.equal(baseUrlFor("groq", {}), "https://api.groq.com/openai/v1");
});

test("reasonAbout calls OpenAI chat/completions and parses choices", async () => {
  const env = { PROVIDER: "openai", OPENAI_API_KEY: "ok", OPENAI_MODEL: "gpt-test" };
  let calledUrl = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    calledUrl = url;
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"actionType":"PAYMENT","justification":"OpenAI says pay."}' } }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const decision = await reasonAbout(INPUT, env);
    assert.equal(decision.actionType, ACTION_TYPES.PAYMENT);
    assert.equal(decision.justification, "OpenAI says pay.");
    assert.equal(calledUrl, "https://api.openai.com/v1/chat/completions");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reasonAbout calls DeepSeek chat/completions and parses choices", async () => {
  const env = { PROVIDER: "deepseek", DEEPSEEK_API_KEY: "dk", DEEPSEEK_MODEL: "deepseek-test" };
  let calledUrl = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    calledUrl = url;
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"actionType":"PAYMENT","justification":"DeepSeek says pay."}' } }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const decision = await reasonAbout(INPUT, env);
    assert.equal(decision.actionType, ACTION_TYPES.PAYMENT);
    assert.equal(decision.justification, "DeepSeek says pay.");
    assert.equal(calledUrl, "https://api.deepseek.com/chat/completions");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reasonAbout calls Cerebras chat/completions and parses choices", async () => {
  const env = { PROVIDER: "cerebras", CEREBRAS_API_KEY: "ck", CEREBRAS_MODEL: "cerebras-test" };
  let calledUrl = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    calledUrl = url;
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"actionType":"PAYMENT","justification":"Cerebras says pay."}' } }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const decision = await reasonAbout(INPUT, env);
    assert.equal(decision.actionType, ACTION_TYPES.PAYMENT);
    assert.equal(decision.justification, "Cerebras says pay.");
    assert.equal(calledUrl, "https://api.cerebras.ai/v1/chat/completions");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reasonAbout calls Groq chat/completions and parses choices", async () => {
  const env = { PROVIDER: "groq", GROQ_API_KEY: "gq", GROQ_MODEL: "groq-test" };
  let calledUrl = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    calledUrl = url;
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"actionType":"PAYMENT","justification":"Groq says pay."}' } }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const decision = await reasonAbout(INPUT, env);
    assert.equal(decision.actionType, ACTION_TYPES.PAYMENT);
    assert.equal(decision.justification, "Groq says pay.");
    assert.equal(calledUrl, "https://api.groq.com/openai/v1/chat/completions");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Groq empty-content response retries with reasoning_effort=low", async () => {
  const env = { PROVIDER: "groq", GROQ_API_KEY: "gq", GROQ_MODEL: "openai/gpt-oss-20b" };
  let calls = 0;
  const bodies: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    calls++;
    bodies.push(String(init?.body ?? ""));
    if (calls === 1) return new Response(JSON.stringify({ choices: [{ message: { content: "", reasoning: "thinking... thinking... thinking..." } }] }), { status: 200 });
    return new Response(JSON.stringify({ choices: [{ message: { content: "I could not reach the service, so I did not attempt the task." } }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const message = await reasonAboutFailure({ task: "trigger the pickup", diagnosis: "resource endpoint unreachable" }, env);
    assert.equal(message, "I could not reach the service, so I did not attempt the task.");
    assert.equal(calls, 2);
    assert.doesNotMatch(bodies[0], /reasoning_effort/);
    assert.match(bodies[1], /"reasoning_effort":"low"/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reasonAbout calls Google generateContent and parses candidates", async () => {
  const env = { PROVIDER: "google", GOOGLE_API_KEY: "gk", GOOGLE_MODEL: "gemini-test" };
  let calledUrl = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    calledUrl = url;
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"actionType":"HUBOT_TRIGGER","justification":"Physical action, flag it."}' }] } }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const decision = await reasonAbout(INPUT, env);
    assert.equal(decision.actionType, ACTION_TYPES.HUBOT_TRIGGER);
    assert.equal(decision.justification, "Physical action, flag it.");
    assert.match(calledUrl, /\/models\/gemini-test:generateContent\?key=gk$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reasonAbout uses BASE_ANTHROPIC_URL override", async () => {
  const env = { PROVIDER: "anthropic", ANTHROPIC_API_KEY: "test-key", BASE_ANTHROPIC_URL: "https://proxy.example.com/" };
  let calledUrl = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    calledUrl = url;
    return new Response(JSON.stringify({ content: [{ type: "text", text: '{"actionType":"PAYMENT","justification":"via proxy."}' }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const decision = await reasonAbout(INPUT, env);
    assert.equal(decision.justification, "via proxy.");
    assert.equal(calledUrl, "https://proxy.example.com/v1/messages");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reasonAboutFailure falls back without an API key", async () => {
  for (const key of KEYS) delete process.env[key];
  const message = await reasonAboutFailure({ task: "trigger the pickup", diagnosis: "resource endpoint unreachable (unreachable: ECONNREFUSED (connect))" });
  assert.match(message, /resource endpoint unreachable/);
  assert.match(message, /was not performed/i);
  assert.match(message, /trigger the pickup/);
});

test("reasonAboutFailure returns the model's plain-text explanation", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ content: [{ type: "text", text: "The settlement service is down, so I did not attempt the task." }] }), { status: 200 })) as typeof fetch;
  try {
    const message = await reasonAboutFailure({ task: "trigger the pickup", diagnosis: "facilitator endpoint unreachable (ECONNREFUSED)" });
    assert.equal(message, "The settlement service is down, so I did not attempt the task.");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reasonAboutFailure falls back when the model errors", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: "down" } }), { status: 500 })) as typeof fetch;
  try {
    const message = await reasonAboutFailure({ task: "trigger the pickup", diagnosis: "resource endpoint unreachable" });
    assert.match(message, /fell back/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reasonAboutFailure passes the diagnosis to the provider", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  const originalFetch = globalThis.fetch;
  let sentBody = "";
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    sentBody = String(init?.body ?? "");
    return new Response(JSON.stringify({ content: [{ type: "text", text: "I could not reach the HuBot server." }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const message = await reasonAboutFailure({ task: "trigger the pickup", diagnosis: "resource endpoint unreachable: ECONNREFUSED (connect:4000)" });
    assert.equal(message, "I could not reach the HuBot server.");
    assert.match(sentBody, /resource endpoint unreachable: ECONNREFUSED \(connect:4000\)/);
    assert.match(sentBody, /Failure diagnosis/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reasonAboutFailure surfaces Cerebras' top-level 402 message", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ message: "Payment required to access this resource. Visit your billing tab.", type: "payment_required_error", code: "payment_required" }), { status: 402 })) as typeof fetch;
  try {
    const message = await reasonAboutFailure({ task: "trigger the pickup", diagnosis: "resource endpoint unreachable" });
    assert.match(message, /Payment required/);
    assert.match(message, /fell back/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
