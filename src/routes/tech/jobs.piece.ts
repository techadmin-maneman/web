// The piece step's body (./jobs.steps.ts): on a one visit, the product the client chose or that they decided
// against it; on any other job that takes one, the piece fitted or the one that failed.

import { z } from "@hono/zod-openapi";
import { PieceRequestSchema } from "../../domain/job-event-bodies.ts";
import { offeredProducts } from "../../domain/services.ts";
import { type WorkableJob } from "../../domain/tech-jobs.ts";
import { indiaDate } from "../../lib/india-time.ts";
import { takesStep } from "../../policy/in-job-steps.ts";
import { pieceRecorded } from "../../policy/piece-step.ts";

import { type Ctx, type StepBody } from "./jobs.record.ts";

type PieceBody = z.infer<typeof PieceRequestSchema>;

/** The piece step's body for this job: a one visit's choice, or a piece fitted or failed where the job takes one. */
export async function pieceBody(c: Ctx, job: WorkableJob, body: PieceBody): Promise<StepBody> {
  if (job.oneVisit !== null) return oneVisitPiece(c, job, body);
  if ("declined" in body || body.product !== undefined) return { invalid: ["product"] };
  if (!takesStep("piece", job.type)) return { invalid: ["piece_code"] };
  return pieceRecorded(body);
}

/**
 * A one visit's piece step: the client decided against the fit, or chose one of the products offered on the visit's
 * day and was fitted with a new piece from the technician's kit, so nothing came off and nothing failed.
 */
async function oneVisitPiece(c: Ctx, job: WorkableJob, body: PieceBody): Promise<StepBody> {
  if ("declined" in body) return { declined: true };
  if (body.product === undefined) return { invalid: ["product"] };
  if ((body.old_piece ?? null) !== null || (body.failure_reason ?? null) !== null) {
    return { invalid: ["old_piece", "failure_reason"] };
  }
  const offered = await offeredProducts(c.env.DB, indiaDate(job.windowStart));
  if (!offered.some((service) => service.tier === body.product)) return { invalid: ["product"] };
  const fitted = pieceRecorded(body);
  return "invalid" in fitted ? fitted : { ...fitted, product: body.product };
}
