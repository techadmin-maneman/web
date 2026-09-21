// What the try-on's error screen says for each way the API can refuse or a
// render can fail. v2's heading and body are for a photograph that cannot be
// read; the other three replace only those two (ADR 0022).

import type { ErrorCode, FailureCode, JobStatus } from "./api.ts";

export type ErrorKind = "photo" | "renderFailed" | "busy" | "lookLimit";

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

/** A job's state as the page cares about it: still going (null), or the error it ended in. */
export function jobProblem(status: JobStatus): ErrorKind | null {
  if (status.state === "failed") return failureKindOf(status.failure_code ?? "render_failed");
  if (status.state === "expired") return "busy";
  return null;
}
