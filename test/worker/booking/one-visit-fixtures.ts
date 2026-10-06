// What the one-visit tests share (one-visit*.test.ts): the product and the link's reference, a one visit booked, a
// technician walked to its piece step and closing it, and the link's row.

import { env } from "cloudflare:workers";
import { type PaymentsProvider } from "../../../src/providers/payments/index.ts";
import type { Settings } from "../../../src/config/settings.ts";
import { NOW } from "../helpers.ts";
import { JOB, working, type Working } from "../job-fixtures.ts";

/** Mane Man Natural, at Rs. 45,000 with no GST, as staging's book has no GST. */
export const NATURAL = { tier: "natural", name: "Mane Man Natural", amount: 4_500_000 };

/** The first reference of NOW's year, which the visit's link takes before any payment. */
export const LINK_REFERENCE = "MM-2026-0001";

/** Fourteen days after NOW, when a link made at NOW stops taking payment. */
export const TWO_WEEKS_ON = new Date("2026-10-05T06:30:00.000Z");

export const path = (step: string) => `/api/tech/jobs/${JOB}/${step}`;

export const A_PIECE = { piece_code: "MM-NAT-4417-A", base: "Lace", supplier_lot: "L-22" };

/** Today's job booked from the site as one visit, with a second product beside the standard first fit. */
export async function oneVisit(
  vendors: { payments?: PaymentsProvider } = {},
  settings: Partial<Settings> = {},
): Promise<Working> {
  const job = await working("first_fit", vendors, settings);
  await env.DB.batch([
    env.DB.prepare("UPDATE appointments SET one_visit = 'booked' WHERE id = ?1").bind(JOB),
    env.DB.prepare(
      `INSERT INTO services (kind, tier, name, minutes, sort, updated_by, updated_at)
       VALUES ('first_fit', ?1, ?2, 180, 1, 'ops@localhost', ?3)`,
    ).bind(NATURAL.tier, NATURAL.name, NOW.toISOString()),
    env.DB.prepare(
      `INSERT INTO price_book (item, tier, amount_ex_gst, gst_percent, valid_from)
       VALUES ('first_fit', ?1, ?2, 0, '2026-09-01')`,
    ).bind(NATURAL.tier, NATURAL.amount),
  ]);
  return job;
}

/** Works the visit to its piece step, sends it, then the rest up to the outcome; answers the piece step. */
export async function toThePiece(job: Working, piece: object): Promise<Response> {
  await job.workTo("piece");
  const answer = await job.post(path("piece"), piece, "event-piece-01");
  await job.post(path("checklist"), { done: [] }, "event-checklist-01");
  await job.post(path("consumables"), { items: [] }, "event-consumables-01");
  await job.post(path("photos"), { phase: "after" }, "event-afterphotos-01");
  return answer;
}

export const closeAsDone = (job: Working, eventId = "event-outcome-01") =>
  job.post(path("outcome"), { outcome: "done" }, eventId);

export const linkRow = () =>
  env.DB.prepare(
    "SELECT tier, amount, razorpay_link_id IS NOT NULL AS made, sent_at, paid_at FROM payment_links",
  ).first();
