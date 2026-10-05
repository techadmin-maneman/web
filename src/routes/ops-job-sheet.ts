// The job sheet the technician app reads, set by ops behind Access
// (docs/decisions/0087-consumables-and-stock.md; docs/open-points.md, item 28):
//   GET  /api/job-sheet                              each kind of visit's checklist, and the partial reasons
//   POST /api/job-sheet/checklists/:visit_type       one kind's checklist, the whole list in its order
//   POST /api/job-sheet/partial-reasons              the partial reasons, the whole list in their order
//
// A list nobody has saved is the committed one (src/config/job-sheet.ts). A
// phone keeps the list it was given with the job, and an item ops take off is
// retired, so what a phone queued before the change is still understood. Each
// save records the Access identity behind it in the same batch (ADR 0031).

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { JOB_SHEET_BOUNDS } from "../config/job-sheet.ts";
import { VISIT_TYPES } from "../config/visit-types.ts";
import { jobSheet, saveList, type JobSheet, type JobSheetList, type ListName } from "../domain/job-sheet-settings.ts";
import { actorOf } from "../http/audit.ts";
import type { App, AppEnv } from "../http/context.ts";
import { errorResponse, refuse } from "../http/errors.ts";
import { json } from "../http/openapi.ts";

const ItemSchema = z.object({ code: z.string(), label: z.string() }).strict();

/** What every list carries, a checklist and the reasons alike. */
const LIST = {
  items: z.array(ItemSchema).openapi({ description: "What the technician is offered, in order." }),
  retired: z.array(ItemSchema).openapi({
    description: "Taken off by ops, and still understood: a phone may have queued one before it knew.",
  }),
  set_by: z.union([z.string(), z.null()]).openapi({ description: "Null while the committed list stands." }),
  set_at: z.union([z.iso.datetime(), z.null()]),
};

const JobSheetSchema = z
  .object({
    checklists: z.array(
      z
        .object({ visit_type: z.enum(VISIT_TYPES), ...LIST })
        .strict()
        .openapi("JobSheetChecklist"),
    ),
    partial_reasons: z.object(LIST).strict().openapi("JobSheetList"),
    max_checklist_items: z.number().int(),
    max_partial_reasons: z.number().int(),
    max_label: z.number().int(),
  })
  .strict()
  .openapi("JobSheet");

/** A label a technician reads, one to a row: no line breaks or other control characters. */
const Label = z
  .string()
  .trim()
  .min(1)
  .max(JOB_SHEET_BOUNDS.maxLabel)
  .regex(/^[^\p{Cc}]+$/u);

const ListChangeSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            code: z.string().min(1).max(64).optional().openapi({
              description: "An item already on the list, or retired from it, keeps its code; a new one sends none.",
            }),
            label: Label,
          })
          .strict(),
      )
      .min(1)
      .max(Math.max(JOB_SHEET_BOUNDS.maxChecklistItems, JOB_SHEET_BOUNDS.maxPartialReasons)),
  })
  .strict()
  .openapi("JobSheetListChange", { description: "The whole list, in its order. An item left out is retired." });

const SHEET = { description: "The job sheet as it now stands", ...json(JobSheetSchema) };
const REFUSED = errorResponse(
  "invalid_request: fields names items for a list empty or too long, or items.N.label or items.N.code for one " +
    "that is empty, too long, twice on the list, or a code the list never held",
);

const sheetRoute = createRoute({
  method: "get",
  path: "/api/job-sheet",
  summary: "Each kind of visit's checklist and the partial reasons, as the technician app reads them",
  responses: { 200: SHEET, 403: errorResponse("access_required") },
});

const checklistRoute = createRoute({
  method: "post",
  path: "/api/job-sheet/checklists/{visit_type}",
  summary: "One kind of visit's checklist, the whole list in its order",
  request: {
    params: z.object({ visit_type: z.enum(VISIT_TYPES) }),
    body: { required: true, ...json(ListChangeSchema) },
  },
  responses: { 200: SHEET, 400: REFUSED, 403: errorResponse("access_required") },
});

const reasonsRoute = createRoute({
  method: "post",
  path: "/api/job-sheet/partial-reasons",
  summary: "The reasons a job may be left partly done, the whole list in its order",
  request: { body: { required: true, ...json(ListChangeSchema) } },
  responses: { 200: SHEET, 400: REFUSED, 403: errorResponse("access_required") },
});

const listBody = (list: JobSheetList) => ({
  items: list.items.map((item) => ({ code: item.id, label: item.label })),
  retired: list.retired.map((item) => ({ code: item.id, label: item.label })),
  set_by: list.setBy,
  set_at: list.setAt,
});

const sheetBody = (sheet: JobSheet) => ({
  checklists: VISIT_TYPES.map((type) => ({ visit_type: type, ...listBody(sheet.checklists[type]) })),
  partial_reasons: listBody(sheet.partialReasons),
  max_checklist_items: JOB_SHEET_BOUNDS.maxChecklistItems,
  max_partial_reasons: JOB_SHEET_BOUNDS.maxPartialReasons,
  max_label: JOB_SHEET_BOUNDS.maxLabel,
});

/** Saves one list and answers the whole sheet, or the fields refused. */
async function save(c: Context<AppEnv>, which: ListName, items: z.infer<typeof ListChangeSchema>["items"]) {
  const saved = await saveList(c.env.DB, {
    which,
    items,
    actor: actorOf(c),
    requestId: c.var.requestId,
    now: c.var.deps.now(),
  });
  if (!saved.ok) return refuse(c, "invalid_request", saved.fields);
  return c.json(sheetBody(await jobSheet(c.env.DB)), 200);
}

export function registerOpsJobSheet(app: App): void {
  app.openapi(sheetRoute, async (c) => c.json(sheetBody(await jobSheet(c.env.DB)), 200));

  app.openapi(checklistRoute, (c) =>
    save(c, { list: "checklist", visitType: c.req.valid("param").visit_type }, c.req.valid("json").items),
  );

  app.openapi(reasonsRoute, (c) => save(c, { list: "partial_reason" }, c.req.valid("json").items));
}
