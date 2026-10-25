// The console's client of mm-api (docs/openapi-ops.json), the one the apps share (packages/web-kit/api.ts), each call
// checked against ./api-schema.ts; the calls several sections share; and the types their answers are named by. Each
// section's own calls are its folder's <section>-api.ts. Every call is same-origin, so Access's cookie goes with it
// and the Origin matches, as a write on the ops surface requires (docs/decisions/0026-hosts-and-surfaces.md).

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

export type ClientsFound = Body<paths["/api/clients/find"]["post"]>;
export type ClientList = Body<paths["/api/clients"]["get"]>;
export type ClientListQuery = NonNullable<paths["/api/clients"]["get"]["parameters"]["query"]>;
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
export type CreditAdjustment = Sent<paths["/api/clients/{id}/credits"]["post"]>;
export type ClientInvite = NonNullable<ClientRecord["invite"]>;
export type InviteAttachment = Sent<paths["/api/clients/{id}/referral"]["post"]>;
export type PhotoVisit = Body<paths["/api/clients/{id}/photos"]["get"]>["visits"][number];
export type Photo = PhotoVisit["photos"][number];
export type PhotoView = Body<paths["/api/clients/{id}/photos/view"]["post"]>;
export type Consent = Body<paths["/api/clients/{id}/consents"]["get"]>["consents"][number];
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
export type OpenAlert = Body<paths["/api/alerts"]["get"]>["alerts"][number];
/** An address a client gives ops on the phone, as the page sends it. */
export type AddressGiven = Sent<paths["/api/clients/{id}/address"]["post"]>;

/** The three queues a client's rights over their data put in front of ops (docs/decisions/0049-dpdp.md). */
export type Grievance = Body<paths["/api/grievances"]["get"]>["grievances"][number];
export type ActivityEntry = Body<paths["/api/activity"]["get"]>["entries"][number];
export type ActivityAction = ActivityEntry["action"];
export type ActivityAsked = NonNullable<paths["/api/activity"]["get"]["parameters"]["query"]>;
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
/** The days no visit is offered. */
export type Blackout = Body<paths["/api/blackouts"]["get"]>["blackouts"][number];
export type BlackoutAdd = Sent<paths["/api/blackouts"]["post"]>;
export type SlotTimes = Body<paths["/api/slot-times"]["get"]>;
export type SlotTimesChange = Sent<paths["/api/slot-times"]["post"]>;
export type BlackoutRemove = Sent<paths["/api/blackouts/remove"]["post"]>;
/** Partners who send us clients on their own code (docs/decisions/0123-partner-referral-channels.md). */
export type Partners = Body<paths["/api/referral-channels"]["get"]>;
export type Partner = Partners["channels"][number];
export type PartnerTerms = Sent<paths["/api/referral-channels"]["post"]>;
/** Partners' monthly statements, and their payments (docs/decisions/0124-partner-statements.md). */
export type PartnerStatements = Body<paths["/api/partner-statements"]["get"]>;
export type PartnerStatement = PartnerStatements["statements"][number];
export type PartnerPayout = Sent<paths["/api/partner-statements/{id}/payouts"]["post"]>;
/** The site's words and the WhatsApp messages, as the Words page changes them (docs/decisions/0126-the-words-page.md). */
export type Word = Body<paths["/api/words"]["get"]>["words"][number];
export type WordsPublish = NonNullable<Body<paths["/api/words"]["get"]>["published"]>;
/** Discount codes, and a code on a client's visit (docs/decisions/0108-discount-codes.md). */
export type DiscountCodes = Body<paths["/api/discount-codes"]["get"]>;
export type DiscountCode = Body<paths["/api/discount-codes"]["get"]>["codes"][number];
export type DiscountCodesNew = Sent<paths["/api/discount-codes"]["post"]>;
export type VisitDiscountCode = NonNullable<ClientVisit["discount_code"]>;
export type Price = Body<paths["/api/prices"]["post"]>["prices"][number];
export type PriceChange = Sent<paths["/api/prices"]["post"]>;
export type PriceWithdrawal = Sent<paths["/api/prices/withdraw"]["post"]>;
/** What technicians are paid for each visit (docs/decisions/0122-technician-pay-per-visit.md). */
export type TechnicianPay = Body<paths["/api/technician-pay"]["get"]>;
export type PayRate = TechnicianPay["rates"][number];
export type PayKind = PayRate["kind"];
export type PayRateSet = Sent<paths["/api/technician-pay/rates"]["post"]>;
/** The services clients book, kind by kind, each with its prices (docs/decisions/0085-services-ops-can-edit.md). */
export type ServiceCatalogue = Body<paths["/api/services"]["get"]>;
export type OpsService = ServiceCatalogue["services"][number];
export type Kind = OpsService["kind"];
export type ServedPincode = Body<paths["/api/service-area"]["get"]>["pincodes"][number];
export type AreaChange = Sent<paths["/api/service-area"]["post"]>["changes"][number];
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
/** An item a list's save sends: a checklist's may also say what the client reads. */
export type JobSheetItemSent = Sent<paths["/api/job-sheet/checklists/{visit_type}"]["post"]>["items"][number];
export type Stock = Body<paths["/api/stock"]["get"]>;
export type StockUnits = Body<paths["/api/stock/units"]["get"]>;
export type StockDelivery = Sent<paths["/api/stock/deliveries"]["post"]>;
export type StockTransfer = Sent<paths["/api/stock/transfers"]["post"]>;
export type StockCount = Sent<paths["/api/stock/counts"]["post"]>;
export type StockWriteOff = Sent<paths["/api/stock/write-offs"]["post"]>;
export type StockPlaceAdd = Sent<paths["/api/stock/places"]["post"]>;
export type StockPlaceChange = Sent<paths["/api/stock/places/{id}"]["post"]>;

/** The Staff list: who may do what, and whether it is enforced. */
export type StaffList = Body<paths["/api/staff"]["get"]>;
export type StaffPerson = StaffList["people"][number];
export type StaffGrant = StaffPerson["grants"][number];
export type StaffSave = Sent<paths["/api/staff"]["post"]>;
export type StaffToken = StaffList["service_tokens"][number];
export type StaffTokenAdd = Sent<paths["/api/staff/service-tokens"]["post"]>;

export type NoShowCase = Body<paths["/api/no-shows"]["get"]>["cases"][number];
export type ChargePreview = Body<paths["/api/no-shows/{id}/charge"]["get"]>;
export type DecidedNoShow = Body<paths["/api/no-shows/decided"]["get"]>["cases"][number];
export type NoShowDispute = Body<paths["/api/no-shows/disputes"]["get"]>["disputes"][number];
export type DisputeRuling = Sent<paths["/api/no-shows/disputes/{id}/ruling"]["post"]>["ruling"];
type DayMoney = Body<paths["/api/payments"]["get"]>;
export type Charge = DayMoney["charges"][number];
export type Roster = Body<paths["/api/technicians"]["get"]>;
export type Technician = Roster["technicians"][number];
/** A technician as both lists carry them: active, or switched off. */
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
type TechniciansWork = Body<paths["/api/technicians/work"]["get"]>;
export type TechnicianWork = TechniciansWork["technicians"][number];
export type Board = Body<paths["/api/dispatch"]["get"]>;
export type BoardRow = Board["technicians"][number];
type BoardDay = BoardRow["days"][number];
export type Block = BoardDay["blocks"][number];
export type Unassigned = Board["unassigned"][number];
export type BoardClient = NonNullable<Block["person"]>;
export type Moved = Body<paths["/api/dispatch/move"]["post"]>;
export type Proposed = Body<paths["/api/dispatch/propose"]["post"]>;
export type Room = Body<paths["/api/dispatch/room"]["get"]>["rooms"][number];
export type DispatchDay = Body<paths["/api/dispatch/day"]["get"]>;

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
type ErrorCode = components["schemas"]["ErrorResponse"]["error"]["code"];

/**
 * Whether Access, rather than mm-api, answered. Access redirects a call whose
 * session has run out to the team's login page; the call does not follow it,
 * so it arrives as an opaque redirect. mm-api's own refusal of a missing or
 * spent token is the same thing seen from behind Access.
 */
function lapsedIn(response: Response, code: string | undefined): boolean {
  return response.type === "opaqueredirect" || response.status === 401 || code === "access_required";
}

/** The console's one client; a feature with calls of its own (./care/care-api.ts) makes them with it. */
export const client = createClient<paths, ErrorCode | "signed_out">({
  // A redirect is never followed: the only one a call meets is Access's, to a login page on another origin.
  redirect: "manual",
  sessionEnded: lapsedIn,
  onSessionEnded: markLapsed,
  // Access's redirect carries none of the API's codes.
  missingCode: (status) => (status === 0 ? "signed_out" : "unknown"),
  // A write whose answer was lost is sent again under its key, and answered as it was (src/http/idempotency.ts).
  keyWrites: true,
});

/** Where a job is being put: the technician, the India date and the window. */
export interface Landing {
  readonly technicianId: string;
  readonly date: string;
  readonly window: BookingWindow;
  /** The start chosen in the window; null takes its earliest with room. */
  readonly startsAt: string | null;
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
  /** A visit linked to with no week: the board opens on its day. */
  readonly visit?: string | null;
}

/** A query's fields that are set: a null leaves one to the route. */
export function setOnly<T extends Record<string, string | null>>(fields: T): { [K in keyof T]?: string } {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== null)) as {
    [K in keyof T]?: string;
  };
}

export const moveBody = (appointmentId: string, to: Landing, shown: Shown) => ({
  appointment_id: appointmentId,
  technician_id: to.technicianId,
  date: to.date,
  // A start chosen says the time; with none, the window's earliest start with room is taken.
  ...(to.startsAt === null ? { window: to.window } : { starts_at: to.startsAt }),
  reason: to.reason,
  expected_technician_id: shown.technicianId,
  expected_starts_at: shown.startsAt,
  ...(to.blackoutReason === null ? {} : { blackout_reason: to.blackoutReason }),
});

export const api = {
  /** Who Access let through, and where signing out goes. */
  whoami: () => client.get("/api/whoami"),
  /** Ops called a client who had not heard of a move; its task leaves the Tasks board. */
  toldByPhone: (moveId: string) => client.post("/api/dispatch/moves/{id}/told", { path: { id: moveId } }),
  /**
   * Clients by part of a name or of a number. What ops type goes in the body,
   * never in a path or a query string, so a number stays out of logs and referrers.
   */
  findClients: (text: string) => client.post("/api/clients/find", { body: { text } }),
  client: (id: string) => client.get("/api/clients/{id}", { path: { id } }),
  /** Every queue ops still have to work through, and whose each task is. A task leaves when its row is decided. */
  tasks: () => client.get("/api/tasks"),
  /** The same, with the tasks past the lapse days ops set, which the board otherwise leaves out. */
  tasksWithLapsed: () => client.get("/api/tasks", { query: { lapsed: "include" } }),
  /** What each place holds, what is low, and the latest movements. */
  stock: () => client.get("/api/stock"),
};
