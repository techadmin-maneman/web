// Every route the technician app calls, named once, apart from the browser so
// a Node test can put the list beside the API's own document
// (`docs/openapi-tech.json`, `test/node/tech-routes.test.ts`).
//
// The shapes are no longer read off the boards: `npm run openapi` writes
// `apps/tech/src/api-schema.ts` from the same schemas that serve the routes, so
// the app cannot drift from them without failing to compile.

export interface TechRoute {
  readonly method: "GET" | "POST" | "PUT";
  /** The path under the technician host's /api, as the OpenAPI document writes it. */
  readonly path: string;
}

/** Every route the app calls. Each one is in the document; the test checks that. */
export const ROUTES: readonly TechRoute[] = [
  { method: "POST", path: "/tech/auth/otp" },
  { method: "POST", path: "/tech/auth/verify" },
  { method: "POST", path: "/tech/auth/logout" },
  { method: "GET", path: "/tech/me" },
  { method: "GET", path: "/tech/jobs" },
  { method: "GET", path: "/tech/jobs/{id}" },
  { method: "GET", path: "/tech/jobs/{id}/last-visit-photo" },
  { method: "POST", path: "/tech/jobs/{id}/checkin" },
  { method: "POST", path: "/tech/jobs/{id}/start" },
  { method: "POST", path: "/tech/jobs/{id}/photos/upload-url" },
  { method: "PUT", path: "/tech/photos/{token}" },
  { method: "POST", path: "/tech/jobs/{id}/photos" },
  { method: "POST", path: "/tech/jobs/{id}/checklist" },
  { method: "POST", path: "/tech/jobs/{id}/consumables" },
  { method: "POST", path: "/tech/jobs/{id}/piece" },
  { method: "POST", path: "/tech/jobs/{id}/outcome" },
  { method: "POST", path: "/tech/jobs/{id}/no-show" },
  { method: "GET", path: "/tech/pieces/lookup" },
];

/**
 * Nothing. The shell assumed `GET /tech/me` and `POST /tech/auth/logout`
 * because P2-M4's list did not write them; the API now has both, so there is
 * no route left that only the app believes in (`docs/open-points.md`, item 55).
 */
export const ROUTES_ASSUMED: readonly TechRoute[] = [];

/** The header every write carries, which makes it idempotent however often it is replayed. */
export const EVENT_ID_HEADER = "X-Client-Event-Id";

/** The job's start as the phone held it: a job ops moved to another time answers `409 superseded`, field `time`. */
export const JOB_STARTS_AT_HEADER = "X-Job-Starts-At";

/** FSM changed the job underneath the phone. The job stops and the technician is told what changed. */
export const SUPERSEDED = "superseded";

/** A step reached us before the one ahead of it. The queue is ordered, so this is a fault worth showing. */
export const OUT_OF_ORDER = "out_of_order";

/** Ops revoked this phone. The app wipes what it holds, as it does for any 401, and says which it was. */
export const DEVICE_REVOKED = "device_revoked";

/** The no-show wait has not run out. The job is untouched and the countdown goes on. */
export const TOO_EARLY_TO_CLOSE = "too_early_to_close";

/** The kinds of write the phone queues, named as the API's job events are. */
export const EVENT_KINDS = [
  "check_in",
  "start",
  "before_photos",
  "checklist",
  "consumables",
  "piece",
  "after_photos",
  "outcome",
  "no_show",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/** The route one of the outbox's events is sent to. Both photograph sets go to the one route. */
const ROUTE_OF: Readonly<Record<EventKind, string>> = {
  check_in: "checkin",
  start: "start",
  before_photos: "photos",
  after_photos: "photos",
  checklist: "checklist",
  consumables: "consumables",
  piece: "piece",
  outcome: "outcome",
  no_show: "no-show",
};

export function pathFor(kind: EventKind, jobId: string): string {
  return `/tech/jobs/${jobId}/${ROUTE_OF[kind]}`;
}
