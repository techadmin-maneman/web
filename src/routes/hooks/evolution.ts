// POST /api/hooks/evolution/:token: what Evolution reports on the number we send
// from (docs/decisions/0041-outbound-messages-for-phase-2.md). MESSAGES_UPDATE
// carries the delivery receipts for the messages we sent, which fill in
// outbound_messages.delivered_at and read_at for the no-show evidence.
// MESSAGES_UPSERT carries every message on the number; a STOP reply among them
// withdraws its sender's WhatsApp consents (src/domain/stop-messages.ts).
//
// Evolution is set to send those two events only (runbook, step 12); any other
// event is ignored. The body names the chat and carries the instance's API key,
// so our logger never writes it, nor the token: its request line records the route's
// pattern, not its path, and Cloudflare's own line, which would, is off
// (observability.logs.invocation_logs, wrangler.jsonc).

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { App, AppEnv } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { queueMessage } from "../../http/queue-message.ts";
import { secretsMatch } from "../../lib/hash.ts";
import { stopByReply } from "../../domain/stop-messages.ts";
import { isStopReply } from "../../policy/consents.ts";

/** Receipts that say something new. SERVER_ACK (reached WhatsApp's servers) and PENDING do not. */
const DELIVERED = new Set(["DELIVERY_ACK", "READ", "PLAYED"]);
const READ = new Set(["READ", "PLAYED"]);

/** A request carrying more than this many receipts or messages has the rest ignored, inside the free plan's limits. */
const MAX_ITEMS = 50;

// Loose on purpose: whatever else Evolution sends is ignored, not refused, so Evolution does not retry it.
const EventSchema = z.object({ event: z.string() });
const ReceiptSchema = z.object({
  keyId: z.string().optional(),
  key: z.object({ id: z.string().optional() }).optional(), // how older Evolution versions name the message
  fromMe: z.boolean().optional(),
  status: z.string().catch(""),
});
const ReceiptsSchema = z.object({ data: z.union([ReceiptSchema, z.array(ReceiptSchema)]).optional() });
const MessageSchema = z.object({
  key: z
    .object({
      remoteJid: z.string().optional(),
      // The sender's number, where remoteJid is WhatsApp's private "@lid" address for them.
      remoteJidAlt: z.string().optional(),
      senderPn: z.string().optional(),
      fromMe: z.boolean().optional(),
    })
    .optional(),
  message: z
    .object({
      conversation: z.string().optional(),
      extendedTextMessage: z.object({ text: z.string().optional() }).optional(),
    })
    .nullish(),
});
const MessagesSchema = z.object({ data: z.union([MessageSchema, z.array(MessageSchema)]).optional() });
type Message = z.infer<typeof MessageSchema>;

export const evolutionHookRoute = createRoute({
  method: "post",
  path: "/api/hooks/evolution/{token}",
  summary:
    "Evolution's delivery receipts (messages.update) for the WhatsApp messages we sent, and the messages on our " +
    "number (messages.upsert), where a STOP reply stops our messages",
  request: { params: z.object({ token: z.string() }) },
  responses: {
    204: { description: "Taken, or ignored. Either way Evolution need not send it again" },
    401: errorResponse("unauthorized: the token is wrong"),
    404: errorResponse("not_found: receipts are not switched on (no EVOLUTION_WEBHOOK_TOKEN)"),
  },
});

export function registerEvolutionHook(app: App): void {
  app.openapi(evolutionHookRoute, async (c) => {
    const { log } = c.var;
    const expected = c.var.config.settings.messaging.evolution?.webhookToken ?? null;
    if (expected === null) return refuse(c, "not_found");
    if (!(await secretsMatch(c.req.valid("param").token, expected))) {
      log.warn("evolution_hook_unauthorized");
      return refuse(c, "unauthorized");
    }

    const body = await c.req.json<unknown>().catch(() => null);
    const named = EventSchema.safeParse(body);
    if (!named.success) {
      log.warn("evolution_hook_unreadable");
      return c.body(null, 204);
    }
    const event = named.data.event.toLowerCase().replace(/_/g, ".");
    if (event === "messages.update") await takeReceipts(c, body);
    else if (event === "messages.upsert") await takeReplies(c, body);
    else log.info("evolution_hook_ignored", { event: event.slice(0, 40) });
    return c.body(null, 204);
  });
}

async function takeReceipts(c: Context<AppEnv>, body: unknown): Promise<void> {
  const parsed = ReceiptsSchema.safeParse(body);
  if (!parsed.success) {
    c.var.log.warn("evolution_hook_unreadable");
    return;
  }
  const receipts = [parsed.data.data ?? []].flat().slice(0, MAX_ITEMS);
  const now = c.var.deps.now().toISOString();
  let recorded = 0;
  for (const receipt of receipts) {
    const providerMessageId = receipt.keyId ?? receipt.key?.id;
    if (providerMessageId === undefined || receipt.fromMe === false || !DELIVERED.has(receipt.status)) continue;
    recorded += await recordReceipt(c.env.DB, providerMessageId, READ.has(receipt.status), now);
  }
  c.var.log.info("evolution_receipts", { receipts: receipts.length, recorded });
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

/** Reads the messages people sent us, and acts on each STOP: its sender's consents withdrawn, and one answer. */
async function takeReplies(c: Context<AppEnv>, body: unknown): Promise<void> {
  const { deps, log, requestId } = c.var;
  const parsed = MessagesSchema.safeParse(body);
  if (!parsed.success) {
    log.warn("evolution_hook_unreadable");
    return;
  }
  const messages = [parsed.data.data ?? []].flat().slice(0, MAX_ITEMS);
  let stopped = 0;
  for (const message of messages) {
    const mobileE164 = stopReplyFrom(message);
    if (mobileE164 === null) continue;
    const answerId = await stopByReply(c.env.DB, { mobileE164, requestId, now: deps.now() });
    if (answerId === null) continue;
    stopped += 1;
    await queueMessage(c, answerId);
  }
  log.info("evolution_replies", { messages: messages.length, stopped });
}

/** The number a STOP reply came from, as E.164; null for anything else, ours, or from a group. */
function stopReplyFrom(message: Message): string | null {
  if (message.key?.fromMe !== false) return null;
  const text = message.message?.conversation ?? message.message?.extendedTextMessage?.text;
  if (text === undefined || !isStopReply(text)) return null;
  return senderNumber(message.key);
}

const PERSONAL_CHAT = "@s.whatsapp.net";

/** "919810000001@s.whatsapp.net" → "+919810000001", from whichever of the key's addresses gives the number. */
function senderNumber(key: NonNullable<Message["key"]>): string | null {
  if (key.remoteJid?.endsWith("@g.us") === true) return null;
  const chat = [key.remoteJid, key.remoteJidAlt, key.senderPn].find((jid) => jid?.endsWith(PERSONAL_CHAT) === true);
  const digits = chat?.slice(0, -PERSONAL_CHAT.length).split(":")[0] ?? "";
  return /^\d{8,15}$/.test(digits) ? `+${digits}` : null;
}
