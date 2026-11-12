// The client's sign-off of a fit, from the technician's side (docs/decisions/0254-client-signs-off-the-fit.md): asking,
// and asking again once a flag is put right; the client signing on the technician's phone, with the code the ask gave
// it; and the technician recording that the client declined to sign, with why. Each write carries the phone's event
// ID, as the outbox sends it; the card says where the sign-off stands (./jobs.read.ts).

import { z } from "@hono/zod-openapi";
import { askSignOff, declineSignOff, signOffOnPhone, type AnswerRefusal } from "../../domain/field/sign-offs.ts";
import type { App, AppEnv } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { techRoute } from "../../http/session-routes.ts";
import { technicianOf } from "../../http/technician-session.ts";
import { cardStepsFor, SIGN_OFF_STEP } from "../../policy/in-job-steps.ts";
import { DECLINE_MAX_CHARS, SIGN_OFF_STATES } from "../../policy/sign-off.ts";
import { SignOffAnswerSchema, SignOffSchema } from "../schemas/sign-off.ts";
import { namedJob } from "./jobs.record.ts";
import { EventIdSchema, jobId } from "./jobs.schemas.ts";
import type { Context } from "hono";
import type { WorkableJob } from "../../domain/field/workable-job.ts";

const NOT_A_FIT = "invalid_request: the visit takes no sign-off: it is no first fit, one visit or replacement";
const SIGNED_IN = errorResponse(
  "session_required; device_revoked: ops revoked this phone; technician_inactive: ops switched the technician off",
);
const NO_JOB = errorResponse("not_found: no such job, or never this technician's");

const askRoute = techRoute({
  method: "post",
  path: "/api/tech/jobs/{id}/sign-off-request",
  summary: "Ask the client to sign off the fit, or ask again once what they flagged is put right",
  request: {
    params: jobId,
    headers: EventIdSchema,
    body: { required: true, ...json(z.object({}).strict().openapi("SignOffRequest")) },
  },
  responses: {
    200: {
      description: "Asked; the code a signature on this phone carries, null where it is signed or declined already",
      ...json(
        z
          .object({
            state: z.enum(SIGN_OFF_STATES),
            code: z.union([z.string().regex(/^\d{6}$/), z.null()]).openapi({
              description: "Six digits, for 30 minutes, for the client to sign on this phone. Shown to nobody.",
            }),
          })
          .strict()
          .openapi("SignOffAsked"),
      ),
    },
    400: errorResponse(NOT_A_FIT),
    401: SIGNED_IN,
    404: NO_JOB,
  },
});

const phoneRoute = techRoute({
  method: "post",
  path: "/api/tech/jobs/{id}/sign-off",
  summary: "The client signs off, or flags, on the technician's phone, with the code the ask gave it",
  request: {
    params: jobId,
    headers: EventIdSchema,
    body: {
      required: true,
      ...json(
        z
          .object({ code: z.string().regex(/^\d{6}$/), answer: SignOffAnswerSchema })
          .strict()
          .openapi("SignOffOnPhone"),
      ),
    },
  },
  responses: {
    200: { description: "Recorded", ...json(SignOffSchema) },
    400: errorResponse(NOT_A_FIT),
    401: SIGNED_IN,
    403: errorResponse("sign_off_code: the code is wrong, used, or past its 30 minutes: ask again"),
    404: NO_JOB,
    409: errorResponse("sign_off_not_asked: ask first; sign_off_closed: signed or declined already"),
    422: errorResponse("sign_off_checks_open: a sign-off needs every check ticked; flag what isn't right instead"),
  },
});

const declineRoute = techRoute({
  method: "post",
  path: "/api/tech/jobs/{id}/sign-off-declined",
  summary: "Record that the client declined to sign, with why: the fit then closes, and ops are given a Tasks row",
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
    200: { description: "Recorded", ...json(SignOffSchema) },
    400: errorResponse(`${NOT_A_FIT}; or a reason empty or over ${String(DECLINE_MAX_CHARS)} characters`),
    401: SIGNED_IN,
    404: NO_JOB,
    409: errorResponse("sign_off_closed: the client signed already"),
  },
});

type Ctx = Context<AppEnv>;

/** The job, where it is this technician's and takes a sign-off; why not otherwise. */
async function fitJob(c: Ctx): Promise<WorkableJob | "not_found" | "not_a_fit"> {
  const job = await namedJob(c, c.req.param("id") ?? "");
  if (job === null) return "not_found";
  const steps: readonly string[] = cardStepsFor(job.type, job.oneVisit !== null);
  return steps.includes(SIGN_OFF_STEP) ? job : "not_a_fit";
}

const REFUSALS: Readonly<
  Record<AnswerRefusal, "sign_off_not_asked" | "sign_off_closed" | "sign_off_checks_open" | "sign_off_code">
> = {
  not_asked: "sign_off_not_asked",
  closed: "sign_off_closed",
  checks_open: "sign_off_checks_open",
  code_wrong: "sign_off_code",
};

export function registerTechSignOff(app: App): void {
  app.openapi(askRoute, async (c) => {
    const job = await fitJob(c);
    if (job === "not_found") return refuse(c, "not_found");
    if (job === "not_a_fit") return refuse(c, "invalid_request", ["visit"]);
    const asked = await askSignOff(c.env.DB, {
      appointmentId: job.id,
      technicianId: technicianOf(c).technicianId,
      now: c.var.deps.now(),
    });
    return c.json(asked, 200);
  });

  app.openapi(phoneRoute, async (c) => {
    const job = await fitJob(c);
    if (job === "not_found") return refuse(c, "not_found");
    if (job === "not_a_fit") return refuse(c, "invalid_request", ["visit"]);
    const { code, answer } = c.req.valid("json");
    const given =
      answer.result === "signed"
        ? ({ result: "signed", checks: answer.checks } as const)
        : ({ result: "flagged", checks: answer.checks, flagText: answer.flag_text } as const);
    const signed = await signOffOnPhone(c.env.DB, { ...given, appointmentId: job.id, code, now: c.var.deps.now() });
    return typeof signed === "string" ? refuse(c, REFUSALS[signed]) : c.json(signed, 200);
  });

  app.openapi(declineRoute, async (c) => {
    const job = await fitJob(c);
    if (job === "not_found") return refuse(c, "not_found");
    if (job === "not_a_fit") return refuse(c, "invalid_request", ["visit"]);
    const declined = await declineSignOff(c.env.DB, {
      appointmentId: job.id,
      technicianId: technicianOf(c).technicianId,
      reason: c.req.valid("json").reason,
      now: c.var.deps.now(),
    });
    return declined === "closed" ? refuse(c, "sign_off_closed") : c.json(declined, 200);
  });
}
