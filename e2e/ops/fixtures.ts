// What the ops routes answer in these tests. The figures are the Ops Console
// board's own (design/phase2/Ops Console.dc.html, B2, B3 and C1 to C3), so a
// test reads beside the drawing; nothing here is a real person, number,
// address or photograph.
//
// The queues the console reads are empty on a fresh local database, and
// seeding a held grant or a client's photographs would mean writing rows no
// route creates. So the tests that need them answer the API themselves, as
// e2e/app's do for a state the API cannot be put into.

import type { Page, Route } from "@playwright/test";
import sharp from "sharp";

export const HELD = {
  held: [
    {
      id: "aa000000-0000-4000-8000-000000000001",
      referrer: { person_id: "11000000-0000-4000-8000-000000000001", name: "Rohit Malhotra" },
      referred: { person_id: "11000000-0000-4000-8000-000000000002", name: "Vikram Sethi" },
      fitted_on: "2027-09-19",
      signals: ["shared_address"],
    },
    {
      id: "aa000000-0000-4000-8000-000000000002",
      referrer: { person_id: "11000000-0000-4000-8000-000000000003", name: "Ashish Gill" },
      referred: { person_id: "11000000-0000-4000-8000-000000000004", name: "Manoj Gill" },
      fitted_on: "2027-09-21",
      signals: ["shared_upi"],
    },
    {
      id: "aa000000-0000-4000-8000-000000000003",
      referrer: { person_id: "11000000-0000-4000-8000-000000000005", name: "Karan Bose" },
      referred: { person_id: "11000000-0000-4000-8000-000000000006", name: "Nikhil Arora" },
      fitted_on: "2027-09-22",
      signals: ["monthly_cap"],
    },
  ],
};

export const REFERRERS = {
  referrers: [
    { code: "KB1102", name: "Karan Bose", opens: 19, consultations: 9, fits: 6, granted: 15, redeemed: 2 },
    { code: "RM4417", name: "Rohit Malhotra", opens: 7, consultations: 3, fits: 2, granted: 6, redeemed: 4 },
    { code: "AG2208", name: "Ashish Gill", opens: 4, consultations: 2, fits: 1, granted: 3, redeemed: 3 },
    { code: "VS0916", name: "Vikram Sethi", opens: 1, consultations: 0, fits: 0, granted: 0, redeemed: 0 },
  ],
};

export const AREAS = {
  areas: [
    {
      pincode: "400050",
      area: "Bandra W",
      city: "Mumbai",
      served: false,
      launched_at: null,
      waiting: 117,
      oldest: "2027-02-04T06:00:00.000Z",
      referred: 31,
      alerts: 84,
    },
    {
      pincode: "400026",
      area: "Cumballa",
      city: "Mumbai",
      served: false,
      launched_at: null,
      waiting: 64,
      oldest: "2027-03-19T06:00:00.000Z",
      referred: 12,
      alerts: 41,
    },
    {
      pincode: "122018",
      area: "Sector 65",
      city: "Gurgaon",
      served: true,
      launched_at: "2026-11-01T06:00:00.000Z",
      waiting: 4,
      oldest: "2027-05-11T06:00:00.000Z",
      referred: 1,
      alerts: 2,
    },
  ],
};

export const PREVIEW = { pincode: "400050", waiting: 117, alerts: 84, launched: false };
export const LAUNCHED = { pincode: "400050", waiting: 117, alerts: 84, launched: true };

// ---- Boards A1, A2 and A3: the week the dispatch board draws -----------------

/** Fri 19 to Thu 25 September, the week board A1 heads, in a year whose days fall as it draws them. */
const DATES = ["2025-09-19", "2025-09-20", "2025-09-21", "2025-09-22", "2025-09-23", "2025-09-24", "2025-09-25"];

/** Each column's utilisation, as the board letters it; 92 and 88 are the weekend's peak. */
const UTILISATION = [64, 92, 88, 58, 64, 61, 67];

const BOARD_TECHNICIANS = [
  { id: "66000000-0000-4000-8000-000000000001", name: "Imran Qureshi", initials: "IQ", zone: "Sec 40–65" },
  { id: "66000000-0000-4000-8000-000000000002", name: "Sandeep Yadav", initials: "SY", zone: "Sec 1–39" },
  { id: "66000000-0000-4000-8000-000000000003", name: "Arjun Negi", initials: "AN", zone: "DLF 1–5" },
  { id: "66000000-0000-4000-8000-000000000004", name: "Faizan Ali", initials: "FA", zone: "Sohna Rd" },
];

/** "Blocks are sized by slot: consultation and service 1, replacement 1.5, first fit 2." */
const SLOTS: Readonly<Record<string, number>> = { consultation: 1, service: 1, replacement: 1.5, first_fit: 2 };
/** Each window's first half-slot in India's time, as UTC (docs/decisions/0035-window-slot-map.md). */
const STARTS: Readonly<Record<string, string>> = { morning: "03:30", afternoon: "06:30", evening: "10:30" };

let jobs = 0;
const job = (type: string, client: string | null, sector: string, day: number, window: string) => ({
  appointment_id: `77000000-0000-4000-8000-${String(++jobs).padStart(12, "0")}`,
  type,
  starts_at: `${DATES[day] ?? ""}T${STARTS[window] ?? ""}:00.000Z`,
  window,
  slots: SLOTS[type] ?? 1,
  status: "scheduled",
  client,
  sector,
});

/** One technician's seven days, from the blocks given against the day they fall on. */
const daysOf = (blocks: readonly { day: number; block: ReturnType<typeof job> }[]) =>
  DATES.map((date, day) => ({ date, blocks: blocks.filter((each) => each.day === day).map((each) => each.block) }));

const on = (day: number, block: ReturnType<typeof job>) => ({ day, block });

/**
 * The board's own week: the design's rows, with two jobs in a cell put in
 * different windows, because a technician cannot hold two in one (ADR 0034).
 */
export const BOARD = {
  from: DATES[0],
  dates: DATES,
  technicians: [
    {
      technician_id: BOARD_TECHNICIANS[0]?.id,
      name: BOARD_TECHNICIANS[0]?.name,
      initials: BOARD_TECHNICIANS[0]?.initials,
      zone: BOARD_TECHNICIANS[0]?.zone,
      days: daysOf([
        on(0, job("service", "Rohit M.", "Sec 65", 0, "morning")),
        on(0, job("service", "Vikram S.", "DLF 4", 0, "afternoon")),
        on(1, job("first_fit", "Sanjay B.", "Sec 43", 1, "morning")),
        on(2, job("consultation", "Nikhil A.", "Sec 57", 2, "morning")),
        on(2, job("service", "Aman T.", "Sec 49", 2, "afternoon")),
        on(3, job("service", "Deepak R.", "Sec 54", 3, "afternoon")),
        on(4, job("replacement", "Kunal M.", "Sec 62", 4, "afternoon")),
        on(6, job("service", "Rohit M.", "Sec 65", 6, "morning")),
      ]),
    },
    {
      technician_id: BOARD_TECHNICIANS[1]?.id,
      name: BOARD_TECHNICIANS[1]?.name,
      initials: BOARD_TECHNICIANS[1]?.initials,
      zone: BOARD_TECHNICIANS[1]?.zone,
      days: daysOf([
        on(0, job("service", "Arun P.", "Sec 23", 0, "morning")),
        on(1, job("replacement", "Manish G.", "Sec 31", 1, "afternoon")),
        on(1, job("consultation", "Tarun J.", "Sec 15", 1, "evening")),
        on(2, job("first_fit", "Ravi S.", "Sec 28", 2, "morning")),
        on(4, job("service", "Sameer L.", "Sec 12", 4, "morning")),
        on(5, job("service", "Vivek N.", "Sec 35", 5, "afternoon")),
      ]),
    },
    {
      technician_id: BOARD_TECHNICIANS[2]?.id,
      name: BOARD_TECHNICIANS[2]?.name,
      initials: BOARD_TECHNICIANS[2]?.initials,
      zone: BOARD_TECHNICIANS[2]?.zone,
      days: daysOf([
        on(0, job("service", "Gaurav D.", "DLF 2", 0, "morning")),
        on(1, job("first_fit", "Rahul K.", "DLF 5", 1, "morning")),
        on(2, job("service", "Anil V.", "DLF 1", 2, "morning")),
        on(2, job("consultation", "Puneet S.", "DLF 3", 2, "afternoon")),
        on(3, job("replacement", "Mohit A.", "DLF 4", 3, "afternoon")),
        on(5, job("service", "Varun C.", "DLF 2", 5, "morning")),
        on(6, job("service", "Kabir H.", "DLF 5", 6, "afternoon")),
      ]),
    },
    {
      technician_id: BOARD_TECHNICIANS[3]?.id,
      name: BOARD_TECHNICIANS[3]?.name,
      initials: BOARD_TECHNICIANS[3]?.initials,
      zone: BOARD_TECHNICIANS[3]?.zone,
      days: daysOf([
        on(1, job("service", "Dev M.", "Sohna", 1, "morning")),
        on(1, job("consultation", "Ishaan B.", "Sohna", 1, "evening")),
        on(2, job("service", "Nitin R.", "Sohna", 2, "afternoon")),
        on(3, job("service", "Yash T.", "Sohna", 3, "morning")),
        on(6, job("replacement", "Hari P.", "Sohna", 6, "afternoon")),
      ]),
    },
  ],
  /** No client comes with an unassigned job: the route answers with the visit, not the person. */
  unassigned: [
    {
      appointment_id: "78000000-0000-4000-8000-000000000001",
      type: "first_fit",
      asked_window: "morning",
      offered_window: "morning",
      date: DATES[1],
      sector: "Sec 43",
    },
    {
      appointment_id: "78000000-0000-4000-8000-000000000002",
      type: "service",
      asked_window: "evening",
      offered_window: "evening",
      date: DATES[1],
      sector: "Sec 12",
    },
    {
      appointment_id: "78000000-0000-4000-8000-000000000003",
      type: "consultation",
      asked_window: "morning",
      offered_window: "morning",
      date: DATES[2],
      sector: "DLF 3",
    },
    {
      appointment_id: "78000000-0000-4000-8000-000000000004",
      type: "replacement",
      asked_window: "afternoon",
      offered_window: "afternoon",
      date: DATES[2],
      sector: "Sohna",
    },
  ],
  utilisation: DATES.map((date, day) => ({ date, percent: UTILISATION[day] ?? 0 })),
  /** Always empty: FSM answers about availability 48 hours ahead (docs/open-points.md, item 53). */
  leave: [],
};

export const MOVED = { move_id: "79000000-0000-4000-8000-000000000001", messaged: true };

// ---- Boards B2 and B3: one client's page ------------------------------------

/** The board's client, on a number nobody holds. */
export const CLIENT = { id: "22000000-0000-4000-8000-000000000001", name: "Rohit Malhotra", mobile: "+919810004417" };

const TECHNICIAN = { name: "Imran Qureshi", initials: "IQ" };
const VISIT_ID = "33000000-0000-4000-8000-000000000001";

export const RECORD = {
  ...CLIENT,
  state: "fitted",
  known_since: "2026-11-01T06:00:00.000Z",
  address: {
    line1: "House 1204",
    line2: null,
    locality: "Sector 65",
    city: "Gurgaon",
    pincode: "122018",
    access_notes: "Gate 4417, bay B",
  },
  credits: { visits: 2, earliest_expiry: "2028-01-03T06:00:00.000Z" },
  visits: {
    upcoming: [],
    past: [
      {
        id: VISIT_ID,
        date: "2027-08-22",
        window_label: "morning",
        starts_at: "2027-08-22T03:30:00.000Z",
        ends_at: "2027-08-22T05:00:00.000Z",
        length_minutes: 90,
        type: "service",
        status: "completed",
        technician: TECHNICIAN,
        place: "Sector 65, Gurgaon 122018",
        outcome: "done",
      },
    ],
  },
  payments: [],
  /*
   * What the record adds up to (src/domain/client-history.ts): the board's own
   * client, fitted in November 2026 and served since, with the piece B1 draws
   * still in wear and falling due in the month the board's head writes.
   */
  history: {
    visits: 6,
    services: 4,
    replacements: 1,
    first_fit_on: "2026-11-14",
    last_visit_on: "2027-08-22",
    spend: 4_956_000,
    replacement_due: { on: "2028-03-01", month: "2028-03", piece_code: "MM-STD-4417-C" },
  },
};

/** The same client before any of it: no visit done, no piece in wear, nothing paid. */
export const NEW_RECORD = {
  ...RECORD,
  state: "lead",
  visits: { upcoming: [], past: [] },
  history: {
    visits: 0,
    services: 0,
    replacements: 0,
    first_fit_on: null,
    last_visit_on: null,
    spend: 0,
    replacement_due: null,
  },
};

const ANGLES = ["front", "top", "left", "right", "hair"] as const;
const PHASES = ["before", "after"] as const;

const photo = (phase: string, angle: string, n: number) => ({
  id: `44000000-0000-4000-8000-00000000000${String(n)}`,
  phase,
  angle,
  width: 600,
  height: 800,
  taken_at: "2027-08-22T04:30:00.000Z",
});

export const PHOTOS = {
  visits: [
    {
      visit_id: VISIT_ID,
      date: "2027-08-22",
      type: "service",
      technician: TECHNICIAN,
      photos: PHASES.flatMap((phase, set) => ANGLES.map((angle, n) => photo(phase, angle, set * 5 + n))),
    },
  ],
};

export const CONSENTS = {
  consents: [
    {
      purpose: "photos_own_record",
      state: "given",
      notice_version: "photos-own-record-v1",
      at: "2026-11-14T08:00:00.000Z",
    },
    {
      purpose: "photos_referral_cards",
      state: "given",
      notice_version: "photos-referral-cards-v2",
      at: "2027-08-03T08:00:00.000Z",
    },
    { purpose: "photos_marketing", state: "not_given", notice_version: null, at: null },
    {
      purpose: "whatsapp_visits",
      state: "given",
      notice_version: "whatsapp-visits-v1",
      at: "2026-11-02T08:00:00.000Z",
    },
    {
      purpose: "whatsapp_launches",
      state: "withdrawn",
      notice_version: "whatsapp-launches-v1",
      at: "2027-01-11T08:00:00.000Z",
    },
  ],
  deletion: null,
};

// ---- Board D1: the no-show the board rules on ---------------------------------

/**
 * The board's own case: the technician checked in at 11:31, 240 m out, the
 * WhatsApp delivered at 11:32, and he closed the job at 11:47 after 15 minutes.
 * The route gives the technician and the date, never the client.
 */
export const NO_SHOWS = {
  cases: [
    {
      id: "66000000-0000-4000-8000-000000000001",
      appointment_id: "77000000-0000-4000-8000-000000000001",
      visit_date: "2027-09-19",
      technician: "Imran Qureshi",
      checked_in_at: "2027-09-19T06:01:00.000Z",
      distance_m: 240,
      message_delivered_at: "2027-09-19T06:02:00.000Z",
      wait_ends_at: "2027-09-19T06:16:00.000Z",
      closed_at: "2027-09-19T06:17:00.000Z",
      decision: "undecided",
      decided_at: null,
    },
    {
      id: "66000000-0000-4000-8000-000000000002",
      appointment_id: "77000000-0000-4000-8000-000000000002",
      visit_date: "2027-09-20",
      technician: "Sandeep Yadav",
      checked_in_at: "2027-09-20T04:30:00.000Z",
      distance_m: 12,
      message_delivered_at: null,
      wait_ends_at: "2027-09-20T04:45:00.000Z",
      closed_at: "2027-09-20T04:46:00.000Z",
      decision: "undecided",
      decided_at: null,
    },
  ],
};

/**
 * The same case with nothing measured: the address had no coordinates, so the
 * route carries no distance at all (docs/decisions/0036-geocoding.md). Every
 * case looks like this today, since no address has ever been geocoded.
 */
export const NO_SHOW_UNMEASURED = {
  cases: [{ ...NO_SHOWS.cases[0], distance_m: null }],
};

/**
 * Board D1's first card: the day's three figures, and the two charges beneath
 * them. The amounts are the board's own, in paise as the route answers them.
 * The late cancellation carries its evidence, "cancelled 9:14 am · visit was
 * 10 am"; the no-show carries no amount, because nothing records what one was
 * charged, so it is counted beside the figure instead of added to it.
 */
export const DAY_MONEY = {
  date: "2027-09-22",
  collected: 8_400_000,
  refunds_processing: 708_000,
  refunded: 236_000,
  charged: 236_000,
  no_shows_charged: 1,
  dispute: null,
  charges: [
    {
      id: "b1000000-0000-4000-8000-000000000001",
      kind: "late_cancellation",
      person: { id: "11000000-0000-4000-8000-000000000002", name: "Vikram Sethi" },
      amount: 236_000,
      at: "2027-09-22T03:44:00.000Z",
      visit_started_at: "2027-09-22T04:30:00.000Z",
      change: "cancelled",
      technician: null,
    },
    {
      id: "b1000000-0000-4000-8000-000000000002",
      kind: "no_show",
      person: { id: "11000000-0000-4000-8000-000000000005", name: "Karan Bose" },
      amount: null,
      at: "2027-09-22T05:00:00.000Z",
      visit_started_at: "2027-09-22T06:00:00.000Z",
      change: null,
      technician: "Imran Qureshi",
    },
  ],
};

// ---- Board B1: the pieces the client has been fitted with ----------------------

/** The board's own three: one still in wear, one that split, and one rejected at the fit. */
export const PIECES = {
  pieces: [
    {
      piece_code: "MM-STD-4417-C",
      base: "Mono",
      supplier_lot: "L-2704",
      fitted_at: "2027-06-27",
      replacement_due_at: "2028-03-01",
      failed_at: null,
      failure_reason: null,
    },
    {
      piece_code: "MM-STD-4417-B",
      base: "Mono",
      supplier_lot: "L-1109",
      fitted_at: "2026-11-14",
      replacement_due_at: "2027-06-01",
      failed_at: "2027-06-24T06:00:00.000Z",
      failure_reason: "base split at crown",
    },
    {
      piece_code: "MM-STD-4417-A",
      base: "Mono",
      supplier_lot: null,
      fitted_at: "2026-11-14",
      replacement_due_at: null,
      failed_at: "2026-11-16T06:00:00.000Z",
      failure_reason: "rejected at fit, refunded",
    },
  ],
};

// ---- Board D2: what ops still have to do ---------------------------------------

/**
 * Read against 22 September 2027 in India, the day the tests and the fidelity
 * run set their clock to. Four have run over, as the board's head writes, and
 * each task's `due` is its `since` plus the placeholder two days
 * (src/policy/tasks.ts), so the days left are the board's own: "2 days",
 * "Today", "Overdue 3".
 */
export const TASKS = {
  overdue: 4,
  groups: [
    {
      group: "replacement_order",
      count: 2,
      tasks: [
        {
          id: "91000000-0000-4000-8000-000000000001",
          person: { id: "22000000-0000-4000-8000-000000000002", name: "Kunal Mehta" },
          detail: "MM-STD-4417-K",
          since: "2027-09-16T18:30:00.000Z",
          due: "2027-09-18T18:30:00.000Z",
        },
        {
          id: "91000000-0000-4000-8000-000000000002",
          person: { id: CLIENT.id, name: CLIENT.name },
          detail: "MM-STD-4417-C",
          since: "2027-09-21T18:30:00.000Z",
          due: "2027-09-23T18:30:00.000Z",
        },
      ],
    },
    {
      group: "referral_review",
      count: 2,
      tasks: [
        {
          id: "92000000-0000-4000-8000-000000000001",
          person: { id: "22000000-0000-4000-8000-000000000003", name: "Rohan Bhalla" },
          detail: "shared_address",
          since: "2027-09-17T06:00:00.000Z",
          due: "2027-09-19T06:00:00.000Z",
        },
        {
          id: "92000000-0000-4000-8000-000000000002",
          person: { id: "22000000-0000-4000-8000-000000000004", name: "Karan Bose" },
          detail: "monthly_cap",
          since: "2027-09-20T06:00:00.000Z",
          due: "2027-09-22T06:00:00.000Z",
        },
      ],
    },
    {
      group: "no_show_decision",
      count: 2,
      tasks: [
        {
          id: "93000000-0000-4000-8000-000000000001",
          person: null,
          detail: "Imran Qureshi",
          since: "2027-09-19T06:17:00.000Z",
          due: "2027-09-21T06:17:00.000Z",
        },
        {
          id: "93000000-0000-4000-8000-000000000002",
          person: null,
          detail: "Sandeep Yadav",
          since: "2027-09-20T04:46:00.000Z",
          due: "2027-09-22T04:46:00.000Z",
        },
      ],
    },
    {
      group: "number_change",
      count: 1,
      tasks: [
        {
          id: "94000000-0000-4000-8000-000000000001",
          person: { id: "22000000-0000-4000-8000-000000000005", name: "Vikram Sethi" },
          detail: null,
          since: "2027-09-18T06:00:00.000Z",
          due: "2027-09-20T06:00:00.000Z",
        },
      ],
    },
    {
      group: "erasure_request",
      count: 1,
      tasks: [
        {
          id: "95000000-0000-4000-8000-000000000001",
          person: { id: "22000000-0000-4000-8000-000000000006", name: "Ashish Gill" },
          detail: null,
          since: "2027-09-21T06:00:00.000Z",
          due: "2027-09-23T06:00:00.000Z",
        },
      ],
    },
  ],
};

/** The day the board's tasks are read against: 10:30 in India on 22 September 2027. */
export const TASKS_READ_ON = new Date("2027-09-22T05:00:00.000Z");

// ---- Board D3: the roster, and the phones the board does not draw --------------

const technician = (
  n: number,
  name: string,
  initials: string,
  zone: string | null,
  devices: { device_id: string; label: string | null; last_seen_at: string; revoked_at: string | null }[],
) => ({ id: `88000000-0000-4000-8000-00000000000${String(n)}`, name, initials, zone, devices });

export const TECHNICIANS = {
  technicians: [
    technician(1, "Imran Qureshi", "IQ", "Sec 40–65", [
      { device_id: "device-1", label: "Chrome on Android", last_seen_at: "2027-09-22T05:00:00.000Z", revoked_at: null },
      {
        device_id: "device-2",
        label: "Safari on iPhone",
        last_seen_at: "2027-08-04T05:00:00.000Z",
        revoked_at: "2027-08-05T05:00:00.000Z",
      },
    ]),
    technician(2, "Sandeep Yadav", "SY", "Sec 1–39", [
      { device_id: "device-3", label: null, last_seen_at: "2027-09-21T05:00:00.000Z", revoked_at: null },
    ]),
    technician(3, "Faizan Ali", "FA", null, []),
  ],
};

/**
 * What each of them has finished, over the quarter the route counts by default.
 * Faizan's is the board's own line, "18 minutes over on services", against the
 * 90 minutes a service visit is planned for; Sandeep's average is of fewer jobs
 * than he finished, because the phone timed only thirty of them.
 */
export const TECHNICIAN_WORK = {
  from: "2027-06-24",
  to: "2027-09-23",
  technicians: [
    {
      technician_id: "88000000-0000-4000-8000-000000000001",
      jobs: 48,
      timed_jobs: 48,
      average_minutes: 84,
      average_planned_minutes: 90,
      skill: null,
    },
    {
      technician_id: "88000000-0000-4000-8000-000000000002",
      jobs: 34,
      timed_jobs: 30,
      average_minutes: 91,
      average_planned_minutes: 90,
      skill: null,
    },
    {
      technician_id: "88000000-0000-4000-8000-000000000003",
      jobs: 29,
      timed_jobs: 29,
      average_minutes: 108,
      average_planned_minutes: 90,
      skill: null,
    },
  ],
};

// ---- The three DPDP queues, which no board draws ------------------------------

/**
 * Read against 22 September 2027 in India, as board D2's tasks are, so the days
 * left read the same on every run: the first grievance is within the 30 days the
 * app promises and the second is past them; of the deletion requests the first
 * is within its 7 days, the second is past them and the third falls due today.
 * The numbers are made up, as everywhere else here, and the words are nobody's.
 */
export const GRIEVANCES = {
  grievances: [
    {
      id: "a1000000-0000-4000-8000-000000000001",
      person_id: CLIENT.id,
      name: CLIENT.name,
      mobile: CLIENT.mobile,
      text: "I asked for the WhatsApp messages about launches to stop and they have not stopped.",
      raised_at: "2027-09-14T06:00:00.000Z",
    },
    {
      id: "a1000000-0000-4000-8000-000000000002",
      person_id: "22000000-0000-4000-8000-000000000007",
      name: "Vikram Sethi",
      mobile: "+919810004418",
      text: "Who saw my photographs, and when?",
      raised_at: "2027-08-01T06:00:00.000Z",
    },
  ],
};

export const DELETION_REQUESTS = {
  requests: [
    {
      id: "a2000000-0000-4000-8000-000000000001",
      person_id: CLIENT.id,
      name: CLIENT.name,
      mobile: CLIENT.mobile,
      requested_at: "2027-09-20T06:00:00.000Z",
    },
    {
      id: "a2000000-0000-4000-8000-000000000002",
      person_id: "22000000-0000-4000-8000-000000000008",
      name: "Ashish Gill",
      mobile: "+919810004419",
      requested_at: "2027-09-10T06:00:00.000Z",
    },
    {
      id: "a2000000-0000-4000-8000-000000000003",
      person_id: "22000000-0000-4000-8000-000000000009",
      name: "Karan Bose",
      mobile: "+919810004420",
      requested_at: "2027-09-15T06:00:00.000Z",
    },
  ],
};

export const NUMBER_CHANGES = {
  changes: [
    {
      id: "a3000000-0000-4000-8000-000000000001",
      person_id: CLIENT.id,
      name: CLIENT.name,
      old_mobile: CLIENT.mobile,
      new_mobile: "+919810004421",
      requested_at: "2027-09-21T06:00:00.000Z",
    },
  ],
};

export const ERASURE_REQUESTED = {
  ...CONSENTS,
  deletion: {
    id: "55000000-0000-4000-8000-000000000001",
    state: "requested",
    requested_at: "2027-09-18T08:00:00.000Z",
    decided_at: null,
  },
};

/** A photograph that is a block of ink, so no test holds a picture of anyone. */
export const inkPhoto = () =>
  sharp({ create: { width: 600, height: 800, channels: 3, background: "#16233a" } })
    .jpeg()
    .toBuffer();

type Answers = Readonly<Record<string, (route: Route) => Promise<void>>>;

export const json = (body: unknown) => (route: Route) => route.fulfill({ json: body });
export const jpeg = (body: Buffer) => (route: Route) => route.fulfill({ body, contentType: "image/jpeg" });
export const fails = (status: number, code: string) => (route: Route) =>
  route.fulfill({ status, json: { error: { code, request_id: "test" } } });

/** Answers the console's calls from `answers`, by path; anything else goes to the local mm-api. */
export async function answer(page: Page, answers: Answers): Promise<void> {
  await page.route("**/api/**", (route) => {
    const reply = answers[new URL(route.request().url()).pathname];
    return reply === undefined ? route.continue() : reply(route);
  });
}
