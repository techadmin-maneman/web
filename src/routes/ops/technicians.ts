// The technicians themselves, behind Access.
//
// Each keeps to the caller's cities: a technician elsewhere, or with no city
// when the caller's grants name cities, is not found, and is given only a city
// the caller's grants reach.
//
// The roster itself, and the phones each technician works from, are on
// GET /api/technicians (src/routes/ops/field.ts). The work route answers the two
// figures the board draws beside it, over a period the roster has no business
// carrying.

import { opsRoute } from "../../http/session-routes.ts";
import { z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { isActiveCity } from "../../domain/cities/cities.ts";
import { VISIT_TYPES } from "../../config/visit-types.ts";
import type { AuditAction, AuditEntry } from "../../domain/platform/audit.ts";
import {
  addTechnician,
  changeTechnician,
  deactivateTechnician,
  deleteTechnician,
  nameTaken,
  reactivateTechnician,
  rosterTechnician,
  type RosterTechnician,
} from "../../domain/dispatch/technician-roster.ts";
import { actorOf } from "../../http/audit.ts";
import type { App, AppEnv } from "../../http/context.ts";
import { technicianWork, type TechnicianWork } from "../../domain/dispatch/technician-work.ts";
import { isWithin, techniciansWithin } from "../../domain/clients/places.ts";
import { permits, routeReach } from "../../http/staff-access.ts";
import { reachesCity } from "../../policy/access.ts";
import { GIVING_NO_CITY } from "../../policy/console-routes.ts";
import { opsInputs } from "../../http/ops-inputs.ts";
import { INDIAN_MOBILE_PATTERN, toE164 } from "../../lib/mobile.ts";
import { testRecordAtCreation } from "../../policy/staging-test-records.ts";
import { runsOver } from "../../policy/technician-work.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { addDays, indiaDate } from "../../lib/india-time.ts";
import { tellOfUncoveredCities } from "../../domain/clients/service-area.ts";

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
  })
  .strict()
  .openapi("TechnicianWork");

const WorkSchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date().openapi({ description: "Exclusive: the day after the last one counted." }),
    technicians: z.array(TechnicianWorkSchema).openapi({
      description: "Every active technician in the caller's cities, by name, including those who finished nothing.",
    }),
  })
  .strict()
  .openapi("TechniciansWork", { description: "Counted at read time from the appointments themselves." });

const workRoute = opsRoute({
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
  },
});

const NameSchema = z.string().trim().min(1).max(80).openapi({ description: "Their whole name, as clients see it." });
const MobileSchema = z
  .string()
  .regex(INDIAN_MOBILE_PATTERN)
  .openapi({ description: "The Indian mobile they sign in with; their sign-in code goes to it on WhatsApp." });
const ZoneSchema = z
  .union([z.string().trim().min(1).max(60), z.null()])
  .openapi({ description: "Where they mostly work, in ops' words; null for none." });
const CitySchema = z.union([z.string().min(1).max(60), z.null()]).openapi({
  description:
    "The city they work in, one of GET /api/technicians' cities, which are those the caller's grants reach. Staff with " +
    "a grant of that city or its zone see them; with none, only a national grant does.",
});

const FitsTrainedSchema = z
  .boolean()
  .optional()
  .openapi({ description: "Trained to fit: only such a technician is offered or given a first fit (ADR 0119)." });

const NewTechnicianSchema = z
  .object({
    name: NameSchema,
    mobile: MobileSchema,
    zone: ZoneSchema.optional(),
    city: CitySchema.optional(),
    fits_trained: FitsTrainedSchema,
  })
  .strict()
  .openapi("NewTechnician");

const TechnicianChangeSchema = z
  .object({
    name: NameSchema.optional(),
    mobile: MobileSchema.optional(),
    zone: ZoneSchema.optional(),
    city: CitySchema.optional(),
    fits_trained: FitsTrainedSchema,
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
          "Their visits still to come, now unassigned: each waits in the dispatch board's tray for ops to give it to " +
          "another. A visit already begun stays theirs. Empty when they were switched off already.",
      }),
  })
  .strict()
  .openapi("TechnicianDeactivated");

const technicianPath = { params: z.object({ id: z.uuid() }) };

const MANAGE_ONLY = "access_required, or not_permitted: changing a technician asks Operations MANAGE";

const addRoute = opsRoute({
  method: "post",
  path: "/api/technicians",
  summary: "Add a technician. Their number signs in to the technician app at once",
  request: { body: { required: true, ...json(NewTechnicianSchema) } },
  responses: {
    201: { description: "Added", ...json(TechnicianIdSchema) },
    400: errorResponse(
      "invalid_request: no name, not an Indian mobile, or not one of our cities, or one the caller's grants do not reach",
    ),
    403: errorResponse(MANAGE_ONLY),
    409: errorResponse(
      "number_in_use: another active technician signs in with that number; name_taken: another goes by that name",
    ),
  },
});

const changeRoute = opsRoute({
  method: "patch",
  path: "/api/technicians/{id}",
  summary: "Change a technician's name, number, zone or city",
  request: { ...technicianPath, body: { required: true, ...json(TechnicianChangeSchema) } },
  responses: {
    200: { description: "Changed", ...json(TechnicianIdSchema) },
    400: errorResponse(
      "invalid_request: nothing to change, no name, not an Indian mobile, or not one of our cities, or one the caller's grants do not reach",
    ),
    403: errorResponse(MANAGE_ONLY),
    404: errorResponse("not_found: no such technician in the caller's cities"),
    409: errorResponse(
      "number_in_use: another active technician signs in with that number; name_taken: another goes by that name",
    ),
  },
});

const deactivateRoute = opsRoute({
  method: "post",
  path: "/api/technicians/{id}/deactivate",
  summary: "Switch a technician off: they are signed out at once, and their visits still to come are unassigned",
  request: technicianPath,
  responses: {
    200: { description: "Switched off", ...json(ReturnedVisitsSchema) },
    403: errorResponse(MANAGE_ONLY),
    404: errorResponse("not_found: no such technician in the caller's cities"),
  },
});

const reactivateRoute = opsRoute({
  method: "post",
  path: "/api/technicians/{id}/reactivate",
  summary: "Switch a technician back on, so they can sign in again",
  request: technicianPath,
  responses: {
    200: { description: "Switched on", ...json(z.object({ active: z.literal(true) }).strict()) },
    403: errorResponse(MANAGE_ONLY),
    404: errorResponse("not_found: no such technician in the caller's cities"),
    409: errorResponse("number_in_use: another active technician signs in with their number now"),
  },
});

const deleteRoute = opsRoute({
  method: "post",
  path: "/api/technicians/{id}/delete",
  summary:
    "Delete a technician added by mistake, with their leave and phones, while nothing records any work of theirs",
  request: technicianPath,
  responses: {
    200: { description: "Deleted", ...json(z.object({ deleted: z.literal(true) }).strict()) },
    403: errorResponse(MANAGE_ONLY),
    404: errorResponse("not_found: no such technician in the caller's cities"),
    409: errorResponse("in_use: a visit, a job, stock or a hair profile names them; switch them off instead"),
  },
});

/** The audit entry for a change to one technician, by the member of staff behind the call. */
function auditOf(c: Context<AppEnv>, action: AuditAction, id: string, detail?: AuditEntry["detail"]): AuditEntry {
  return {
    surface: "ops",
    actor: actorOf(c),
    action,
    subject: { kind: "technician", id },
    requestId: c.var.requestId,
    ...(detail === undefined ? {} : { detail }),
  };
}

/** The technician the path names, if there is one in the caller's cities. */
async function technicianToChange(c: Context<AppEnv>, id: string): Promise<RosterTechnician | null> {
  const technician = await rosterTechnician(c.env.DB, id);
  if (technician === null || !reachesCity(await routeReach(c), technician.city)) return null;
  return technician;
}

/** The fields a change names, in a fixed order, for its audit entry: never their values. */
const CHANGEABLE = ["name", "mobile", "zone", "city", "fits_trained"] as const;

/**
 * Whether the caller may give a technician this city: one of ours that their grants reach, or none (GIVING_NO_CITY).
 * Undefined, a change that leaves their city alone, may always be sent.
 */
async function mayGiveCity(c: Context<AppEnv>, city: string | null | undefined): Promise<boolean> {
  if (city === undefined) return true;
  if (city === null) return permits(c, GIVING_NO_CITY);
  if (!reachesCity(await routeReach(c), city)) return false;
  return isActiveCity(c.env.DB, city);
}

/** Each technician's work over the period, for the technicians in the caller's cities. */
async function workInReach(c: Context<AppEnv>, period: { from: string; to: string }): Promise<TechnicianWork[]> {
  const [everyone, reached] = await Promise.all([
    technicianWork(c.env.DB, period),
    routeReach(c).then((reach) => techniciansWithin(c.env.DB, reach)),
  ]);
  return everyone.filter((each) => isWithin(reached, each.technician_id));
}

export function registerOpsTechnicians(app: App): void {
  registerTechnicianDelete(app);
  registerTechnicianAdd(app);
  app.openapi(changeRoute, async (c) => {
    const { id } = c.req.valid("param");
    const change = c.req.valid("json");
    const mobileE164 = change.mobile === undefined ? undefined : toE164(change.mobile);
    if (mobileE164 === null) return refuse(c, "invalid_request", ["mobile"]);
    if (!(await mayGiveCity(c, change.city))) {
      return refuse(c, "invalid_request", ["city"]);
    }

    const technician = await technicianToChange(c, id);
    if (technician === null) return refuse(c, "not_found");
    if (change.name !== undefined && (await nameTaken(c.env.DB, change.name, id))) return refuse(c, "name_taken");
    const fields = CHANGEABLE.filter((field) => change[field] !== undefined).join(",");
    const changed = await changeTechnician({
      db: c.env.DB,
      current: technician,
      change: { name: change.name, mobileE164, zone: change.zone, city: change.city, fitsTrained: change.fits_trained },
      audit: auditOf(c, "technician.change", id, { fields }),
      now: c.var.deps.now(),
    });
    if (changed === "number_in_use") return refuse(c, "number_in_use");
    return c.json({ id }, 200);
  });

  app.openapi(deactivateRoute, async (c) => {
    const { id } = c.req.valid("param");
    const technician = await technicianToChange(c, id);
    if (technician === null) return refuse(c, "not_found");
    if (!technician.active) return c.json({ visits: [] }, 200);

    const visits = await deactivateTechnician(c.env.DB, id, auditOf(c, "technician.deactivate", id), c.var.deps.now());
    c.var.log.info("technician_deactivated", { technician_id: id, visits_unassigned: visits.length });
    // The last in a city leaves it served with nobody to send: ops hear of it now, not the next morning.
    await tellOfUncoveredCities(c.env.DB, c.var.deps);
    return c.json({ visits }, 200);
  });

  app.openapi(reactivateRoute, async (c) => {
    const { id } = c.req.valid("param");
    const technician = await technicianToChange(c, id);
    if (technician === null) return refuse(c, "not_found");
    if (technician.active) return c.json({ active: true as const }, 200);

    const reactivated = await reactivateTechnician(
      c.env.DB,
      technician,
      auditOf(c, "technician.reactivate", id),
      c.var.deps.now(),
    );
    if (reactivated === "number_in_use") return refuse(c, "number_in_use");
    await tellOfUncoveredCities(c.env.DB, c.var.deps);
    return c.json({ active: true as const }, 200);
  });

  app.openapi(workRoute, async (c) => {
    const asked = c.req.valid("query");
    const today = indiaDate(c.var.deps.now());
    // Today is counted, so the period ends tomorrow; the board's figures include a job finished this morning.
    const figures = (await opsInputs(c)).technicianWork;
    const to = asked.to ?? addDays(today, 1);
    const from = asked.from ?? addDays(to, -figures.period);
    if (from >= to) return refuse(c, "invalid_request", ["from"]);

    const work = await workInReach(c, { from, to });
    const runningOver = (each: TechnicianWork) =>
      each.average_minutes !== null &&
      each.average_planned_minutes !== null &&
      runsOver({ average: each.average_minutes, planned: each.average_planned_minutes }, figures.over_by);
    const technicians = work.map((each) => ({ ...each, runs_over: runningOver(each) }));
    return c.json({ from, to, technicians }, 200);
  });
}

/** Adding a technician, apart from the changes above. */
function registerTechnicianAdd(app: App): void {
  app.openapi(addRoute, async (c) => {
    const { name, mobile, zone, city, fits_trained: fitsTrained } = c.req.valid("json");
    const mobileE164 = toE164(mobile);
    if (mobileE164 === null) return refuse(c, "invalid_request", ["mobile"]);
    if (!(await mayGiveCity(c, city ?? null))) {
      return refuse(c, "invalid_request", ["city"]);
    }

    if (await nameTaken(c.env.DB, name)) return refuse(c, "name_taken");

    const id = crypto.randomUUID();
    const marks = {
      fitsTrained: fitsTrained ?? false,
      testRecord: testRecordAtCreation(c.var.config.environment, name),
    };
    const technician = { id, name, mobileE164, zone: zone ?? null, city: city ?? null, ...marks };
    const added = await addTechnician(c.env.DB, technician, auditOf(c, "technician.add", id), c.var.deps.now());
    if (added === "number_in_use") return refuse(c, "number_in_use");
    return c.json({ id }, 201);
  });
}

/** Deleting a technician added by mistake, apart from the changes above. */
function registerTechnicianDelete(app: App): void {
  app.openapi(deleteRoute, async (c) => {
    const { id } = c.req.valid("param");
    const technician = await technicianToChange(c, id);
    if (technician === null) return refuse(c, "not_found");

    const deleted = await deleteTechnician(c.env.DB, id, auditOf(c, "technician.delete", id), c.var.deps.now());
    if (deleted === "has_work") return refuse(c, "in_use");
    return c.json({ deleted: true as const }, 200);
  });
}
