// What the try-on's error screen says for each way the API can refuse or a
// render can fail. v2's heading and body are for a photograph that cannot be
// read; the other three replace only those two (ADR 0022).

import type { ErrorCode, FailureCode, JobStatus } from "./api.ts";

export type ErrorKind = "photo" | "renderFailed" | "busy" | "lookLimit";

/** A failure: what the error screen says, and the code analytics records. */
export interface Failure {
  readonly kind: ErrorKind;
  readonly code: string;
}

/** An API refusal. Anything the visitor cannot fix by choosing another photograph is "busy". */
export function errorKindOf(code: ErrorCode | "network"): ErrorKind {
  if (code === "look_limit_reached") return "lookLimit";
  if (code === "photo_invalid_file") return "photo";
  return "busy";
}

/** Why a render failed. */
export function failureKindOf(code: FailureCode): ErrorKind {
  if (code === "render_failed") return "renderFailed";
  if (code === "busy") return "busy";
  return "photo";
}

/** A job's state as the page cares about it: still going (null), or how it ended. */
export function jobProblem(status: JobStatus): Failure | null {
  if (status.state === "failed") {
    const code = status.failure_code ?? "render_failed";
    return { kind: failureKindOf(code), code };
  }
  if (status.state === "expired") return { kind: "busy", code: "expired" };
  return null;
}
