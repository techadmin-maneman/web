// Recalls, behind Access (docs/decisions/0187-recalls.md).
//
// Read with Operations VIEW; raised and closed with MANAGE. Each write answers the recall as GET /api/recalls/{id} does.

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import {
  closeRecall,
  raiseRecall,
  recallableLots,
  recallDetail,
  recalls,
  type Recall,
  type RecallDetail,
} from "../../domain/inventory/recalls.ts";
import { actorOf } from "../../http/audit.ts";
import type { App, AppEnv } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { indiaDate } from "../../lib/india-time.ts";
import { MAX_NOTE } from "../../config/consumables.ts";
import { queueMessage } from "../../http/queue-message.ts";

const RecallSchema = z.object({
  id: z.string(),
  number: z.number().int(),
  lot_id: z.string(),
  lot_code: z.string(),
  consumable_code: z.string(),
  name: z.string(),
  reason: z.string(),
  raised_at: z.string(),
  closed_at: z.string().nullable(),
});

const DETAIL = {
  description: "A recall, where its lot's stock is and who wears its pieces",
  ...json(
    RecallSchema.extend({
      held: z.array(z.object({ place_id: z.string(), place: z.string(), quantity: z.number().int() })),
      worn: z.array(
        z.object({
          piece_id: z.string().openapi({ description: "What a replacement booked free names as `covers`." }),
          piece_code: z.string(),
          person_id: z.string(),
          person: z.string(),
          due_on: z.string().nullable(),
        }),
      ),
    }).openapi("Recall"),
  ),
};
const ACCESS = errorResponse("access_required");
const recallPath = { params: z.object({ id: z.string().min(1).max(64) }) };
const MISSING = errorResponse("not_found: no such recall");

const listRoute = createRoute({
  method: "get",
  path: "/api/recalls",
  summary: "Every recall, and the lots one may be raised on",
  responses: {
    200: {
      description: "The recalls",
      ...json(
        z
          .object({
            recalls: z.array(RecallSchema),
            lots: z.array(
              z.object({ id: z.string(), lot_code: z.string(), consumable_code: z.string(), name: z.string() }),
            ),
          })
          .openapi("Recalls"),
      ),
    },
    403: ACCESS,
  },
});

const detailRoute = createRoute({
  method: "get",
  path: "/api/recalls/{id}",
  summary: "One recall: where its lot's stock is, and who wears its pieces",
  request: recallPath,
  responses: { 200: DETAIL, 403: ACCESS, 404: MISSING },
});

const raiseRoute = createRoute({
  method: "post",
  path: "/api/recalls",
  summary: "A lot recalled, with why: blocked everywhere, and each piece of it a client wears made due today",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({
            lot_id: z.string().min(1).max(64),
            reason: z
              .string()
              .trim()
              .min(1)
              .max(MAX_NOTE)
              .regex(/^[^\p{Cc}]+$/u),
          })
          .strict()
          .openapi("RecallRaise"),
      ),
    },
  },
  responses: {
    200: DETAIL,
    400: errorResponse("invalid_request: fields names lot_id for no such lot, or one recalled already"),
    403: ACCESS,
    404: MISSING,
  },
});

const closeRoute = createRoute({
  method: "post",
  path: "/api/recalls/{id}/close",
  summary: "A recall closed once its stock and pieces are dealt with; the lot stays blocked",
  request: recallPath,
  responses: { 200: DETAIL, 403: ACCESS, 404: errorResponse("not_found: no such recall open") },
});

const written = (c: Context<AppEnv>) => ({ actor: actorOf(c), requestId: c.var.requestId, now: c.var.deps.now() });

const recallJson = (recall: Recall) => ({
  id: recall.id,
  number: recall.number,
  lot_id: recall.lotId,
  lot_code: recall.lotCode,
  consumable_code: recall.code,
  name: recall.name,
  reason: recall.reason,
  raised_at: recall.raisedAt,
  closed_at: recall.closedAt,
});

const detailJson = (recall: RecallDetail) => ({
  ...recallJson(recall),
  held: recall.held.map((each) => ({ place_id: each.placeId, place: each.place, quantity: each.quantity })),
  worn: recall.worn.map((each) => ({
    piece_id: each.pieceId,
    piece_code: each.pieceCode,
    person_id: each.personId,
    person: each.person,
    due_on: each.dueOn,
  })),
});

async function detailAnswer(c: Context<AppEnv>, id: string) {
  const recall = await recallDetail(c.env.DB, id);
  if (recall === null) return refuse(c, "not_found");
  return c.json(detailJson(recall), 200);
}

export function registerOpsRecalls(app: App): void {
  app.openapi(listRoute, async (c) => {
    const [all, lots] = await Promise.all([recalls(c.env.DB), recallableLots(c.env.DB)]);
    return c.json(
      {
        recalls: all.map(recallJson),
        lots: lots.map((lot) => ({ id: lot.id, lot_code: lot.lotCode, consumable_code: lot.code, name: lot.name })),
      },
      200,
    );
  });

  app.openapi(detailRoute, async (c) => detailAnswer(c, c.req.valid("param").id));

  app.openapi(raiseRoute, async (c) => {
    const body = c.req.valid("json");
    const raised = await raiseRecall(
      c.env.DB,
      { lotId: body.lot_id, reason: body.reason, today: indiaDate(c.var.deps.now()) },
      written(c),
    );
    if (!raised.ok) return refuse(c, "invalid_request", raised.fields);
    for (const id of raised.messageIds) await queueMessage(c, id);
    return detailAnswer(c, raised.id);
  });

  app.openapi(closeRoute, async (c) => {
    const { id } = c.req.valid("param");
    if (!(await closeRecall(c.env.DB, id, written(c)))) return refuse(c, "not_found");
    return detailAnswer(c, id);
  });
}
