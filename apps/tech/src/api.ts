// The technician app's calls to mm-api (docs/api-tech.md). Every shape here is
// the API's own: `npm run openapi` writes ./api-schema.ts from the schemas that
// serve the routes, so nothing below is this app's reading of a board.
//
// Every call is same-origin, so the session cookie goes with it and the Origin
// matches (docs/decisions/0026-hosts-and-surfaces.md). Every write carries the
// client-generated `X-Client-Event-Id`, which makes it idempotent however often
// the outbox replays it (docs/decisions/0038-offline-writes.md).

import type { components } from "./api-schema.ts";
import { EVENT_ID_HEADER, JOB_STARTS_AT_HEADER, SUPERSEDED } from "./routes.ts";

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
  /** The job's start as the phone held it when the write was queued; null for a write an older build queued. */
  readonly startsAt: string | null;
}

/** A call that never reached the API: no signal, a signal that never answered, or something else answering. */
const OFFLINE = { ok: false, status: 0, code: "offline", fields: [] } as const;

/**
 * Whether a failed call means the API could not be reached, or could not answer
 * just now, so that trying again later — or working from what the phone holds —
 * is the right thing. Any other failure is the API's answer.
 */
export function unreachable(answer: { readonly status: number; readonly code: string }): boolean {
  return answer.code === "offline" || answer.status === 429 || answer.status >= 500;
}

/**
 * How long a call waits before the phone counts itself as having no signal. A
 * weak signal that never answers is worse than none: without a limit a screen
 * would wait on it for as long as the browser does, which is minutes.
 */
const PATIENCE_MS = {
  /** A read the phone holds its own copy of: better to show that than to wait. */
  read: 4_000,
  /** A write, a sign-in or a lookup, which nothing on the phone can stand in for. */
  write: 15_000,
  /** One photograph, the largest thing the app sends. */
  upload: 60_000,
} as const;

/** Set by the service worker on the day's list it answered from its copy (apps/tech/sw/sw.ts). */
const SERVED_FROM = "Mm-Served-From";

const sessionListeners = new Set<(code: string) => void>();
const reachListeners = new Set<(reached: boolean) => void>();

/**
 * A 401 from any call ends the session: ops revoked the phone, or it ran out.
 * App wipes the phone and shows the sign-in (apps/tech/src/App.tsx), wherever
 * the technician was, so no screen has to handle it.
 */
export function onSessionEnded(listener: (code: string) => void): () => void {
  sessionListeners.add(listener);
  return () => {
    sessionListeners.delete(listener);
  };
}

/** After every call: whether anything answered, which is truer than whether the phone says it has a network. */
export function onReach(listener: (reached: boolean) => void): () => void {
  reachListeners.add(listener);
  return () => {
    reachListeners.delete(listener);
  };
}

function reached(answered: boolean): void {
  for (const listener of reachListeners) listener(answered);
}

async function answerOf<T>(response: Response): Promise<Answer<T>> {
  if (response.ok) {
    // An answer that is not JSON is not ours — a Wi-Fi sign-in page, say — and throws, which counts as no signal.
    const body = response.status === 204 ? null : ((await response.json()) as unknown);
    reached(response.headers.get(SERVED_FROM) !== "cache");
    return { ok: true, status: response.status, body: body as T };
  }
  reached(true);
  const failure = (await response.json().catch(() => null)) as {
    error?: { code?: string; fields?: string[] };
  } | null;
  const code = failure?.error?.code ?? (response.status === 409 ? SUPERSEDED : "unknown");
  if (response.status === 401) for (const listener of sessionListeners) listener(code);
  return { ok: false, status: response.status, code, fields: failure?.error?.fields ?? [] };
}

/** One request, and its answer read in full, given up on if it takes longer than `patience`. */
async function ask<T>(url: string, init: RequestInit, patience: number): Promise<Answer<T>> {
  const giveUp = new AbortController();
  const timer = setTimeout(() => {
    giveUp.abort();
  }, patience);
  try {
    return await answerOf<T>(await fetch(url, { ...init, credentials: "same-origin", signal: giveUp.signal }));
  } catch {
    reached(false);
    return OFFLINE;
  } finally {
    clearTimeout(timer);
  }
}

function call<T>(method: string, path: string, patience: number, body?: unknown, write?: Write): Promise<Answer<T>> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (write !== undefined) {
    headers[EVENT_ID_HEADER] = write.eventId;
    if (write.startsAt !== null) headers[JOB_STARTS_AT_HEADER] = write.startsAt;
  }
  return ask<T>(
    `/api${path}`,
    { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) },
    patience,
  );
}

export const api = {
  /** The code goes to the technician's mobile on WhatsApp, and the phone names itself here too. */
  sendCode: (mobile: string, deviceId: string) =>
    call<Challenge>("POST", "/tech/auth/otp", PATIENCE_MS.write, { mobile, device_id: deviceId }),
  /**
   * Checks the code. A wrong one is a 200 with the attempts left, not an error:
   * only a closed challenge is refused (410). The right one opens the session
   * bound to this phone (docs/decisions/0052-technician-sessions.md).
   */
  verify: (challengeId: string, code: string, deviceId: string) =>
    call<Verified>("POST", "/tech/auth/verify", PATIENCE_MS.write, {
      challenge_id: challengeId,
      code,
      device_id: deviceId,
    }),
  /** Who is signed in, and on which phone. A 401 says the session ended, or that ops revoked the phone. */
  me: () => call<Me>("GET", "/tech/me", PATIENCE_MS.read),
  logout: () => call<null>("POST", "/tech/auth/logout", PATIENCE_MS.write),

  /** Today and tomorrow in full; later dates carry time, type and sector only. */
  jobs: (date: string) => call<Day>("GET", `/tech/jobs?date=${encodeURIComponent(date)}`, PATIENCE_MS.read),
  /** The card, which respects the day-before unlock: the API withholds it, not the screen. */
  job: (id: string) => call<Job>("GET", `/tech/jobs/${id}`, PATIENCE_MS.read),
  /** The piece a label names, and whether it is one of this job's client's. */
  piece: (code: string, jobId: string) =>
    call<PieceLookup>(
      "GET",
      `/tech/pieces/lookup?code=${encodeURIComponent(code)}&job=${encodeURIComponent(jobId)}`,
      PATIENCE_MS.write,
    ),

  /** A link to PUT one photograph to, good for fifteen minutes. */
  uploadLink: (jobId: string, phase: Phase, angle: Angle) =>
    call<UploadLink>("POST", `/tech/jobs/${jobId}/photos/upload-url`, PATIENCE_MS.write, { phase, angle }),

  /** The photograph itself. The link is a path on this host, so this call is same-origin too. */
  upload: (link: string, frame: Blob) => ask<null>(link, { method: "PUT", body: frame }, PATIENCE_MS.upload),

  /** Every write below goes through the outbox, never straight from a screen (./store/outbox.ts). */
  send: <T>(path: string, body: unknown, write: Write) => call<T>("POST", path, PATIENCE_MS.write, body, write),
};
