// The client's sign-off of a fit, from the technician's side (docs/decisions/0254-client-signs-off-the-fit.md): asking,
// and asking again once a flag is put right; the client signing on the technician's phone; and the technician
// recording that the client declined to sign, with why. Each comes through the phone's outbox with its event ID and is
// answered with the sign-off as it then stands, so an event sent again, or one a fit has moved past, never stops the
// queue behind it. A job given to another technician, called off or closed since says so, as any write does.

import { z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { jobChangesSince, type Superseding } from "../../domain/field/job-events.ts";
import { askSignOff, declineSignOff, signOffOf, signOffOnPhone } from "../../domain/field/sign-offs.ts";
import type { WorkableJob } from "../../domain/field/workable-job.ts";
import type { App, AppEnv } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { opsInputs } from "../../http/ops-inputs.ts";
import { techRoute } from "../../http/session-routes.ts";
import { technicianOf } from "../../http/technician-session.ts";
import { cardStepsFor, SIGN_OFF_STEP } from "../../policy/in-job-steps.ts";
import { DECLINE_MAX_CHARS } from "../../policy/sign-off.ts";
import { SignOffAnswerSchema, SignOffSchema } from "../schemas/sign-off.ts";
import { hasClosed, namedJob, refusalOf, superseded } from "./jobs.record.ts";
import { EventIdSchema, jobId } from "./jobs.schemas.ts";

const NOT_A_FIT = "invalid_request: the visit takes no sign-off: it is no first fit, one visit or replacement";
const SIGNED_IN = errorResponse(
  "session_required; device_revoked: ops revoked this phone; technician_inactive: ops switched the technician off",
);
const NO_JOB = errorResponse("not_found: no such job, or never this technician's");
const CHANGED = errorResponse(
  "superseded: the job was given to another technician or called off under the phone; already_closed: the visit " +
    "has closed",
);
const STANDING = { description: "The sign-off as it now stands", ...json(SignOffSchema) };

const askRoute = techRoute({
  method: "post",
  path: "/api/tech/jobs/{id}/sign-off-request",
  summary: "Ask the client to sign off the fit, or ask again once what they flagged is put right",
  request: {
    params: jobId,
    headers: EventIdSchema,
    body: { required: true, ...json(z.object({}).strict().openapi("SignOffRequest")) },
  },
  responses: { 200: STANDING, 400: errorResponse(NOT_A_FIT), 401: SIGNED_IN, 404: NO_JOB, 409: CHANGED },
});

const phoneRoute = techRoute({
  method: "post",
  path: "/api/tech/jobs/{id}/sign-off",
  summary: "The client signs off, or says what isn't right, on the technician's phone",
  request: {
    params: jobId,
    headers: EventIdSchema,
    body: {
      required: true,
      ...json(z.object({ answer: SignOffAnswerSchema }).strict().openapi("SignOffOnPhone")),
    },
  },
  responses: {
    200: STANDING,
    400: errorResponse(NOT_A_FIT),
    401: SIGNED_IN,
    404: NO_JOB,
    409: CHANGED,
    422: errorResponse("sign_off_checks_open: a sign-off needs every check ticked; flag what isn't right instead"),
  },
});

const declineRoute = techRoute({
  method: "post",
  path: "/api/tech/jobs/{id}/sign-off-declined",
  summary: "Record that the client declined to sign, with why: the fit may then close, and Care are given a Tasks row",
  request: {
    params: jobId,
    headers: EventIdSchema,
    body: {
      required: true,
      ...json(
        z
          .object({ reason: z.string().trim().min(1).max(DECLINE_MAX_CHARS) })
          .strict()
          .openapi("SignOffDeclined"),
      ),
    },
  },
  responses: {
    200: STANDING,
    400: errorResponse(`${NOT_A_FIT}; or a reason empty or over ${String(DECLINE_MAX_CHARS)} characters`),
    401: SIGNED_IN,
    404: NO_JOB,
    409: CHANGED,
  },
});

type Ctx = Context<AppEnv>;

/** Why a sign-off write is not taken: no such job of theirs, no fit, or a job changed under the phone. */
type NotTaken = "not_found" | "not_a_fit" | { readonly superseding: Superseding };

/** The job, where it is still this technician's as their phone holds it and takes a sign-off; why not otherwise. */
async function fitJob(c: Ctx): Promise<WorkableJob | NotTaken> {
  const job = await namedJob(c, c.req.param("id") ?? "");
  if (job === null) return "not_found";
  const steps: readonly string[] = cardStepsFor(job.type, job.oneVisit !== null);
  if (!steps.includes(SIGN_OFF_STEP)) return "not_a_fit";
  const superseding = await jobChangesSince(c.env.DB, job, technicianOf(c).technicianId, null);
  return superseding.changed.length > 0 ? { superseding } : job;
}

/** The phone's write: the job, whose, under which event, and when. */
const writeOf = (c: Ctx, job: WorkableJob, eventId: string) => ({
  appointmentId: job.id,
  technicianId: technicianOf(c).technicianId,
  eventId,
  now: c.var.deps.now(),
});

export function registerTechSignOff(app: App): void {
  app.openapi(askRoute, async (c) => {
    const job = await fitJob(c);
    if (job === "not_found") return refuse(c, "not_found");
    if (job === "not_a_fit") return refuse(c, "invalid_request", ["visit"]);
    if ("superseding" in job) return c.json(refusalOf(c, superseded(job.superseding)), 409);
    if (await hasClosed(c, job.id)) return refuse(c, "already_closed");
    const asked = await askSignOff(c.env.DB, writeOf(c, job, c.req.valid("header")["x-client-event-id"]));
    return asked === null ? refuse(c, "already_closed") : c.json(asked, 200);
  });

  app.openapi(phoneRoute, async (c) => {
    const job = await fitJob(c);
    if (job === "not_found") return refuse(c, "not_found");
    if (job === "not_a_fit") return refuse(c, "invalid_request", ["visit"]);
    if ("superseding" in job) return c.json(refusalOf(c, superseded(job.superseding)), 409);
    const { answer } = c.req.valid("json");
    const given =
      answer.result === "signed"
        ? ({ result: "signed", checks: answer.checks } as const)
        : ({ result: "flagged", checks: answer.checks, flagText: answer.flag_text } as const);
    const signed = await signOffOnPhone(c.env.DB, {
      ...given,
      ...writeOf(c, job, c.req.valid("header")["x-client-event-id"]),
      jobClosed: await hasClosed(c, job.id),
      guaranteeDays: (await opsInputs(c)).guaranteeDays,
    });
    if (signed === "job_closed") return refuse(c, "already_closed");
    if (signed === "checks_open") return refuse(c, "sign_off_checks_open");
    return c.json(signed, 200);
  });

  app.openapi(declineRoute, async (c) => {
    const job = await fitJob(c);
    if (job === "not_found") return refuse(c, "not_found");
    if (job === "not_a_fit") return refuse(c, "invalid_request", ["visit"]);
    if ("superseding" in job) return c.json(refusalOf(c, superseded(job.superseding)), 409);
    // Sent again after the close it let land, it is answered with where the sign-off stands.
    if (await hasClosed(c, job.id)) {
      const standing = await signOffOf(c.env.DB, job.id);
      return standing === null ? refuse(c, "already_closed") : c.json(standing, 200);
    }
    const write = writeOf(c, job, c.req.valid("header")["x-client-event-id"]);
    const declined = await declineSignOff(c.env.DB, {
      ...write,
      reason: c.req.valid("json").reason,
      guaranteeDays: (await opsInputs(c)).guaranteeDays,
    });
    return declined === null ? refuse(c, "already_closed") : c.json(declined, 200);
  });
}
