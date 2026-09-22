// The client's referrals (board F1; docs/decisions/0048-referrals.md): their code and invite link, their credit
// balance, and the tracker, which shows completed fits only: each friend's first name and the month they were
// fitted, never opens, consultations or pending referrals.
//
//   GET /api/refer

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../app.ts";
import { PUBLIC_ORIGIN } from "../config/environments.ts";
import { creditBalance } from "../domain/credits.ts";
import { referralCodeOf } from "../domain/referrals.ts";
import { requireClientSession } from "../http/client-session.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { indiaDate } from "../lib/india-time.ts";

export const CreditsSchema = z
  .object({
    visits: z.number().int().openapi({ description: "Service-visit credits left." }),
    earliest_expiry: z.union([z.iso.datetime(), z.null()]).openapi({ description: "When the soonest expire." }),
  })
  .strict()
  .openapi("Credits");

const ReferSchema = z
  .object({
    code: z.string(),
    link: z.string().openapi({ description: "The invite link to share: maneman.in/r/<code>." }),
    credits: CreditsSchema,
    card: z.object({ state: z.enum(["house", "personal"]), version: z.number().int() }).strict(),
    fitted: z
      .array(z.object({ first_name: z.string(), month: z.string().openapi({ description: "YYYY-MM, in India." }) }))
      .openapi({ description: "Friends whose first fit closed as done, most recent first." }),
  })
  .strict()
  .openapi("Refer");

const referRoute = createRoute({
  method: "get",
  path: "/api/refer",
  summary: "The client's code, credits and fitted friends",
  responses: {
    200: { description: "Their referrals", content: { "application/json": { schema: ReferSchema } } },
    401: errorResponse("session_required"),
  },
});

export function registerClientRefer(app: App): void {
  app.use("/api/refer", requireClientSession);

  app.openapi(referRoute, async (c) => {
    const session = c.var.clientSession;
    if (session === undefined) return c.json(errorBody("session_required", c.var.requestId), 401);
    const db = c.env.DB;
    const now = c.var.deps.now();
    const person = await db
      .prepare("SELECT name FROM people WHERE id = ?1")
      .bind(session.subjectId)
      .first<{ name: string }>();
    const code = await referralCodeOf(db, session.subjectId, person?.name ?? "", now);
    const [card, balance, fitted] = await Promise.all([
      db
        .prepare("SELECT card_state, card_version FROM referral_codes WHERE code = ?1")
        .bind(code)
        .first<{ card_state: "house" | "personal"; card_version: number }>(),
      creditBalance(db, session.subjectId, now),
      db
        .prepare(
          `SELECT p.name, a.window_start FROM referral_attributions r
           JOIN people p ON p.id = r.referred_person_id JOIN appointments a ON a.id = r.first_fit_appointment_id
           WHERE r.code = ?1 AND r.grant_state IN ('approved', 'granted') ORDER BY a.window_start DESC`,
        )
        .bind(code)
        .all<{ name: string; window_start: string }>(),
    ]);
    return c.json(
      {
        code,
        link: `${PUBLIC_ORIGIN[c.var.config.environment]}/r/${code}`,
        credits: { visits: balance.visits, earliest_expiry: balance.earliestExpiry },
        card: { state: card?.card_state ?? ("house" as const), version: card?.card_version ?? 1 },
        fitted: fitted.results.map((friend) => ({
          first_name: friend.name.split(" ")[0] ?? friend.name,
          month: indiaDate(new Date(friend.window_start)).slice(0, 7),
        })),
      },
      200,
    );
  });
}
