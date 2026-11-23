// Fit today, from the technician's side (docs/decisions/0299-fit-today.md): whether a plain consultation they have just
// closed as done may become the client's fit on the spot, and booking it. Both need signal: the booking is the
// engine's own, never queued on the phone.

import { z } from "@hono/zod-openapi";
import { fitTodayOf, holdFitToday, type FitTodayRefusal } from "../../domain/booking/fit-today.ts";
import { visitOfHold } from "../../domain/booking/booked-hold.ts";
import { bookHold } from "../../http/book-hold.ts";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse, type ErrorCode } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { techRoute } from "../../http/session-routes.ts";
import { technicianOf } from "../../http/technician-session.ts";
import { jobId } from "./jobs.schemas.ts";

const REFUSALS = [
  "not_offered",
  "fit_booked",
  "not_in_kit",
  "no_product",
  "no_room",
] as const satisfies readonly FitTodayRefusal[];

const FitTodaySchema = z
  .object({
    offer: z.union([
      z
        .object({
          product: z.string().openapi({ description: "The first fit's service, the client's profile's product." }),
          stock_code: z.string().openapi({ description: "The hair system in the kit made exactly to the profile." }),
          stock_name: z.string(),
          starts_at: z.iso.datetime(),
          minutes: z.number().int(),
        })
        .strict(),
      z.null(),
    ]),
    refusal: z.union([z.enum(REFUSALS), z.null()]).openapi({
      description:
        "Why it is not offered: not_offered (not this technician's plain consultation closed done today), fit_booked, " +
        "not_in_kit (no piece made exactly to the profile), no_product, no_room (no start near enough to begin now, " +
        "or too late in the day for a one visit). Null with an offer.",
    }),
  })
  .strict()
  .openapi("TechnicianFitToday");

const SIGNED_IN = errorResponse(
  "session_required; device_revoked: ops revoked this phone; technician_inactive: ops switched the technician off",
);

const fitTodayRoute = techRoute({
  method: "get",
  path: "/api/tech/jobs/{id}/fit-today",
  summary: "Whether the consultation just closed may become the client's fit on the spot, and with which piece",
  request: { params: jobId },
  responses: { 200: { description: "The offer, or why there is none", ...json(FitTodaySchema) }, 401: SIGNED_IN },
});

const bookFitTodayRoute = techRoute({
  method: "post",
  path: "/api/tech/jobs/{id}/fit-today",
  summary: "Books the client's fit on the spot, with this technician, as a consultation and fit in one visit",
  request: { params: jobId },
  responses: {
    201: {
      description: "Booked",
      ...json(
        z
          .object({ visit_id: z.union([z.uuid(), z.null()]) })
          .strict()
          .openapi("TechnicianFitTodayBooked"),
      ),
    },
    401: SIGNED_IN,
    404: errorResponse("not_found: not this technician's plain consultation closed as done today"),
    409: errorResponse("already_booked: the client has a first fit to come; taken: no room on the day from now"),
    422: errorResponse("not_bookable: no piece in the kit made to the profile; no_product: none on sale today"),
  },
});

/** The error each refusal is answered with. */
const CODE_OF = {
  not_offered: "not_found",
  fit_booked: "already_booked",
  not_in_kit: "not_bookable",
  no_product: "no_product",
  no_room: "taken",
} as const satisfies Readonly<Record<FitTodayRefusal, ErrorCode>>;

export function registerTechFitToday(app: App): void {
  app.openapi(fitTodayRoute, async (c) => {
    const asked = { technicianId: technicianOf(c).technicianId, jobId: c.req.valid("param").id, now: c.var.deps.now() };
    const offered = await fitTodayOf(c.env.DB, asked);
    if (!offered.ok) return c.json({ offer: null, refusal: offered.refusal }, 200);
    const { service, stock, startsAt } = offered.fit;
    const offer = {
      product: service.name,
      stock_code: stock.code,
      stock_name: stock.name,
      starts_at: startsAt.toISOString(),
      minutes: service.minutes,
    };
    return c.json({ offer, refusal: null }, 200);
  });

  app.openapi(bookFitTodayRoute, async (c) => {
    const asked = { technicianId: technicianOf(c).technicianId, jobId: c.req.valid("param").id, now: c.var.deps.now() };
    const held = await holdFitToday(c.env.DB, asked);
    if (!held.ok) return refuse(c, CODE_OF[held.refusal]);
    await bookHold(c, held.holdId);
    c.var.log.info("fit_today_booked", { hold_id: held.holdId });
    return c.json({ visit_id: await visitOfHold(c.env.DB, held.holdId) }, 201);
  });
}
