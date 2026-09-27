// What each technician has done, behind Access (Ops Console, board D3;
// src/domain/technician-work.ts):
//   GET /api/technicians/work?from=&to=   jobs finished, and how long they took
//
// The roster itself, and the phones each technician works from, are on
// GET /api/technicians (src/routes/ops-field.ts). This route answers the two
// figures the board draws beside it, over a period the roster has no business
// carrying.
//
// The board's third figure, Skill, is not here and cannot be: nothing records
// what a technician is trained for (docs/open-points.md, item 59). `skill` is
// answered as null rather than left out, so the contract itself says the gap is
// ours and not the technician's.

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../http/context.ts";
import { technicianWork, WORK_PERIOD_DAYS } from "../domain/technician-work.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { addDays, indiaDate } from "../lib/india-time.ts";

const json = <T extends z.ZodType>(schema: T) => ({ content: { "application/json": { schema } } });

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
    skill: z.null().openapi({
      description:
        'The board\'s "First fit" or "Service". Nothing records what a technician is trained for and the FSM user carries no such field, so this is always null (docs/open-points.md, item 59).',
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
          description: `India's calendar date the count starts on; ${String(WORK_PERIOD_DAYS)} days back when it is left out.`,
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

export function registerOpsTechnicians(app: App): void {
  app.openapi(workRoute, async (c) => {
    const asked = c.req.valid("query");
    const today = indiaDate(c.var.deps.now());
    // Today is counted, so the period ends tomorrow; the board's figures include a job finished this morning.
    const to = asked.to ?? addDays(today, 1);
    const from = asked.from ?? addDays(to, -WORK_PERIOD_DAYS);
    if (from >= to) return c.json(errorBody("invalid_request", c.var.requestId, ["from"]), 400);

    const work = await technicianWork(c.env.DB, { from, to });
    return c.json({ from, to, technicians: work.map((each) => ({ ...each, skill: null })) }, 200);
  });
}
