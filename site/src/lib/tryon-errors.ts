// What the try-on's error screen says for each way the API can refuse or a
// render can fail. v2's heading and body are for a photograph that cannot be
// read; the others replace only those two (ADR 0022). Where YouCam names what
// is wrong with the photograph, the screen says that instead (failure_reason,
// docs/reference/youcam-api-notes.md). A browser that has had its look is not
// an error: it is shown that its look was sent (ADR 0104).

import type { ErrorCode, JobStatus } from "./api.ts";

export const ERROR_KINDS = [
  "photo",
  "noFace",
  "shoulders",
  "facing",
  "onePerson",
  "notStyleable",
  "refused",
  "renderFailed",
  "busy",
  "unavailable",
  "paused",
] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];
type FailureCode = NonNullable<JobStatus["failure_code"]>;
type FailureReason = NonNullable<JobStatus["failure_reason"]>;

/** A failure: what the error screen says, and the code analytics records. */
export interface Failure {
  readonly kind: ErrorKind;
  readonly code: string;
}

/** An API refusal. Anything the visitor cannot fix by choosing another photograph is "busy". */
export function errorKindOf(code: ErrorCode | "network"): ErrorKind {
  if (code === "photo_invalid_file") return "photo";
  if (code === "whatsapp_unavailable") return "unavailable";
  return "busy";
}

/** The screen for each fault YouCam names. */
const REASON_KINDS: Readonly<Record<FailureReason, ErrorKind>> = {
  no_face: "noFace",
  no_shoulders: "shoulders",
  face_angle: "facing",
  several_people: "onePerson",
  not_styleable: "notStyleable",
  refused: "refused",
  unavailable: "paused",
};

/** Why a render failed: the fault YouCam named, else the code's. */
export function failureKindOf(code: FailureCode, reason?: FailureReason): ErrorKind {
  if (reason !== undefined) return REASON_KINDS[reason];
  if (code === "render_failed") return "renderFailed";
  if (code === "busy") return "busy";
  return "photo";
}

/** A job's state as the page cares about it: still going (null), or how it ended. */
export function jobProblem(status: JobStatus): Failure | null {
  if (status.state === "failed") {
    const code = status.failure_code ?? "render_failed";
    return { kind: failureKindOf(code, status.failure_reason), code: status.failure_reason ?? code };
  }
  if (status.state === "expired") return { kind: "busy", code: "expired" };
  return null;
}
