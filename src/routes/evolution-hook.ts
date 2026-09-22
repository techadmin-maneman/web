// POST /api/hooks/evolution/:token: Evolution's delivery receipts for the
// messages we sent (docs/decisions/0041-outbound-messages-for-phase-2.md).
// They fill in outbound_messages.delivered_at and read_at, which the no-show
// evidence reads in P2-M4.
//
// Evolution is set to send MESSAGES_UPDATE only (runbook, step 12); any other
// event is ignored. The body names the recipient's chat and carries the
// instance's API key, so it is never logged. Nor is the token: the request log
// records the route's pattern, not its path.

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../app.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { secretsMatch } from "../lib/hash.ts";

/** Receipts that say something new. SERVER_ACK (reached WhatsApp's servers) and PENDING do not. */
const DELIVERED = new Set(["DELIVERY_ACK", "READ", "PLAYED"]);
const READ = new Set(["READ", "PLAYED"]);

/** A request carrying more than this many receipts has the rest ignored, to stay inside the free plan's limits. */
const MAX_RECEIPTS = 50;

/** Loose on purpose: whatever else Evolution sends is ignored, not refused, so Evolution does not retry it. */
const ReceiptSchema = z.object({
  keyId: z.string().optional(),
  key: z.object({ id: z.string().optional() }).optional(), // how older Evolution versions name the message
  fromMe: z.boolean().optional(),
  status: z.unknown(),
});
const EvolutionEventSchema = z.object({
  event: z.string(),
  data: z.union([ReceiptSchema, z.array(ReceiptSchema)]).optional(),
});

export const evolutionHookRoute = createRoute({
  method: "post",
  path: "/api/hooks/evolution/{token}",
  summary: "Evolution's delivery receipts (messages.update) for the WhatsApp messages we sent",
  request: { params: z.object({ token: z.string() }) },
  responses: {
    204: { description: "Taken, or ignored. Either way Evolution need not send it again" },
    401: errorResponse("unauthorized: the token is wrong"),
    404: errorResponse("not_found: receipts are not switched on (no EVOLUTION_WEBHOOK_TOKEN)"),
  },
});

export function registerEvolutionHook(app: App): void {
  app.openapi(evolutionHookRoute, async (c) => {
    const { requestId, log } = c.var;
    const expected = c.var.config.settings.messaging.evolution?.webhookToken ?? null;
    if (expected === null) return c.json(errorBody("not_found", requestId), 404);
    if (!(await secretsMatch(c.req.valid("param").token, expected))) {
      log.warn("evolution_hook_unauthorized");
      return c.json(errorBody("unauthorized", requestId), 401);
    }

    const parsed = EvolutionEventSchema.safeParse(await c.req.json<unknown>().catch(() => null));
    if (!parsed.success) {
      log.warn("evolution_hook_unreadable");
      return c.body(null, 204);
    }
    const event = parsed.data.event.toLowerCase().replace(/_/g, ".");
    if (event !== "messages.update") {
      log.info("evolution_hook_ignored", { event: event.slice(0, 40) });
      return c.body(null, 204);
    }

    const receipts = [parsed.data.data ?? []].flat().slice(0, MAX_RECEIPTS);
    const now = c.var.deps.now().toISOString();
    let recorded = 0;
    for (const receipt of receipts) {
      const providerMessageId = receipt.keyId ?? receipt.key?.id;
      const status = typeof receipt.status === "string" ? receipt.status : "";
      if (providerMessageId === undefined || receipt.fromMe === false || !DELIVERED.has(status)) continue;
      recorded += await recordReceipt(c.env.DB, providerMessageId, READ.has(status), now);
    }
    log.info("evolution_receipts", { receipts: receipts.length, recorded });
    return c.body(null, 204);
  });
}

/** Marks our message delivered, and read if it was. The first report of each wins. */
async function recordReceipt(db: D1Database, providerMessageId: string, read: boolean, at: string): Promise<number> {
  const result = await db
    .prepare(
      `UPDATE outbound_messages
       SET delivered_at = COALESCE(delivered_at, ?2),
           read_at = CASE WHEN ?3 = 1 THEN COALESCE(read_at, ?2) ELSE read_at END
       WHERE provider_message_id = ?1 AND (delivered_at IS NULL OR (?3 = 1 AND read_at IS NULL))`,
    )
    .bind(providerMessageId, at, read ? 1 : 0)
    .run();
  return result.meta.changes;
}
