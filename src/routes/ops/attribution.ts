// Attribution in the console (docs/decisions/0288-attribution-and-conversions.md), behind Access:
//
// - POST /api/leads/call: a lead taken on a call, its channel picked (Customer Care · Act).
// - GET /api/clients/{id}/attribution: how a client found us, and what they told ops (Customer Care · View).
// - POST /api/clients/{id}/heard-from: what they told ops, asked at the consultation (Customer Care · Act).
// - POST /api/clients/{id}/stop-sharing: nothing more of theirs to Google or Meta, as they asked (Customer Care · Manage).

import { opsRoute } from "../../http/session-routes.ts";
import { z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { clientAttribution, setHeardFrom, stopSharing } from "../../domain/attribution/attribution.ts";
import { leadFromCall } from "../../domain/attribution/call-lead.ts";
import { enqueue } from "../../domain/platform/enqueue.ts";
import { actorOf } from "../../http/audit.ts";
import type { App, AppEnv } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json, PersonNameSchema } from "../../http/openapi.ts";
import { clientInReach } from "../../http/staff-access.ts";
import { INDIAN_MOBILE_PATTERN, toE164 } from "../../lib/mobile.ts";
import { CHANNEL_CODES, DECLARED_CHANNELS } from "../../policy/channels.ts";
import { HEARD_FROM_CODES, HEARD_FROM_OTHER_MAX } from "../../policy/heard-from.ts";
import { testRecordAtCreation } from "../../policy/staging-test-records.ts";

const Id = z.object({ id: z.uuid() });
const NotFound = errorResponse("not_found: no such client within the caller's cities");

const callRoute = opsRoute({
  method: "post",
  path: "/api/leads/call",
  summary: "Take a lead on a call: a new number is a person and a phone lead, a known one a touch of theirs",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({
            name: PersonNameSchema,
            mobile: z.string().regex(INDIAN_MOBILE_PATTERN),
            channel: z
              .enum(DECLARED_CHANNELS)
              .openapi({ description: "Where the caller came from, as ops picked it." }),
          })
          .strict()
          .openapi("CallLead"),
      ),
    },
  },
  responses: {
    200: {
      description: "Taken",
      ...json(
        z
          .object({
            person_id: z.uuid(),
            known: z.boolean().openapi({ description: "The number is one of our people's; no lead was made." }),
          })
          .strict()
          .openapi("CallLeadTaken"),
      ),
    },
    400: errorResponse("invalid_request"),
  },
});

const TouchShownSchema = z
  .object({
    at: z.iso.datetime(),
    via: z.enum(["site", "whatsapp", "call"]),
    channel: z.enum(CHANNEL_CODES),
    utm_source: z.union([z.string(), z.null()]),
    utm_medium: z.union([z.string(), z.null()]),
    utm_campaign: z.union([z.string(), z.null()]),
    landing_path: z.union([z.string(), z.null()]),
    referrer: z.union([z.string(), z.null()]),
    link_name: z.union([z.string(), z.null()]).openapi({ description: "The campaign link it came through." }),
  })
  .strict()
  .openapi("TouchShown");

const readRoute = opsRoute({
  method: "get",
  path: "/api/clients/{id}/attribution",
  summary: "How a client found us: their channel by the rule, their first and last touch, and what they told ops",
  request: { params: Id },
  responses: {
    200: {
      description: "Their attribution; every field empty for a client we hold nothing of",
      ...json(
        z
          .object({
            attributed_channel: z.union([z.enum(CHANNEL_CODES), z.null()]),
            last_touch_channel: z.union([z.enum(CHANNEL_CODES), z.null()]),
            first_touch: z.union([TouchShownSchema, z.null()]),
            last_touch: z.union([TouchShownSchema, z.null()]),
            touches: z.number().int(),
            heard_from: z.union([z.enum(HEARD_FROM_CODES), z.null()]),
            heard_from_other: z.union([z.string(), z.null()]),
            heard_from_at: z.union([z.iso.datetime(), z.null()]),
            sharing_stopped_at: z.union([z.iso.datetime(), z.null()]),
          })
          .strict()
          .openapi("ClientAttribution"),
      ),
    },
    404: NotFound,
  },
});

const heardRoute = opsRoute({
  method: "post",
  path: "/api/clients/{id}/heard-from",
  summary: "What the client told ops of how they heard of us, kept apart from the channel the rule gives",
  request: {
    params: Id,
    body: {
      required: true,
      ...json(
        z
          .object({
            heard_from: z.enum(HEARD_FROM_CODES),
            heard_from_other: z.string().trim().min(1).max(HEARD_FROM_OTHER_MAX).optional(),
          })
          .strict()
          .openapi("HeardFrom"),
      ),
    },
  },
  responses: {
    204: { description: "Kept" },
    404: NotFound,
  },
});

const stopRoute = opsRoute({
  method: "post",
  path: "/api/clients/{id}/stop-sharing",
  summary: "Send nothing more of the client's to Google or Meta, as they asked; whatever was waiting is let go",
  request: { params: Id },
  responses: {
    204: { description: "Stopped" },
    404: NotFound,
  },
});

const changeOf = (c: Context<AppEnv>) => ({ actor: actorOf(c), requestId: c.var.requestId, now: c.var.deps.now() });

const EMPTY = {
  attributed_channel: null,
  last_touch_channel: null,
  first_touch: null,
  last_touch: null,
  touches: 0,
  heard_from: null,
  heard_from_other: null,
  heard_from_at: null,
  sharing_stopped_at: null,
};

export function registerOpsAttribution(app: App): void {
  app.openapi(callRoute, async (c) => {
    const body = c.req.valid("json");
    const mobileE164 = toE164(body.mobile);
    if (mobileE164 === null) return refuse(c, "invalid_request", ["mobile"]);
    const taken = await leadFromCall(c.env.DB, {
      ...changeOf(c),
      name: body.name,
      mobileE164,
      channel: body.channel,
      testRecord: testRecordAtCreation(c.var.config.environment, body.name),
    });
    if (taken.leadId !== null) {
      const toCrm = { lead_id: taken.leadId, request_id: c.var.requestId };
      await enqueue(c.env.CRM_QUEUE, toCrm, { log: c.var.log, ifLost: "sweeper" });
    }
    return c.json({ person_id: taken.personId, known: taken.leadId === null }, 200);
  });

  app.openapi(readRoute, async (c) => {
    const { id } = c.req.valid("param");
    if ((await clientInReach(c, id)) === null) return refuse(c, "not_found");
    return c.json((await clientAttribution(c.env.DB, id)) ?? EMPTY, 200);
  });

  app.openapi(heardRoute, async (c) => {
    const { id } = c.req.valid("param");
    if ((await clientInReach(c, id)) === null) return refuse(c, "not_found");
    const body = c.req.valid("json");
    await setHeardFrom(c.env.DB, {
      ...changeOf(c),
      personId: id,
      heardFrom: body.heard_from,
      other: body.heard_from_other ?? null,
    });
    return c.body(null, 204);
  });

  app.openapi(stopRoute, async (c) => {
    const { id } = c.req.valid("param");
    if ((await clientInReach(c, id)) === null) return refuse(c, "not_found");
    await stopSharing(c.env.DB, { ...changeOf(c), personId: id });
    return c.body(null, 204);
  });
}
