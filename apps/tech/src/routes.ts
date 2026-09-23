// ─────────────────────────────────────────────────────────────────────────────
// PROVISIONAL. The technician API is P2-M4's, and it is being built beside this
// app. Nothing here is generated from an OpenAPI document yet, so nothing here
// is the contract.
//
// Every route this app calls is named below exactly as the P2-M4 section of
// `docs/prompts/phase2-backend.md` writes it, so the two can be put side by
// side; `test/node/tech-routes.test.ts` does that against the prompt itself.
// ROUTES_ASSUMED holds those the prompt does not write, which the app needs and
// which must be confirmed against the real document.
// ─────────────────────────────────────────────────────────────────────────────

export interface TechRoute {
  readonly method: string;
  /** The path under the technician host's /api, as the prompt writes it. */
  readonly path: string;
  /** The text the prompt writes for this route, which the test looks for. */
  readonly prompt: string;
}

/** Every route the prompt's P2-M4 "Technician" list writes. */
export const ROUTES_SPECIFIED: readonly TechRoute[] = [
  { method: "POST", path: "/tech/auth/otp", prompt: "POST /tech/auth/otp" },
  { method: "POST", path: "/tech/auth/verify", prompt: "POST /tech/auth/verify" },
  { method: "GET", path: "/tech/jobs", prompt: "GET /tech/jobs?date=" },
  { method: "GET", path: "/tech/jobs/:id", prompt: "GET /tech/jobs/:id" },
  { method: "POST", path: "/tech/jobs/:id/checkin", prompt: "POST /tech/jobs/:id/checkin" },
  { method: "POST", path: "/tech/jobs/:id/start", prompt: "POST /tech/jobs/:id/start" },
  { method: "POST", path: "/tech/jobs/:id/photos/upload-url", prompt: "POST /tech/jobs/:id/photos/upload-url" },
  { method: "POST", path: "/tech/jobs/:id/photos", prompt: "POST /tech/jobs/:id/photos" },
  { method: "POST", path: "/tech/jobs/:id/checklist", prompt: "POST /tech/jobs/:id/checklist" },
  // The prompt writes these three as tails of the line above: "`/consumables`, `/piece` and `/outcome`".
  { method: "POST", path: "/tech/jobs/:id/consumables", prompt: "/consumables" },
  { method: "POST", path: "/tech/jobs/:id/piece", prompt: "/piece" },
  { method: "POST", path: "/tech/jobs/:id/outcome", prompt: "/outcome" },
  { method: "POST", path: "/tech/jobs/:id/no-show", prompt: "POST /tech/jobs/:id/no-show" },
  { method: "GET", path: "/tech/pieces/lookup", prompt: "GET /tech/pieces/lookup?code=" },
];

/**
 * The routes the prompt does not write. The app cannot open without them, so
 * they are named here and reported, not hidden in a component.
 *
 * - `GET /tech/me` answers who is signed in and whether this device is still
 *   enrolled. Without it the app cannot tell a signed-out phone from a revoked
 *   one (docs/decisions/0029-sessions.md).
 * - `POST /tech/auth/logout` ends the session, as the client app's
 *   `POST /auth/logout` does.
 */
export const ROUTES_ASSUMED: readonly Omit<TechRoute, "prompt">[] = [
  { method: "GET", path: "/tech/me" },
  { method: "POST", path: "/tech/auth/logout" },
];

/** The header every write carries: "the client-generated `X-Client-Event-Id`, which is idempotent". */
export const EVENT_ID_HEADER = "X-Client-Event-Id";

/** The error code a write meets when FSM changed underneath it (the prompt's `409 superseded`). */
export const SUPERSEDED = "superseded";

/**
 * ASSUMED: the code a 401 carries when ops have revoked this device, as against
 * a session that merely ended. Either way the app wipes what the phone holds;
 * this only changes what it says.
 */
export const DEVICE_REVOKED = "device_revoked";

/** The route one of the outbox's events is sent to. */
export function pathFor(kind: string, jobId: string): string {
  return `/tech/jobs/${jobId}/${kind}`;
}
