// Attribution in the console (docs/decisions/0288-attribution-and-conversions.md), behind Access:
//
// - POST /api/leads/call: a lead taken on a call, its channel picked (Customer Care · Act).
// - GET /api/clients/{id}/attribution: how a client found us, and what they told ops (Customer Care · View).
// - POST /api/clients/{id}/heard-from: what they told ops, asked at the consultation (Customer Care · Act).
// - POST /api/clients/{id}/lost: the lead lost, why and in what words, or taken back (Customer Care · Act).
// - POST /api/clients/{id}/stop-sharing: nothing more of theirs to Google or Meta, as they asked (Customer Care · Manage).

import { opsRoute } from "../../http/session-routes.ts";
import { z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { clientAttribution, setHeardFrom, stopSharing } from "../../domain/attribution/attribution.ts";
import { jobSheet } from "../../domain/field/job-sheet-settings.ts";
import { leadStages, setLost } from "../../domain/leads/lead-stages.ts";
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
import { LOST_OBJECTION_MAX } from "../../policy/lost-leads.ts";
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
            pincode: z
              .string()
              .regex(/^[1-8]\d{5}$/)
              .optional()
              .openapi({ description: "Where they are, as they said: their city until they give an address." }),
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
  summary:
    "How a client found us: their channel by the rule, their first and last touch, and what they told ops; and their " +
    "lead's stages, each when first reached, and whether it was lost",
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
            became_lead_at: z.union([z.iso.datetime(), z.null()]),
            first_reply_at: z
              .union([z.iso.datetime(), z.null()])
              .openapi({ description: "Care's first written reply; an automatic message is none." }),
            qualified_at: z
              .union([z.iso.datetime(), z.null()])
              .openapi({ description: "When their first consultation was booked." }),
            attended_at: z.union([z.iso.datetime(), z.null()]),
            fitted_at: z.union([z.iso.datetime(), z.null()]),
            lost_reason: z
              .union([z.string(), z.null()])
              .openapi({ description: "One of the job sheet's lost_reasons, by its code." }),
            lost_reason_label: z.union([z.string(), z.null()]).openapi({
              description: "The reason's words on the job sheet, a reason ops have since taken off the list included.",
            }),
            lost_objection: z.union([z.string(), z.null()]),
            lost_at: z.union([z.iso.datetime(), z.null()]),
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
    400: errorResponse("invalid_request: fields names heard_from for an answer not on the list"),
    404: NotFound,
  },
});

const lostRoute = opsRoute({
  method: "post",
  path: "/api/clients/{id}/lost",
  summary: "The lead lost, with why and the client's objection; a null reason takes it back",
  request: {
    params: Id,
    body: {
      required: true,
      ...json(
        z
          .object({
            lost_reason: z.union([z.string().min(1).max(64), z.null()]).openapi({
              description: "One of the job sheet's lost_reasons, by its code; null takes a lead lost back.",
            }),
            lost_objection: z.string().trim().min(1).max(LOST_OBJECTION_MAX).optional(),
          })
          .strict()
          .openapi("LeadLost"),
      ),
    },
  },
  responses: {
    204: { description: "Kept" },
    400: errorResponse("invalid_request: fields names lost_reason for a code the job sheet never listed"),
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
  lost_reason: null,
  lost_objection: null,
  lost_at: null,
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
      pincode: body.pincode,
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
    const [found, stages, sheet] = await Promise.all([
      clientAttribution(c.env.DB, id),
      leadStages(c.env.DB, id),
      jobSheet(c.env.DB),
    ]);
    const attribution = found ?? EMPTY;
    const { items, retired } = sheet.lostReasons;
    const words = new Map([...retired, ...items].map((item) => [item.id, item.label]));
    const reason = attribution.lost_reason;
    const label = reason === null ? null : (words.get(reason) ?? reason);
    return c.json({ ...attribution, ...stages, lost_reason_label: label }, 200);
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

  app.openapi(lostRoute, async (c) => {
    const { id } = c.req.valid("param");
    if ((await clientInReach(c, id)) === null) return refuse(c, "not_found");
    const body = c.req.valid("json");
    const set = await setLost(c.env.DB, {
      ...changeOf(c),
      personId: id,
      reason: body.lost_reason,
      objection: body.lost_objection ?? null,
    });
    if (set === "unknown_reason") return refuse(c, "invalid_request", ["lost_reason"]);
    return c.body(null, 204);
  });

  app.openapi(stopRoute, async (c) => {
    const { id } = c.req.valid("param");
    if ((await clientInReach(c, id)) === null) return refuse(c, "not_found");
    await stopSharing(c.env.DB, { ...changeOf(c), personId: id });
    return c.body(null, 204);
  });
}
