// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export interface LoggedRequest {
  id: number;
  ts: number;
  tool: string;
  args: Record<string, unknown>;
  durationMs: number;
  ok: boolean;
  error?: string;
  resultText?: string;
}

/** In-memory ring buffer of every tool request a server has handled. */
export class RequestLog {
  private entries: LoggedRequest[] = [];
  private nextId = 1;

  constructor(private readonly maxEntries = 200) {}

  add(entry: { tool: string; args: Record<string, unknown>; durationMs: number; ok: boolean; error?: string; resultText?: string }): LoggedRequest {
    const record: LoggedRequest = { id: this.nextId++, ts: Date.now(), ...entry };
    this.entries.push(record);
    if (this.entries.length > this.maxEntries) this.entries.shift();
    return record;
  }

  /** Most recent first. */
  recent(limit = 50): LoggedRequest[] {
    return [...this.entries].reverse().slice(0, limit);
  }
}

interface ToolConfig {
  title?: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  annotations?: unknown;
  _meta?: Record<string, unknown>;
}

/**
 * Wraps `server.registerTool` so every request is (a) recorded in the
 * RequestLog and (b) streamed live to the connected client via an MCP
 * `notifications/message` logging notification. Anyone connected to the
 * server can see activity immediately, and can query the full log through
 * the `request_log` tool.
 */
export function registerLogged(
  server: McpServer,
  log: RequestLog,
  name: string,
  config: ToolConfig,
  handler: (args: unknown, extra: unknown) => Promise<CallToolResult>,
): void {
  server.registerTool(name, config as never, (async (args: unknown, extra: unknown) => {
    const start = Date.now();
    const plainArgs = args as Record<string, unknown>;
    try {
      const result = await handler(args, extra);
      const durationMs = Date.now() - start;
      const first = result.content?.[0];
      const text = first && "text" in first ? first.text : "";
      const ok = result.isError !== true;
      log.add({ tool: name, args: plainArgs, durationMs, ok, error: ok ? undefined : text, resultText: ok ? text.slice(0, 2000) : undefined });
      emitLog(server, ok ? "info" : "error", { tool: name, ok, durationMs, ...(ok ? {} : { error: text }) });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const durationMs = Date.now() - start;
      log.add({ tool: name, args: plainArgs, durationMs, ok: false, error: message });
      emitLog(server, "error", { tool: name, ok: false, durationMs, error: message });
      throw err;
    }
  }) as never);
}

function emitLog(server: McpServer, level: "info" | "error", data: Record<string, unknown>): void {
  try {
    if (server.isConnected()) void server.sendLoggingMessage({ level, logger: "xbot02", data });
  } catch {
    // Best-effort live stream; logging must never break a request.
  }
}
