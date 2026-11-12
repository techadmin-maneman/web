// The client signs off a fit from their own app, or says what isn't right (docs/decisions/0254-client-signs-off-the-fit.md):
// only once the technician has asked, and only on a visit of theirs. A flag goes to the technician's phone, who puts it
// right and asks again; a sign-off is final.

import { z } from "@hono/zod-openapi";
import { signOffInApp, type AnswerRefusal } from "../../domain/field/sign-offs.ts";
import { clientOf } from "../../http/client-session.ts";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { opsInputs } from "../../http/ops-inputs.ts";
import { clientRoute } from "../../http/session-routes.ts";
import { SignOffAnswerSchema, SignOffSchema } from "../schemas/sign-off.ts";

const signOffRoute = clientRoute({
  method: "post",
  path: "/api/visits/{id}/sign-off",
  summary: "Sign off the fit the technician asked about, or say what isn't right",
  request: {
    params: z.object({ id: z.uuid().openapi({ description: "The visit's ID." }) }),
    body: { required: true, ...json(SignOffAnswerSchema) },
  },
  responses: {
    200: { description: "Recorded; a flag reaches the technician's phone", ...json(SignOffSchema) },
    400: errorResponse("invalid_request: see error.fields"),
    401: errorResponse("session_required"),
    404: errorResponse("not_found: no such visit of this client's"),
    409: errorResponse("sign_off_not_asked: the technician has not asked yet; sign_off_closed: signed or declined"),
    422: errorResponse("sign_off_checks_open: a sign-off needs every check ticked; flag what isn't right instead"),
  },
});

const REFUSALS: Readonly<Record<AnswerRefusal, "sign_off_not_asked" | "sign_off_closed" | "sign_off_checks_open">> = {
  not_asked: "sign_off_not_asked",
  closed: "sign_off_closed",
  checks_open: "sign_off_checks_open",
};

export function registerClientSignOff(app: App): void {
  app.openapi(signOffRoute, async (c) => {
    const answer = c.req.valid("json");
    const given =
      answer.result === "signed"
        ? ({ result: "signed", checks: answer.checks } as const)
        : ({ result: "flagged", checks: answer.checks, flagText: answer.flag_text } as const);
    const signed = await signOffInApp(c.env.DB, {
      ...given,
      appointmentId: c.req.valid("param").id,
      personId: clientOf(c).subjectId,
      guaranteeDays: (await opsInputs(c)).guaranteeDays,
      now: c.var.deps.now(),
    });
    if (signed === "not_found") return refuse(c, "not_found");
    return typeof signed === "string" ? refuse(c, REFUSALS[signed]) : c.json(signed, 200);
  });
}
