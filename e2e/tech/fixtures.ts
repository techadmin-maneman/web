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
//
// The jobs and cards are here; the fake API that serves them is ./fake-tech.ts, and what a test reads off the
// phone ./on-phone.ts.

// The API's own rules, so the fake cannot drift from them: the card's steps.
import { cardStepsFor } from "../../src/policy/in-job-steps.ts";
import { indiaDate } from "../../src/lib/india-time.ts";
import type { paths } from "../../apps/tech/src/api-schema.ts";
import { type Reply } from "../contract.ts";

/** What `method path` answers with `status`, as the technician app's generated types have it. */
export type TechReply<
  Path extends keyof paths,
  Method extends keyof paths[Path] = "get",
  Status extends number = 200,
> = Reply<paths, Path, Method, Status>;

export type Card = TechReply<"/api/tech/jobs/{id}">;
type Job = TechReply<"/api/tech/jobs">["jobs"][number];
export type VisitType = NonNullable<Job["type"]>;
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

export const CHALLENGE_ID = "c0000000-0000-4000-8000-000000000001";

export const JOB_ID = "a0000000-0000-4000-8000-000000000001";
export const SECOND_JOB_ID = "a0000000-0000-4000-8000-000000000002";
export const LOCKED_JOB_ID = "a0000000-0000-4000-8000-000000000003";
export const TOMORROW_JOB_ID = "a0000000-0000-4000-8000-000000000004";

/** Today's calendar date in India, as the app asks the backend for it. */
export function todayInIndia(now: Date = new Date()): string {
  return indiaDate(now);
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

/** Midnight in India as the visit's day begins: a test taps I have arrived whenever on the day it runs. */
const checkInOpens = (date: string) => at(dayBefore(date), "18:30");

/** The slots each type takes, and how long it is booked for (src/config/scheduling.ts). */
const SLOTS: Readonly<Record<VisitType, number>> = { consultation: 1, service: 1, replacement: 1.5, first_fit: 2 };
const MINUTES: Readonly<Record<VisitType, number>> = {
  consultation: 60,
  service: 90,
  replacement: 135,
  first_fit: 180,
};

/** A job nothing of which has reached us, as the day's list says it. */
const NOT_BEGUN: Job["progress"] = { started_at: null, outcome: null };

/**
 * Rohit's visit this morning, the first of the day, of the type a test asks for; or, as one visit, their consultation
 * and first fit together, paid for once they are fitted (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md).
 */
const firstJob = (date: string, type: VisitType, oneVisit = false, progress = NOT_BEGUN): Job => ({
  id: JOB_ID,
  day: "today",
  date,
  starts_at: at(date, "04:00"),
  ends_at: at(date, "05:30"),
  window_label: "morning",
  type,
  one_visit: oneVisit,
  service: null,
  sector: "Sector 65",
  status: "scheduled",
  badge: oneVisit ? "at_visit" : "prepaid",
  slots: SLOTS[type],
  minutes: MINUTES[type],
  unlocked: true,
  unlocks_at: unlocksAt(date),
  client_name: "Rohit M.",
  progress,
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
  service: null,
  sector: "DLF Phase 4",
  status: "scheduled",
  badge: "credit",
  slots: 1,
  minutes: 90,
  unlocked: true,
  unlocks_at: unlocksAt(date),
  client_name: "Vikram S.",
  progress: NOT_BEGUN,
});

/** This afternoon's first fit, its card still locked as the list shows it, until 6 pm tomorrow. */
const lockedJob = (date: string): Job => ({
  id: LOCKED_JOB_ID,
  day: "later",
  date,
  starts_at: at(date, "08:30"),
  ends_at: at(date, "11:30"),
  window_label: "afternoon",
  type: "first_fit",
  one_visit: false,
  service: { tier: "natural", name: "Mane Man Natural" },
  sector: "Sector 43",
  status: "scheduled",
  badge: "prepaid",
  slots: 2,
  minutes: 180,
  unlocked: false,
  unlocks_at: at(dayAfter(date), "12:30"),
  client_name: null,
  progress: NOT_BEGUN,
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
    service: null,
    sector: "Sector 50",
    status: "scheduled",
    badge: "free",
    slots: 1,
    minutes: 90,
    unlocked: true,
    unlocks_at: unlocksAt(date),
    client_name: "Rohit M.",
    progress: NOT_BEGUN,
  };
};

/** The day's list; `progress` is where Rohit's job stands, as the list carries it. */
export function jobsToday(date: string, type: VisitType = "service", progress = NOT_BEGUN, oneVisit = false): Job[] {
  return [firstJob(date, type, oneVisit, progress), secondJob(date), lockedJob(date)];
}

export function jobsTomorrow(today: string): Job[] {
  return [tomorrowsJob(today)];
}

export const CHECKLIST: Card["checklist"] = [
  { id: "piece_removed", label: "Hair system removed" },
  { id: "scalp_cleaned", label: "Scalp cleaned" },
  { id: "piece_cleaned", label: "Hair system cleaned" },
];

/** A consultation's checklist, which a one visit runs alone once the client decides against the fit. */
const CONSULTATION_CHECKLIST: Card["checklist"] = [
  { id: "scalp_checked", label: "Scalp and hairline checked" },
  { id: "measurements_taken", label: "Measurements taken" },
  { id: "options_shown", label: "Options and prices shown" },
];

/** A consultation and fit in one visit: the consultation's three items, then the first fit's six (src/config/job-sheet.ts). */
export const ONE_VISIT_CHECKLIST: Card["checklist"] = [
  ...CONSULTATION_CHECKLIST,
  { id: "template_checked", label: "Template checked against the head" },
  { id: "base_trimmed", label: "Base trimmed and shaped" },
  { id: "adhesive_applied", label: "Adhesive applied" },
  { id: "piece_set", label: "Hair system set and pressed" },
  { id: "cut_and_styled", label: "Cut and styled" },
  { id: "aftercare_explained", label: "Aftercare explained" },
];

/** The reasons as the console set them: the committed four, in src/config/job-sheet.ts's words. */
const PARTIAL_REASONS: Card["partial_reasons"] = [
  { id: "client_stopped_it", label: "Client stopped it partway" },
  { id: "piece_not_ready", label: "Hair system not ready" },
  { id: "client_unwell", label: "Client unwell" },
  { id: "more_time_needed", label: "More time needed" },
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

export const NOTHING_DONE: Progress = {
  checked_in_at: null,
  wait_ends_at: null,
  distance_m: null,
  started_at: null,
  steps_done: [],
  outcome: null,
};

/** Rohit's piece on their head today, fitted in July. */
export const ROHITS_PIECE: Piece = {
  piece_code: "MM-STD-4417-B",
  base: "PLACEHOLDER_STANDARD",
  supplier_lot: "LOT-4417",
  fitted_at: "2030-07-02",
  replacement_due_at: "2030-12-29",
  failed_at: null,
  failure_reason: null,
};

/** Rohit's hair profile as their consultation took it, their history with it. */
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

/** Parts of the address the client filled in beyond the fixture's two lines: flat, floor, tower, building, landmark. */
export type AddressParts = Partial<NonNullable<Card["address"]>>;

export interface CardOptions {
  readonly pin?: boolean;
  readonly type?: VisitType;
  readonly waitMinutes?: number;
  /** The booked start; the fixture's 9:30 am when null or left out. */
  readonly startsAt?: string | null;
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
  /** The service the visit was sold as; none unless a test gives one. */
  readonly service?: Card["service"];
  /** What a one visit's client decided at the piece step that landed; none unless a test gives it. */
  readonly clientChoice?: Card["client_choice"];
}

export function card(date: string, progress: Progress, options: CardOptions = {}): Card {
  const type = options.type ?? "service";
  const oneVisit = options.oneVisit === true;
  const job = firstJob(date, type, oneVisit);
  return {
    ...job,
    starts_at: options.startsAt ?? job.starts_at,
    service: options.service ?? null,
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
    checkin_from: checkInOpens(date),
    // Not the policy's 200 m: ops have tuned it, and the door says theirs.
    checkin_radius_m: 150,
    pieces: [...(options.pieces ?? [])],
    last_visit:
      options.lastVisit === true
        ? { date: "2030-08-22", technician: "Imran", photo_url: `/api/tech/jobs/${JOB_ID}/last-visit-photo` }
        : null,
    reminder: options.reminderDelivered === undefined ? null : { delivered_at: options.reminderDelivered },
    steps: cardStepsFor(oneVisit ? "first_fit" : type, oneVisit),
    checklist: options.checklist ?? CHECKLIST,
    checklist_if_declined: oneVisit ? CONSULTATION_CHECKLIST : [],
    partial_reasons: PARTIAL_REASONS,
    consumables: CONSUMABLES,
    products: oneVisit || type === "consultation" ? PRODUCTS : [],
    payment_link: null,
    discount_code: options.discountCode ?? null,
    client_choice: oneVisit ? (options.clientChoice ?? null) : null,
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
    checkin_from: checkInOpens(date),
    checkin_radius_m: 150,
    pieces: null,
    last_visit: null,
    reminder: null,
    steps: cardStepsFor("first_fit"),
    checklist: CHECKLIST,
    checklist_if_declined: [],
    partial_reasons: PARTIAL_REASONS,
    consumables: CONSUMABLES,
    products: [],
    payment_link: null,
    discount_code: null,
    client_choice: null,
    profile: null,
  };
}

/** Tomorrow's card: unlocked, so the address is there, and on a day that is not today. */
export function tomorrowCard(today: string): Card {
  return { ...card(today, NOTHING_DONE), ...tomorrowsJob(today), progress: NOTHING_DONE };
}
