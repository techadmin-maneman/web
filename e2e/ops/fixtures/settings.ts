// Settings (docs/decisions/0061-ops-editable-inputs.md): the rules, the price
// book and the service area.

import type { OpsReply } from "../answer.ts";

/**
 * The rules are the register's own, one of each shape: a single number nobody
 * has set, a set of keys somebody has, and the open-keyed cycles.
 */
export const SETTINGS = {
  settings: [
    {
      name: "checkin_radius_m",
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
        first_fit_lead: { min: 0, max: 30 },
        service_cadence: { min: 14, max: 90 },
        reminder_before_due: { min: 1, max: 14 },
        at_risk_after_due: { min: 1, max: 60 },
        first_fit_to_book: { min: 1, max: 60 },
        horizon: { min: 14, max: 90 },
        invoice_prompt: { min: 1, max: 60 },
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

/** The committed figures: the first fit in force, and a service whose new price starts in October. */
export const PRICES = {
  today: "2027-09-21",
  max_amount_ex_gst: 100_000_000,
  max_gst_percent: 28,
  prices: [
    {
      item: "first_fit",
      tier: "standard",
      amount_ex_gst: 3_000_000,
      gst_percent: 0,
      valid_from: "2026-09-22",
      in_force: true,
    },
    {
      item: "service",
      tier: "standard",
      amount_ex_gst: 250_000,
      gst_percent: 18,
      valid_from: "2027-10-01",
      in_force: false,
    },
    {
      item: "service",
      tier: "standard",
      amount_ex_gst: 200_000,
      gst_percent: 18,
      valid_from: "2026-09-22",
      in_force: true,
    },
  ],
} satisfies OpsReply<"/api/prices">;

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
