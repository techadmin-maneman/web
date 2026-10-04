// Boards B1, B2 and B3: one client's page, their photographs, consents and pieces.

import sharp from "sharp";
import type { OpsReply } from "../answer.ts";

type ClientRecord = OpsReply<"/api/clients/{id}">;
type Photos = OpsReply<"/api/clients/{id}/photos">;

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
    building: null,
    flat: null,
    floor: null,
    tower: null,
    landmark: null,
    given_to_ops: null,
  },
  credits: { visits: 2, earliest_expiry: "2028-01-03T06:00:00.000Z" },
  visits: {
    // The Saturday visit he has booked, which the page once showed nowhere (OPS-04).
    upcoming: [
      {
        id: "33000000-0000-4000-8000-000000000002",
        date: "2027-09-25",
        window_label: "morning",
        starts_at: "2027-09-25T03:30:00.000Z",
        ends_at: "2027-09-25T05:00:00.000Z",
        length_minutes: 90,
        type: "service",
        status: "scheduled",
        stage: "booked",
        prepaid: true,
        technician: TECHNICIAN,
        place: "Sector 65, Gurgaon 122018",
        outcome: null,
        closed_without_follow_up: null,
        discount_code: null,
        price_open: false,
        requested_code: null,
      },
    ],
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
        stage: null,
        prepaid: false,
        technician: TECHNICIAN,
        place: "Sector 65, Gurgaon 122018",
        outcome: "done",
        closed_without_follow_up: null,
        discount_code: null,
        price_open: false,
        requested_code: null,
      },
    ],
  },
  payments: [
    {
      kind: "payment",
      id: "34000000-0000-4000-8000-000000000001",
      date: "2027-08-20",
      amount: 236_000,
      amount_ex_gst: 200_000,
      gst_percent: 18,
      visit: { id: VISIT_ID, date: "2027-08-22", type: "service" },
      booking: null,
      status: "captured",
      method: "upi",
      reference: "MM-2027-0841",
      refunded_amount: 0,
      purpose: "visit",
      charge: null,
      no_show: null,
      discount_code: null,
    },
  ],
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
  /** He came through a friend's invite, whose 3 visits were given at his first fit. */
  invite: {
    code: "VSAB23",
    referrer: { id: "22000000-0000-4000-8000-000000000009", name: "Vikram Sethi" },
    grant: "granted",
    since: "2026-10-20T06:00:00.000Z",
    attached: null,
  },
} satisfies ClientRecord;

/** The same client before any of it: no visit done, no piece in wear, nothing paid. */
export const NEW_RECORD = {
  ...RECORD,
  state: "lead",
  address: null,
  visits: { upcoming: [], past: [] },
  payments: [],
  history: {
    visits: 0,
    services: 0,
    replacements: 0,
    first_fit_on: null,
    last_visit_on: null,
    spend: 0,
    replacement_due: null,
  },
  invite: null,
} satisfies ClientRecord;

const ANGLES = ["front", "top", "left", "right", "hair"] as const;
const PHASES = ["before", "after"] as const;

type Photo = Photos["visits"][number]["photos"][number];

const photo = (phase: Photo["phase"], angle: Photo["angle"], n: number): Photo => ({
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
} satisfies Photos;

export const CONSENTS = {
  consents: [
    {
      purpose: "photos_own_record",
      state: "given",
      notice_version: "photos-own-record-v1",
      at: "2026-11-14T08:00:00.000Z",
      source: "app_profile",
    },
    {
      purpose: "photos_referral_cards",
      state: "given",
      notice_version: "photos-referral-cards-v2",
      at: "2027-08-03T08:00:00.000Z",
      source: "app_share_sheet",
    },
    { purpose: "photos_marketing", state: "not_given", notice_version: null, at: null, source: null },
    {
      purpose: "whatsapp_visits",
      state: "given",
      notice_version: "referral-consultation-v1",
      at: "2026-11-02T08:00:00.000Z",
      source: "site_booking",
    },
    {
      purpose: "whatsapp_launches",
      state: "withdrawn",
      notice_version: "whatsapp-launches-v1",
      at: "2027-01-11T08:00:00.000Z",
      source: "app_profile",
    },
  ],
  deletion: null,
} satisfies OpsReply<"/api/clients/{id}/consents">;

export const ERASURE_REQUESTED = {
  ...CONSENTS,
  deletion: {
    id: "55000000-0000-4000-8000-000000000001",
    state: "requested",
    requested_at: "2027-09-18T08:00:00.000Z",
    decided_at: null,
  },
} satisfies OpsReply<"/api/clients/{id}/consents">;

/** Board B1's own three: one still in wear, one that split, and one rejected at the fit. */
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
} satisfies OpsReply<"/api/clients/{id}/pieces">;

type HairProfilePage = OpsReply<"/api/clients/{id}/hair-profile">;

/** The products a correction may name: made up, as every name here is. */
const PRODUCTS = [
  { tier: "standard", name: "First fit" },
  { tier: "essential", name: "Mane Man Essential" },
];

/** A client whose profile nobody has recorded. */
export const NO_HAIR_PROFILE = {
  latest: null,
  versions: [],
  products: PRODUCTS,
} satisfies HairProfilePage;

/** Rohit's fit spec as Imran took it at his consultation, and his history. */
const AT_CONSULTATION = {
  id: "44000000-0000-4000-8000-000000000001",
  recorded_at: "2027-09-21T05:30:00.000Z",
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
} satisfies NonNullable<HairProfilePage["latest"]>;

/** And ops' correction the next day: the colour, a shade lighter. */
const CORRECTED = {
  ...AT_CONSULTATION,
  id: "44000000-0000-4000-8000-000000000002",
  recorded_at: "2027-09-22T05:30:00.000Z",
  fit: { ...AT_CONSULTATION.fit, colour: "2" as const },
};

export const HAIR_PROFILE = {
  latest: CORRECTED,
  versions: [
    {
      ...CORRECTED,
      recorded_by: { kind: "ops", staff: "ops@maneman.in" },
      visit: null,
    },
    {
      ...AT_CONSULTATION,
      recorded_by: { kind: "technician", name: "Imran" },
      visit: { id: VISIT_ID, date: "2027-09-21", type: "consultation" },
    },
  ],
  products: PRODUCTS,
} satisfies HairProfilePage;

/** A photograph that is a block of ink, so no test holds a picture of anyone. */
export const inkPhoto = () =>
  sharp({ create: { width: 600, height: 800, channels: 3, background: "#16233a" } })
    .jpeg()
    .toBuffer();
