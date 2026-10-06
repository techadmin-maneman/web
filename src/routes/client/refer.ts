// The client's referrals (docs/decisions/0048-referrals.md): their code and invite link, their credit
// balance, and the tracker, which shows completed fits only: each friend's first name and the month they were
// fitted, never opens, consultations or pending referrals.
//
//   GET    /api/refer
//   POST   /api/refer/card    the client's card, made from their first fit's photographs, with their consent
//   GET    /api/refer/card    the same card while it is live, for the app to show and to share as a photograph
//   DELETE /api/refer/card    the revoke: new opens show the house card
//
// Refer is a fitted client's (ADR 0048; ADR 0083, withdrawn): the invite says "Had my hair system fitted", and a lead
// could otherwise invite their own first number from a second. So every route but the revoke answers 403 not_fitted
// before a first fit, as the app's tab shows its empty state; and a card of their own waits for that fit's photographs.
// The API makes the card itself: nothing the client sends becomes one.

import { clientRoute } from "../../http/session-routes.ts";
import { z } from "@hono/zod-openapi";
import type { App } from "../../http/context.ts";
import { PUBLIC_ORIGIN } from "../../config/environments.ts";
import { isFitted } from "../../domain/client-visits.ts";
import { spendableCredits, type Balance } from "../../domain/credits.ts";
import { liveCard, makeCard, revokeCard } from "../../domain/referral-cards.ts";
import { inviteOf, referralCodeOf } from "../../domain/referrals.ts";
import { clientOf } from "../../http/client-session.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { indiaDate } from "../../lib/india-time.ts";
import { firstNameOf } from "../../lib/names.ts";
import { failureReason } from "../../log.ts";

export const CreditsSchema = z
  .object({
    visits: z.number().int().openapi({ description: "Service-visit credits left." }),
    earliest_expiry: z.union([z.iso.datetime(), z.null()]).openapi({ description: "When the soonest expire." }),
    expiring_visits: z.number().int().openapi({ description: "How many of them expire then." }),
  })
  .strict()
  .openapi("Credits");

export const creditsBody = (balance: Balance): z.infer<typeof CreditsSchema> => ({
  visits: balance.visits,
  earliest_expiry: balance.earliestExpiry,
  expiring_visits: balance.expiringFirst,
});

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
          visits: z
            .number()
            .int()
            .openapi({
              description:
                "The service visits the client was given for this friend: what a referral earned when the friend was " +
                "fitted, 0 where it gave the referrer none (docs/decisions/0107-referral-rewards-in-the-console.md).",
            }),
        }),
      )
      .openapi({ description: "Friends whose first fit closed as done, most recent first." }),
    invite_credits: z.union([z.enum(["checking", "refused"]), z.null()]).openapi({
      description:
        "For a client who came through an invite, where its credits stand when they are not simply in the " +
        "balance: checking while ops review the grant, refused once ops rejected it. Null otherwise, and where the " +
        "reward it was held under gives the friend no visits.",
    }),
  })
  .strict()
  .openapi("Refer");

interface FittedRow {
  friend_first_name: string | null;
  name: string;
  erased_at: string | null;
  window_start: string;
  visits: number | null;
}

/**
 * A fitted friend's first name, as the grant kept it. An erased friend has none, since the erasure blanks
 * it: the tracker must not tell the referrer that the friend asked to be erased.
 */
function friendName(friend: FittedRow): string | null {
  if (friend.friend_first_name !== null) return friend.friend_first_name;
  if (friend.erased_at !== null) return null;
  return firstNameOf(friend.name);
}

/** The invite a client came through, where its grant waits on ops or was refused by them. */
const INVITE_CREDITS: Readonly<Record<string, "checking" | "refused">> = { held: "checking", rejected: "refused" };

/**
 * Where the credits of the invite the client came with stand, when not simply in the balance. A friend the reward it
 * was held under gave nothing has no credits to check or refuse (docs/decisions/0107-referral-rewards-in-the-console.md);
 * one held before rewards were kept, whose figure is null, may have some.
 */
function inviteCredits(
  invited: { grant_state: string; friend_visits: number | null } | null,
): "checking" | "refused" | null {
  if (invited === null || invited.friend_visits === 0) return null;
  return INVITE_CREDITS[invited.grant_state] ?? null;
}

/** The client's code, made from their initials the first time they need one. */
async function codeOf(db: D1Database, personId: string, now: Date): Promise<string> {
  const person = await db.prepare("SELECT name FROM people WHERE id = ?1").bind(personId).first<{ name: string }>();
  return referralCodeOf(db, personId, person?.name ?? "", now);
}

const NOT_FITTED = "not_fitted: Refer opens once the client's first fit is done";

const referRoute = clientRoute({
  method: "get",
  path: "/api/refer",
  summary: "The client's code, credits and fitted friends",
  responses: {
    200: { description: "Their referrals", content: { "application/json": { schema: ReferSchema } } },
    401: errorResponse("session_required"),
    403: errorResponse(NOT_FITTED),
  },
});

const cardRoute = clientRoute({
  method: "post",
  path: "/api/refer/card",
  summary: "Make the client's referral card from their first fit's front photographs, before and after",
  responses: {
    200: {
      description: "Made, and stored as the card's next version",
      content: { "application/json": { schema: z.object({ version: z.number().int() }).strict() } },
    },
    401: errorResponse("session_required"),
    403: errorResponse(`${NOT_FITTED}, or no front photograph of their first fit, before and after, is stored`),
    409: errorResponse("consent_required: the client has not agreed to photographs on referral cards"),
    503: errorResponse("unavailable: the card could not be made just now"),
  },
});

const revokeRoute = clientRoute({
  method: "delete",
  path: "/api/refer/card",
  summary: "Take the client's card down: new opens show the house card",
  responses: { 204: { description: "Revoked, or there was none" }, 401: errorResponse("session_required") },
});

const liveCardRoute = clientRoute({
  method: "get",
  path: "/api/refer/card",
  summary: "The client's own card while it is live: the JPEG the invite shows",
  request: {
    query: z.object({
      v: z
        .string()
        .optional()
        .openapi({
          description:
            "The card's version, from GET /api/refer. The route does not read it: a new version is a new link, so " +
            "the day the phone may keep the card never shows an older one.",
        }),
    }),
  },
  responses: {
    200: { description: "The card", content: { "image/jpeg": { schema: z.string() } } },
    401: errorResponse("session_required"),
    403: errorResponse(NOT_FITTED),
    404: errorResponse("not_found: no card of theirs is live: none made, taken down, the consent off, or erased"),
  },
});

export function registerClientRefer(app: App): void {
  app.openapi(cardRoute, async (c) => {
    const session = clientOf(c);
    const db = c.env.DB;
    const now = c.var.deps.now();
    if (!(await isFitted(db, session.subjectId))) return refuse(c, "not_fitted");
    const code = await codeOf(db, session.subjectId, now);
    const stores = { photos: c.env.CLIENT_PHOTOS, cards: c.env.REFERRAL_CARDS };
    const made = await makeCard(db, stores, c.var.deps.cards, { personId: session.subjectId, code, now }).catch(
      (error: unknown) => {
        c.var.log.warn("card_not_made", { reason: failureReason(error) });
        return { problem: "not_made" } as const;
      },
    );
    if ("problem" in made) {
      if (made.problem === "no_consent") return refuse(c, "consent_required");
      if (made.problem === "not_photographed") return refuse(c, "not_fitted");
      return refuse(c, "unavailable");
    }
    return c.json({ version: made.version }, 200);
  });

  registerLiveCard(app);

  app.openapi(revokeRoute, async (c) => {
    const session = clientOf(c);
    await revokeCard(c.env.DB, c.env.REFERRAL_CARDS, session.subjectId, c.var.deps.now());
    return c.body(null, 204);
  });

  app.openapi(referRoute, async (c) => {
    const session = clientOf(c);
    const db = c.env.DB;
    const now = c.var.deps.now();
    if (!(await isFitted(db, session.subjectId))) return refuse(c, "not_fitted");
    const code = await codeOf(db, session.subjectId, now);
    const [card, invite, balance, fitted, invited] = await Promise.all([
      db
        .prepare("SELECT card_state, card_version FROM referral_codes WHERE code = ?1")
        .bind(code)
        .first<{ card_state: "house" | "personal"; card_version: number }>(),
      // The invite as the landing reads it, with naming on: it names the client exactly when they have agreed to
      // the cards' current lines.
      inviteOf(db, code, true),
      spendableCredits(db, session.subjectId, now),
      db
        .prepare(
          `SELECT r.friend_first_name, p.name, p.erased_at, a.window_start, g.visits FROM referral_attributions r
           JOIN people p ON p.id = r.referred_person_id JOIN appointments a ON a.id = r.first_fit_appointment_id
           LEFT JOIN credit_ledger g ON g.kind = 'grant' AND g.source_kind = 'referral' AND g.source_id = r.id
             AND g.person_id = ?2
           WHERE r.code = ?1 AND r.grant_state IN ('approved', 'granted') ORDER BY a.window_start DESC`,
        )
        .bind(code, session.subjectId)
        .all<FittedRow>(),
      db
        .prepare("SELECT grant_state, friend_visits FROM referral_attributions WHERE referred_person_id = ?1")
        .bind(session.subjectId)
        .first<{ grant_state: string; friend_visits: number | null }>(),
    ]);
    const consented = (invite?.referrerFirstName ?? null) !== null;
    return c.json(
      {
        code,
        link: `${PUBLIC_ORIGIN[c.var.config.environment]}/r/${code}`,
        named: consented && c.var.config.settings.referrerNameOnInvite,
        credits: creditsBody(balance),
        card: { state: card?.card_state ?? ("house" as const), version: card?.card_version ?? 1, consented },
        fitted: fitted.results.map((friend) => ({
          first_name: friendName(friend),
          month: indiaDate(new Date(friend.window_start)).slice(0, 7),
          visits: friend.visits ?? 0,
        })),
        invite_credits: inviteCredits(invited),
      },
      200,
    );
  });
}

/**
 * The client's own card, as the invite shows it. The preview's route, GET /api/og/{code}.jpg, is the public host's
 * (ADR 0026), so the app cannot load it from its own: this is the same card for its owner, for the share sheet's
 * preview and for the photograph the phone's share sheet sends with the invite's words.
 */
function registerLiveCard(app: App): void {
  app.openapi(liveCardRoute, async (c) => {
    const session = clientOf(c);
    if (!(await isFitted(c.env.DB, session.subjectId))) return refuse(c, "not_fitted");
    const code = await codeOf(c.env.DB, session.subjectId, c.var.deps.now());
    // Live exactly when the landing's preview would show it: stored, the consent still given, the client not erased.
    const card = await liveCard(c.env.DB, c.env.REFERRAL_CARDS, code);
    if (card === null) return refuse(c, "not_found");
    return c.body(card.body, 200, {
      "Content-Type": "image/jpeg",
      "Content-Length": String(card.size),
      "Cache-Control": "private, max-age=86400",
    });
  });
}
