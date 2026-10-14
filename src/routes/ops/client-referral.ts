// Ops attaching an invite to a client who booked away from the invite's own page: in the app, by messaging ops, or
// on /book in a browser that no longer remembers it (docs/decisions/0089-an-invite-is-not-lost.md). On the ops
// surface behind Access.
//
// The client is attributed through the landing's own function, so its rules hold here too: never the code's own
// referrer, never a client who came with an invite already; one attached after the friend's first fit waits for ops'
// review (src/policy/fraud-holds.ts, attached_after_fit). Who attached it and why are
// kept with it, and its audit entry is written in the same batch. The CRM is then sent the client again, and reads
// the invite they now carry.

import { opsRoute } from "../../http/session-routes.ts";
import { z } from "@hono/zod-openapi";
import { actorOf } from "../../http/audit.ts";
import type { App } from "../../http/context.ts";
import { CODE_PATTERN } from "../../config/invite-codes.ts";
import {
  attribute,
  clientInviteOf,
  GRANT_STATES,
  referralSourceOf,
  inviteOf,
} from "../../domain/referrals/referrals.ts";
import { errorBody, errorResponse, ErrorResponseSchema, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { clientInReach } from "../../http/staff-access.ts";
import { queueCrmContact } from "../../http/contact-sync.ts";
import { REASON_MAX_CHARS } from "../../policy/decision-reasons.ts";

/** The invite a client came with, as their page shows it. */
export const ClientInviteSchema = z
  .object({
    code: z.string(),
    referrer: z
      .union([z.object({ id: z.uuid(), name: z.string() }).strict(), z.null()])
      .openapi({ description: "Who sent it; null once they have been erased." }),
    grant: z.enum(GRANT_STATES).openapi({
      description:
        "pending until the client's first fit; held for ops' review; approved or granted, the reward given; " +
        "rejected; expired, lapsed on a waitlist; clawed_back, the first fit refunded.",
    }),
    since: z.iso.datetime().openapi({ description: "When the client first came with it, or ops attached it." }),
    attached: z
      .union([
        z
          .object({
            by: z.string().openapi({ description: "The Access identity of the member of staff who attached it." }),
            reason: z.union([z.string(), z.null()]).openapi({ description: "Null once either side is erased." }),
          })
          .strict(),
        z.null(),
      ])
      .openapi({ description: "Who attached it and why; null for an invite the client used themselves." }),
  })
  .strict()
  .openapi("ClientInvite");

const AlreadyInvitedSchema = z
  .object({
    error: ErrorResponseSchema.shape.error,
    invite: z.object({ code: z.string() }).strict().openapi({ description: "The invite the client came with first." }),
  })
  .strict()
  .openapi("AlreadyInvited");

const attachRoute = opsRoute({
  method: "post",
  path: "/api/clients/{id}/referral",
  summary: "Attach an invite to a client who booked away from its page, with the reason",
  request: {
    params: z.object({ id: z.uuid() }),
    body: {
      required: true,
      ...json(
        z
          .object({
            code: z.string().trim().regex(CODE_PATTERN).openapi({ description: "The invite's code, in either case." }),
            reason: z.string().trim().min(1).max(REASON_MAX_CHARS).openapi({
              description: "Why, in ops' words: kept with the invite, and blanked if either side is erased.",
            }),
          })
          .strict()
          .openapi("InviteAttachment"),
      ),
    },
  },
  responses: {
    201: { description: "Attached", ...json(ClientInviteSchema) },
    400: errorResponse("invalid_request: no reason, or a code that is not shaped like one"),
    404: errorResponse("not_found: no such client in the caller's cities, or one who has been erased"),
    409: {
      description:
        "own_invite: the client is the code's own referrer; already_invited: the client came with an invite " +
        "already, which the answer names",
      content: { "application/json": { schema: z.union([ErrorResponseSchema, AlreadyInvitedSchema]) } },
    },
    422: errorResponse("unknown_invite: no invite has that code"),
  },
});

export function registerOpsClientReferral(app: App): void {
  app.openapi(attachRoute, async (c) => {
    const personId = c.req.valid("param").id;
    const { code, reason } = c.req.valid("json");
    const { requestId } = c.var;
    const db = c.env.DB;
    if ((await clientInReach(c, personId)) === null) return refuse(c, "not_found");
    const invite = await inviteOf({ db, code, nameOnInvite: false });
    if (invite === null) return refuse(c, "unknown_invite");

    const staff = actorOf(c);
    const outcome = await attribute(db, {
      invite,
      personId,
      ...(await referralSourceOf(db, personId)),
      toldNotice: null,
      now: c.var.deps.now(),
      attachedBy: {
        by: staff.id,
        reason,
        audit: {
          surface: "ops",
          actor: staff,
          action: "referral.attach",
          subject: { kind: "person", id: personId },
          requestId,
          detail: { code: invite.code },
        },
      },
    });
    if (outcome.outcome === "own_invite") return refuse(c, "own_invite");
    // Ops may attach after the friend's first fit; the grant is held for their review (attached_after_fit).
    if (outcome.outcome === "fitted") throw new Error("an invite ops attach is never refused for a first fit");
    if (outcome.outcome === "already_attributed") {
      return c.json({ ...errorBody("already_invited", requestId), invite: { code: outcome.code } }, 409);
    }

    // The lead reads the invite the client now carries, and notes it (src/queues/crm-sync.ts).
    await queueCrmContact(c, personId, true);
    c.var.log.info("invite_attached", { person_id: personId });
    const attached = await clientInviteOf(db, personId);
    if (attached === null) throw new Error("the invite just attached is not there");
    return c.json(attached, 201);
  });
}
