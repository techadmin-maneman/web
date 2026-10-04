// Settings (docs/decisions/0061-ops-editable-inputs.md): the rules, the services
// and their prices (docs/decisions/0085-services-ops-can-edit.md), and the service area.

import type { OpsReply } from "../answer.ts";

/**
 * The rules are the register's own, one of each shape: a single number nobody
 * has set, a set of keys somebody has, the open-keyed cycles, a set whose keys
 * count in two units, and a rule of choices
 * (docs/decisions/0088-every-policy-in-the-console.md).
 */
export const SETTINGS = {
  settings: [
    {
      name: "checkin_radius_m",
      kind: "number",
      title: "Check-in radius",
      note: "How close to the address a technician must be for I have arrived to pass.",
      unit: "metres",
      min: 50,
      max: 1000,
      keys: null,
      bounds: null,
      value: 200,
      default: 200,
      set_by: null,
      set_at: null,
    },
    {
      name: "no_show_wait_min",
      kind: "number",
      title: "No-show wait",
      note: "How long a technician waits, from check-in, before he may close a job as a no-show.",
      unit: "minutes",
      min: 5,
      max: 120,
      keys: ["consultation", "first_fit", "service", "replacement"],
      bounds: null,
      value: { consultation: 15, first_fit: 20, service: 15, replacement: 15 },
      default: { consultation: 15, first_fit: 15, service: 15, replacement: 15 },
      set_by: "ops@maneman.in",
      set_at: "2027-09-20T06:00:00.000Z",
    },
    {
      name: "piece_cycle_days",
      kind: "number",
      title: "Replacement cycle",
      note: "How long a piece on each base lasts before it is due for replacement.",
      unit: "days",
      min: 30,
      max: 1095,
      keys: "open",
      bounds: null,
      value: { default: 180 },
      default: { default: 180 },
      set_by: null,
      set_at: null,
    },
    // One input for the next visit's days, each figure with its own bounds (docs/decisions/0086-the-next-visit-is-offered.md).
    {
      name: "booking_days",
      kind: "number",
      title: "Booking and the next visit",
      note: "When the app offers each next visit and how far ahead a client may book it.",
      unit: "days",
      min: 0,
      max: 90,
      keys: [
        "first_fit_lead",
        "service_cadence",
        "reminder_before_due",
        "at_risk_after_due",
        "first_fit_to_book",
        "horizon",
        "invoice_prompt",
      ],
      bounds: {
        first_fit_lead: { min: 0, max: 30, unit: "days" },
        service_cadence: { min: 14, max: 90, unit: "days" },
        reminder_before_due: { min: 1, max: 14, unit: "days" },
        at_risk_after_due: { min: 1, max: 60, unit: "days" },
        first_fit_to_book: { min: 1, max: 60, unit: "days" },
        horizon: { min: 14, max: 90, unit: "days" },
        invoice_prompt: { min: 1, max: 60, unit: "days" },
      },
      value: {
        first_fit_lead: 0,
        service_cadence: 30,
        reminder_before_due: 7,
        at_risk_after_due: 7,
        first_fit_to_book: 7,
        horizon: 45,
        invoice_prompt: 14,
      },
      default: {
        first_fit_lead: 0,
        service_cadence: 30,
        reminder_before_due: 7,
        at_risk_after_due: 7,
        first_fit_to_book: 7,
        horizon: 45,
        invoice_prompt: 14,
      },
      set_by: null,
      set_at: null,
    },
    {
      name: "phone_clock",
      kind: "number",
      title: "How far a phone is trusted about time",
      note: "How long before the booked start a check-in may say the technician arrived.",
      unit: "minutes",
      min: 0,
      max: 240,
      keys: ["before_start", "held_offline"],
      bounds: {
        before_start: { min: 0, max: 240, unit: "minutes" },
        held_offline: { min: 1, max: 72, unit: "hours" },
      },
      value: { before_start: 60, held_offline: 24 },
      default: { before_start: 60, held_offline: 24 },
      set_by: null,
      set_at: null,
    },
    {
      name: "late_change_charge",
      kind: "choice",
      title: "What a late move or cancel costs",
      note: "What each kind of visit costs when the client moves or cancels it inside that notice.",
      keys: ["consultation", "first_fit", "service", "replacement"],
      choices: {
        consultation: ["nothing", "visit"],
        first_fit: ["nothing", "late_fee", "visit"],
        service: ["nothing", "visit"],
        replacement: ["nothing", "late_fee", "visit"],
      },
      value: { consultation: "nothing", first_fit: "late_fee", service: "visit", replacement: "late_fee" },
      default: { consultation: "nothing", first_fit: "late_fee", service: "visit", replacement: "late_fee" },
      set_by: null,
      set_at: null,
    },
    {
      name: "referral_reward",
      kind: "number",
      title: "What a referral earns",
      note: "The free service visits the client who sent an invite gets, and those their friend gets.",
      unit: "service visits",
      min: 0,
      max: 1095,
      keys: ["referrer_visits", "friend_visits", "valid_days"],
      bounds: {
        referrer_visits: { min: 0, max: 12, unit: "service visits" },
        friend_visits: { min: 0, max: 12, unit: "service visits" },
        valid_days: { min: 30, max: 1095, unit: "days" },
      },
      value: { referrer_visits: 3, friend_visits: 3, valid_days: 365 },
      default: { referrer_visits: 3, friend_visits: 3, valid_days: 365 },
      set_by: null,
      set_at: null,
    },
  ],
} satisfies OpsReply<"/api/settings">;

/**
 * The days no visit is offered (docs/decisions/0088-every-policy-in-the-console.md): two days of Diwali added in the
 * console with visits still booked on them, and a day the runbook's SQL wrote before the screen, which records nobody.
 */
export const BLACKOUTS = {
  today: "2027-09-21",
  max_days: 31,
  blackouts: [
    { date: "2027-10-29", reason: "Diwali", set_by: "ops@maneman.in", set_at: "2027-09-20T06:00:00.000Z", booked: 2 },
    { date: "2027-10-30", reason: "Diwali", set_by: "ops@maneman.in", set_at: "2027-09-20T06:00:00.000Z", booked: 1 },
    { date: "2027-11-15", reason: "Staff training", set_by: null, set_at: null, booked: 0 },
  ],
} satisfies OpsReply<"/api/blackouts">;

/**
 * Discount codes (docs/decisions/0108-discount-codes.md): a percentage with a cap, on first fits and service visits,
 * used three times; and an amount off replacements, switched off, its one use kept.
 */
export const DISCOUNT_CODES = {
  today: "2027-09-21",
  batch_most: 100,
  listed_most: 200,
  codes: [
    {
      id: "51000000-0000-4000-8000-000000000001",
      code: "WEDDNG25",
      kind: "percent",
      value: 25,
      cap: 500_000,
      covers: ["first_fit", "service"],
      expires_on: "2027-12-31",
      max_uses: 50,
      once_per_client: true,
      batch_id: null,
      created_by: "ops@maneman.in",
      created_at: "2027-09-01T06:00:00.000Z",
      switched_off: null,
      uses: 3,
      given: 1_200_000,
    },
    {
      id: "51000000-0000-4000-8000-000000000002",
      code: "RPLC2K",
      kind: "amount",
      value: 200_000,
      cap: null,
      covers: ["replacement"],
      expires_on: null,
      max_uses: null,
      once_per_client: false,
      batch_id: null,
      created_by: "ops@maneman.in",
      created_at: "2027-08-01T06:00:00.000Z",
      switched_off: { by: "owner@maneman.in", at: "2027-09-10T06:00:00.000Z" },
      uses: 1,
      given: 200_000,
    },
  ],
} satisfies OpsReply<"/api/discount-codes">;

/**
 * The services, kind by kind (docs/decisions/0085-services-ops-can-edit.md): each kind's standard service, a
 * premium first fit ops added, a lace replacement retired, and a service visit whose new price starts in October,
 * with the one it replaced folded into its history.
 */
const service = (fields: {
  kind: "consultation" | "first_fit" | "service" | "replacement";
  tier: string;
  name: string;
  minutes: number;
  sort?: number;
  retired_date?: string | null;
  prices: {
    amount_ex_gst: number;
    gst_percent: number;
    valid_from: string;
    in_force: boolean;
  }[];
}) => ({
  kind: fields.kind,
  tier: fields.tier,
  name: fields.name,
  minutes: fields.minutes,
  sort: fields.sort ?? 0,
  retired_date: fields.retired_date ?? null,
  offered: fields.retired_date === undefined || fields.retired_date === null || fields.retired_date > "2027-09-21",
  updated_by: "ops@maneman.in",
  updated_at: "2027-09-01T06:00:00.000Z",
  prices: fields.prices.map((price) => ({ item: fields.kind, tier: fields.tier, ...price })),
});

export const SERVICES = {
  today: "2027-09-21",
  kinds: [
    { kind: "consultation" as const, minutes: 60 },
    { kind: "first_fit" as const, minutes: 180 },
    { kind: "service" as const, minutes: 90 },
    { kind: "replacement" as const, minutes: 135 },
  ],
  services: [
    service({
      kind: "consultation",
      tier: "standard",
      name: "Consultation",
      minutes: 60,
      prices: [{ amount_ex_gst: 0, gst_percent: 0, valid_from: "2026-09-22", in_force: true }],
    }),
    service({
      kind: "first_fit",
      tier: "standard",
      name: "First fit",
      minutes: 180,
      prices: [{ amount_ex_gst: 3_000_000, gst_percent: 0, valid_from: "2026-09-22", in_force: true }],
    }),
    service({
      kind: "first_fit",
      tier: "premium",
      name: "Premium",
      minutes: 240,
      sort: 1,
      prices: [{ amount_ex_gst: 4_000_000, gst_percent: 0, valid_from: "2027-09-01", in_force: true }],
    }),
    service({
      kind: "service",
      tier: "standard",
      name: "Service visit",
      minutes: 90,
      prices: [
        { amount_ex_gst: 250_000, gst_percent: 18, valid_from: "2027-10-01", in_force: false },
        { amount_ex_gst: 200_000, gst_percent: 18, valid_from: "2026-09-22", in_force: true },
        { amount_ex_gst: 150_000, gst_percent: 0, valid_from: "2026-01-01", in_force: false },
      ],
    }),
    service({
      kind: "replacement",
      tier: "standard",
      name: "Replacement",
      minutes: 135,
      prices: [{ amount_ex_gst: 1_500_000, gst_percent: 0, valid_from: "2026-09-22", in_force: true }],
    }),
    service({
      kind: "replacement",
      tier: "lace",
      name: "Lace replacement",
      minutes: 150,
      sort: 1,
      retired_date: "2027-09-01",
      prices: [{ amount_ex_gst: 2_000_000, gst_percent: 0, valid_from: "2027-01-01", in_force: true }],
    }),
  ],
  late_fees: [
    {
      kind: "first_fit" as const,
      item: "late_fee_first_fit" as const,
      prices: [
        {
          item: "late_fee_first_fit" as const,
          tier: "standard",
          amount_ex_gst: 400_000,
          gst_percent: 0,
          valid_from: "2026-09-22",
          in_force: true,
        },
      ],
    },
    {
      kind: "replacement" as const,
      item: "late_fee_replacement" as const,
      prices: [
        {
          item: "late_fee_replacement" as const,
          tier: "standard",
          amount_ex_gst: 300_000,
          gst_percent: 0,
          valid_from: "2026-09-22",
          in_force: true,
        },
      ],
    },
  ],
  min_minutes: 30,
  max_minutes: 360,
  max_amount_ex_gst: 100_000_000,
  max_gst_percent: 28,
} satisfies OpsReply<"/api/services">;

type PriceRow = OpsReply<"/api/prices/withdraw", "post">["prices"][number];

/** The book's rows, as a price's routes answer them: every service's and late fee's, newest first. */
export const PRICE_ROWS: PriceRow[] = [
  ...SERVICES.services.flatMap((each): PriceRow[] => each.prices),
  ...SERVICES.late_fees.flatMap((fee): PriceRow[] => fee.prices),
];

/** Three of NCR's own six-digit numbers: one served, one with a waitlist, one neither. */
export const SERVICE_AREA = {
  pincodes: [
    { pincode: "110017", area: "Saket", city: "Delhi", served: true, launch_on: "2026-09-01", waiting: 0, to_alert: 0 },
    {
      pincode: "110024",
      area: "Lajpat Nagar",
      city: "Delhi",
      served: false,
      launch_on: null,
      waiting: 5,
      to_alert: 3,
    },
    { pincode: "122018", area: "Sec65", city: "Gurgaon", served: false, launch_on: null, waiting: 0, to_alert: 0 },
  ],
} satisfies OpsReply<"/api/service-area">;
