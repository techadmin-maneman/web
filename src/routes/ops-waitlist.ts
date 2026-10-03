// Ops' waitlist, the pincode launch and the referrers' funnel (Ops Console, C2 and C3;
// docs/decisions/0048-referrals.md), on the ops surface behind Access:
//   GET  /api/waitlist                 who is waiting, by pincode
//   POST /api/pincodes/:pin/launch     what a launch would send, then the launch itself
//   GET  /api/referrers                every referrer's figures: opens, consultations, fits, granted, redeemed
// A launch is audited, and its alerts leave in a paced line.

import { createRoute, z } from "@hono/zod-openapi";
import { staffOf } from "../http/audit.ts";
import type { App } from "../http/context.ts";
import { launchPincode, launchPreview, waitlistByPincode } from "../domain/waitlist.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { json } from "../http/openapi.ts";
import { indiaDate } from "../lib/india-time.ts";
import type { MessagingMessage } from "../queues/messaging.ts";

/** The pincodes the waitlist lists at once, the longest waits: far more than a launch is chosen from. */
export const WAITLIST_AREAS = 200;
/** The referrers one page holds, the busiest first. */
export const REFERRERS_PAGE = 50;

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
                  area: z.union([z.string(), z.null()]).openapi({
                    description:
                      "The area's name once ops have named it; null until then, and for a pincode we do not know.",
                  }),
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
            more: z.boolean().openapi({
              description: `More than ${String(WAITLIST_AREAS)} pincodes have someone waiting; these are the longest waits.`,
            }),
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
  summary: `The referrers' figures, the busiest first, ${String(REFERRERS_PAGE)} at a time`,
  request: {
    query: z.object({
      offset: z.coerce.number().int().min(0).default(0).openapi({ description: "How many to skip: 0, then 50 on." }),
    }),
  },
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
            more: z.boolean().openapi({ description: "Another page follows this one." }),
          })
          .strict(),
      ),
    },
  },
});

export function registerOpsWaitlist(app: App): void {
  app.openapi(waitlistRoute, async (c) => {
    const areas = await waitlistByPincode(c.env.DB, WAITLIST_AREAS + 1);
    return c.json(
      {
        more: areas.length > WAITLIST_AREAS,
        areas: areas.slice(0, WAITLIST_AREAS).map((area) => ({
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
    const staff = staffOf(c);
    const { alerts } = await launchPincode(db, {
      pincode: pin,
      launchOn: launchOn ?? indiaDate(now),
      audit: {
        surface: "ops",
        actor: staff,
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
    const { offset } = c.req.valid("query");
    // Each figure is counted once for every code together, then joined on, rather than a query a row.
    const { results } = await c.env.DB.prepare(
      `WITH funnel AS (
         SELECT a.code, SUM(a.via = 'consultation') AS consultations,
           COUNT(a.first_fit_appointment_id) AS fits, SUM(a.grant_state IN ('granted', 'approved')) AS granted
         FROM referral_attributions a GROUP BY a.code
       ), spent AS (
         SELECT a.code, COUNT(*) AS redeemed
         FROM credit_ledger e JOIN credit_ledger g ON g.id = e.grant_id JOIN referral_attributions a ON a.id = g.source_id
         WHERE e.kind = 'redeem' AND g.source_kind = 'referral' GROUP BY a.code
       )
       SELECT r.code, p.name, r.opens, COALESCE(f.consultations, 0) AS consultations, COALESCE(f.fits, 0) AS fits,
         COALESCE(f.granted, 0) AS granted, COALESCE(s.redeemed, 0) AS redeemed
       FROM referral_codes r JOIN people p ON p.id = r.person_id
       LEFT JOIN funnel f ON f.code = r.code LEFT JOIN spent s ON s.code = r.code
       ORDER BY fits DESC, r.opens DESC, p.name, r.code
       LIMIT ?1 OFFSET ?2`,
    )
      .bind(REFERRERS_PAGE + 1, offset)
      .all<{
        code: string;
        name: string;
        opens: number;
        consultations: number;
        fits: number;
        granted: number;
        redeemed: number;
      }>();
    return c.json({ referrers: results.slice(0, REFERRERS_PAGE), more: results.length > REFERRERS_PAGE }, 200);
  });
}
