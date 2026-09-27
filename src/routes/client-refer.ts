// The client's referrals (board F1; docs/decisions/0048-referrals.md): their code and invite link, their credit
// balance, and the tracker, which shows completed fits only: each friend's first name and the month they were
// fitted, never opens, consultations or pending referrals.
//
//   GET    /api/refer
//   PUT    /api/refer/card    the client's card: a 1200 x 630 JPEG under 300 KB, with their consent to cards
//   DELETE /api/refer/card    the revoke: new opens show the house card

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../http/context.ts";
import { PUBLIC_ORIGIN } from "../config/environments.ts";
import { creditBalance } from "../domain/credits.ts";
import { MAX_CARD_BYTES, revokeCard, storeCard } from "../domain/referral-cards.ts";
import { inviteOf, referralCodeOf } from "../domain/referrals.ts";
import { clientOf, requireClientSession } from "../http/client-session.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { indiaDate } from "../lib/india-time.ts";
import { firstNameOf } from "../lib/names.ts";

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
    named: z.boolean().openapi({
      description:
        "Whether the invite's preview names the client, as GET /api/r/{code} will: they agreed to the cards' " +
        "current lines, and naming is on (REFERRER_NAME_ON_INVITE).",
    }),
    credits: CreditsSchema,
    card: z
      .object({
        state: z.enum(["house", "personal"]),
        version: z.number().int(),
        consented: z.boolean().openapi({
          description: "Whether the client has agreed to photographs on referral cards, on the notice's current lines.",
        }),
      })
      .strict(),
    fitted: z
      .array(
        z.object({
          first_name: z.union([z.string(), z.null()]).openapi({
            description:
              "Kept with the referral when it was granted, so it stays after the friend is erased. Null for a " +
              "friend erased before names were kept: never the word the erasure leaves.",
          }),
          month: z.string().openapi({ description: "YYYY-MM, in India." }),
        }),
      )
      .openapi({ description: "Friends whose first fit closed as done, most recent first." }),
    invite_credits: z.union([z.enum(["checking", "refused"]), z.null()]).openapi({
      description:
        "For a client who came through an invite, where its credits stand when they are not simply in the " +
        "balance: checking while ops review the grant, refused once ops rejected it. Null otherwise.",
    }),
  })
  .strict()
  .openapi("Refer");

interface FittedRow {
  friend_first_name: string | null;
  name: string;
  erased_at: string | null;
  window_start: string;
}

/**
 * A fitted friend's first name, as the grant kept it (LIFE-13). An erased friend has none, since the erasure blanks
 * it: the tracker must not tell the referrer that the friend asked to be erased.
 */
function friendName(friend: FittedRow): string | null {
  if (friend.friend_first_name !== null) return friend.friend_first_name;
  if (friend.erased_at !== null) return null;
  return firstNameOf(friend.name);
}

/** The invite a client came through, where its grant waits on ops or was refused by them. */
const INVITE_CREDITS: Readonly<Record<string, "checking" | "refused">> = { held: "checking", rejected: "refused" };

const referRoute = createRoute({
  method: "get",
  path: "/api/refer",
  summary: "The client's code, credits and fitted friends",
  responses: {
    200: { description: "Their referrals", content: { "application/json": { schema: ReferSchema } } },
    401: errorResponse("session_required"),
  },
});

const cardRoute = createRoute({
  method: "put",
  path: "/api/refer/card",
  summary: "Upload the client's referral card: the body is the JPEG itself",
  responses: {
    200: {
      description: "Stored as the card's next version",
      content: { "application/json": { schema: z.object({ version: z.number().int() }).strict() } },
    },
    401: errorResponse("session_required"),
    409: errorResponse("consent_required: the client has not agreed to photographs on referral cards"),
    422: errorResponse("photo_invalid_file: not a 1200 x 630 JPEG under 300 KB"),
  },
});

const revokeRoute = createRoute({
  method: "delete",
  path: "/api/refer/card",
  summary: "Take the client's card down: new opens show the house card",
  responses: { 204: { description: "Revoked, or there was none" }, 401: errorResponse("session_required") },
});

export function registerClientRefer(app: App): void {
  app.use("/api/refer", requireClientSession);
  app.use("/api/refer/*", requireClientSession);

  app.openapi(cardRoute, async (c) => {
    const session = clientOf(c);
    const db = c.env.DB;
    const now = c.var.deps.now();
    if (Number(c.req.header("Content-Length") ?? "0") > MAX_CARD_BYTES) {
      return c.json(errorBody("photo_invalid_file", c.var.requestId), 422);
    }
    const person = await db
      .prepare("SELECT name FROM people WHERE id = ?1")
      .bind(session.subjectId)
      .first<{ name: string }>();
    const code = await referralCodeOf(db, session.subjectId, person?.name ?? "", now);
    const stored = await storeCard(db, c.env.REFERRAL_CARDS, {
      personId: session.subjectId,
      code,
      bytes: new Uint8Array(await c.req.arrayBuffer()),
      now,
    });
    if ("problem" in stored) {
      return stored.problem === "no_consent"
        ? c.json(errorBody("consent_required", c.var.requestId), 409)
        : c.json(errorBody("photo_invalid_file", c.var.requestId), 422);
    }
    return c.json({ version: stored.version }, 200);
  });

  app.openapi(revokeRoute, async (c) => {
    const session = clientOf(c);
    await revokeCard(c.env.DB, c.env.REFERRAL_CARDS, session.subjectId, c.var.deps.now());
    return c.body(null, 204);
  });

  app.openapi(referRoute, async (c) => {
    const session = clientOf(c);
    const db = c.env.DB;
    const now = c.var.deps.now();
    const person = await db
      .prepare("SELECT name FROM people WHERE id = ?1")
      .bind(session.subjectId)
      .first<{ name: string }>();
    const code = await referralCodeOf(db, session.subjectId, person?.name ?? "", now);
    const [card, invite, balance, fitted, invited] = await Promise.all([
      db
        .prepare("SELECT card_state, card_version FROM referral_codes WHERE code = ?1")
        .bind(code)
        .first<{ card_state: "house" | "personal"; card_version: number }>(),
      // The invite as the landing reads it, with naming on: it names the client exactly when they have agreed to
      // the cards' current lines.
      inviteOf(db, code, true),
      creditBalance(db, session.subjectId, now),
      db
        .prepare(
          `SELECT r.friend_first_name, p.name, p.erased_at, a.window_start FROM referral_attributions r
           JOIN people p ON p.id = r.referred_person_id JOIN appointments a ON a.id = r.first_fit_appointment_id
           WHERE r.code = ?1 AND r.grant_state IN ('approved', 'granted') ORDER BY a.window_start DESC`,
        )
        .bind(code)
        .all<FittedRow>(),
      db
        .prepare("SELECT grant_state FROM referral_attributions WHERE referred_person_id = ?1")
        .bind(session.subjectId)
        .first<{ grant_state: string }>(),
    ]);
    const consented = (invite?.referrerFirstName ?? null) !== null;
    return c.json(
      {
        code,
        link: `${PUBLIC_ORIGIN[c.var.config.environment]}/r/${code}`,
        named: consented && c.var.config.settings.referrerNameOnInvite,
        credits: { visits: balance.visits, earliest_expiry: balance.earliestExpiry },
        card: { state: card?.card_state ?? ("house" as const), version: card?.card_version ?? 1, consented },
        fitted: fitted.results.map((friend) => ({
          first_name: friendName(friend),
          month: indiaDate(new Date(friend.window_start)).slice(0, 7),
        })),
        invite_credits: INVITE_CREDITS[invited?.grant_state ?? ""] ?? null,
      },
      200,
    );
  });
}
