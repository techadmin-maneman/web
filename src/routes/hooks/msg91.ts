// POST /api/hooks/msg91/:token: what MSG91's WhatsApp webhook reports on the number we send from
// (docs/decisions/0114-whatsapp-business-platform-through-msg91.md, 0197-one-inbound-port.md), read as its webhook
// documents it ("How to receive WhatsApp delivery reports via webhook (new)", msg91.com/help): an outbound report
// (`direction` "1") whose `eventName` is delivered or read is a receipt for the message its `requestId` names, as our
// send answered; an inbound message (`direction` "0") from `customerNumber` carries its words in `text`, or in the
// stringified JSON of `content`, `button` (a quick reply, STOP among them) or `messages`. Both go to the inbound port
// every provider feeds (src/domain/messages/inbound.ts).
//
// MSG91 posts one event a request, or a list. The token in the path is our secret, MSG91_WEBHOOK_TOKEN; the body
// names the chat, so the logger never writes it.

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { inboundContext } from "../../http/inbound-context.ts";
import { secretsMatch } from "../../lib/hash.ts";
import { takeInbound, type Inbound } from "../../domain/messages/inbound.ts";

// Loose on purpose: whatever else MSG91 sends is ignored, not refused, so MSG91 does not retry it.
const EventSchema = z.looseObject({
  direction: z.union([z.string(), z.number()]).optional(),
  eventName: z.string().optional(),
  customerNumber: z.string().optional(),
  requestId: z.string().optional(),
  uuid: z.string().optional(),
  text: z.string().nullish(),
  content: z.string().nullish(),
  button: z.string().nullish(),
  messages: z.string().nullish(),
});
type Msg91Event = z.infer<typeof EventSchema>;
const BodySchema = z.union([EventSchema, z.array(EventSchema)]);

const Words = z.looseObject({ text: z.string().optional(), payload: z.string().optional() });
const Sent = z.array(
  z.looseObject({
    id: z.string().optional(),
    text: z.looseObject({ body: z.string().optional() }).optional(),
    button: Words.optional(),
  }),
);

/** A field MSG91 sends as JSON in a string, parsed; undefined when it is not there or not JSON. */
function parsedJson(text: string | null | undefined): unknown {
  if (text === null || text === undefined || text === "") return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** What the person wrote, or the quick reply they pressed: its payload, so a STOP button stops. */
function wordsOf(event: Msg91Event): string | undefined {
  if (typeof event.text === "string" && event.text !== "") return event.text;
  const content = Words.safeParse(parsedJson(event.content)).data;
  const button = Words.safeParse(parsedJson(event.button)).data;
  const [first] = Sent.safeParse(parsedJson(event.messages)).data ?? [];
  return content?.text ?? button?.payload ?? button?.text ?? first?.text?.body ?? first?.button?.payload;
}

/** "919810000001" or "+91 98100 00001" as E.164; null for anything that is not a number. */
function numberOf(customerNumber: string | undefined): string | null {
  const digits = customerNumber?.replace(/\D/g, "") ?? "";
  return /^\d{8,15}$/.test(digits) ? `+${digits}` : null;
}

/** One event of MSG91's, for the inbound port: a receipt, a message, or nothing we use. */
function inboundOf(event: Msg91Event): Inbound[] {
  const direction = String(event.direction ?? "");
  const status = event.eventName?.toLowerCase() ?? "";
  if (direction === "1") {
    const providerMessageId = event.requestId ?? event.uuid;
    if (providerMessageId === undefined || (status !== "delivered" && status !== "read")) return [];
    return [{ kind: "receipt", providerMessageId, read: status === "read" }];
  }
  if (direction !== "0") return [];
  const text = wordsOf(event);
  const mobileE164 = numberOf(event.customerNumber);
  if (text === undefined || mobileE164 === null) return [];
  const [first] = Sent.safeParse(parsedJson(event.messages)).data ?? [];
  return [{ kind: "message", mobileE164, text, providerMessageId: event.uuid ?? first?.id ?? null }];
}

const msg91HookRoute = createRoute({
  method: "post",
  path: "/api/hooks/msg91/{token}",
  summary:
    "MSG91's WhatsApp webhook: delivery reports for the messages we sent, and the messages on our number, where a " +
    "STOP stops our messages",
  request: { params: z.object({ token: z.string() }) },
  responses: {
    204: { description: "Taken, or ignored. Either way MSG91 need not send it again" },
    401: errorResponse("unauthorized: the token is wrong"),
    404: errorResponse("not_found: MSG91 is not the messaging provider, or its webhook has no MSG91_WEBHOOK_TOKEN"),
  },
});

export function registerMsg91Hook(app: App): void {
  app.openapi(msg91HookRoute, async (c) => {
    const { log } = c.var;
    const expected = c.var.config.settings.messaging.msg91?.webhookToken ?? null;
    if (expected === null) return refuse(c, "not_found");
    if (!(await secretsMatch(c.req.valid("param").token, expected))) {
      log.warn("msg91_hook_unauthorized");
      return refuse(c, "unauthorized");
    }
    const parsed = BodySchema.safeParse(await c.req.json<unknown>().catch(() => null));
    if (!parsed.success) {
      log.warn("msg91_hook_unreadable");
      return c.body(null, 204);
    }
    const events = [parsed.data].flat().flatMap(inboundOf);
    log.info("msg91_inbound", { ...(await takeInbound(inboundContext(c), events)) });
    return c.body(null, 204);
  });
}
