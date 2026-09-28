// Settings (docs/decisions/0061-ops-editable-inputs.md): the rules, the services
// and their prices (docs/decisions/0085-services-ops-can-edit.md), and the service area.

import type { OpsReply } from "../answer.ts";

/**
 * The rules are the register's own, one of each shape: a single number nobody
 * has set, a set of keys somebody has, and the open-keyed cycles.
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
      source: "src/policy/check-in.ts",
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
      source: "src/policy/no-show.ts",
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
      source: "src/config/pieces.ts",
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
      source: "src/policy/next-visit.ts",
      set_by: null,
      set_at: null,
    },
  ],
} satisfies OpsReply<"/api/settings">;

/**
 * The services, kind by kind (docs/decisions/0085-services-ops-can-edit.md): each kind's standard service, a
 * premium first fit ops added and FSM has no item for yet, a lace replacement retired, and a service visit whose new
 * price starts in October, with the one it replaced folded into its history.
 */
const service = (fields: {
  kind: "consultation" | "first_fit" | "service" | "replacement";
  tier: string;
  name: string;
  minutes: number;
  sort?: number;
  retired_date?: string | null;
  fsm_item_id?: string | null;
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
  fsm_item_id: fields.fsm_item_id === undefined ? `fsm-${fields.kind}-${fields.tier}` : fields.fsm_item_id,
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
      fsm_item_id: null,
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
