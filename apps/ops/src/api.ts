// The ops console's calls to mm-api (docs/openapi-ops.json). Every call is
// same-origin, so Cloudflare Access's own cookie goes with it and the Origin
// matches, which the ops surface requires on a write
// (docs/decisions/0026-hosts-and-surfaces.md).
//
// The console holds no session of its own. Access decides who gets here, and
// mm-api records each call under that identity (docs/decisions/0031-access-and-audit.md).

import type { paths } from "./api-schema.ts";

/** The 200 body of one operation, which the ops document mostly writes inline rather than naming. */
type Body<T> = T extends { responses: { 200: { content: { "application/json": infer B } } } } ? B : never;

/** What one operation is sent. */
type Sent<T> = T extends { requestBody: { content: { "application/json": infer B } } } ? B : never;

export type Held = Body<paths["/api/referrals/held"]["get"]>["held"][number];
export type Referrer = Body<paths["/api/referrers"]["get"]>["referrers"][number];
export type Area = Body<paths["/api/waitlist"]["get"]>["areas"][number];
export type Launch = Body<paths["/api/pincodes/{pin}/launch"]["post"]>;
export type Decision = Body<paths["/api/referrals/{id}/decision"]["post"]>;

export type ClientFound = Body<paths["/api/clients/search"]["post"]>;
export type ClientRecord = Body<paths["/api/clients/{id}"]["get"]>;
export type PhotoVisit = Body<paths["/api/clients/{id}/photos"]["get"]>["visits"][number];
export type Photo = PhotoVisit["photos"][number];
export type Consents = Body<paths["/api/clients/{id}/consents"]["get"]>;
export type Consent = Consents["consents"][number];
export type Piece = Body<paths["/api/clients/{id}/pieces"]["get"]>["pieces"][number];

export type Tasks = Body<paths["/api/tasks"]["get"]>;
export type TaskGroup = Tasks["groups"][number];
export type Task = TaskGroup["tasks"][number];

/** The three queues a client's rights over their data put in front of ops (docs/decisions/0049-dpdp.md). */
export type Grievance = Body<paths["/api/grievances"]["get"]>["grievances"][number];
export type DeletionRequest = Body<paths["/api/deletion-requests"]["get"]>["requests"][number];
export type NumberChange = Body<paths["/api/number-changes"]["get"]>["changes"][number];

export type NoShowCase = Body<paths["/api/no-shows"]["get"]>["cases"][number];
export type Technician = Body<paths["/api/technicians"]["get"]>["technicians"][number];
export type Device = Technician["devices"][number];
export type Board = Body<paths["/api/dispatch"]["get"]>;
export type BoardRow = Board["technicians"][number];
export type BoardDay = BoardRow["days"][number];
export type Block = BoardDay["blocks"][number];
export type Unassigned = Board["unassigned"][number];
export type Moved = Body<paths["/api/dispatch/move"]["post"]>;

type MoveRequest = Sent<paths["/api/dispatch/move"]["post"]>;
export type MoveReason = MoveRequest["reason"];
export type BookingWindow = NonNullable<MoveRequest["window"]>;
export type VisitType = NonNullable<Block["type"]>;

/** A failed call carries the API's error code, or "offline" when it never reached the API. */
export type Answer<T> =
  { readonly ok: true; readonly body: T } | { readonly ok: false; readonly status: number; readonly code: string };

async function refusal(response: Response): Promise<Answer<never>> {
  const error = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
  return { ok: false, status: response.status, code: error?.error?.code ?? "unknown" };
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<Answer<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    return { ok: false, status: 0, code: "offline" };
  }
  if (response.ok) return { ok: true, body: (await response.json()) as T };
  return refusal(response);
}

/** A photograph's bytes, which the API audits before it serves them. */
async function image(path: string): Promise<Answer<Blob>> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: "same-origin" });
  } catch {
    return { ok: false, status: 0, code: "offline" };
  }
  return response.ok ? { ok: true, body: await response.blob() } : refusal(response);
}

/** Where a job is being put: the technician, the India date and the window. */
export interface Landing {
  readonly technicianId: string;
  readonly date: string;
  readonly window: BookingWindow;
  readonly reason: MoveReason;
}

export const api = {
  /** Seven days from today, or from `from`. No name or number is in the query. */
  board: () => call<Board>("GET", "/api/dispatch"),
  /**
   * A job the tray holds, put on a technician. The server runs the clash check
   * before it writes anything, here and on a move alike (ADR 0034).
   */
  assign: (appointmentId: string, to: Landing) =>
    call<Moved>("POST", "/api/dispatch/assign", {
      appointment_id: appointmentId,
      technician_id: to.technicianId,
      date: to.date,
      window: to.window,
      reason: to.reason,
    }),
  /** A job already on the board, moved. The client is messaged, and never charged for it. */
  move: (appointmentId: string, to: Landing) =>
    call<Moved>("POST", "/api/dispatch/move", {
      appointment_id: appointmentId,
      technician_id: to.technicianId,
      date: to.date,
      window: to.window,
      reason: to.reason,
    }),
  held: () => call<{ held: Held[] }>("GET", "/api/referrals/held"),
  decideReferral: (id: string, decision: "approve" | "reject", reason: string | null) =>
    call<Decision>("POST", `/api/referrals/${id}/decision`, { decision, reason }),
  referrers: () => call<{ referrers: Referrer[] }>("GET", "/api/referrers"),
  waitlist: () => call<{ areas: Area[] }>("GET", "/api/waitlist"),
  /** Without confirm, what a launch would send; with it, the launch itself. */
  launch: (pincode: string, confirm: boolean) => call<Launch>("POST", `/api/pincodes/${pincode}/launch`, { confirm }),
  /** The number goes in the body, never in a path or a query string, so it stays out of logs and referrers. */
  findClient: (mobile: string) => call<ClientFound>("POST", "/api/clients/search", { mobile }),
  client: (id: string) => call<ClientRecord>("GET", `/api/clients/${id}`),
  /** Which photographs exist, by visit. No image comes with it, and nothing is audited. */
  clientPhotos: (id: string) => call<{ visits: PhotoVisit[] }>("GET", `/api/clients/${id}/photos`),
  /** One photograph. The API writes the audit entry before it serves the bytes (ADR 0031). */
  clientPhoto: (id: string, photoId: string) => image(`/api/clients/${id}/photos/${photoId}`),
  clientConsents: (id: string) => call<Consents>("GET", `/api/clients/${id}/consents`),
  /** The client's pieces. The route reads FSM afresh first, since FSM is the record. */
  clientPieces: (id: string) => call<{ pieces: Piece[] }>("GET", `/api/clients/${id}/pieces`),
  /** Every queue ops still have to work through. Nothing is closed here: a task leaves when its row is decided. */
  tasks: () => call<Tasks>("GET", "/api/tasks"),
  /** The cases nobody has ruled on yet. The route also answers the decided ones; the board draws a queue. */
  noShows: () => call<{ cases: NoShowCase[] }>("GET", "/api/no-shows?decision=undecided"),
  /** Charge the visit or waive it. Neither takes money: the charge follows the 24-hour policy at P2-M5. */
  decideNoShow: (id: string, decision: "charged" | "waived") =>
    call<{ decided: boolean }>("POST", `/api/no-shows/${id}/decision`, { decision }),
  /** The grievances nobody has answered yet, oldest first. */
  grievances: () => call<{ grievances: Grievance[] }>("GET", "/api/grievances"),
  /** Ops' answer, which closes the grievance. Nothing sends it to the client; ops do that themselves. */
  resolveGrievance: (id: string, response: string) =>
    call<{ state: "resolved" }>("POST", `/api/grievances/${id}/resolve`, { response }),
  deletionRequests: () => call<{ requests: DeletionRequest[] }>("GET", "/api/deletion-requests"),
  /**
   * "delete" erases the client at once and cannot be undone; "reject" needs a
   * reason. The route wants the field either way, so a deletion sends it as null.
   */
  decideDeletion: (id: string, decision: "delete" | "reject", reason: string | null) =>
    call<{ state: "done" | "rejected" }>("POST", `/api/deletion-requests/${id}/decision`, { decision, reason }),
  numberChanges: () => call<{ changes: NumberChange[] }>("GET", "/api/number-changes"),
  /** Confirming moves the client to the new number; rejecting needs a reason. */
  decideNumberChange: (id: string, decision: "confirm" | "reject", reason: string | null) =>
    call<{ state: "confirmed" | "rejected" }>("POST", `/api/number-changes/${id}/decision`, { decision, reason }),
  technicians: () => call<{ technicians: Technician[] }>("GET", "/api/technicians"),
  /** The phone's ID is the app's own, never a hardware serial, so it can stand in a path. */
  revokeDevice: (id: string, deviceId: string) =>
    call<{ revoked_at: string }>("POST", `/api/technicians/${id}/devices/${encodeURIComponent(deviceId)}/revoke`),
};
