// The technicians themselves, behind Access (Ops Console, board D3):
//   GET   /api/technicians/work?from=&to=   jobs finished, and how long they took
//   POST  /api/technicians                  add a technician
//   PATCH /api/technicians/:id              change his name, number, zone or city
//   POST  /api/technicians/:id/deactivate   switch him off: signed out, his visits still to come unassigned
//   POST  /api/technicians/:id/reactivate   switch him back on
//
// The roster itself, and the phones each technician works from, are on
// GET /api/technicians (src/routes/ops-field.ts). The work route answers the two
// figures the board draws beside it, over a period the roster has no business
// carrying.
//
// The board's third figure, Skill, is not here and cannot be: nothing records
// what a technician is trained for (docs/open-points.md, item 59). `skill` is
// answered as null rather than left out, so the contract itself says the gap is
// ours and not the technician's.

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { isActiveCity } from "../domain/cities.ts";
import { VISIT_TYPES } from "../config/visit-types.ts";
import type { AuditAction, AuditEntry } from "../domain/audit.ts";
import {
  addTechnician,
  changeTechnician,
  deactivateTechnician,
  reactivateTechnician,
  rosterTechnician,
} from "../domain/technician-roster.ts";
import { staffOf } from "../http/audit.ts";
import type { App, AppEnv } from "../http/context.ts";
import { technicianWork, type TechnicianWork } from "../domain/technician-work.ts";
import { opsInputs } from "../http/ops-inputs.ts";
import { INDIAN_MOBILE_PATTERN, toE164 } from "../lib/mobile.ts";
import { runsOver } from "../policy/technician-work.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { json } from "../http/openapi.ts";
import { addDays, indiaDate } from "../lib/india-time.ts";

const TechnicianWorkSchema = z
  .object({
    technician_id: z.uuid(),
    jobs: z.number().int().openapi({ description: "Visits completed in the period." }),
    timed_jobs: z.number().int().openapi({
      description: "Of those, the ones the phone timed from Start to the outcome: what the averages are the mean of.",
    }),
    average_minutes: z
      .union([z.number().int(), z.null()])
      .openapi({ description: "How long those took; null when the phone timed none of them." }),
    average_planned_minutes: z
      .union([z.number().int(), z.null()])
      .openapi({ description: "What the same jobs were planned to take, so the two can be read against each other." }),
    runs_over: z.boolean().openapi({
      description:
        "Whether the average runs as far over the planned length as ops set (technician_work.over_by, 15 minutes to " +
        "begin with); false when the phone timed none of the jobs.",
    }),
    skill: z.null().openapi({
      description:
        'The board\'s "First fit" or "Service". Nothing records what a technician is trained for, so this is always null (docs/open-points.md, item 59).',
    }),
  })
  .strict()
  .openapi("TechnicianWork");

const WorkSchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date().openapi({ description: "Exclusive: the day after the last one counted." }),
    technicians: z
      .array(TechnicianWorkSchema)
      .openapi({ description: "Every active technician, by name, including those who finished nothing." }),
  })
  .strict()
  .openapi("TechniciansWork", { description: "Counted at read time from the appointments themselves." });

const workRoute = createRoute({
  method: "get",
  path: "/api/technicians/work",
  summary: "Per technician: jobs finished over a period, and how they ran against the planned length",
  request: {
    query: z.object({
      from: z.iso
        .date()
        .optional()
        .openapi({
          description:
            "India's calendar date the count starts on; as many days back as ops set (technician_work.period, 90 to " +
            "begin with) when it is left out.",
        }),
      to: z.iso.date().optional().openapi({ description: "Exclusive; tomorrow when it is left out." }),
    }),
  },
  responses: {
    200: { description: "The technicians", ...json(WorkSchema) },
    400: errorResponse("invalid_request: from is not before to"),
    403: errorResponse("access_required"),
  },
});

const NameSchema = z.string().trim().min(1).max(80).openapi({ description: "His whole name, as clients see it." });
const MobileSchema = z
  .string()
  .regex(INDIAN_MOBILE_PATTERN)
  .openapi({ description: "The Indian mobile he signs in with; his sign-in code goes to it on WhatsApp." });
const ZoneSchema = z
  .union([z.string().trim().min(1).max(60), z.null()])
  .openapi({ description: "Where he mostly works, in ops' words; null for none." });
const CitySchema = z.union([z.string().min(1).max(60), z.null()]).openapi({
  description:
    "The city he works in, one of GET /api/technicians' cities. Staff with a grant of that city or its zone see him; " +
    "with none, only a national grant does.",
});

const NewTechnicianSchema = z
  .object({ name: NameSchema, mobile: MobileSchema, zone: ZoneSchema.optional(), city: CitySchema.optional() })
  .strict()
  .openapi("NewTechnician");

const TechnicianChangeSchema = z
  .object({
    name: NameSchema.optional(),
    mobile: MobileSchema.optional(),
    zone: ZoneSchema.optional(),
    city: CitySchema.optional(),
  })
  .strict()
  .refine((change) => Object.keys(change).length > 0, { message: "nothing to change" })
  .openapi("TechnicianChange", { description: "Only what is sent changes." });

const TechnicianIdSchema = z.object({ id: z.uuid() }).strict().openapi("TechnicianId");

const ReturnedVisitsSchema = z
  .object({
    visits: z
      .array(
        z
          .object({
            appointment_id: z.uuid(),
            starts_at: z.iso.datetime(),
            type: z.union([z.enum(VISIT_TYPES), z.null()]),
            client: z.union([z.string(), z.null()]),
          })
          .strict(),
      )
      .openapi({
        description:
          "His visits still to come, now unassigned: each waits in the dispatch board's tray for ops to give it to " +
          "another. A visit already begun stays his. Empty when he was switched off already.",
      }),
  })
  .strict()
  .openapi("TechnicianDeactivated");

const technicianPath = { params: z.object({ id: z.uuid() }) };

const MANAGE_ONLY = "access_required, or not_permitted: changing a technician asks Operations MANAGE";

const addRoute = createRoute({
  method: "post",
  path: "/api/technicians",
  summary: "Add a technician. His number signs in to the technician app at once",
  request: { body: { required: true, ...json(NewTechnicianSchema) } },
  responses: {
    201: { description: "Added", ...json(TechnicianIdSchema) },
    400: errorResponse("invalid_request: no name, not an Indian mobile, or not one of our cities"),
    403: errorResponse(MANAGE_ONLY),
    409: errorResponse("number_in_use: another active technician signs in with that number"),
  },
});

const changeRoute = createRoute({
  method: "patch",
  path: "/api/technicians/{id}",
  summary: "Change a technician's name, number, zone or city",
  request: { ...technicianPath, body: { required: true, ...json(TechnicianChangeSchema) } },
  responses: {
    200: { description: "Changed", ...json(TechnicianIdSchema) },
    400: errorResponse("invalid_request: nothing to change, no name, not an Indian mobile, or not one of our cities"),
    403: errorResponse(MANAGE_ONLY),
    404: errorResponse("not_found: no such technician"),
    409: errorResponse("number_in_use: another active technician signs in with that number"),
  },
});

const deactivateRoute = createRoute({
  method: "post",
  path: "/api/technicians/{id}/deactivate",
  summary: "Switch a technician off: he is signed out at once, and his visits still to come are unassigned",
  request: technicianPath,
  responses: {
    200: { description: "Switched off", ...json(ReturnedVisitsSchema) },
    403: errorResponse(MANAGE_ONLY),
    404: errorResponse("not_found: no such technician"),
  },
});

const reactivateRoute = createRoute({
  method: "post",
  path: "/api/technicians/{id}/reactivate",
  summary: "Switch a technician back on, so he can sign in again",
  request: technicianPath,
  responses: {
    200: { description: "Switched on", ...json(z.object({ active: z.literal(true) }).strict()) },
    403: errorResponse(MANAGE_ONLY),
    404: errorResponse("not_found: no such technician"),
    409: errorResponse("number_in_use: another active technician signs in with his number now"),
  },
});

/** The audit entry for a change to one technician, by the member of staff behind the call. */
function auditOf(c: Context<AppEnv>, action: AuditAction, id: string, detail?: AuditEntry["detail"]): AuditEntry {
  return {
    surface: "ops",
    actor: staffOf(c),
    action,
    subject: { kind: "technician", id },
    requestId: c.var.requestId,
    ...(detail === undefined ? {} : { detail }),
  };
}


/** The fields a change names, in a fixed order, for its audit entry: never their values. */
const CHANGEABLE = ["name", "mobile", "zone", "city"] as const;

/** Whether a city sent is one of ours; none sent, or null, is. */
async function cityIsOurs(c: Context<AppEnv>, city: string | null | undefined): Promise<boolean> {
  if (city === undefined || city === null) return true;
  return isActiveCity(c.env.DB, city);
}

export function registerOpsTechnicians(app: App): void {
  app.openapi(addRoute, async (c) => {
    const { name, mobile, zone, city } = c.req.valid("json");
    const mobileE164 = toE164(mobile);
    if (mobileE164 === null) return c.json(errorBody("invalid_request", c.var.requestId, ["mobile"]), 400);
    if (!(await cityIsOurs(c, city))) return c.json(errorBody("invalid_request", c.var.requestId, ["city"]), 400);

    const id = crypto.randomUUID();
    const added = await addTechnician(
      c.env.DB,
      { id, name, mobileE164, zone: zone ?? null, city: city ?? null },
      auditOf(c, "technician.add", id),
      c.var.deps.now(),
    );
    if (added === "number_in_use") return c.json(errorBody("number_in_use", c.var.requestId), 409);
    return c.json({ id }, 201);
  });

  app.openapi(changeRoute, async (c) => {
    const { id } = c.req.valid("param");
    const change = c.req.valid("json");
    const mobileE164 = change.mobile === undefined ? undefined : toE164(change.mobile);
    if (mobileE164 === null) return c.json(errorBody("invalid_request", c.var.requestId, ["mobile"]), 400);
    if (!(await cityIsOurs(c, change.city))) {
      return c.json(errorBody("invalid_request", c.var.requestId, ["city"]), 400);
    }

    const technician = await rosterTechnician(c.env.DB, id);
    if (technician === null) return c.json(errorBody("not_found", c.var.requestId), 404);
    const fields = CHANGEABLE.filter((field) => change[field] !== undefined).join(",");
    const changed = await changeTechnician(
      c.env.DB,
      technician,
      { name: change.name, mobileE164, zone: change.zone, city: change.city },
      auditOf(c, "technician.change", id, { fields }),
      c.var.deps.now(),
    );
    if (changed === "number_in_use") return c.json(errorBody("number_in_use", c.var.requestId), 409);
    return c.json({ id }, 200);
  });

  app.openapi(deactivateRoute, async (c) => {
    const { id } = c.req.valid("param");
    const technician = await rosterTechnician(c.env.DB, id);
    if (technician === null) return c.json(errorBody("not_found", c.var.requestId), 404);
    if (!technician.active) return c.json({ visits: [] }, 200);

    const visits = await deactivateTechnician(c.env.DB, id, auditOf(c, "technician.deactivate", id), c.var.deps.now());
    c.var.log.info("technician_deactivated", { technician_id: id, visits_unassigned: visits.length });
    return c.json({ visits }, 200);
  });

  app.openapi(reactivateRoute, async (c) => {
    const { id } = c.req.valid("param");
    const technician = await rosterTechnician(c.env.DB, id);
    if (technician === null) return c.json(errorBody("not_found", c.var.requestId), 404);
    if (technician.active) return c.json({ active: true as const }, 200);

    const reactivated = await reactivateTechnician(
      c.env.DB,
      technician,
      auditOf(c, "technician.reactivate", id),
      c.var.deps.now(),
    );
    if (reactivated === "number_in_use") return c.json(errorBody("number_in_use", c.var.requestId), 409);
    return c.json({ active: true as const }, 200);
  });

  app.openapi(workRoute, async (c) => {
    const asked = c.req.valid("query");
    const today = indiaDate(c.var.deps.now());
    // Today is counted, so the period ends tomorrow; the board's figures include a job finished this morning.
    const figures = (await opsInputs(c)).technicianWork;
    const to = asked.to ?? addDays(today, 1);
    const from = asked.from ?? addDays(to, -figures.period);
    if (from >= to) return c.json(errorBody("invalid_request", c.var.requestId, ["from"]), 400);

    const work = await technicianWork(c.env.DB, { from, to });
    const runningOver = (each: TechnicianWork) =>
      each.average_minutes !== null &&
      each.average_planned_minutes !== null &&
      runsOver({ average: each.average_minutes, planned: each.average_planned_minutes }, figures.over_by);
    const technicians = work.map((each) => ({ ...each, runs_over: runningOver(each), skill: null }));
    return c.json({ from, to, technicians }, 200);
  });
}
