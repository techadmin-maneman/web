// Ops' waitlist, the pincode launch and the referrers' funnel (Ops Console, C2 and C3;
// docs/decisions/0048-referrals.md), on the ops surface behind Access:
//   GET  /api/waitlist                 who is waiting, by pincode, and the cities a pincode may be added in
//   POST /api/pincodes/:pin/launch     what a launch would send, then the launch itself
//   GET  /api/referrers                every referrer's figures: opens, consultations, fits, granted, redeemed
// A launch is audited, and its alerts leave in a paced line.

import { createRoute, z } from "@hono/zod-openapi";
import { staffOf } from "../http/audit.ts";
import type { App } from "../http/context.ts";
import { listCities } from "../domain/cities.ts";
import { reachBinding, withinReach } from "../domain/places.ts";
import { launchedPincode, pincodeOf } from "../domain/service-area.ts";
import { launchPincode, launchPreview, waitlistByPincode } from "../domain/waitlist.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { json } from "../http/openapi.ts";
import { queuePacedMessages } from "../http/queue-message.ts";
import { reachOf, routeReach } from "../http/staff-access.ts";
import { indiaDate } from "../lib/india-time.ts";
import { reachesCity, type PlacesReached } from "../policy/access.ts";
import { launchesLater } from "../policy/launch.ts";

/** The pincodes the waitlist lists at once, the longest waits: far more than a launch is chosen from. */
export const WAITLIST_AREAS = 200;
/** The referrers one page holds, the busiest first. */
export const REFERRERS_PAGE = 50;

const waitlistRoute = createRoute({
  method: "get",
  path: "/api/waitlist",
  summary: "Who is waiting in the caller's cities, by pincode, the longest wait first",
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
            cities: z.array(z.string()).openapi({
              description: "Our cities the caller may add a pincode in: those their Growth MANAGE reaches.",
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
            launch_on: z.iso
              .date()
              .optional()
              .openapi({ description: "India's date it started: today if left out, and never a day to come." }),
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
    400: errorResponse("launch_in_future: launch_on is a day still to come"),
    403: errorResponse("access_required, or not_permitted: the pincode's city is outside the caller's Growth MANAGE"),
    404: errorResponse("not_found: the service area holds no such pincode, so it is added first"),
  },
});

const referrersRoute = createRoute({
  method: "get",
  path: "/api/referrers",
  summary: `The figures of the referrers in the caller's cities, the busiest first, ${String(REFERRERS_PAGE)} at a time`,
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
                  person_id: z.uuid().openapi({ description: "Whose code it is: the client page to open." }),
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
    const areas = await waitlistByPincode(c.env.DB, WAITLIST_AREAS + 1, await routeReach(c));
    const adding = await reachOf(c, "growth", "manage");
    const cities = (await listCities(c.env.DB)).filter((city) => reachesCity(adding, city.name));
    return c.json(
      {
        more: areas.length > WAITLIST_AREAS,
        cities: cities.map((city) => city.name),
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
    const known = await pincodeOf(db, pin);
    if (known === null) return c.json(errorBody("not_found", c.var.requestId), 404);
    // Whether we serve a pincode is no secret, as the site says so to anyone, so one elsewhere is refused, not hidden.
    if (!reachesCity(await routeReach(c), known.city)) {
      return c.json(errorBody("not_permitted", c.var.requestId), 403);
    }

    if (!confirm) {
      const preview = await launchPreview(db, pin);
      return c.json({ pincode: pin, waiting: preview.waiting, alerts: preview.alerts, launched: false }, 200);
    }
    const today = indiaDate(now);
    if (launchOn !== undefined && launchesLater(launchOn, today)) {
      return c.json(errorBody("launch_in_future", c.var.requestId, ["launch_on"]), 400);
    }
    const staff = staffOf(c);
    const { alerts } = await launchPincode(db, {
      pincode: launchedPincode(known),
      launchDay: launchOn ?? today,
      audit: {
        surface: "ops",
        actor: staff,
        action: "pincode.launch",
        subject: { kind: "pincode", id: pin },
        requestId: c.var.requestId,
      },
      now,
    });
    await queuePacedMessages(c, alerts);
    const waiting = await launchPreview(db, pin);
    return c.json({ pincode: pin, waiting: waiting.waiting, alerts: alerts.length, launched: true }, 200);
  });

  app.openapi(referrersRoute, async (c) => {
    const { offset } = c.req.valid("query");
    const referrers = await referrersFrom(c.env.DB, offset, await routeReach(c));
    return c.json({ referrers: referrers.slice(0, REFERRERS_PAGE), more: referrers.length > REFERRERS_PAGE }, 200);
  });
}

interface ReferrerFigures {
  readonly code: string;
  readonly person_id: string;
  readonly name: string;
  readonly opens: number;
  readonly consultations: number;
  readonly fits: number;
  readonly granted: number;
  readonly redeemed: number;
}

/**
 * The referrers within reach from `offset`, the busiest first: a page and one more, to tell whether another follows.
 * Each figure is counted once for every code together, then joined on, rather than a query a row. A referrer is in
 * their own city, wherever their friends are.
 */
async function referrersFrom(db: D1Database, offset: number, reached: PlacesReached): Promise<ReferrerFigures[]> {
  const { results } = await db
    .prepare(
      `WITH funnel AS (
         SELECT a.code, SUM(a.via = 'consultation') AS consultations,
           COUNT(a.first_fit_appointment_id) AS fits, SUM(a.grant_state IN ('granted', 'approved')) AS granted
         FROM referral_attributions a GROUP BY a.code
       ), spent AS (
         SELECT a.code, COUNT(*) AS redeemed
         FROM credit_ledger e JOIN credit_ledger g ON g.id = e.grant_id JOIN referral_attributions a ON a.id = g.source_id
         WHERE e.kind = 'redeem' AND g.source_kind = 'referral' GROUP BY a.code
       )
       SELECT r.code, r.person_id, p.name, r.opens, COALESCE(f.consultations, 0) AS consultations, COALESCE(f.fits, 0) AS fits,
         COALESCE(f.granted, 0) AS granted, COALESCE(s.redeemed, 0) AS redeemed
       FROM referral_codes r JOIN people p ON p.id = r.person_id
       LEFT JOIN funnel f ON f.code = r.code LEFT JOIN spent s ON s.code = r.code
       WHERE ${withinReach("client", "p", "?3")}
       ORDER BY fits DESC, r.opens DESC, p.name, r.code
       LIMIT ?1 OFFSET ?2`,
    )
    .bind(REFERRERS_PAGE + 1, offset, reachBinding(reached))
    .all<ReferrerFigures>();
  return results;
}
