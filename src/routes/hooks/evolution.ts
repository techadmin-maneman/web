// POST /api/hooks/evolution: what Evolution reports on the number we send from
// (docs/decisions/0041-outbound-messages-for-phase-2.md), its token in the
// Authorization header, out of every URL a proxy logs; and the same at
// /api/hooks/evolution/:token, the token in the path, until the bridge sends the
// header (provisioning, step 12). MESSAGES_UPDATE
// carries the delivery receipts for the messages we sent, which fill in
// outbound_messages.delivered_at and read_at for the no-show evidence.
// MESSAGES_UPSERT carries every message on the number; a STOP reply among them
// withdraws its sender's WhatsApp consents. Both go to the inbound port every
// provider feeds (src/domain/messages/inbound.ts).
//
// Evolution is set to send those two events only (provisioning, step 12); any other
// event is ignored. The body names the chat and carries the instance's API key,
// so our logger never writes it, nor the token: its request line records the route's
// pattern, not its path, and Cloudflare's own line, which would, is off
// (observability.logs.invocation_logs, wrangler.jsonc).

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { App, AppEnv } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { inboundContext } from "../../http/inbound-context.ts";
import { secretsMatch } from "../../lib/hash.ts";
import { takeInbound, type Inbound } from "../../domain/messages/inbound.ts";

/** Receipts that say something new. SERVER_ACK (reached WhatsApp's servers) and PENDING do not. */
const DELIVERED = new Set(["DELIVERY_ACK", "READ", "PLAYED"]);
const READ = new Set(["READ", "PLAYED"]);

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
      id: z.string().optional(),
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

const SUMMARY =
  "Evolution's delivery receipts (messages.update) for the WhatsApp messages we sent, and the messages on our " +
  "number (messages.upsert), where a STOP reply stops our messages";

const RESPONSES = {
  204: { description: "Taken, or ignored. Either way Evolution need not send it again" },
  401: errorResponse("unauthorized: the token is wrong"),
  404: errorResponse("not_found: receipts are not switched on (no EVOLUTION_WEBHOOK_TOKEN)"),
};

const evolutionHookRoute = createRoute({
  method: "post",
  path: "/api/hooks/evolution",
  summary: `${SUMMARY}; the token as "Authorization: Bearer <token>"`,
  responses: RESPONSES,
});

const tokenInPathRoute = createRoute({
  method: "post",
  path: "/api/hooks/evolution/{token}",
  summary: `${SUMMARY}; the token in the path, until the bridge sends it as a header`,
  request: { params: z.object({ token: z.string() }) },
  responses: RESPONSES,
});

export function registerEvolutionHook(app: App): void {
  app.openapi(evolutionHookRoute, (c) => takeHook(c, c.req.header("Authorization")?.replace(/^Bearer\s+/i, "") ?? ""));
  app.openapi(tokenInPathRoute, (c) => takeHook(c, c.req.valid("param").token));
}

/** What Evolution reported, once its token is ours. */
async function takeHook(c: Context<AppEnv>, token: string): Promise<Response> {
  const { log } = c.var;
  const expected = c.var.config.settings.messaging.evolution?.webhookToken ?? null;
  if (expected === null) return refuse(c, "not_found");
  if (!(await secretsMatch(token, expected))) {
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
  if (event === "messages.update" || event === "messages.upsert") {
    const events = event === "messages.update" ? receiptsIn(c, body) : messagesIn(c, body);
    const taken = await takeInbound(inboundContext(c), events);
    log.info(event === "messages.update" ? "evolution_receipts" : "evolution_replies", taken);
  } else log.info("evolution_hook_ignored", { event: event.slice(0, 40) });
  return c.body(null, 204);
}

/** The receipts that say something new, for the inbound port. */
function receiptsIn(c: Context<AppEnv>, body: unknown): Inbound[] {
  const parsed = ReceiptsSchema.safeParse(body);
  if (!parsed.success) {
    c.var.log.warn("evolution_hook_unreadable");
    return [];
  }
  return [parsed.data.data ?? []].flat().flatMap((receipt): Inbound[] => {
    const providerMessageId = receipt.keyId ?? receipt.key?.id;
    if (providerMessageId === undefined || receipt.fromMe === false || !DELIVERED.has(receipt.status)) return [];
    return [{ kind: "receipt", providerMessageId, read: READ.has(receipt.status) }];
  });
}

/** The messages people sent our number, for the inbound port: never ours, nor a group's, nor one with no text. */
function messagesIn(c: Context<AppEnv>, body: unknown): Inbound[] {
  const parsed = MessagesSchema.safeParse(body);
  if (!parsed.success) {
    c.var.log.warn("evolution_hook_unreadable");
    return [];
  }
  return [parsed.data.data ?? []].flat().flatMap((message): Inbound[] => {
    if (message.key?.fromMe !== false) return [];
    const text = message.message?.conversation ?? message.message?.extendedTextMessage?.text;
    const mobileE164 = senderNumber(message.key);
    if (text === undefined || mobileE164 === null) return [];
    return [{ kind: "message", mobileE164, text, providerMessageId: message.key.id ?? null }];
  });
}

const PERSONAL_CHAT = "@s.whatsapp.net";

/** "919810000001@s.whatsapp.net" → "+919810000001", from whichever of the key's addresses gives the number. */
function senderNumber(key: NonNullable<Message["key"]>): string | null {
  if (key.remoteJid?.endsWith("@g.us") === true) return null;
  const chat = [key.remoteJid, key.remoteJidAlt, key.senderPn].find((jid) => jid?.endsWith(PERSONAL_CHAT) === true);
  const digits = chat?.slice(0, -PERSONAL_CHAT.length).split(":")[0] ?? "";
  return /^\d{8,15}$/.test(digits) ? `+${digits}` : null;
}
