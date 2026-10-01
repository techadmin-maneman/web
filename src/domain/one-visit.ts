// What closing a consultation and fit in one visit as done makes of it
// (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md; src/policy/one-visit.ts). The technician's piece step
// recorded what the client decided: the product they chose and were fitted with, whose payment link then goes to
// them, or that they decided against it, which makes the visit a consultation, with nothing charged and any discount
// code on it given back (docs/decisions/0108-discount-codes.md). A close the phone sends again finds the visit as the
// first one left it, and asks for the link only while it is still unsent.
//
// A visit closed partly done, or as a no-show, stays a one visit still to be decided: ops follow it up from the
// Tasks board, as any visit so closed, and nothing is charged or sent.

import { STANDARD_TIER } from "../config/visit-types.ts";
import { indiaDate } from "../lib/india-time.ts";
import type { Decision } from "../policy/one-visit.ts";
import { releaseDeclined } from "./discount-code-uses.ts";
import { eventsOf } from "./job-events.ts";
import { sendPaymentLink, type LinkDeps, type LinkSent } from "./payment-links.ts";

/** The client's decision, from the piece step's body; null for a body that records neither. */
export function decisionOf(body: Record<string, unknown>): Decision | null {
  if (body.declined === true) return { declined: true };
  return typeof body.product === "string" ? { product: body.product } : null;
}

/** The job being closed: which visit, whose, and when. */
export interface ClosingJob {
  readonly id: string;
  readonly personId: string | null;
  readonly windowStart: Date;
}

/**
 * Closes a one visit as done, by the client's decision at its latest piece step: the visit becomes a consultation,
 * or the product's, whose payment link is then asked for. Null where nothing is asked: a declined visit, or one
 * whose piece step records no decision.
 */
export async function closeOneVisit(
  db: D1Database,
  deps: LinkDeps,
  job: ClosingJob,
  now: Date,
): Promise<LinkSent | null> {
  const piece = (await eventsOf(db, job.id)).findLast((event) => event.kind === "piece");
  const decision = piece === undefined ? null : decisionOf(piece.body);
  if (decision === null || job.personId === null) return null;

  if ("declined" in decision) {
    await db.batch([
      db
        .prepare("UPDATE appointments SET one_visit = 'declined', type = 'consultation', tier = ?2 WHERE id = ?1")
        .bind(job.id, STANDARD_TIER),
      releaseDeclined(db, job.id, now),
    ]);
    return null;
  }
  await db
    .prepare("UPDATE appointments SET one_visit = 'fitted', tier = ?2 WHERE id = ?1")
    .bind(job.id, decision.product)
    .run();
  const visit = {
    appointmentId: job.id,
    personId: job.personId,
    tier: decision.product,
    day: indiaDate(job.windowStart),
  };
  return sendPaymentLink(db, deps, visit, now);
}
