// The technician API, faked in the browser, at the shapes `docs/openapi-tech.json`
// writes (apps/tech/src/api-schema.ts). No mm-api runs for these tests: the app
// is driven through its own client, so what is checked is the app's behaviour,
// not the backend's, which has its own suite. Each body here is typed against
// the app's generated API types, and each reply the fake sends is checked
// against the document as it goes (e2e/contract.ts), so the fake cannot answer
// what mm-api never would.
//
// The people are the design's own invented ones. No real name, number or
// photograph is used anywhere.

import { randomUUID } from "node:crypto";
import type { BrowserContext, Page, Route } from "@playwright/test";
import type { paths } from "../../apps/tech/src/api-schema.ts";
import { assertInContract, type Reply } from "../contract.ts";

/** What `method path` answers with `status`, as the technician app's generated types have it. */
type TechReply<Path extends keyof paths, Method extends keyof paths[Path] = "get", Status extends number = 200> = Reply<
  paths,
  Path,
  Method,
  Status
>;

type Card = TechReply<"/api/tech/jobs/{id}">;
type Job = TechReply<"/api/tech/jobs">["jobs"][number];
type VisitType = NonNullable<Job["type"]>;
export type Progress = Card["progress"];
export type Step = Progress["steps_done"][number];
export type Piece = TechReply<"/api/tech/pieces/lookup">["piece"];
export type HairProfile = NonNullable<Card["profile"]>;

export const ME = {
  id: "88000000-0000-4000-8000-000000000001",
  name: "Imran Qureshi",
  first_name: "Imran",
  initials: "IQ",
  device: {
    device_id: "01000000-0000-7000-8000-000000000001",
    label: "Chrome on Android",
    enrolled_at: "2030-09-01T04:00:00.000Z",
  },
} satisfies TechReply<"/api/tech/me">;

const CHALLENGE_ID = "c0000000-0000-4000-8000-000000000001";

export const JOB_ID = "a0000000-0000-4000-8000-000000000001";
export const SECOND_JOB_ID = "a0000000-0000-4000-8000-000000000002";
export const LOCKED_JOB_ID = "a0000000-0000-4000-8000-000000000003";
export const TOMORROW_JOB_ID = "a0000000-0000-4000-8000-000000000004";

/** Today's calendar date in India, as the app asks the backend for it. */
export function todayInIndia(now: Date = new Date()): string {
  return new Date(now.getTime() + 330 * 60 * 1000).toISOString().slice(0, 10);
}

export function dayBefore(date: string): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10);
}

export function dayAfter(date: string): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
}

const at = (date: string, time: string) => `${date}T${time}:00.000Z`;

/** 6 pm in India on the day before the visit, when its address unlocks (src/policy/job-visibility.ts). */
const unlocksAt = (date: string) => at(dayBefore(date), "12:30");

/** The slots each type takes (src/config/scheduling.ts). */
const SLOTS: Readonly<Record<VisitType, number>> = { consultation: 1, service: 1, replacement: 1.5, first_fit: 2 };

/**
 * Rohit's visit this morning, the first of the day, of the type a test asks for; or, as one visit, his consultation
 * and first fit together, paid for once he is fitted (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md).
 */
const firstJob = (date: string, type: VisitType, oneVisit = false): Job => ({
  id: JOB_ID,
  day: "today",
  date,
  starts_at: at(date, "04:00"),
  ends_at: at(date, "05:30"),
  window_label: "morning",
  type,
  one_visit: oneVisit,
  product: null,
  sector: "Sector 65",
  status: "scheduled",
  badge: oneVisit ? "at_visit" : "prepaid",
  slots: SLOTS[type],
  unlocked: true,
  unlocks_at: unlocksAt(date),
});

const secondJob = (date: string): Job => ({
  id: SECOND_JOB_ID,
  day: "today",
  date,
  starts_at: at(date, "06:00"),
  ends_at: at(date, "07:30"),
  window_label: "morning",
  type: "service",
  one_visit: false,
  product: null,
  sector: "DLF Phase 4",
  status: "scheduled",
  badge: "credit",
  slots: 1,
  unlocked: true,
  unlocks_at: unlocksAt(date),
});

/** This afternoon's first fit, its card still locked as the list shows it. */
const lockedJob = (date: string): Job => ({
  id: LOCKED_JOB_ID,
  day: "later",
  date,
  starts_at: at(date, "08:30"),
  ends_at: at(date, "11:30"),
  window_label: "afternoon",
  type: "first_fit",
  one_visit: false,
  product: "Mane Man Natural",
  sector: "Sector 43",
  status: "scheduled",
  badge: "prepaid",
  slots: 2,
  unlocked: false,
  unlocks_at: unlocksAt(date),
});

/** Tomorrow's one job, unlocked since 6 pm today: its card is open, and its door is not. */
const tomorrowsJob = (today: string): Job => {
  const date = dayAfter(today);
  return {
    id: TOMORROW_JOB_ID,
    day: "tomorrow",
    date,
    starts_at: at(date, "04:30"),
    ends_at: at(date, "06:00"),
    window_label: "morning",
    type: "service",
    one_visit: false,
    product: null,
    sector: "Sector 50",
    status: "scheduled",
    badge: "free",
    slots: 1,
    unlocked: true,
    unlocks_at: unlocksAt(date),
  };
};

export function jobsToday(date: string, type: VisitType = "service"): Job[] {
  return [firstJob(date, type), secondJob(date), lockedJob(date)];
}

export function jobsTomorrow(today: string): Job[] {
  return [tomorrowsJob(today)];
}

const CHECKLIST: Card["checklist"] = [
  { id: "piece_removed", label: "PLACEHOLDER Piece removed" },
  { id: "scalp_cleaned", label: "PLACEHOLDER Scalp cleaned" },
  { id: "piece_cleaned", label: "PLACEHOLDER Piece cleaned" },
];

/** A consultation and fit in one visit: the consultation's three items, then the first fit's six (src/config/job-sheet.ts). */
export const ONE_VISIT_CHECKLIST: Card["checklist"] = [
  { id: "scalp_checked", label: "PLACEHOLDER Scalp and hairline checked" },
  { id: "measurements_taken", label: "PLACEHOLDER Measurements taken" },
  { id: "options_shown", label: "PLACEHOLDER Options and prices shown" },
  { id: "template_checked", label: "PLACEHOLDER Template checked against the head" },
  { id: "base_trimmed", label: "PLACEHOLDER Base trimmed and shaped" },
  { id: "adhesive_applied", label: "PLACEHOLDER Adhesive applied" },
  { id: "piece_set", label: "PLACEHOLDER Piece set and pressed" },
  { id: "cut_and_styled", label: "PLACEHOLDER Cut and styled" },
  { id: "aftercare_explained", label: "PLACEHOLDER Aftercare explained" },
];

/** The reasons as the console set them: the committed four, in src/config/job-sheet.ts's words. */
const PARTIAL_REASONS: Card["partial_reasons"] = [
  { id: "client_stopped_it", label: "Client stopped it partway" },
  { id: "piece_not_ready", label: "PLACEHOLDER The piece was not ready" },
  { id: "client_unwell", label: "PLACEHOLDER Client unwell" },
  { id: "more_time_needed", label: "PLACEHOLDER More time needed" },
];

/**
 * The consumables the console lists, as a service visit's card carries them: the two it is expected to use first,
 * at what it expects, then every other one (docs/decisions/0087-consumables-and-stock.md).
 */
export const CONSUMABLES: Card["consumables"] = [
  { code: "tape_strips", name: "Tape strips", unit: "strip", expected: 4 },
  { code: "solvent", name: "Solvent", unit: "ml", expected: 10 },
  { code: "bonding_glue", name: "Bonding glue", unit: "ml", expected: 0 },
  { code: "shampoo_sachet", name: "Shampoo sachet", unit: "sachet", expected: 0 },
];

/** The products a one visit's client may choose, by name and never by price: made up, as every name here is. */
export const PRODUCTS: Card["products"] = [
  { tier: "essential", name: "Mane Man Essential" },
  { tier: "natural", name: "Mane Man Natural" },
];

/** The API's piece label (src/config/pieces.ts), which it refuses a write for. */
const PIECE_LABEL = /^MM-[A-Z0-9]{2,6}-\d{2,8}-[A-Z]$/;

export const NOTHING_DONE: Progress = {
  checked_in_at: null,
  wait_ends_at: null,
  distance_m: null,
  started_at: null,
  steps_done: [],
  outcome: null,
};

/** Rohit's piece on his head today, fitted in July. */
export const ROHITS_PIECE: Piece = {
  piece_code: "MM-STD-4417-B",
  base: "PLACEHOLDER_STANDARD",
  supplier_lot: "LOT-4417",
  fitted_at: "2030-07-02",
  replacement_due_at: "2030-12-29",
  failed_at: null,
  failure_reason: null,
};

/** Rohit's hair profile as his consultation took it, his history with it. */
export const ROHITS_PROFILE: HairProfile = {
  id: "d0000000-0000-4000-8000-000000000001",
  recorded_at: "2030-07-01T05:00:00.000Z",
  fit: {
    norwood_stage: "IV",
    head_circumference_cm: 57.5,
    front_to_nape_cm: 36,
    ear_to_ear_cm: 33.5,
    temple_to_temple_cm: 34,
    base_width_in: 8,
    base_length_in: 10,
    colour: "1B",
    grey_percent: 20,
    density_percent: 120,
    wave: "slight_wave",
    hairline: "natural",
    product: "essential",
    product_name: "Mane Man Essential",
    attachment: "tape",
  },
  history: { remedies: ["minoxidil"], transplant_year: null, skin_and_allergies: "Dry at the crown" },
};

/** The API's steps (src/policy/in-job-steps.ts): a consultation and a one visit take the profile. */
function stepsFor(type: VisitType, oneVisit = false): Step[] {
  const takesPiece = oneVisit || type === "replacement" || type === "first_fit";
  const takesProfile = oneVisit || type === "consultation";
  return [
    "before_photos",
    "checklist",
    "consumables",
    ...(takesPiece ? (["piece"] as const) : []),
    ...(takesProfile ? (["profile"] as const) : []),
    "after_photos",
    "outcome",
  ];
}

/** Parts of the address the client filled in beyond the fixture's two lines: flat, floor, tower, building, landmark. */
type AddressParts = Partial<NonNullable<Card["address"]>>;

export interface CardOptions {
  readonly pin?: boolean;
  readonly type?: VisitType;
  readonly waitMinutes?: number;
  readonly pieces?: readonly Piece[];
  readonly lastVisit?: boolean;
  readonly reminderDelivered?: string | null;
  /** Parts of the address the client filled in beyond the fixture's two lines: flat, floor, tower, building, landmark. */
  readonly address?: AddressParts;
  /** A consultation and fit in one visit, its products on the card. */
  readonly oneVisit?: boolean;
  /** The client's hair profile as it stands; none recorded unless a test gives one. */
  readonly profile?: HairProfile | null;
  readonly checklist?: Card["checklist"];
  /** A one visit's discount code already on it; none unless a test gives one. */
  readonly discountCode?: Card["discount_code"];
}

export function card(date: string, progress: Progress, options: CardOptions = {}): Card {
  const type = options.type ?? "service";
  const oneVisit = options.oneVisit === true;
  return {
    ...firstJob(date, type, oneVisit),
    address: {
      line1: "Tower C, 14th floor",
      line2: null,
      building: null,
      tower: null,
      floor: null,
      flat: null,
      landmark: null,
      locality: "Sector 65",
      city: "Gurgaon",
      pincode: "122018",
      // An address the client typed rather than chose carries no coordinate (ADR 0054).
      lat: options.pin === false ? null : 28.39,
      lng: options.pin === false ? null : 77.07,
      ...options.address,
    },
    access_notes: "Gate code 4417 · visitor bay B",
    client: { name: "Rohit M.", mobile: "+919810000000", note: null },
    progress,
    no_show_wait_min: options.waitMinutes ?? 15,
    pieces: [...(options.pieces ?? [])],
    last_visit:
      options.lastVisit === true
        ? { date: "2030-08-22", technician: "Imran", photo_url: `/api/tech/jobs/${JOB_ID}/last-visit-photo` }
        : null,
    reminder: options.reminderDelivered === undefined ? null : { delivered_at: options.reminderDelivered },
    steps: stepsFor(oneVisit ? "first_fit" : type, oneVisit),
    checklist: options.checklist ?? CHECKLIST,
    partial_reasons: PARTIAL_REASONS,
    consumables: CONSUMABLES,
    products: oneVisit || type === "consultation" ? PRODUCTS : [],
    payment_link: null,
    discount_code: options.discountCode ?? null,
    profile: options.profile ?? null,
  };
}

/** A job further out: time, type and sector only, as the day-before unlock leaves it. */
export function lockedCard(date: string): Card {
  return {
    ...lockedJob(date),
    address: null,
    access_notes: null,
    client: null,
    progress: NOTHING_DONE,
    no_show_wait_min: 15,
    pieces: null,
    last_visit: null,
    reminder: null,
    steps: stepsFor("first_fit"),
    checklist: CHECKLIST,
    partial_reasons: PARTIAL_REASONS,
    consumables: CONSUMABLES,
    products: [],
    payment_link: null,
    discount_code: null,
    profile: null,
  };
}

/** Tomorrow's card: unlocked, so the address is there, and on a day that is not today. */
function tomorrowCard(today: string): Card {
  return { ...card(today, NOTHING_DONE), ...tomorrowsJob(today) };
}

export interface Write {
  readonly path: string;
  readonly eventId: string | null;
  /** The job's start as the phone held it when it queued the write. */
  readonly startsAt: string | null;
  readonly body: unknown;
}

export interface Fake {
  /** False stands for a basement: every call fails as it does with no signal. */
  online: boolean;
  /** False until a code is verified: the API has no session for this phone, and every call but the sign-in's is a 401. */
  signedIn: boolean;
  /** True once ops revoke the phone: every call is a 401 `device_revoked`. */
  revoked: boolean;
  /** True once ops switch the technician off: every call but the sign-in's is a 401 `technician_inactive`. */
  switchedOff: boolean;
  /** True makes the next code the phone checks one the API has closed, a `410`. */
  codeClosed: boolean;
  /** Every mobile number a code was asked for, in order. */
  readonly codesSent: string[];
  /** True makes the day's list arrive in a shape the app cannot draw, as a broken release might send it. */
  malformed: boolean;
  /** Set to make the next write answer `409 superseded` with these fields. */
  supersede: readonly string[] | null;
  /** Set with `supersede` to name whom the job went to, and when, as the API does (open point 92). */
  wentTo: WentTo;
  /**
   * True once ops have given the job to someone else: its card and a
   * photograph's PUT answer 404, as the API answers for a job that is not this
   * technician's, and a write or an upload link answers `409 superseded`
   * naming the field, and whom the job went to where `wentTo` says.
   */
  moved: boolean;
  /**
   * Set to move the job to another time: a write that holds any other answers
   * `409 superseded`, field time. The card goes on answering the old time, as
   * the copy the phone holds does until it asks again.
   */
  movedTo: string | null;
  /** Set to make the no-show refuse with `425 too_early_to_close`, as it does before the wait runs. */
  tooEarly: boolean;
  /** What the check-in answers: pass, or a distance outside the radius. */
  checkIn: { passed: boolean; distance_m: number | null };
  /** How long the no-show wait runs from the check-in, in whole minutes, as ops set it. */
  waitMinutes: number;
  /**
   * Set to answer a passing check-in with only this many milliseconds of the wait
   * left, so a test need not wait whole minutes. The API answers so for a check-in
   * the phone made earlier and sent late, which keeps its claimed time (ADR 0065).
   */
  waitLeftMs: number | null;
  /** False for an address saved by typing, which has no coordinate for Navigate to take. */
  pin: boolean;
  /** The first job's type: a replacement or a first fit has the piece step. */
  type: VisitType;
  /** True makes the first job a consultation and fit in one visit. */
  oneVisit: boolean;
  /** The discount code already on the one visit, or none. */
  discountCode: Card["discount_code"];
  /** The client's pieces on the card. */
  pieces: Piece[];
  /** The client's hair profile on the card, or none recorded. */
  profile: HairProfile | null;
  /** The checklist on the card: three items unless a test gives a longer one. */
  checklist: Card["checklist"];
  /** Parts of the address beyond the fixture's two lines. */
  address: AddressParts;
  /** Whether the client has a last visit with an after photograph. */
  lastVisit: boolean;
  /** The day-before WhatsApp: undefined when none was sent, null when it never arrived. */
  reminderDelivered: string | null | undefined;
  /** True puts one unlocked job on tomorrow's list. */
  tomorrow: boolean;
  /** Every write that reached the API, in the order it arrived. */
  readonly writes: Write[];
  /** Every photograph PUT to an upload link, by its angle. */
  readonly photos: string[];
  /** Every thumbnail PUT beside a photograph, by its angle. */
  readonly thumbnails: string[];
  /** What the job's card reports, which the fake moves on as writes land. */
  progress: Progress;
}

const accepted = (fake: Fake, eventId: string | null): TechReply<"/api/tech/jobs/{id}/start", "post", 202> => ({
  event_id: eventId ?? "",
  replayed: false,
  fsm_write_state: "pending",
  progress: fake.progress,
});

/** Sends the fake's answer, once the contract says mm-api could have sent it (e2e/contract.ts). */
function reply(route: Route, status: number, body?: unknown): Promise<void> {
  const request = route.request();
  assertInContract("tech", request.method(), new URL(request.url()).pathname, status, body);
  return body === undefined ? route.fulfill({ status }) : route.fulfill({ status, json: body });
}

/** Whom a job went to, by first name, and when, as a `409 superseded` names the other technician. */
type WentTo = { technician: string; at: string | null } | null;

const refuse = (route: Route, status: number, code: string, fields: readonly string[] = [], moved: WentTo = null) =>
  reply(route, status, {
    error:
      moved === null
        ? { code, request_id: "test", fields: [...fields] }
        : { code, request_id: "test", fields: [...fields], moved },
  });

/** A 1×1 grey PNG: the last visit's photograph, which is nobody's. */
const LAST_VISIT_PHOTO = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgAB4iG8MwAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * Answers the technician API for one page. Anything not named here is a 404, so
 * a screen calling a route nobody agreed to fails the test rather than passing
 * quietly.
 *
 * `on` is the page, except where a service worker is running: a worker's own
 * calls reach browserContext.route() and not page.route(), so the offline tests
 * pass the context instead (e2e/tech/offline.e2e.ts).
 */
export async function fakeTech(page: Page, empty = false, on: Page | BrowserContext = page): Promise<Fake> {
  const fake: Fake = {
    online: true,
    signedIn: true,
    revoked: false,
    switchedOff: false,
    codeClosed: false,
    codesSent: [],
    malformed: false,
    supersede: null,
    wentTo: null,
    moved: false,
    movedTo: null,
    tooEarly: false,
    checkIn: { passed: true, distance_m: 40 },
    waitMinutes: 15,
    waitLeftMs: null,
    pin: true,
    type: "service",
    oneVisit: false,
    discountCode: null,
    pieces: [],
    profile: null,
    checklist: CHECKLIST,
    address: {},
    lastVisit: false,
    reminderDelivered: undefined,
    tomorrow: false,
    writes: [],
    photos: [],
    thumbnails: [],
    progress: NOTHING_DONE,
  };

  const jobCard = (today: string) =>
    card(today, fake.progress, {
      pin: fake.pin,
      type: fake.type,
      waitMinutes: fake.waitMinutes,
      pieces: fake.pieces,
      lastVisit: fake.lastVisit,
      reminderDelivered: fake.reminderDelivered,
      address: fake.address,
      oneVisit: fake.oneVisit,
      profile: fake.profile,
      checklist: fake.checklist,
      discountCode: fake.discountCode,
    });

  await on.route("**/api/tech/**", async (route: Route) => {
    if (!fake.online) return route.abort();
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    const headers = route.request().headers();
    const eventId = headers["x-client-event-id"] ?? null;
    const startsAt = headers["x-job-starts-at"] ?? null;
    // Asked on every request, so a run that crosses midnight in India reads the new day as the app does.
    const today = todayInIndia();

    // The sign-in: a code for any number, and any six digits right unless the code was closed.
    if (method === "POST" && path === "/api/tech/auth/otp") {
      const body = route.request().postDataJSON() as { mobile: string };
      fake.codesSent.push(body.mobile);
      return reply(route, 202, { challenge_id: CHALLENGE_ID, expires_in_s: 600 });
    }
    if (method === "POST" && path === "/api/tech/auth/verify") {
      if (fake.codeClosed) return refuse(route, 410, "code_expired");
      fake.signedIn = true;
      return reply(route, 200, { verified: true, first_name: ME.first_name, device_id: ME.device.device_id });
    }
    if (fake.revoked) return refuse(route, 401, "device_revoked");
    if (fake.switchedOff) return refuse(route, 401, "technician_inactive");
    if (!fake.signedIn) return refuse(route, 401, "session_required");

    // The photograph itself, and its thumbnail: PUT to the links the API handed out.
    if (method === "PUT" && path.startsWith("/api/tech/photos/")) {
      if (fake.moved) return refuse(route, 404, "not_found");
      const slot = path.slice("/api/tech/photos/".length);
      if (slot.endsWith("/small")) {
        fake.thumbnails.push(slot.slice(0, -"/small".length));
        return reply(route, 204);
      }
      fake.photos.push(slot);
      return reply(route, 200, { take: randomUUID() });
    }

    if (method === "POST") {
      if (path === "/api/tech/auth/logout") return reply(route, 204);
      if (path.endsWith("/photos/upload-url")) {
        if (fake.moved) return refuse(route, 409, "superseded", ["technician"], fake.wentTo);
        const body = route.request().postDataJSON() as { phase: string; angle: string };
        return reply(route, 201, {
          upload_url: `/api/tech/photos/${body.phase}-${body.angle}`,
          small_upload_url: `/api/tech/photos/${body.phase}-${body.angle}/small`,
          expires_at: new Date(Date.now() + 900_000).toISOString(),
        });
      }

      if (fake.moved) return refuse(route, 409, "superseded", ["technician"], fake.wentTo);
      if (fake.movedTo !== null && startsAt !== null && startsAt !== fake.movedTo) {
        return refuse(route, 409, "superseded", ["time"]);
      }
      const changed = fake.supersede;
      if (changed !== null) return refuse(route, 409, "superseded", changed, fake.wentTo);
      if (path.endsWith("/no-show") && fake.tooEarly) return refuse(route, 425, "too_early_to_close");

      // A one visit's client may decide against the fit, when the piece step carries no label.
      const body = route.request().postDataJSON() as { piece_code?: string; declined?: boolean } | null;
      const declined = body?.declined === true;
      if (path.endsWith("/piece") && !declined && !PIECE_LABEL.test(body?.piece_code ?? "")) {
        return refuse(route, 400, "invalid_request", ["piece_code"]);
      }
      fake.writes.push({ path, eventId, startsAt, body });

      if (path.endsWith("/checkin")) {
        const now = new Date();
        const waitEnds = new Date(now.getTime() + (fake.waitLeftMs ?? fake.waitMinutes * 60_000)).toISOString();
        if (fake.checkIn.passed) {
          fake.progress = {
            ...fake.progress,
            checked_in_at: now.toISOString(),
            wait_ends_at: waitEnds,
            distance_m: fake.checkIn.distance_m,
          };
        }
        return reply(route, 200, {
          passed: fake.checkIn.passed,
          distance_m: fake.checkIn.distance_m,
          radius_m: 200,
          checked_in_at: now.toISOString(),
          wait_ends_at: fake.checkIn.passed ? waitEnds : null,
          accepted: fake.checkIn.passed ? accepted(fake, eventId) : null,
        });
      }
      if (path.endsWith("/start")) {
        fake.progress = { ...fake.progress, started_at: new Date().toISOString() };
        return reply(route, 202, accepted(fake, eventId));
      }
      // The profile is no job event: its answer carries no FSM write (docs/decisions/0106-a-clients-hair-profile.md).
      if (path.endsWith("/profile")) {
        fake.progress = { ...fake.progress, steps_done: [...fake.progress.steps_done, "profile"] };
        return reply(route, 202, { event_id: eventId ?? "", replayed: false, progress: fake.progress });
      }
      if (path.endsWith("/no-show")) {
        fake.progress = { ...fake.progress, outcome: "no_show" };
        return reply(route, 200, {
          closed: true,
          wait_ends_at: new Date().toISOString(),
          case_id: "b0000000-0000-4000-8000-000000000001",
          accepted: accepted(fake, eventId),
        });
      }
      const step = stepOf(path, body as { phase?: string } | null);
      if (step !== null) {
        fake.progress = { ...fake.progress, steps_done: [...fake.progress.steps_done, step] };
        if (step === "outcome") {
          const outcome = (body as { outcome?: string } | null)?.outcome ?? "done";
          fake.progress = { ...fake.progress, outcome };
        }
        return reply(route, 202, accepted(fake, eventId));
      }
      return refuse(route, 404, "not_found");
    }

    if (path === "/api/tech/me") return reply(route, 200, ME);
    if (path === "/api/tech/jobs") {
      const date = url.searchParams.get("date") ?? "";
      // Outside the contract on purpose: what a broken release might send, which the app must survive.
      if (fake.malformed) return route.fulfill({ json: { date, jobs: null } });
      if (date === today) return reply(route, 200, { date, jobs: empty ? [] : jobsToday(date, fake.type) });
      if (date === dayAfter(today) && fake.tomorrow) return reply(route, 200, { date, jobs: jobsTomorrow(today) });
      return reply(route, 200, { date, jobs: [] });
    }
    if (path === "/api/tech/pieces/lookup") {
      const code = url.searchParams.get("code") ?? "";
      if (!PIECE_LABEL.test(code)) return refuse(route, 404, "not_found");
      return reply(route, 200, {
        piece: { ...ROHITS_PIECE, piece_code: code },
        belongs_to_this_job: code === ROHITS_PIECE.piece_code,
      });
    }
    if (path === `/api/tech/jobs/${JOB_ID}/last-visit-photo`) {
      if (fake.moved || !fake.lastVisit) return refuse(route, 404, "not_found");
      assertInContract("tech", method, path, 200);
      return route.fulfill({ contentType: "image/png", body: LAST_VISIT_PHOTO });
    }
    if (path === `/api/tech/jobs/${JOB_ID}`) {
      return fake.moved ? refuse(route, 404, "not_found") : reply(route, 200, jobCard(today));
    }
    if (path === `/api/tech/jobs/${LOCKED_JOB_ID}`) return reply(route, 200, lockedCard(today));
    if (path === `/api/tech/jobs/${TOMORROW_JOB_ID}` && fake.tomorrow) {
      return reply(route, 200, tomorrowCard(today));
    }
    return refuse(route, 404, "not_found");
  });

  return fake;
}

/** The job event a POST stands for, so the fake's progress moves as the real one does. */
function stepOf(path: string, body: { phase?: string } | null): Step | null {
  if (path.endsWith("/photos")) return body?.phase === "after" ? "after_photos" : "before_photos";
  for (const step of ["checklist", "consumables", "piece", "outcome"] as const) {
    if (path.endsWith(`/${step}`)) return step;
  }
  return null;
}

/** Whether anything scrolls but a screen's own body: the page, or the column the screens sit in. */
export function pageScrolls(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const column = document.getElementById("root");
    const pageHeight = document.scrollingElement?.scrollHeight ?? 0;
    return pageHeight > window.innerHeight || (column !== null && column.scrollHeight > column.clientHeight);
  });
}

/** Everything the phone is holding in its own store, read from the page. */
export function heldOnPhone(
  page: Page,
): Promise<{ outbox: number; frames: number; frameSizes: number[]; smallSizes: number[] }> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("mm-tech");
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(new Error("no store"));
      };
    });
    const read = <T>(store: string) =>
      new Promise<T[]>((resolve) => {
        const request = db.transaction(store, "readonly").objectStore(store).getAll() as IDBRequest<T[]>;
        request.onsuccess = () => {
          resolve(request.result);
        };
      });
    const outbox = await read<unknown>("outbox");
    const frames = await read<{ frame: Blob; small?: Blob }>("frames");
    return {
      outbox: outbox.length,
      frames: frames.length,
      frameSizes: frames.map((kept) => kept.frame.size),
      smallSizes: frames.map((kept) => kept.small?.size ?? 0),
    };
  });
}

/** The angles of the frames the phone holds, in the order the store keeps them. */
export function anglesOnPhone(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("mm-tech");
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(new Error("no store"));
      };
    });
    const frames = await new Promise<{ angle: string }[]>((resolve) => {
      const request = db.transaction("frames", "readonly").objectStore("frames").getAll() as IDBRequest<
        { angle: string }[]
      >;
      request.onsuccess = () => {
        resolve(request.result);
      };
    });
    db.close();
    return frames.map((frame) => frame.angle);
  });
}

/** Whether the phone still holds its store at all: a wipe deletes the whole database. */
export async function storeOnPhone(page: Page): Promise<boolean> {
  const names = await page.evaluate(() => indexedDB.databases().then((each) => each.map((one) => one.name)));
  return names.includes("mm-tech");
}

/** The keys of what the phone keeps of the API, sorted: its days, its cards, and each job's arrival and close-out. */
export function keptOnPhone(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("mm-tech");
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(new Error("no store"));
      };
    });
    const keys = await new Promise<IDBValidKey[]>((resolve) => {
      const request = db.transaction("jobs", "readonly").objectStore("jobs").getAllKeys();
      request.onsuccess = () => {
        resolve(request.result);
      };
    });
    db.close();
    return keys.map(String).sort();
  });
}

/** Puts records straight into what the phone keeps, as an older day's work would have left them. */
export async function leftOnPhone(page: Page, records: readonly object[]): Promise<void> {
  await page.evaluate(async (kept) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("mm-tech");
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(new Error("no store"));
      };
    });
    await new Promise<void>((resolve) => {
      const transaction = db.transaction("jobs", "readwrite");
      for (const record of kept) transaction.objectStore("jobs").put(record);
      transaction.oncomplete = () => {
        resolve();
      };
    });
    db.close();
  }, records);
}

/** The phone's position, so board B5's check-in can run without a real fix. */
export async function atTheDoor(page: Page, lat = 28.39, lng = 77.07): Promise<void> {
  await page.context().grantPermissions(["geolocation"]);
  await page.context().setGeolocation({ latitude: lat, longitude: lng });
}
