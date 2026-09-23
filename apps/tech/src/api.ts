// The technician app's calls to mm-api (docs/api-tech.md). Every shape here is
// the API's own: `npm run openapi` writes ./api-schema.ts from the schemas that
// serve the routes, so nothing below is this app's reading of a board.
//
// Every call is same-origin, so the session cookie goes with it and the Origin
// matches (docs/decisions/0026-hosts-and-surfaces.md). Every write carries the
// client-generated `X-Client-Event-Id`, which makes it idempotent however often
// the outbox replays it (docs/decisions/0038-offline-writes.md).

import type { components } from "./api-schema.ts";
import { EVENT_ID_HEADER, SUPERSEDED } from "./routes.ts";

export {
  DEVICE_REVOKED,
  EVENT_KINDS,
  OUT_OF_ORDER,
  pathFor,
  ROUTES,
  ROUTES_ASSUMED,
  SUPERSEDED,
  TOO_EARLY_TO_CLOSE,
  type EventKind,
} from "./routes.ts";

type Schema = components["schemas"];

export type Me = Schema["TechnicianMe"];
export type Challenge = Schema["TechnicianChallenge"];
export type Verified = Schema["TechnicianVerify"];
export type JobSummary = Schema["TechnicianJob"];
export type Job = Schema["TechnicianJobDetail"];
export type Progress = Schema["TechnicianJobProgress"];
export type Accepted = Schema["TechnicianWriteAccepted"];
export type CheckIn = Schema["CheckIn"];
export type NoShowClose = Schema["NoShowClose"];
export type PieceLookup = Schema["PieceLookup"];
export type UploadLink = Schema["TechnicianPhotoUrl"];
export type Day = Schema["TechnicianJobs"];

export type VisitType = NonNullable<JobSummary["type"]>;
/** No amount ever reaches this app: a badge only (board A1). */
export type Badge = JobSummary["badge"];
export type Step = Job["steps"][number];
export type PartialReason = Job["partial_reasons"][number];
export type Angle = Schema["TechnicianPhotoUrlRequest"]["angle"];
export type Phase = Schema["TechnicianPhotoUrlRequest"]["phase"];

/**
 * A failed call carries the API's error code, or "offline" when it never
 * reached the API. The API never returns a message — a stable code and, on a
 * 409 or a 400, the fields that changed or failed — so the words a screen shows
 * are the app's own (apps/tech/src/content.ts).
 */
export type Answer<T> =
  | { readonly ok: true; readonly status: number; readonly body: T }
  | {
      readonly ok: false;
      readonly status: number;
      readonly code: string;
      readonly fields: readonly string[];
    };

export interface Write {
  /** The UUIDv7 that makes this write idempotent, whatever it takes to arrive. */
  readonly eventId: string;
}

async function call<T>(method: string, path: string, body?: unknown, write?: Write): Promise<Answer<T>> {
  let response: Response;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (write !== undefined) headers[EVENT_ID_HEADER] = write.eventId;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    return { ok: false, status: 0, code: "offline", fields: [] };
  }
  if (response.ok) {
    const value = response.status === 204 ? null : ((await response.json()) as unknown);
    return { ok: true, status: response.status, body: value as T };
  }
  const failure = (await response.json().catch(() => null)) as {
    error?: { code?: string; fields?: string[] };
  } | null;
  return {
    ok: false,
    status: response.status,
    code: failure?.error?.code ?? (response.status === 409 ? SUPERSEDED : "unknown"),
    fields: failure?.error?.fields ?? [],
  };
}

export const api = {
  /** The code goes to the technician's mobile on WhatsApp, and the phone names itself here too. */
  sendCode: (mobile: string, deviceId: string) =>
    call<Challenge>("POST", "/tech/auth/otp", { mobile, device_id: deviceId }),
  /**
   * Checks the code. A wrong one is a 200 with the attempts left, not an error:
   * only a closed challenge is refused (410). The right one opens the session
   * bound to this phone (docs/decisions/0052-technician-sessions.md).
   */
  verify: (challengeId: string, code: string, deviceId: string) =>
    call<Verified>("POST", "/tech/auth/verify", { challenge_id: challengeId, code, device_id: deviceId }),
  /** Who is signed in, and on which phone. A 401 says the session ended, or that ops revoked the phone. */
  me: () => call<Me>("GET", "/tech/me"),
  logout: () => call<null>("POST", "/tech/auth/logout"),

  /** Today and tomorrow in full; later dates carry time, type and sector only. */
  jobs: (date: string) => call<Day>("GET", `/tech/jobs?date=${encodeURIComponent(date)}`),
  /** The card, which respects the day-before unlock: the API withholds it, not the screen. */
  job: (id: string) => call<Job>("GET", `/tech/jobs/${id}`),
  /** The piece a label names, and whether it is one of this job's client's. */
  piece: (code: string, jobId: string) =>
    call<PieceLookup>("GET", `/tech/pieces/lookup?code=${encodeURIComponent(code)}&job=${encodeURIComponent(jobId)}`),

  /** A link to PUT one photograph to, good for fifteen minutes. */
  uploadLink: (jobId: string, phase: Phase, angle: Angle) =>
    call<UploadLink>("POST", `/tech/jobs/${jobId}/photos/upload-url`, { phase, angle }),

  /** The photograph itself. The link is a path on this host, so this call is same-origin too. */
  async upload(link: string, frame: Blob): Promise<Answer<null>> {
    let response: Response;
    try {
      response = await fetch(link, { method: "PUT", credentials: "same-origin", body: frame });
    } catch {
      return { ok: false, status: 0, code: "offline", fields: [] };
    }
    if (response.ok) return { ok: true, status: response.status, body: null };
    const failure = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
    return { ok: false, status: response.status, code: failure?.error?.code ?? "unknown", fields: [] };
  },

  /** Every write below goes through the outbox, never straight from a screen (./store/outbox.ts). */
  send: <T>(path: string, body: unknown, write: Write) => call<T>("POST", path, body, write),
};
