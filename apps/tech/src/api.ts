// The technician app's calls to mm-api (docs/api-tech.md), made with the one
// client the apps share (packages/web-kit/api.ts). Every shape here is the
// API's own: `npm run openapi` writes ./api-schema.ts from the schemas that
// serve the routes, and each call's path, query, body and answer are checked
// against it, so nothing below is this app's reading of a board.
//
// Every call is same-origin, so the session cookie goes with it and the Origin
// matches (docs/decisions/0026-hosts-and-surfaces.md). Every write carries the
// client-generated `X-Client-Event-Id`, which makes it idempotent however often
// the outbox replays it (docs/decisions/0038-offline-writes.md).

import { createClient, type Answer as Answered } from "@maneman/web-kit/api";
import type { components, paths } from "./api-schema.ts";
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
export type PhotoTaken = Schema["TechnicianPhotoTaken"];
export type Day = Schema["TechnicianJobs"];

export type VisitType = NonNullable<JobSummary["type"]>;
/** No amount ever reaches this app: a badge only (board A1). */
export type Badge = JobSummary["badge"];
export type Step = Job["steps"][number];
export type PartialReason = Job["partial_reasons"][number];
export type Angle = Schema["TechnicianPhotoUrlRequest"]["angle"];
export type Phase = Schema["TechnicianPhotoUrlRequest"]["phase"];

/** The codes the API refuses with, as its document writes them. */
export type ErrorCode = Schema["ErrorResponse"]["error"]["code"];

/**
 * A failed call carries the API's error code, or "offline" when it never
 * reached the API. The API never returns a message — a stable code and, on a
 * 409 or a 400, the fields that changed or failed — so the words a screen shows
 * are the app's own (apps/tech/src/content.ts).
 */
export type Answer<T> = Answered<T, ErrorCode>;

export interface Write {
  /** The UUIDv7 that makes this write idempotent, whatever it takes to arrive. */
  readonly eventId: string;
  /** The job's start as the phone held it when the write was queued; null for a write an older build queued. */
  readonly startsAt: string | null;
}

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

const client = createClient<paths, ErrorCode>({
  onSessionEnded: (code) => {
    for (const listener of sessionListeners) listener(code);
  },
  // The day's list from the service worker's copy is still the day, but it is not the API answering.
  onAnswer: (response) => {
    reached(response.headers.get(SERVED_FROM) !== "cache");
  },
  onUnreached: () => {
    reached(false);
  },
  // FSM changed the job under the phone and the answer lost its body on the way: still a job to stop.
  missingCode: (status) => (status === 409 ? SUPERSEDED : "unknown"),
});

/** The headers that make a write idempotent, and say which start of the job the phone held. */
function headersOf(write: Write): Record<string, string> {
  const headers: Record<string, string> = { [EVENT_ID_HEADER]: write.eventId };
  if (write.startsAt !== null) headers[JOB_STARTS_AT_HEADER] = write.startsAt;
  return headers;
}

export const api = {
  /** The code goes to the technician's mobile on WhatsApp, and the phone names itself here too. */
  sendCode: (mobile: string, deviceId: string) =>
    client.post("/api/tech/auth/otp", { body: { mobile, device_id: deviceId }, patience: PATIENCE_MS.write }),
  /**
   * Checks the code. A wrong one is a 200 with the attempts left, not an error:
   * only a closed challenge is refused (410). The right one opens the session
   * bound to this phone (docs/decisions/0052-technician-sessions.md).
   */
  verify: (challengeId: string, code: string, deviceId: string) =>
    client.post("/api/tech/auth/verify", {
      body: { challenge_id: challengeId, code, device_id: deviceId },
      patience: PATIENCE_MS.write,
    }),
  /** Who is signed in, and on which phone. A 401 says the session ended, or that ops revoked the phone. */
  me: () => client.get("/api/tech/me", { patience: PATIENCE_MS.read }),
  logout: () => client.post("/api/tech/auth/logout", { patience: PATIENCE_MS.write }),

  /** Today and tomorrow in full; later dates carry time, type and sector only. */
  jobs: (date: string) => client.get("/api/tech/jobs", { query: { date }, patience: PATIENCE_MS.read }),
  /** The card, which respects the day-before unlock: the API withholds it, not the screen. */
  job: (id: string) => client.get("/api/tech/jobs/{id}", { path: { id }, patience: PATIENCE_MS.read }),
  /** The piece a label names, and whether it is one of this job's client's. */
  piece: (code: string, jobId: string) =>
    client.get("/api/tech/pieces/lookup", { query: { code, job: jobId }, patience: PATIENCE_MS.write }),

  /**
   * A discount code on a one visit, before its payment link goes (docs/decisions/0108-discount-codes.md). Asked
   * straight, not through the outbox: the technician must hear at once whether it applies.
   */
  discountCode: (jobId: string, code: string) =>
    client.post("/api/tech/jobs/{id}/discount-code", {
      path: { id: jobId },
      body: { code },
      patience: PATIENCE_MS.write,
    }),

  /** A link to PUT one photograph to, good for fifteen minutes. */
  uploadLink: (jobId: string, phase: Phase, angle: Angle) =>
    client.post("/api/tech/jobs/{id}/photos/upload-url", {
      path: { id: jobId },
      body: { phase, angle },
      patience: PATIENCE_MS.write,
    }),

  /** The photograph itself. The link is a path on this host, so this call is same-origin too. */
  upload: (link: string, frame: Blob) =>
    client.request<PhotoTaken | null>("PUT", link, { body: frame, patience: PATIENCE_MS.upload }),

  /** Its thumbnail, naming the take the photograph's upload answered, so it is kept beside that take alone. */
  uploadThumbnail: (link: string, take: string, small: Blob) =>
    client.request<null>("PUT", `${link}?take=${encodeURIComponent(take)}`, {
      body: small,
      patience: PATIENCE_MS.upload,
    }),

  /**
   * Every write below goes through the outbox, never straight from a screen
   * (./store/outbox.ts). The outbox keeps each write's path as it queued it,
   * under the API's /api (./routes.ts), and sends it as it was queued.
   */
  send: <T>(path: string, body: unknown, write: Write) =>
    client.request<T>("POST", `/api${path}`, {
      ...(body === undefined ? {} : { json: body }),
      headers: headersOf(write),
      patience: PATIENCE_MS.write,
    }),
};
