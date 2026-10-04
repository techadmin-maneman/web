// The ops console's calls to mm-api (docs/openapi-ops.json), made with the one
// client the apps share (packages/web-kit/api.ts), so each call's path, query,
// body and answer are checked against ./api-schema.ts (FEO-30). Every call is
// same-origin, so Cloudflare Access's own cookie goes with it and the Origin
// matches, which the ops surface requires on a write
// (docs/decisions/0026-hosts-and-surfaces.md).
//
// The console holds no session of its own. Access decides who gets here, and
// mm-api records each call under that identity (docs/decisions/0031-access-and-audit.md).

import { createClient, type Answer as Answered, type Sent, type Success } from "@maneman/web-kit/api";
import type { components, paths } from "./api-schema.ts";
import { markLapsed } from "./lib/session.ts";

/** What one operation answers with, which the ops document mostly writes inline rather than naming. */
type Body<Op> = Success<Op>;

export type Whoami = Body<paths["/api/whoami"]["get"]>;
export type Held = Body<paths["/api/referrals/held"]["get"]>["held"][number];
export type Referrer = Body<paths["/api/referrers"]["get"]>["referrers"][number];
export type Area = Body<paths["/api/waitlist"]["get"]>["areas"][number];
export type Launch = Body<paths["/api/pincodes/{pin}/launch"]["post"]>;
export type Decision = Body<paths["/api/referrals/{id}/decision"]["post"]>;

export type ClientsFound = Body<paths["/api/clients/find"]["post"]>;
/** A client's page: their record, or what is kept of them once erased. */
type ClientPage = Body<paths["/api/clients/{id}"]["get"]>;
export type ClientRecord = components["schemas"]["ClientRecord"];
export type ErasedClientRecord = components["schemas"]["ErasedClientRecord"];
export const isErased = (page: ClientPage): page is ErasedClientRecord => "erased_at" in page;
export type ClientVisit = ClientRecord["visits"]["past"][number];
export type ClientPayment = ClientRecord["payments"][number];
export type ClientPaymentLink = ClientRecord["payment_links"][number];
export type ClientInvoice = ClientRecord["invoices"][number];
/** A booking that refunded its payment by itself: paid after its hold lapsed, or a move whose visit had begun. */
export type AutoRefund = ClientRecord["auto_refunds"][number];
/** A visit ops book for a client: the windows free for it, what is sent, and what came of it. */
export type VisitAvailability = Body<paths["/api/visits/availability"]["get"]>;
export type AvailabilityQuery = NonNullable<paths["/api/visits/availability"]["get"]["parameters"]["query"]>;
export type VisitToBook = Sent<paths["/api/visits"]["post"]>;
export type VisitBooked = Body<paths["/api/visits"]["post"]>;
/** What cancelling a client's visit gives back, free to the client and on their own late terms. */
export type CancelTerms = Body<paths["/api/visits/{id}/cancel"]["post"]>;
export type CancelOutcome = CancelTerms["free"];
export type HandClose = Sent<paths["/api/visits/{id}/close"]["post"]>;
export type CreditBalance = Body<paths["/api/clients/{id}/credits"]["post"]>;
export type CreditAdjustment = Sent<paths["/api/clients/{id}/credits"]["post"]>;
export type ClientInvite = NonNullable<ClientRecord["invite"]>;
export type InviteAttachment = Sent<paths["/api/clients/{id}/referral"]["post"]>;
export type PhotoVisit = Body<paths["/api/clients/{id}/photos"]["get"]>["visits"][number];
export type Photo = PhotoVisit["photos"][number];
export type PhotoView = Body<paths["/api/clients/{id}/photos/view"]["post"]>;
export type Consents = Body<paths["/api/clients/{id}/consents"]["get"]>;
export type Consent = Consents["consents"][number];
export type Piece = Body<paths["/api/clients/{id}/pieces"]["get"]>["pieces"][number];
/** The client's hair profile, and every version of it (ADR 0106). */
export type ClientHairProfile = Body<paths["/api/clients/{id}/hair-profile"]["get"]>;
export type HairProfileVersion = ClientHairProfile["versions"][number];
export type HairProfileView = NonNullable<ClientHairProfile["latest"]>;
export type HairCorrection = Sent<paths["/api/clients/{id}/hair-profile"]["post"]>;

export type Tasks = Body<paths["/api/tasks"]["get"]>;
export type TaskGroup = Tasks["groups"][number];
export type Task = TaskGroup["tasks"][number];
/** The groups ops may close a task of without doing its thing (docs/decisions/0092-task-owners.md). */
export type ClosableGroup = paths["/api/tasks/{group}/{id}/close"]["post"]["parameters"]["path"]["group"];
/** The alerts on Tasks' "Needs a hand". */
export type OpenAlerts = Body<paths["/api/alerts"]["get"]>;
export type OpenAlert = OpenAlerts["alerts"][number];
/** An address a client gives ops on the phone, as the page sends it. */
export type AddressGiven = Sent<paths["/api/clients/{id}/address"]["post"]>;
export type Suggestion = Body<paths["/api/clients/{id}/address/suggestions"]["post"]>["suggestions"][number];

/** The three queues a client's rights over their data put in front of ops (docs/decisions/0049-dpdp.md). */
export type Grievance = Body<paths["/api/grievances"]["get"]>["grievances"][number];
export type DeletionRequest = Body<paths["/api/deletion-requests"]["get"]>["requests"][number];
export type NumberChange = Body<paths["/api/number-changes"]["get"]>["changes"][number];

/**
 * The business inputs ops set for themselves (docs/decisions/0061-ops-editable-inputs.md): a rule of numbers, or of
 * choices (docs/decisions/0088-every-policy-in-the-console.md).
 */
export type OpsSetting = Body<paths["/api/settings"]["get"]>["settings"][number];
export type NumberRule = Extract<OpsSetting, { kind: "number" }>;
export type ChoiceRule = Extract<OpsSetting, { kind: "choice" }>;
export type SettingValue = OpsSetting["value"];
/** The days no visit is offered (docs/decisions/0088-every-policy-in-the-console.md). */
export type Blackout = Body<paths["/api/blackouts"]["get"]>["blackouts"][number];
export type BlackoutAdd = Sent<paths["/api/blackouts"]["post"]>;
export type BlackoutRemove = Sent<paths["/api/blackouts/remove"]["post"]>;
/** Discount codes, and a code on a client's visit (docs/decisions/0108-discount-codes.md). */
export type DiscountCode = Body<paths["/api/discount-codes"]["get"]>["codes"][number];
export type DiscountCodesNew = Sent<paths["/api/discount-codes"]["post"]>;
export type VisitDiscountCode = NonNullable<ClientVisit["discount_code"]>;
export type Price = Body<paths["/api/prices"]["post"]>["prices"][number];
export type PriceChange = Sent<paths["/api/prices"]["post"]>;
export type PriceWithdrawal = Sent<paths["/api/prices/withdraw"]["post"]>;
export type PriceCorrection = Sent<paths["/api/prices/correct"]["post"]>;
/** The services clients book, kind by kind, each with its prices (docs/decisions/0085-services-ops-can-edit.md). */
export type ServiceBook = Body<paths["/api/services"]["get"]>;
export type OpsService = ServiceBook["services"][number];
export type LateFee = ServiceBook["late_fees"][number];
export type Kind = OpsService["kind"];
export type ServiceAdd = Sent<paths["/api/services"]["post"]>;
export type ServedPincode = Body<paths["/api/service-area"]["get"]>["pincodes"][number];
export type AreaChange = Sent<paths["/api/service-area"]["post"]>["changes"][number];
export type AreaChanged = Body<paths["/api/service-area"]["post"]>;
export type NewPincode = Sent<paths["/api/pincodes"]["post"]>;

/** The consumables, each service's expected use, the job sheet, and the stock (docs/decisions/0087-consumables-and-stock.md). */
export type Consumables = Body<paths["/api/consumables"]["get"]>;
export type Consumable = Consumables["consumables"][number];
export type ServiceUse = Consumables["services"][number];
export type NewConsumable = Sent<paths["/api/consumables"]["post"]>;
export type ConsumableChange = Sent<paths["/api/consumables/{code}"]["post"]>;
export type ServiceUsage = Sent<paths["/api/service-usage"]["post"]>;
export type JobSheet = Body<paths["/api/job-sheet"]["get"]>;
export type JobSheetList = JobSheet["partial_reasons"];
export type JobSheetItemSent = Sent<paths["/api/job-sheet/partial-reasons"]["post"]>["items"][number];
export type Stock = Body<paths["/api/stock"]["get"]>;
export type StockDelivery = Sent<paths["/api/stock/deliveries"]["post"]>;
export type StockTransfer = Sent<paths["/api/stock/transfers"]["post"]>;
export type StockCount = Sent<paths["/api/stock/counts"]["post"]>;
export type StockWriteOff = Sent<paths["/api/stock/write-offs"]["post"]>;

/** The Staff list: who may do what, and whether it is enforced. */
export type StaffBook = Body<paths["/api/staff"]["get"]>;
export type StaffPerson = StaffBook["people"][number];
export type StaffGrant = StaffPerson["grants"][number];
export type StaffSave = Sent<paths["/api/staff"]["post"]>;
export type StaffToken = StaffBook["service_tokens"][number];
export type StaffTokenAdd = Sent<paths["/api/staff/service-tokens"]["post"]>;

export type NoShowCase = Body<paths["/api/no-shows"]["get"]>["cases"][number];
export type ChargePreview = Body<paths["/api/no-shows/{id}/charge"]["get"]>;
export type DecidedNoShow = Body<paths["/api/no-shows/decided"]["get"]>["cases"][number];
export type NoShowDispute = Body<paths["/api/no-shows/disputes"]["get"]>["disputes"][number];
export type DisputeRuling = Sent<paths["/api/no-shows/disputes/{id}/ruling"]["post"]>["ruling"];
export type DayMoney = Body<paths["/api/payments"]["get"]>;
export type Charge = DayMoney["charges"][number];
export type Roster = Body<paths["/api/technicians"]["get"]>;
export type Technician = Roster["technicians"][number];
/** A technician as both lists carry him: active, or switched off. */
export type TechnicianSummary = Roster["switched_off"][number];
export type NewTechnician = Sent<paths["/api/technicians"]["post"]>;
export type TechnicianChange = Sent<paths["/api/technicians/{id}"]["patch"]>;
/** A visit a technician just switched off no longer holds, which waits on the dispatch board for another. */
export type ReturnedVisit = Body<paths["/api/technicians/{id}/deactivate"]["post"]>["visits"][number];
export type Device = Technician["devices"][number];
export type Leave = Technician["leave"][number];
/** One technician's leave still to end, each period with the jobs still booked on its days. */
export type StandingLeave = Body<paths["/api/technicians/{id}/leave"]["get"]>["leave"][number];
export type JobOnLeave = StandingLeave["jobs"][number];
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

/**
 * A failed call carries the API's error code, and for invalid_request the
 * fields it refused, so a form can say which of its boxes was wrong. The code
 * is "offline" when the call never reached the API, and "signed_out" when
 * Cloudflare Access sent it to its login page instead (src/lib/session.ts).
 */
export type Answer<T> = Answered<T, ErrorCode | "signed_out">;

/** The codes the API refuses with, as its document writes them. */
export type ErrorCode = components["schemas"]["ErrorResponse"]["error"]["code"];

/**
 * Whether Access, rather than mm-api, answered. Access redirects a call whose
 * session has run out to the team's login page; the call does not follow it,
 * so it arrives as an opaque redirect. mm-api's own refusal of a missing or
 * spent token is the same thing seen from behind Access.
 */
function lapsedIn(response: Response, code: string | undefined): boolean {
  if (response.type === "opaqueredirect") return true;
  return response.status === 401 || code === "access_required";
}

const client = createClient<paths, ErrorCode | "signed_out">({
  // A redirect is never followed: the only one a call meets is Access's, to a login page on another origin.
  redirect: "manual",
  sessionEnded: lapsedIn,
  onSessionEnded: markLapsed,
  // Access's redirect carries none of the API's codes.
  missingCode: (status) => (status === 0 ? "signed_out" : "unknown"),
});

/** Where a job is being put: the technician, the India date and the window. */
export interface Landing {
  readonly technicianId: string;
  readonly date: string;
  readonly window: BookingWindow;
  readonly reason: MoveReason;
  /** Why the visit goes onto a day ops blacked out, as ops typed it; null for any other day. */
  readonly blackoutReason: string | null;
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

/** A query's fields that are set: a null leaves one to the route. */
function setOnly<T extends Record<string, string | null>>(fields: T): { [K in keyof T]?: string } {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== null)) as {
    [K in keyof T]?: string;
  };
}

const moveBody = (appointmentId: string, to: Landing, shown: Shown) => ({
  appointment_id: appointmentId,
  technician_id: to.technicianId,
  date: to.date,
  window: to.window,
  reason: to.reason,
  expected_technician_id: shown.technicianId,
  expected_starts_at: shown.startsAt,
  ...(to.blackoutReason === null ? {} : { blackout_reason: to.blackoutReason }),
});

export const api = {
  /** Who Access let through, and where signing out goes. */
  whoami: () => client.get("/api/whoami"),
  /** Seven days from `from`, or from today, in one city or every one. No name or number is in the query. */
  board: (asked: BoardQuery) => client.get("/api/dispatch", { query: setOnly({ from: asked.from, city: asked.city }) }),
  /** A number that moves whenever something the board draws changes; one row, where the board is hundreds. */
  boardVersion: () => client.get("/api/dispatch/version"),
  /** Where a job in hand would land in the week from `from`, by the check a move runs. Writes nothing. */
  room: (appointmentId: string, from: string) =>
    client.get("/api/dispatch/room", { query: { appointment_id: appointmentId, from } }),
  /**
   * A job the tray holds, put on a technician. The server runs the clash check
   * before it writes anything, here and on a move alike (ADR 0034).
   */
  assign: (appointmentId: string, to: Landing, shown: Shown) =>
    client.post("/api/dispatch/assign", { body: moveBody(appointmentId, to, shown) }),
  /** A job already on the board, moved. The client is never charged for it; the answer says how he hears of it. */
  move: (appointmentId: string, to: Landing, shown: Shown, clearingCheckIn = false) =>
    client.post("/api/dispatch/move", {
      body: clearingCheckIn
        ? { ...moveBody(appointmentId, to, shown), clear_check_in: true as const }
        : moveBody(appointmentId, to, shown),
    }),
  /** Ops called a client who had not heard of a move; its task leaves the Tasks board. */
  toldByPhone: (moveId: string) => client.post("/api/dispatch/moves/{id}/told", { path: { id: moveId } }),
  held: () => client.get("/api/referrals/held"),
  /** Either decision needs a reason, which the server keeps with it (src/policy/decision-reasons.ts). */
  decideReferral: (id: string, decision: "approve" | "reject", reason: string) =>
    client.post("/api/referrals/{id}/decision", { path: { id }, body: { decision, reason } }),
  /** A page of referrers, the busiest first, from `offset`. */
  referrers: (offset: number) => client.get("/api/referrers", { query: { offset } }),
  waitlist: () => client.get("/api/waitlist"),
  /** Without confirm, what a launch would send; with it, the launch itself, from the day given or today. */
  launch: (pincode: string, confirm: boolean, launchOn: string | null = null) =>
    client.post("/api/pincodes/{pin}/launch", {
      path: { pin: pincode },
      body: { confirm, ...(launchOn === null ? {} : { launch_on: launchOn }) },
    }),
  /**
   * Clients by part of a name or of a number. What ops type goes in the body,
   * never in a path or a query string, so a number stays out of logs and referrers.
   */
  findClients: (text: string) => client.post("/api/clients/find", { body: { text } }),
  client: (id: string) => client.get("/api/clients/{id}", { path: { id } }),
  /** A client's 14 days of windows for a kind of visit, who is free in each, and how it would be paid. */
  visitAvailability: (query: AvailabilityQuery) => client.get("/api/visits/availability", { query }),
  /** A visit booked for a client: at once when nothing is paid at booking, else a payment link goes to them. */
  bookVisit: (visit: VisitToBook) => client.post("/api/visits", { body: visit }),
  /** What a cancel would give back, free to the client and on their own late terms. Changes nothing. */
  cancelTerms: (visitId: string) =>
    client.post("/api/visits/{id}/cancel", { path: { id: visitId }, body: { confirm: false } }),
  /** The cancel, on the notice ops were shown: free to the client unless `onClientTerms`. */
  cancelVisit: (visitId: string, notice: CancelTerms["notice"], onClientTerms: boolean, reason: string) =>
    client.post("/api/visits/{id}/cancel", {
      path: { id: visitId },
      body: { confirm: true, notice, ...(onClientTerms ? { on_client_terms: true } : {}), reason },
    }),
  /** A visit whose technician's phone was lost before it sent the work, closed as ops say it went. */
  closeVisit: (visitId: string, close: HandClose) =>
    client.post("/api/visits/{id}/close", { path: { id: visitId }, body: close }),
  /** Visits added or taken away by hand, with the reason; the answer is the balance after it. */
  adjustCredits: (id: string, adjustment: CreditAdjustment) =>
    client.post("/api/clients/{id}/credits", { path: { id }, body: adjustment }),
  /** Buildings matching what ops have typed of the address a client is giving them, in one billed session. */
  addressSuggestions: (id: string, q: string, session: string) =>
    client.post("/api/clients/{id}/address/suggestions", { path: { id }, body: { q, session } }),
  /** The address a client gave on the phone, saved as theirs, marked as given to ops (ADR 0092). */
  saveGivenAddress: (id: string, address: AddressGiven) =>
    client.post("/api/clients/{id}/address", { path: { id }, body: address }),
  /** An invite attached by hand, with why; the answer is the invite as the client's page shows it (ADR 0089). */
  attachInvite: (id: string, attachment: InviteAttachment) =>
    client.post("/api/clients/{id}/referral", { path: { id }, body: attachment }),
  /** Which photographs exist, by visit. No image comes with it, and nothing is audited. */
  clientPhotos: (id: string) => client.get("/api/clients/{id}/photos", { path: { id } }),
  /** Opening them: one audit entry, written before any image is served, and who opened them before (ADR 0031). */
  openPhotos: (id: string) => client.post("/api/clients/{id}/photos/view", { path: { id } }),
  /** One photograph's bytes, within the opening already logged. */
  clientPhoto: (id: string, photoId: string) =>
    client.request<Blob>("GET", `/api/clients/${encodeURIComponent(id)}/photos/${encodeURIComponent(photoId)}`, {
      file: true,
    }),
  clientConsents: (id: string) => client.get("/api/clients/{id}/consents", { path: { id } }),
  /** The client's pieces. */
  clientPieces: (id: string) => client.get("/api/clients/{id}/pieces", { path: { id } }),
  /** The client's hair profile as it stands, and every version of it. */
  clientHairProfile: (id: string) => client.get("/api/clients/{id}/hair-profile", { path: { id } }),
  /** A correction: the whole profile as it now stands, a new version under the caller's name, audited. */
  correctHairProfile: (id: string, correction: HairCorrection) =>
    client.post("/api/clients/{id}/hair-profile", { path: { id }, body: correction }),
  /** Every queue ops still have to work through, and whose each task is. A task leaves when its row is decided. */
  tasks: () => client.get("/api/tasks"),
  /** What waits on ops for one client alone, for the head of their page. */
  clientTasks: (person: string) => client.get("/api/tasks", { query: { person } }),
  /** A task made a member of staff's, by their Access e-mail, or nobody's with null (ADR 0092). */
  setTaskOwner: (group: TaskGroup["group"], id: string, owner: string | null) =>
    client.put("/api/tasks/{group}/{id}/owner", { path: { group, id }, body: { owner } }),
  /** A visit left partly done, closed without a follow-up; the reason is kept with it, under the caller's name. */
  closeTask: (group: ClosableGroup, id: string, reason: string) =>
    client.post("/api/tasks/{group}/{id}/close", { path: { group, id }, body: { reason } }),
  /** A one visit's payment link, texted to the client again by Razorpay, or made now where it never was. */
  resendPaymentLink: (linkId: string) => client.post("/api/payment-links/{id}/resend", { path: { id: linkId } }),
  /** The open alerts ops have been told of, of the caller's own departments. */
  alerts: () => client.get("/api/alerts"),
  /** An alert marked done, under the caller's name. */
  resolveAlert: (id: string) => client.post("/api/alerts/{id}/resolve", { path: { id } }),
  /** The message, lead or CRM erasure an alert gave up on, sent again; the alert closes. */
  sendAlertAgain: (id: string) => client.post("/api/alerts/{id}/send-again", { path: { id } }),
  /** The cases nobody has ruled on yet. The route also answers the decided ones; the board draws a queue. */
  noShows: () => client.get("/api/no-shows", { query: { decision: "undecided" } }),
  /** A day's money, as board D1 heads it: India's date, or today with null. */
  dayMoney: (date: string | null) => client.get("/api/payments", { query: setOnly({ date }) }),
  /**
   * Charge the visit or waive it, with the reason either way. A charge costs
   * what the booking was sold to cost a no-show, and gives back the rest.
   */
  decideNoShow: (id: string, decision: "charged" | "waived", reason: string) =>
    client.post("/api/no-shows/{id}/decision", { path: { id }, body: { decision, reason } }),
  /** The disputed charges still to rule on (docs/decisions/0096-a-no-shows-charge-and-its-dispute.md). */
  /** What charging the case would keep of the visit's payment and refund, read before the charge is sent. */
  chargePreview: (id: string) => client.get("/api/no-shows/{id}/charge", { path: { id } }),
  /** The cases ruled on today, the latest first, each with its ruling. */
  decidedNoShows: () => client.get("/api/no-shows/decided"),
  disputes: () => client.get("/api/no-shows/disputes"),
  ruleOnDispute: (id: string, ruling: DisputeRuling, reason: string) =>
    client.post("/api/no-shows/disputes/{id}/ruling", { path: { id }, body: { ruling, reason } }),
  /** The grievances nobody has answered yet, oldest first. */
  grievances: () => client.get("/api/grievances"),
  /** Ops' answer, which closes the grievance. Nothing sends it to the client; ops do that themselves. */
  resolveGrievance: (id: string, response: string) =>
    client.post("/api/grievances/{id}/resolve", { path: { id }, body: { response } }),
  deletionRequests: () => client.get("/api/deletion-requests"),
  /**
   * "delete" erases the client at once and cannot be undone; "reject" needs a
   * reason. The route wants the field either way, so a deletion sends it as null.
   */
  decideDeletion: (id: string, decision: "delete" | "reject", reason: string | null) =>
    client.post("/api/deletion-requests/{id}/decision", { path: { id }, body: { decision, reason } }),
  /**
   * Erases a client now, from their page; it cannot be undone. `settledByHand` erases despite a visit booked or a
   * payment held, which ops then cancel and refund themselves, or a payment link unpaid, which is cancelled.
   */
  eraseClient: (id: string, settledByHand: boolean) =>
    client.post("/api/clients/{id}/erasure", {
      path: { id },
      body: settledByHand ? { override_open_bookings: true } : {},
    }),
  numberChanges: () => client.get("/api/number-changes"),
  /** Confirming moves the client to the new number; rejecting needs a reason. */
  decideNumberChange: (id: string, decision: "confirm" | "reject", reason: string | null) =>
    client.post("/api/number-changes/{id}/decision", { path: { id }, body: { decision, reason } }),
  technicians: () => client.get("/api/technicians"),
  /** His number signs in to the technician app at once. */
  addTechnician: (technician: NewTechnician) => client.post("/api/technicians", { body: technician }),
  /** Only the fields sent change. */
  changeTechnician: (id: string, change: TechnicianChange) =>
    client.patch("/api/technicians/{id}", { path: { id }, body: change }),
  /** Signed out at once; his visits still to come are given back unassigned, and listed in the answer. */
  switchOff: (id: string) => client.post("/api/technicians/{id}/deactivate", { path: { id } }),
  switchOn: (id: string) => client.post("/api/technicians/{id}/reactivate", { path: { id } }),
  /** What each of them has finished, over the period the route rules; the roster above carries no figure. */
  technicianWork: () => client.get("/api/technicians/work"),
  /** The phone's ID is the app's own, never a hardware serial, so it can stand in a path. */
  /** Let the technician check in to the visit wherever his phone puts him, with why. */
  letIn: (id: string, reason: string) => client.post("/api/visits/{id}/let-in", { path: { id }, body: { reason } }),
  revokeDevice: (id: string, deviceId: string) =>
    client.post("/api/technicians/{id}/devices/{device}/revoke", { path: { id, device: deviceId } }),
  /** After a revoke stopped him signing in. */
  allowSignIn: (id: string) => client.post("/api/technicians/{id}/allow-sign-in", { path: { id } }),
  /** Both dates inclusive. Those days are then refused to booking and to the dispatch board alike (ADR 0062). */
  standingLeave: (id: string) => client.get("/api/technicians/{id}/leave", { path: { id } }),
  recordLeave: (id: string, leave: { from: string; to: string; note: string | null }) =>
    client.post("/api/technicians/{id}/leave", {
      path: { id },
      body: { from: leave.from, to: leave.to, ...(leave.note === null ? {} : { note: leave.note }) },
    }),
  cancelLeave: (id: string, leaveId: string) =>
    client.post("/api/technicians/{id}/leave/{leave}/cancel", { path: { id, leave: leaveId } }),
  /** Every rule ops may change, with its unit, its bounds and who last set it (ADR 0061). */
  settings: () => client.get("/api/settings"),
  /** What the photographs and referral cards hold in R2, against their share (ADR 0093). */
  storage: () => client.get("/api/storage"),
  /** One rule. A null value puts the figure in the code back and removes the row. */
  setSetting: (name: OpsSetting["name"], value: SettingValue | null) =>
    client.post("/api/settings/{name}", { path: { name }, body: { value } }),
  /** A price from the day it applies. The book gains a row; nothing already invoiced moves. */
  setPrice: (price: PriceChange) => client.post("/api/prices", { body: price }),
  /** A price still to come, taken back. The route refuses the one in force and every spent one. */
  withdrawPrice: (row: PriceWithdrawal) => client.post("/api/prices/withdraw", { body: row }),
  /** A price still to come, taken back and set again, from its own day or another, in one go. */
  correctPrice: (correction: PriceCorrection) => client.post("/api/prices/correct", { body: correction }),
  /** Every service, offered or retired, with every price it has had and is to have, and the two late fees. */
  services: () => client.get("/api/services"),
  /** Added last in its kind; clients see it once it has a price. */
  addService: (service: ServiceAdd) => client.post("/api/services", { body: service }),
  /** Its code stays, and with it every price it has and every visit sold under them. */
  renameService: (kind: Kind, tier: string, name: string) =>
    client.post("/api/services/{kind}/{tier}/name", { path: { kind, tier }, body: { name } }),
  /** The line clients read under its name as they choose; an empty one clears it. */
  describeService: (kind: Kind, tier: string, description: string) =>
    client.post("/api/services/{kind}/{tier}/description", { path: { kind, tier }, body: { description } }),
  /** How long visits booked from now on are held and booked for. */
  setServiceLength: (kind: Kind, tier: string, minutes: number) =>
    client.post("/api/services/{kind}/{tier}/length", { path: { kind, tier }, body: { minutes } }),
  /** Every one of a kind's codes, once, first to last. */
  orderServices: (kind: Kind, tiers: readonly string[]) =>
    client.post("/api/services/{kind}/order", { path: { kind }, body: { tiers: [...tiers] } }),
  /** No longer offered from a day, today or later. The route keeps every kind one service to book. */
  retireService: (kind: Kind, tier: string, from: string) =>
    client.post("/api/services/{kind}/{tier}/retire", { path: { kind, tier }, body: { from } }),
  restoreService: (kind: Kind, tier: string) =>
    client.post("/api/services/{kind}/{tier}/restore", { path: { kind, tier } }),
  /** Every day from today on that no visit is offered, with what is still booked on each. */
  blackouts: () => client.get("/api/blackouts"),
  /** Every day from the first to the last, both included. A day already blacked out takes this reason. */
  addBlackouts: (period: BlackoutAdd) => client.post("/api/blackouts", { body: period }),
  /** The days from the first to the last are offered again. */
  removeBlackouts: (period: BlackoutRemove) => client.post("/api/blackouts/remove", { body: period }),
  /** The latest codes made, or the one with this text, each with its uses and what it has given. */
  discountCodes: (code: string | null = null) =>
    client.get("/api/discount-codes", code === null ? {} : { query: { code } }),
  /** One code typed, or one or more generated; more than one generated are single-use. */
  makeDiscountCodes: (codes: DiscountCodesNew) => client.post("/api/discount-codes", { body: codes }),
  /** No booking takes it from now on; the bookings that carry it keep it. */
  switchOffDiscountCode: (id: string) => client.post("/api/discount-codes/{id}/off", { path: { id } }),
  /** Only on a visit not yet paid for, linked or invoiced; one code a visit. */
  enterVisitCode: (visitId: string, code: string) =>
    client.post("/api/visits/{id}/discount-code", { path: { id: visitId }, body: { code } }),
  removeVisitCode: (visitId: string) => client.post("/api/visits/{id}/discount-code/remove", { path: { id: visitId } }),
  /** Every pincode, with how many wait there and how many serving it would tell, and our cities. */
  serviceArea: () => client.get("/api/service-area"),
  /**
   * Only the pincodes named change. The route refuses a change that would leave
   * none served, or serve one from a day to come, and launches each pincode it
   * begins serving: `alerted` counts the WhatsApps that queues.
   */
  setServiceArea: (changes: readonly AreaChange[]) =>
    client.post("/api/service-area", { body: { changes: [...changes] } }),
  /** A pincode the service area does not hold, added unserved in one of our cities. */
  addPincode: (pincode: NewPincode) => client.post("/api/pincodes", { body: pincode }),
  /** Every consumable, and each service's expected use. */
  consumables: () => client.get("/api/consumables"),
  addConsumable: (added: NewConsumable) => client.post("/api/consumables", { body: added }),
  /** Only the fields sent change; a null level clears it. */
  changeConsumable: (code: string, change: ConsumableChange) =>
    client.post("/api/consumables/{code}", { path: { code }, body: change }),
  /** No longer offered from the day given, today or later. Nothing already recorded moves. */
  retireConsumable: (code: string, from: string) =>
    client.post("/api/consumables/{code}/retire", { path: { code }, body: { from } }),
  restoreConsumable: (code: string) => client.post("/api/consumables/{code}/restore", { path: { code } }),
  /** A service's whole list: a consumable left out is expected no more. */
  setServiceUsage: (usage: ServiceUsage) => client.post("/api/service-usage", { body: usage }),
  jobSheet: () => client.get("/api/job-sheet"),
  /** A kind of visit's whole checklist, in its order. An item left out is retired, not forgotten. */
  setChecklist: (type: VisitType, items: readonly JobSheetItemSent[]) =>
    client.post("/api/job-sheet/checklists/{visit_type}", { path: { visit_type: type }, body: { items: [...items] } }),
  setPartialReasons: (items: readonly JobSheetItemSent[]) =>
    client.post("/api/job-sheet/partial-reasons", { body: { items: [...items] } }),
  /** The Staff list, narrowed to the places the caller may see. */
  staff: () => client.get("/api/staff"),
  /** A person added, or their grants and whether they are let in replaced whole. */
  saveStaff: (person: StaffSave) => client.post("/api/staff", { body: person }),
  setEnforcement: (on: boolean) => client.post("/api/staff/enforcement", { body: { on } }),
  addServiceToken: (token: StaffTokenAdd) => client.post("/api/staff/service-tokens", { body: token }),
  removeServiceToken: (clientId: string) =>
    client.post("/api/staff/service-tokens/remove", { body: { client_id: clientId } }),
  /** What each place holds, what is low, and the latest movements. */
  stock: () => client.get("/api/stock"),
  recordDelivery: (delivery: StockDelivery) => client.post("/api/stock/deliveries", { body: delivery }),
  recordTransfer: (moved: StockTransfer) => client.post("/api/stock/transfers", { body: moved }),
  /** The ledger takes the difference from what it held. */
  recordCount: (counted: StockCount) => client.post("/api/stock/counts", { body: counted }),
  recordWriteOff: (lost: StockWriteOff) => client.post("/api/stock/write-offs", { body: lost }),
};
