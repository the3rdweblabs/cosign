// SPDX-License-Identifier: GPL-3.0
// Copyright (c) 2026 The3rdWebLabs (https://github.com/the3rdweblabs)
// Authors: @CYBWithFlourish (https://github.com/CYBWithFlourish), @wethe3rdweblabs (https://github.com/wethe3rdweblabs)

/** Why an agent step failed. `unreachable` = the service is down. */
export type FailureKind = "unreachable" | "http" | "malformed" | "unexpected" | "balance";

/** The external service that is (or may be) at fault. */
export type ServiceKind = "resource" | "facilitator" | "agent";

export interface Diagnosis {
  service: ServiceKind;
  kind: FailureKind;
  detail: string;
}

/** An error that already carries its failure classification. */
export class DiagnosedError extends Error {
  constructor(
    readonly kind: FailureKind,
    message: string,
  ) {
    super(message);
    this.name = "DiagnosedError";
  }
}

const UNREACHABLE_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH", "ECONNRESET", "EAI_AGAIN"]);

/**
 * Maps a fetch exception to a classification the agent can reason about.
 * Node's fetch throws `TypeError: fetch failed` with a `cause` carrying the
 * OS-level errno (`ECONNREFUSED`, ...) - that cause is what tells us the
 * service is down rather than just slow or misbehaving.
 */
export function classifyFetchError(err: unknown): { kind: FailureKind; detail: string } {
  if (err instanceof Error) {
    const cause = (err as { cause?: { code?: string; syscall?: string; address?: string; port?: number } }).cause;
    const code = cause?.code;
    if (code && UNREACHABLE_CODES.has(code)) {
      const port = cause.port !== undefined ? `:${cause.port}` : "";
      return { kind: "unreachable", detail: `${code} (${cause.syscall ?? "connect"}${port})` };
    }
    if (/fetch failed|Failed to fetch|NetworkError|network error/i.test(err.message)) {
      return { kind: "unreachable", detail: err.message };
    }
    return { kind: "unexpected", detail: err.message };
  }
  return { kind: "unexpected", detail: String(err) };
}

/** Renders a failure for the reasoning layer in one plain-language line. */
export function describeDiagnosis(diagnoses: Diagnosis[]): string {
  if (diagnoses.length === 0) return "all services are reachable";
  return diagnoses.map((d) => `${d.service} endpoint ${d.kind}: ${d.detail}`).join("; ");
}
