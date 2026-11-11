// The outcome step's body (./jobs.steps.ts): done, with what a consultation's client said and picked, or partly done
// for one of ops' reasons (docs/decisions/0149-lost-reasons.md, docs/decisions/0247-the-steps-left.md). A reason ops
// have taken off since the phone kept the job is still taken.

import { z } from "@hono/zod-openapi";
import { offeredProducts } from "../../domain/booking/services.ts";
import { OutcomeRequestSchema } from "../../domain/field/job-event-bodies.ts";
import { jobSheet, knownCodes } from "../../domain/field/job-sheet-settings.ts";
import { type WorkableJob } from "../../domain/field/workable-job.ts";
import { decisionAtVisit } from "../../domain/visits/one-visit.ts";
import { indiaDate } from "../../lib/india-time.ts";
import { NO_PIECE, takesStep } from "../../policy/in-job-steps.ts";
import { type Ctx, type StepBody } from "./jobs.record.ts";

type OutcomeBody = z.infer<typeof OutcomeRequestSchema>;

/**
 * A one visit whose fit the client booked for another day: going ahead, with the product its piece step chose as their
 * pick, whether or not the close names it. Nothing where the visit was not booked for later; null for a close that
 * contradicts its piece step.
 */
async function laterPick(
  c: Ctx,
  job: WorkableJob,
  goingAhead: boolean,
  product: string | undefined,
): Promise<{ product?: string } | null> {
  const decision = await decisionAtVisit(c.env.DB, job.id);
  const later = decision !== null && "fit_later" in decision ? decision.product : null;
  if (later === null) return product === undefined ? {} : null;
  if (!goingAhead || (product !== undefined && product !== later)) return null;
  return { product: later };
}

/**
 * A consultation's pick from Options, kept with a client going ahead: one of the products offered on the visit's day;
 * a one visit's is its fit booked for later. Nothing where none was picked; null for a pick refused, as one on any
 * other visit, on a client not going ahead, or of a product not offered.
 */
async function pickOf(
  c: Ctx,
  job: WorkableJob,
  goingAhead: boolean,
  product: string | undefined,
): Promise<{ product?: string } | null> {
  if (job.oneVisit !== null) return laterPick(c, job, goingAhead, product);
  if (product === undefined) return {};
  if (job.type !== "consultation" || !goingAhead) return null;
  const offered = await offeredProducts(c.env.DB, indiaDate(job.windowStart));
  return offered.some((each) => each.tier === product) ? { product } : null;
}

/** A close done: as said, with a yes and its pick, or a no and why. */
async function doneBody(c: Ctx, job: WorkableJob, body: Extract<OutcomeBody, { outcome: "done" }>): Promise<StepBody> {
  if (body.lost_reason === undefined) {
    if (body.going_ahead === undefined)
      return body.product === undefined ? { outcome: "done" } : { invalid: ["product"] };
    const picked = await pickOf(c, job, body.going_ahead, body.product);
    return picked === null ? { invalid: ["product"] } : { outcome: "done", going_ahead: body.going_ahead, ...picked };
  }
  if (body.product !== undefined) return { invalid: ["product"] };
  const lost = knownCodes((await jobSheet(c.env.DB)).lostReasons);
  return lost.has(body.lost_reason)
    ? { outcome: "done", lost_reason: body.lost_reason, going_ahead: false }
    : { invalid: ["lost_reason"] };
}

/** The close as it is kept, or the fields refused. */
export async function outcomeBody(c: Ctx, job: WorkableJob, body: OutcomeBody): Promise<StepBody> {
  if (body.outcome === "done") return doneBody(c, job, body);
  if (body.cannot_fit === true) {
    return body.reason === NO_PIECE && takesStep("piece", job.type, job.oneVisit !== null)
      ? { outcome: "partial", reason: NO_PIECE, cannot_fit: true }
      : { invalid: ["cannot_fit"] };
  }
  const known = knownCodes((await jobSheet(c.env.DB)).partialReasons);
  return known.has(body.reason) ? { outcome: "partial", reason: body.reason } : { invalid: ["reason"] };
}
