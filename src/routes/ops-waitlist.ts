// Ops' waitlist, the pincode launch and the referrers' funnel (Ops Console, C2 and C3;
// docs/decisions/0048-referrals.md), on the ops surface behind Access:
//   GET  /api/waitlist                 who is waiting, by pincode
//   POST /api/pincodes/:pin/launch     what a launch would send, then the launch itself
//   GET  /api/referrers                every referrer's figures: opens, consultations, fits, granted, redeemed
// A launch is audited, and its alerts leave in a paced line.

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../app.ts";
import { actorOf } from "../domain/audit.ts";
import { launchPincode, launchPreview, waitlistByPincode } from "../domain/waitlist.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { indiaDate } from "../lib/india-time.ts";
import type { MessagingMessage } from "../queues/messaging.ts";

const json = <T extends z.ZodType>(schema: T) => ({ content: { "application/json": { schema } } });

const waitlistRoute = createRoute({
  method: "get",
  path: "/api/waitlist",
  summary: "Who is waiting, by pincode, the longest wait first",
  responses: {
    200: {
      description: "Areas with someone waiting",
      ...json(
        z
          .object({
            areas: z.array(
              z
                .object({
                  pincode: z.string(),
                  area: z.union([z.string(), z.null()]),
                  city: z.union([z.string(), z.null()]),
                  served: z.boolean(),
                  launched_at: z.union([z.iso.datetime(), z.null()]),
                  waiting: z.number().int(),
                  oldest: z.union([z.iso.datetime(), z.null()]),
                  referred: z.number().int(),
                  alerts: z.number().int().openapi({ description: "How many asked to be told when we launch." }),
                })
                .strict(),
            ),
          })
          .strict(),
      ),
    },
  },
});

const launchRoute = createRoute({
  method: "post",
  path: "/api/pincodes/{pin}/launch",
  summary: "Launch a pincode: without confirm, what it would send; with it, the launch",
  request: {
    params: z.object({ pin: z.string().regex(/^[1-8]\d{5}$/) }),
    body: {
      required: true,
      ...json(
        z
          .object({
            confirm: z.boolean(),
            launch_on: z.iso.date().optional().openapi({ description: "India's date it starts; today if left out." }),
          })
          .strict()
          .openapi("PincodeLaunch"),
      ),
    },
  },
  responses: {
    200: {
      description: "What it would send, or what it sent",
      ...json(
        z
          .object({
            pincode: z.string(),
            waiting: z.number().int(),
            alerts: z.number().int(),
            launched: z.boolean(),
          })
          .strict(),
      ),
    },
    404: errorResponse("not_found: we have no such pincode"),
  },
});

const referrersRoute = createRoute({
  method: "get",
  path: "/api/referrers",
  summary: "Every referrer's figures, the busiest first",
  responses: {
    200: {
      description: "Referrers",
      ...json(
        z
          .object({
            referrers: z.array(
              z
                .object({
                  code: z.string(),
                  name: z.string(),
                  opens: z.number().int(),
                  consultations: z.number().int(),
                  fits: z.number().int(),
                  granted: z.number().int(),
                  redeemed: z.number().int().openapi({ description: "Credits of theirs spent on visits." }),
                })
                .strict(),
            ),
          })
          .strict(),
      ),
    },
  },
});

export function registerOpsWaitlist(app: App): void {
  app.openapi(waitlistRoute, async (c) => {
    const areas = await waitlistByPincode(c.env.DB);
    return c.json(
      {
        areas: areas.map((area) => ({
          pincode: area.pincode,
          area: area.area,
          city: area.city,
          served: area.served,
          launched_at: area.launchedAt,
          waiting: area.waiting,
          oldest: area.oldest,
          referred: area.referred,
          alerts: area.alerts,
        })),
      },
      200,
    );
  });

  app.openapi(launchRoute, async (c) => {
    const { pin } = c.req.valid("param");
    const { confirm, launch_on: launchOn } = c.req.valid("json");
    const db = c.env.DB;
    const now = c.var.deps.now();
    const known = await db.prepare("SELECT 1 FROM serviceable_pincodes WHERE pincode = ?1").bind(pin).first();
    if (known === null) return c.json(errorBody("not_found", c.var.requestId), 404);

    if (!confirm) {
      const preview = await launchPreview(db, pin);
      return c.json({ pincode: pin, waiting: preview.waiting, alerts: preview.alerts, launched: false }, 200);
    }
    const identity = c.var.accessIdentity;
    if (identity === undefined) throw new Error("ops routes run after requireAccess");
    const { alerts } = await launchPincode(db, {
      pincode: pin,
      launchOn: launchOn ?? indiaDate(now),
      audit: {
        surface: "ops",
        actor: actorOf(identity),
        action: "pincode.launch",
        subject: { kind: "pincode", id: pin },
        requestId: c.var.requestId,
      },
      now,
    });
    if (alerts.length > 0) {
      await c.env.MESSAGE_QUEUE.sendBatch(
        alerts.map((alert) => ({
          body: { message_id: alert.id, request_id: c.var.requestId } satisfies MessagingMessage,
          delaySeconds: alert.delaySeconds,
        })),
      );
    }
    const waiting = await launchPreview(db, pin);
    return c.json({ pincode: pin, waiting: waiting.waiting, alerts: alerts.length, launched: true }, 200);
  });

  app.openapi(referrersRoute, async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT r.code, p.name, r.opens,
         (SELECT COUNT(*) FROM referral_attributions a WHERE a.code = r.code AND a.via = 'consultation') AS consultations,
         (SELECT COUNT(*) FROM referral_attributions a WHERE a.code = r.code AND a.first_fit_appointment_id IS NOT NULL) AS fits,
         (SELECT COUNT(*) FROM referral_attributions a WHERE a.code = r.code AND a.grant_state IN ('granted', 'approved')) AS granted,
         (SELECT COUNT(*) FROM credit_ledger e JOIN credit_ledger g ON g.id = e.grant_id
          WHERE e.kind = 'redeem' AND g.source_kind = 'referral'
            AND g.source_id IN (SELECT a.id FROM referral_attributions a WHERE a.code = r.code)) AS redeemed
       FROM referral_codes r JOIN people p ON p.id = r.person_id
       ORDER BY fits DESC, r.opens DESC, p.name`,
    ).all<{
      code: string;
      name: string;
      opens: number;
      consultations: number;
      fits: number;
      granted: number;
      redeemed: number;
    }>();
    return c.json({ referrers: results }, 200);
  });
}
