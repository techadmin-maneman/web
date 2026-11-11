// The technician app's calls to mm-api (docs/api-tech.md), made with the one
// client the apps share (packages/web-kit/api.ts). Every shape here is the
// API's own: `npm run openapi` writes ./api-schema.ts from the schemas that
// serve the routes, and each call's path, query, body and answer are checked
// against it, so nothing below is this app's reading of a board. A step's body
// is checked as the outbox queues it (EventBody, ./routes.ts); `send` replays it
// as the phone kept it, which may be from an earlier build.
//
// Every call is same-origin, so the session cookie goes with it and the Origin
// matches (docs/decisions/0026-hosts-and-surfaces.md). Every write carries the
// client-generated `X-Client-Event-Id`, which makes it idempotent however often
// the outbox replays it (docs/decisions/0038-offline-writes.md).

import { signInAgain } from "@maneman/web-kit/access";
import { dataChanged, forgetKept } from "@maneman/ui/useLoad";
import { createClient, type Answer as Answered } from "@maneman/web-kit/api";
import type { components, paths } from "./api-schema.ts";
import { EVENT_ID_HEADER, JOB_STARTS_AT_HEADER, SUPERSEDED } from "./routes.ts";
import { heardClock } from "./store/device.ts";

export {
  ALREADY_CLOSED,
  DEVICE_REVOKED,
  OUT_OF_ORDER,
  pathFor,
  SUPERSEDED,
  TECHNICIAN_INACTIVE,
  TOO_EARLY_TO_ARRIVE,
  TOO_EARLY_TO_CLOSE,
  type EventBody,
  type EventKind,
} from "./routes.ts";

type Schema = components["schemas"];

export type Me = Schema["TechnicianMe"];
export type Challenge = Schema["TechnicianChallenge"];
/** A job on the day's list: its address once unlocked, and the next job still to do from it. */
export type JobSummary = Schema["TechnicianDayJob"];
/** A job's card. One an earlier build kept on the phone carries no check-in radius. */
export type Job = Omit<Schema["TechnicianJobDetail"], "checkin_radius_m"> & {
  readonly checkin_radius_m: Schema["TechnicianJobDetail"]["checkin_radius_m"] | null;
};
/** How a technician suggests finishing a visit left partly done: a time, or ops to call the client. */
export type FinishAsk = Schema["TechnicianFinishAsk"]["ask"];
/** A visit of the technician's, of any day, with steps ops sent back (docs/decisions/0246-closed-and-sent-back.md). */
export type VisitToFix = Schema["TechnicianJobs"]["sent_back"][number];
/** What the day's list carries of a job's progress: when it began and how it closed. */
export type JobState = Schema["TechnicianJobState"];
export type CheckIn = Schema["CheckIn"];
export type PieceLookup = Schema["PieceLookup"];
export type Kit = Schema["TechnicianKit"];
export type LeaveRequests = Schema["TechnicianLeaveRequests"];
export type Alerts = Schema["TechnicianAlerts"];
export type Alert = Alerts["alerts"][number];
export type AlertSettings = Schema["TechnicianAlertSettings"];
export type Options = Schema["TechnicianOptions"];
export type Position = Schema["TechnicianPosition"];
type PhotoTaken = Schema["TechnicianPhotoTaken"];
/** The client's hair profile, which the profile step sends and the piece card reads (ADR 0106). */
export type HairProfile = Schema["HairProfile"];
export type FitSpec = Schema["HairFitSpec"];
export type History = Schema["HairHistory"];
/** The profile as this build sends it: the head in inches, which the API takes centimetres for from the build before. */
export type ProfileRequest = Omit<Schema["TechnicianProfileRequest"], "fit"> & { fit: FitSpec };
export type ChecklistRequest = Schema["ChecklistRequest"];
export type PieceFitted = Schema["PieceFitted"];
export type PieceDeclined = Schema["PieceDeclined"];
export type OutcomeRequest = Schema["OutcomeRequest"];

export type Step = Job["steps"][number];
export type PartialReason = Job["partial_reasons"][number];
export type Angle = Schema["TechnicianPhotoUrlRequest"]["angle"];
export type Phase = Schema["TechnicianPhotoUrlRequest"]["phase"];

/** The codes the API refuses with, as its document writes them. */
type ErrorCode = Schema["ErrorResponse"]["error"]["code"];

/**
 * A failed call carries the API's error code, or "offline" when it never
 * reached the API. The API never returns a message — a stable code and, on a
 * 409 or a 400, the fields that changed or failed — so the words a screen shows
 * are the app's own (apps/tech/src/content.ts).
 */
export type Answer<T> = Answered<T, ErrorCode>;

interface Write {
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

const reachListeners = new Set<(reached: boolean) => void>();

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
  // Staging's Access sign-in ran out: the page goes back through it, past the service worker. The outbox keeps every
  // write it had, as it does with no connection.
  onAccessLapsed: signInAgain,
  onAnswer: () => {
    reached(true);
  },
  // The technician's day, the no-show wait and the close-out are dated on the API's clock.
  onFreshAnswer: (response) => {
    if (response.ok) void heardClock(response.headers.get("Date")).catch(() => undefined);
  },
  onUnreached: () => {
    reached(false);
  },
  // The job changed under the phone and the answer lost its body on the way: still a job to stop.
  missingCode: (status) => (status === 409 ? SUPERSEDED : "unknown"),
  // Every screen showing data reads it again once a write lands, so none shows what the write changed.
  onWrite: dataChanged,
});
// A session that ends forgets what its screens showed, so the next person on the device sees none of it.
client.onSessionEnded(forgetKept);

/**
 * A 401 from any call ends the session: ops revoked the phone, or it ran out. App wipes the phone and shows the sign-in
 * (apps/tech/src/App.tsx).
 */
export const onSessionEnded = (listener: (code: string) => void) => client.onSessionEnded(listener);

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

  /** A one visit's payment link texted to the client again, from the close. Asked straight, with signal. */
  resendLink: (jobId: string) =>
    client.post("/api/tech/jobs/{id}/payment-link/resend", { path: { id: jobId }, patience: PATIENCE_MS.write }),
  /** How the technician suggests finishing a visit left partly done, for ops to book. Asked straight, with signal. */
  finishAsk: (jobId: string, ask: FinishAsk) =>
    client.post("/api/tech/jobs/{id}/finish-ask", { path: { id: jobId }, body: { ask }, patience: PATIENCE_MS.write }),

  /** Where the technician is, from the visit's check-in to its close (docs/decisions/0248-safety.md). Never queued. */
  position: (jobId: string, position: Position) =>
    client.post("/api/tech/jobs/{id}/position", { path: { id: jobId }, body: position, patience: PATIENCE_MS.write }),
  /** The technician's SOS not yet handled by ops, if any. */
  ownSos: () => client.get("/api/tech/sos", { patience: PATIENCE_MS.read }),
  /** Raises an SOS, with the visit and where they are: ops are paged at once. Asked straight, never queued. */
  sos: (jobId: string | null, position: Position | null) =>
    client.post("/api/tech/sos", { body: { job_id: jobId, position }, patience: PATIENCE_MS.write }),
  /** A closer reading of where the technician is, for their open SOS; it pages nobody. */
  sosPosition: (id: string, position: Position) =>
    client.post("/api/tech/sos/{id}/position", { path: { id }, body: position, patience: PATIENCE_MS.write }),
  /** The technician says they are safe after their SOS. */
  sosSafe: (id: string) => client.post("/api/tech/sos/{id}/safe", { path: { id }, patience: PATIENCE_MS.write }),

  /** The kit: what it holds, what is coming to it, and its pieces to hand back (docs/decisions/0164-the-kit-screen.md). */
  kit: () => client.get("/api/tech/kit", { patience: PATIENCE_MS.read }),
  /** This month's visits closed, by kind and city, at the technician's own rates. */
  month: () => client.get("/api/tech/month", { patience: PATIENCE_MS.read }),
  /** Asks ops for what the kit is short of over the next seven days, as the API finds it. Asked straight, with signal. */
  kitRequest: () => client.post("/api/tech/kit/requests", { patience: PATIENCE_MS.write }),
  /** Asks ops to move a visit, with why. Asked straight, with signal. */
  reschedule: (jobId: string, reason: "client_asked" | "running_late" | "kit_problem") =>
    client.post("/api/tech/jobs/{id}/reschedule-request", {
      path: { id: jobId },
      body: { reason },
      patience: PATIENCE_MS.write,
    }),
  /** The technician's alerts of the last seven days, the kinds they have on, and the key to subscribe to pushes with. */
  alerts: () => client.get("/api/tech/alerts", { patience: PATIENCE_MS.read }),
  /** Every alert read: the inbox was opened. */
  alertsRead: () => client.post("/api/tech/alerts/read", { patience: PATIENCE_MS.write }),
  /** Kinds of alert turned on or off, made with signal. */
  alertSettings: (change: Schema["TechnicianAlertSettingsChange"]) =>
    client.patch("/api/tech/alerts/settings", { body: change, patience: PATIENCE_MS.write }),
  /** This phone takes the technician's pushes, by the address its browser gave. */
  pushSubscribe: (endpoint: string) =>
    client.post("/api/tech/push-subscriptions", { body: { endpoint }, patience: PATIENCE_MS.write }),
  /** The technician's on-time visits and hairline redo rate over the last 30 days. */
  quality: () => client.get("/api/tech/quality", { patience: PATIENCE_MS.read }),
  /** A consultation's packages and what each costs the client, and the looks they made with the try-on. */
  options: (id: string) => client.get("/api/tech/jobs/{id}/options", { path: { id }, patience: PATIENCE_MS.read }),
  /** The client's alerts and their visits closed before this job (docs/decisions/0242-client-record.md). */
  clientHistory: (id: string) =>
    client.get("/api/tech/jobs/{id}/client-history", { path: { id }, patience: PATIENCE_MS.read }),
  /** The technician's asks for leave not yet past, and where each stands. */
  leave: () => client.get("/api/tech/leave", { patience: PATIENCE_MS.read }),
  /** An ask for leave, which ops decide on Tasks. Asked straight, with signal. */
  askLeave: (ask: { from: string; to: string; note?: string }) =>
    client.post("/api/tech/leave", { body: ask, patience: PATIENCE_MS.write }),
  /**
   * A top-up received in hand: all of it, or of a hair system the pieces scanned, the rest still to come or missing.
   * Asked straight, with signal.
   */
  receiveTopUp: (id: string, units: readonly string[] | null, rest: "on_its_way" | "missing" = "on_its_way") =>
    client.post("/api/tech/kit/transfers/{id}/receive", {
      path: { id },
      body: units === null ? { rest } : { units: [...units], rest },
      patience: PATIENCE_MS.write,
    }),
  /** Returned pieces, and the kit's expired stock, back to its stockroom. */
  handBack: (body: { pieces: string[]; expired: boolean }) =>
    client.post("/api/tech/kit/hand-back", { body, patience: PATIENCE_MS.write }),

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

  /** A link to PUT the photograph of the door to, before the job is closed as a no-show. */
  doorUploadLink: (jobId: string) =>
    client.post("/api/tech/jobs/{id}/door-photo/upload-url", { path: { id: jobId }, patience: PATIENCE_MS.write }),
  /** The photograph of the door; the no-show names the take it is answered with. */
  uploadDoor: (link: string, frame: Blob) =>
    client.request<{ take: string }>("PUT", link, { body: frame, patience: PATIENCE_MS.upload }),

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
