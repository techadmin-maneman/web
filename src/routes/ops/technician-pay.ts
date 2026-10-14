// What technicians are paid for each visit, behind Access (Finance; docs/decisions/0122-technician-pay-per-visit.md):
//   GET   /api/technician-pay                       the grades, each technician's grade, and the rates
//   POST  /api/technician-pay/grades                add a grade
//   PATCH /api/technician-pay/grades/:id            rename one
//   POST  /api/technician-pay/grades/:id/delete     delete one added by mistake, while nothing uses it
//   POST  /api/technician-pay/rates                 set a grade's rate for a kind of visit, from today or later
//   POST  /api/technician-pay/technicians/:id       give a technician a grade, or take theirs away
//   GET   /api/technician-pay/statement?month=      each technician's visits closed in a month, at the rates then
//
// Grades and every city's rates are national: they need a national Finance grant. A city's own rate, and a
// technician's grade, keep to the caller's cities.

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { actorOf } from "../../http/audit.ts";
import type { App, AppEnv } from "../../http/context.ts";
import { listCities } from "../../domain/cities/cities.ts";
import {
  addGrade,
  deleteGrade,
  MAX_VISIT_PAY,
  renameGrade,
  setRate,
  setTechnicianGrade,
  technicianPay,
  VISIT_PAY_KINDS,
} from "../../domain/field/technician-pay.ts";
import { payStatement } from "../../domain/field/pay-statement.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { routeReach, withinRouteReach } from "../../http/staff-access.ts";
import { indiaDate } from "../../lib/india-time.ts";
import { reachesCity } from "../../policy/access.ts";

/** A grade's name: a letter or a digit first, then letters, digits, spaces and . , ' ( ) & / -. */
const GRADE_NAME = /^[\p{L}\p{N}][\p{L}\p{N} .,'()&/-]{0,39}$/u;

const KindSchema = z.enum(VISIT_PAY_KINDS).openapi({
  description:
    "consultation, one_visit (a consultation and fit in one visit), first_fit, service, replacement, no_show.",
});

const PaySchema = z
  .object({
    today: z.iso.date().openapi({ description: "India's date, the first a rate may start from." }),
    kinds: z.array(KindSchema),
    cities: z.array(z.string()).openapi({ description: "The cities a rate may be set for alone, within reach." }),
    max_amount: z.number().int().openapi({ description: "The most one visit may pay, in paise." }),
    grades: z.array(
      z
        .object({
          id: z.uuid(),
          name: z.string(),
          technicians: z.number().int().openapi({ description: "Active technicians on it." }),
        })
        .strict(),
    ),
    technicians: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          city: z.union([z.string(), z.null()]),
          grade_id: z.union([z.uuid(), z.null()]),
        })
        .strict(),
    ),
    rates: z
      .array(
        z
          .object({
            grade_id: z.uuid(),
            city: z.union([z.string(), z.null()]).openapi({ description: "One city's rate; null for every city." }),
            kind: KindSchema,
            amount: z
              .union([z.number().int(), z.null()])
              .openapi({ description: "Paise; null from that date for no rate of its own." }),
            effective_from: z.iso.date(),
            set_by: z.string(),
            set_at: z.iso.datetime(),
          })
          .strict(),
      )
      .openapi({ description: "The rates in force today, and every one set to start later." }),
  })
  .strict()
  .openapi("TechnicianPay");

const ok = { description: "The pay as it now stands", ...json(PaySchema) };
const GradeName = z.object({ name: z.string().trim().regex(GRADE_NAME) }).strict();
const GradeId = z.object({ id: z.uuid() });

const StatementSchema = z
  .object({
    month: z.string().openapi({ example: "2026-11" }),
    lines: z.array(
      z
        .object({
          technician_id: z.string(),
          technician: z.string(),
          city: z.union([z.string(), z.null()]).openapi({ description: "The visit's city." }),
          kind: KindSchema,
          visits: z.number().int(),
          rate: z
            .union([z.number().int(), z.null()])
            .openapi({ description: "Paise a visit; null where none was in force." }),
          amount: z
            .union([z.number().int(), z.null()])
            .openapi({ description: "Paise in all; null where no rate was in force." }),
        })
        .strict(),
    ),
  })
  .strict()
  .openapi("PayStatement", {
    description:
      "Each technician's visits closed in the month, by kind and city, at the rate in force on each one's day.",
  });

const statementRoute = createRoute({
  method: "get",
  path: "/api/technician-pay/statement",
  summary: "What each technician earned in a month at their rates per visit",
  request: { query: z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }) },
  responses: {
    200: { description: "The month's statement", ...json(StatementSchema) },
    400: errorResponse("invalid_request: month is YYYY-MM"),
    403: errorResponse("access_required"),
  },
});

const listRoute = createRoute({
  method: "get",
  path: "/api/technician-pay",
  summary: "The grades, each technician's grade, and the rates per visit",
  responses: { 200: ok, 403: errorResponse("access_required") },
});

const addGradeRoute = createRoute({
  method: "post",
  path: "/api/technician-pay/grades",
  summary: "Add a grade",
  request: { body: { required: true, ...json(GradeName.openapi("PayGradeAdd")) } },
  responses: {
    200: ok,
    400: errorResponse("invalid_request: fields names name"),
    403: errorResponse("access_required"),
    409: errorResponse("taken: a grade has that name"),
  },
});

const renameGradeRoute = createRoute({
  method: "patch",
  path: "/api/technician-pay/grades/{id}",
  summary: "Rename a grade",
  request: { params: GradeId, body: { required: true, ...json(GradeName.openapi("PayGradeRename")) } },
  responses: {
    200: ok,
    400: errorResponse("invalid_request: fields names name"),
    403: errorResponse("access_required"),
    404: errorResponse("not_found"),
    409: errorResponse("taken: another grade has that name"),
  },
});

const deleteGradeRoute = createRoute({
  method: "post",
  path: "/api/technician-pay/grades/{id}/delete",
  summary: "Delete a grade no technician holds and no rate has named",
  request: { params: GradeId },
  responses: {
    200: ok,
    403: errorResponse("access_required"),
    404: errorResponse("not_found"),
    409: errorResponse("in_use: a technician holds it, or a rate has named it"),
  },
});

const setRateRoute = createRoute({
  method: "post",
  path: "/api/technician-pay/rates",
  summary: "Set a grade's rate for a kind of visit, for every city or one, from today or later",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({
            grade_id: z.uuid(),
            city: z.union([z.string().min(1).max(60), z.null()]),
            kind: KindSchema,
            amount: z
              .union([z.number().int().min(0).max(MAX_VISIT_PAY), z.null()])
              .openapi({ description: "Paise; null for no rate of its own from that date." }),
            from: z.iso.date(),
          })
          .strict()
          .openapi("PayRateSet"),
      ),
    },
  },
  responses: {
    200: ok,
    400: errorResponse("invalid_request: fields names from when it is before today, and city when it is not ours"),
    403: errorResponse("not_permitted: every city's rate, and Finance does not reach every city for the caller"),
    404: errorResponse("not_found: no such grade, or a city outside the caller's"),
  },
});

const gradeOfRoute = createRoute({
  method: "post",
  path: "/api/technician-pay/technicians/{id}",
  summary: "Give a technician a grade, or take theirs away",
  request: {
    params: z.object({ id: z.string().min(1).max(64) }),
    body: {
      required: true,
      ...json(
        z
          .object({ grade_id: z.union([z.uuid(), z.null()]) })
          .strict()
          .openapi("TechnicianPayGrade"),
      ),
    },
  },
  responses: {
    200: ok,
    403: errorResponse("access_required"),
    404: errorResponse("not_found: no such technician in the caller's cities, or no such grade"),
  },
});

export function registerOpsTechnicianPay(app: App): void {
  /** The pay as the caller may see it: every technician and city rate within their reach. */
  const list = async (c: Context<AppEnv>) => {
    const reach = await routeReach(c);
    const today = indiaDate(c.var.deps.now());
    const [pay, cities] = await Promise.all([technicianPay(c.env.DB, today), listCities(c.env.DB)]);
    return {
      today,
      kinds: [...VISIT_PAY_KINDS],
      cities: cities.map((city) => city.name).filter((city) => reachesCity(reach, city)),
      max_amount: MAX_VISIT_PAY,
      grades: pay.grades,
      technicians: pay.technicians.filter((technician) => reachesCity(reach, technician.city)),
      rates: pay.rates.filter((rate) => rate.city === null || reachesCity(reach, rate.city)),
    };
  };
  const change = (c: Context<AppEnv>) => ({ actor: actorOf(c), requestId: c.var.requestId, now: c.var.deps.now() });

  app.openapi(listRoute, async (c) => c.json(await list(c), 200));

  app.openapi(statementRoute, async (c) => {
    const { month } = c.req.valid("query");
    const [reach, lines] = await Promise.all([routeReach(c), payStatement(c.env.DB, month)]);
    return c.json({ month, lines: lines.filter((line) => reachesCity(reach, line.city)) }, 200);
  });

  app.openapi(addGradeRoute, async (c) => {
    const added = await addGrade(c.env.DB, { ...change(c), name: c.req.valid("json").name });
    if (added === "taken") return refuse(c, "taken");
    return c.json(await list(c), 200);
  });

  app.openapi(renameGradeRoute, async (c) => {
    const renamed = await renameGrade(c.env.DB, {
      ...change(c),
      id: c.req.valid("param").id,
      name: c.req.valid("json").name,
    });
    if (renamed === "not_found") return refuse(c, "not_found");
    if (renamed === "taken") return refuse(c, "taken");
    return c.json(await list(c), 200);
  });

  app.openapi(deleteGradeRoute, async (c) => {
    const deleted = await deleteGrade(c.env.DB, { ...change(c), id: c.req.valid("param").id });
    if (deleted === "not_found") return refuse(c, "not_found");
    if (deleted === "in_use") return refuse(c, "in_use");
    return c.json(await list(c), 200);
  });

  app.openapi(setRateRoute, async (c) => {
    const body = c.req.valid("json");
    if (body.from < indiaDate(c.var.deps.now())) return refuse(c, "invalid_request", ["from"]);
    const reach = await routeReach(c);
    if (body.city === null && reach.kind !== "everywhere") return refuse(c, "not_permitted");
    if (body.city !== null) {
      if (!(await listCities(c.env.DB)).some((city) => city.name === body.city)) {
        return refuse(c, "invalid_request", ["city"]);
      }
      if (!reachesCity(reach, body.city)) return refuse(c, "not_found");
    }
    const set = await setRate(c.env.DB, {
      ...change(c),
      gradeId: body.grade_id,
      city: body.city,
      kind: body.kind,
      amount: body.amount,
      from: body.from,
    });
    if (set === "not_found") return refuse(c, "not_found");
    return c.json(await list(c), 200);
  });

  app.openapi(gradeOfRoute, async (c) => {
    const { id } = c.req.valid("param");
    if (!(await withinRouteReach(c, "technician", id))) return refuse(c, "not_found");
    const set = await setTechnicianGrade(c.env.DB, {
      ...change(c),
      technicianId: id,
      gradeId: c.req.valid("json").grade_id,
    });
    if (set === "not_found") return refuse(c, "not_found");
    return c.json(await list(c), 200);
  });
}
