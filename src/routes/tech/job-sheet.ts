// Every kind of visit's checklist as ops set it in the console, for Guides (docs/decisions/0250-guides-and-alerts.md),
// which the phone keeps so they open with no signal. The technician's words alone, as the card carries them.

import { z } from "@hono/zod-openapi";
import { VISIT_TYPES, type VisitType } from "../../config/visit-types.ts";
import { jobSheet } from "../../domain/field/job-sheet-settings.ts";
import type { App } from "../../http/context.ts";
import { errorResponse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { techRoute } from "../../http/session-routes.ts";
import { JobSheetItemSchema } from "../schemas/job-sheet.ts";

const ChecklistsSchema = z
  .object({
    checklists: z
      .object(
        Object.fromEntries(VISIT_TYPES.map((type) => [type, z.array(JobSheetItemSchema)])) as Record<
          VisitType,
          z.ZodArray<typeof JobSheetItemSchema>
        >,
      )
      .strict()
      .openapi({ description: "Each kind of visit's checklist, in its order." }),
  })
  .strict()
  .openapi("TechnicianChecklists");

const checklistsRoute = techRoute({
  method: "get",
  path: "/api/tech/checklists",
  summary: "Every kind of visit's checklist as ops set it, for Guides",
  responses: {
    200: { description: "The checklists", ...json(ChecklistsSchema) },
    401: errorResponse("session_required; device_revoked; technician_inactive: ops switched the technician off"),
  },
});

export function registerTechChecklists(app: App): void {
  app.openapi(checklistsRoute, async (c) => {
    const sheet = await jobSheet(c.env.DB);
    const checklists = Object.fromEntries(
      VISIT_TYPES.map((type) => [type, sheet.checklists[type].items.map(({ id, label }) => ({ id, label }))]),
    ) as Record<VisitType, { id: string; label: string }[]>;
    return c.json({ checklists }, 200);
  });
}
