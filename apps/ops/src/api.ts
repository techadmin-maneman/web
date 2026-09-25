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

/** The business inputs ops set for themselves (docs/decisions/0061-ops-editable-inputs.md). */
export type OpsSetting = Body<paths["/api/settings"]["get"]>["settings"][number];
export type SettingValue = OpsSetting["value"];
export type PriceBook = Body<paths["/api/prices"]["get"]>;
export type Price = PriceBook["prices"][number];
export type PriceChange = Sent<paths["/api/prices"]["post"]>;
export type ServedPincode = Body<paths["/api/service-area"]["get"]>["pincodes"][number];
export type AreaChange = Sent<paths["/api/service-area"]["post"]>["changes"][number];

export type NoShowCase = Body<paths["/api/no-shows"]["get"]>["cases"][number];
export type DayMoney = Body<paths["/api/payments"]["get"]>;
export type Charge = DayMoney["charges"][number];
export type Technician = Body<paths["/api/technicians"]["get"]>["technicians"][number];
export type Device = Technician["devices"][number];
export type Leave = Technician["leave"][number];
export type TechniciansWork = Body<paths["/api/technicians/work"]["get"]>;
export type TechnicianWork = TechniciansWork["technicians"][number];
export type Board = Body<paths["/api/dispatch"]["get"]>;
export type BoardRow = Board["technicians"][number];
export type BoardDay = BoardRow["days"][number];
export type Block = BoardDay["blocks"][number];
export type Unassigned = Board["unassigned"][number];
export type BoardClient = NonNullable<Block["person"]>;
export type Moved = Body<paths["/api/dispatch/move"]["post"]>;
export type ClientNotice = Moved["client_notice"];
export type Room = Body<paths["/api/dispatch/room"]["get"]>["rooms"][number];

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

/**
 * The job as the board showed it when ops took it: its technician, none in the
 * tray, and its start. The server refuses a move made from a board that has
 * gone stale, and names what changed (docs/decisions/0069-dispatch-under-concurrency.md).
 */
export interface Shown {
  readonly technicianId: string | null;
  readonly startsAt: string;
}

/** The week and the city the board is asked for; nulls leave them to the route: this week, every city. */
export interface BoardQuery {
  readonly from: string | null;
  readonly city: string | null;
}

const queryOf = (fields: Readonly<Record<string, string | null>>): string => {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(fields)) if (value !== null) query.set(name, value);
  const text = query.toString();
  return text === "" ? "" : `?${text}`;
};

const moveBody = (appointmentId: string, to: Landing, shown: Shown) => ({
  appointment_id: appointmentId,
  technician_id: to.technicianId,
  date: to.date,
  window: to.window,
  reason: to.reason,
  expected_technician_id: shown.technicianId,
  expected_starts_at: shown.startsAt,
});

export const api = {
  /** Seven days from `from`, or from today, in one city or every one. No name or number is in the query. */
  board: (asked: BoardQuery) => call<Board>("GET", `/api/dispatch${queryOf({ from: asked.from, city: asked.city })}`),
  /** Where a job in hand would land in the week from `from`, by the check a move runs. Writes nothing. */
  room: (appointmentId: string, from: string) =>
    call<{ appointment_id: string; rooms: Room[] }>(
      "GET",
      `/api/dispatch/room${queryOf({ appointment_id: appointmentId, from })}`,
    ),
  /**
   * A job the tray holds, put on a technician. The server runs the clash check
   * before it writes anything, here and on a move alike (ADR 0034).
   */
  assign: (appointmentId: string, to: Landing, shown: Shown) =>
    call<Moved>("POST", "/api/dispatch/assign", moveBody(appointmentId, to, shown)),
  /** A job already on the board, moved. The client is never charged for it; the answer says how he hears of it. */
  move: (appointmentId: string, to: Landing, shown: Shown) =>
    call<Moved>("POST", "/api/dispatch/move", moveBody(appointmentId, to, shown)),
  /** Ops called a client who had not heard of a move; its task leaves the Tasks board. */
  toldByPhone: (moveId: string) => call<{ told: true }>("POST", `/api/dispatch/moves/${moveId}/told`),
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
  /** Today's money, as board D1 heads it. The route takes a date; the board draws no way of asking for another. */
  dayMoney: () => call<DayMoney>("GET", "/api/payments"),
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
  /** What each of them has finished, over the period the route rules; the roster above carries no figure. */
  technicianWork: () => call<TechniciansWork>("GET", "/api/technicians/work"),
  /** The phone's ID is the app's own, never a hardware serial, so it can stand in a path. */
  revokeDevice: (id: string, deviceId: string) =>
    call<{ revoked_at: string }>("POST", `/api/technicians/${id}/devices/${encodeURIComponent(deviceId)}/revoke`),
  /** Both dates inclusive. Those days are then refused to booking and to the dispatch board alike (ADR 0062). */
  recordLeave: (id: string, leave: { from: string; to: string; note: string | null }) =>
    call<{ id: string }>("POST", `/api/technicians/${id}/leave`, {
      from: leave.from,
      to: leave.to,
      ...(leave.note === null ? {} : { note: leave.note }),
    }),
  cancelLeave: (id: string, leaveId: string) =>
    call<{ cancelled: boolean }>("POST", `/api/technicians/${id}/leave/${leaveId}/cancel`),
  /** Every rule ops may change, with its unit, its bounds and who last set it (ADR 0061). */
  settings: () => call<{ settings: OpsSetting[] }>("GET", "/api/settings"),
  /** One rule. A null value puts the figure in the code back and removes the row. */
  setSetting: (name: string, value: SettingValue | null) =>
    call<OpsSetting>("POST", `/api/settings/${encodeURIComponent(name)}`, { value }),
  prices: () => call<PriceBook>("GET", "/api/prices"),
  /** A price from the day it applies. The book gains a row; nothing already invoiced moves. */
  setPrice: (price: PriceChange) => call<{ prices: Price[] }>("POST", "/api/prices", price),
  serviceArea: () => call<{ pincodes: ServedPincode[] }>("GET", "/api/service-area"),
  /** Only the pincodes named change. The route refuses a change that would leave none served. */
  setServiceArea: (changes: readonly AreaChange[]) =>
    call<{ changed: number; served: number }>("POST", "/api/service-area", { changes }),
};
