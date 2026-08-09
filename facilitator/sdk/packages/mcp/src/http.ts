// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

/**
 * Mounts an McpServer on any web-standard runtime (Node 18+, Workers, Bun,
 * Deno) as a stateless Streamable HTTP endpoint. Return the handler and wire
 * it to every route/method on a path, e.g. with node:http:
 *
 *   const handler = toWebHandler(server);
 *   http.createServer(async (req, res) => {
 *     const response = await handler(toWebRequest(req));
 *     res.writeHead(response.status, Object.fromEntries(response.headers));
 *     res.end(Buffer.from(await response.arrayBuffer()));
 *   });
 *
 * Stateless mode means no session bookkeeping and no SSE stream pinning -
 * right for serverless-hosted agent servers that ChatGPT-style connectors and
 * remote MCP clients can reach over plain HTTP.
 */
export function toWebHandler(server: McpServer): (request: Request) => Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  let ready: Promise<void> | null = null;
  return async (request: Request): Promise<Response> => {
    ready ??= server.connect(transport);
    await ready;
    return transport.handleRequest(request);
  };
}
