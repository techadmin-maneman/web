// The client's profile, on the client surface (docs/decisions/0042-client-profile.md). The profile and a deletion
// request are here; each other section has its file beside it: the address (./address.ts), the consents
// (./consents.ts) and a number change (./number-change.ts).
//   GET   /api/profile
//   POST  /api/address/suggestions     buildings matching what is typed so far
//   PATCH /api/profile/address
//   PATCH /api/consents/:purpose
//   POST  /api/number-change          a code to each number
//   DELETE /api/number-change         the client withdraws it, before ops decide
//   POST  /api/number-change/verify   one number's code; with both, the change waits for ops
//   POST  /api/deletion-request
// Each consent switch is audited in the same batch as the switch, and a switch
// to the state a purpose already holds writes neither a ledger row (ADR 0058)
// nor an audit entry. A number change or deletion request is audited as it is
// made; its effect comes only with ops' decision, which is audited in turn
// (src/routes/ops/profile.ts).

import { z } from "@hono/zod-openapi";
import { lastDecidedChange, openNumberChange } from "../../domain/clients/number-change.ts";
import { consentsOf, currentAddress, liveContact, maskedMobile } from "../../domain/clients/profile.ts";
import { latestGrievances, type ShownGrievance } from "../../domain/ops/grievances.ts";
import { lastRejectedDeletion, openDeletion, requestDeletion } from "../../domain/privacy/deletion.ts";
import { clientAudit } from "../../http/audit.ts";
import { clientOf } from "../../http/client-session.ts";
import type { App } from "../../http/context.ts";
import { refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { clientRoute, signedIn } from "../../http/session-routes.ts";
import { CONSENT_PURPOSES } from "../../policy/consents.ts";
import { DECISION_SHOWN_DAYS } from "../../policy/decision-reasons.ts";
import { GRIEVANCES_SHOWN } from "../../policy/grievances.ts";
import { AddressSchema } from "../schemas/address.ts";
import { numberChangeBody, NumberChangeSchema } from "../schemas/number-change.ts";

const ProfileSchema = z
  .object({
    name: z.string(),
    mobile: z.string().openapi({ description: "Masked: +91 98xxx x4417." }),
    // A union, not .nullable(): that would make the Address component itself nullable, request bodies and all.
    address: z.union([AddressSchema, z.null()]),
    address_given_to_ops: z.union([z.iso.datetime(), z.null()]).openapi({
      description:
        "When the client gave this address to ops on the phone, who saved it for them; null for one they saved themselves.",
    }),
    consents: z
      .array(
        z
          .object({ purpose: z.enum(CONSENT_PURPOSES), granted: z.boolean(), since: z.iso.datetime().nullable() })
          .strict(),
      )
      .openapi({ description: "The five purposes, in order. Off until the client first switches one on." }),
    number_change: z.union([NumberChangeSchema, z.null()]),
    number_change_decided: z
      .union([
        z
          .object({
            state: z.enum(["confirmed", "rejected"]),
            new_mobile: z.string().openapi({ description: "Masked, as the design shows it: +91 98xxx x4417." }),
            decided_at: z.iso.datetime(),
            reason: z
              .union([z.string(), z.null()])
              .openapi({ description: "Ops' reason for a rejection, which they write knowing the client reads it." }),
          })
          .strict(),
        z.null(),
      ])
      .openapi({
        description: `What ops decided about the client's latest change of number, for ${String(DECISION_SHOWN_DAYS)} days after, while no other change is under way. A rejection once vanished from the app.`,
      }),
    deletion: z
      .object({ state: z.literal("requested"), requested_at: z.iso.datetime() })
      .strict()
      .nullable(),
    deletion_rejected: z
      .union([
        z
          .object({
            decided_at: z.iso.datetime(),
            reason: z
              .union([z.string(), z.null()])
              .openapi({ description: "Ops' reason, which they write knowing the client reads it." }),
          })
          .strict(),
        z.null(),
      ])
      .openapi({
        description: `The client's latest request to delete their account that ops rejected, for ${String(DECISION_SHOWN_DAYS)} days after, while no other request is waiting.`,
      }),
    grievances: z
      .array(
        z
          .object({
            id: z.uuid(),
            text: z.string(),
            state: z.enum(["open", "resolved"]),
            raised_at: z.iso.datetime(),
            response: z
              .union([z.string(), z.null()])
              .openapi({ description: "Ops' answer, which they write knowing the client reads it; null while open." }),
            answered_at: z.union([z.iso.datetime(), z.null()]),
          })
          .strict(),
      )
      .openapi({
        description: `The client's latest ${String(GRIEVANCES_SHOWN)} concerns about their data, newest first: every one still open, and those answered within ${String(DECISION_SHOWN_DAYS)} days.`,
      }),
  })
  .strict()
  .openapi("Profile");

const profileRoute = clientRoute({
  method: "get",
  path: "/api/profile",
  summary:
    "The profile: name, number, address, consents, any number change or deletion under way, and the latest concerns raised",
  responses: { 200: { description: "The profile", ...json(ProfileSchema) }, ...signedIn },
});

const deletionRoute = clientRoute({
  method: "post",
  path: "/api/deletion-request",
  summary: "Ask for the account to be deleted. Ops process it; asking twice makes one request",
  responses: {
    202: {
      description: "Requested",
      ...json(z.object({ state: z.literal("requested"), requested_at: z.iso.datetime() }).strict()),
    },
    ...signedIn,
  },
});

function grievanceBody(grievance: ShownGrievance) {
  return {
    id: grievance.id,
    text: grievance.text,
    state: grievance.state,
    raised_at: grievance.raisedAt,
    response: grievance.response,
    answered_at: grievance.answeredAt,
  };
}

export function registerClientProfile(app: App): void {
  app.openapi(profileRoute, async (c) => {
    const personId = clientOf(c).subjectId;
    const db = c.env.DB;
    const person = await liveContact(db, personId);
    if (person === null) return refuse(c, "session_required");

    const now = c.var.deps.now();
    const [address, consents, change, decided, deletion, deletionRejected, grievances] = await Promise.all([
      currentAddress(db, personId),
      consentsOf(db, personId),
      openNumberChange(db, personId),
      lastDecidedChange(db, personId, now),
      openDeletion(db, personId),
      lastRejectedDeletion(db, personId, now),
      latestGrievances(db, personId, now),
    ]);
    return c.json(
      {
        name: person.name,
        mobile: maskedMobile(person.mobileE164),
        address:
          address === null
            ? null
            : {
                line1: address.line1,
                line2: address.line2,
                locality: address.locality,
                city: address.city,
                pincode: address.pincode,
                access_notes: address.accessNotes,
                building: address.building,
                flat: address.flat,
                floor: address.floor,
                tower: address.tower,
                landmark: address.landmark,
                place_id: address.placeId,
              },
        address_given_to_ops: address?.givenToOps?.at ?? null,
        consents,
        number_change: change === null ? null : numberChangeBody(change),
        number_change_decided:
          change !== null || decided === null
            ? null
            : {
                state: decided.state,
                new_mobile: maskedMobile(decided.newMobileE164),
                decided_at: decided.decidedAt,
                reason: decided.reason,
              },
        deletion: deletion === null ? null : { state: "requested" as const, requested_at: deletion.createdAt },
        deletion_rejected:
          deletion !== null || deletionRejected === null
            ? null
            : { decided_at: deletionRejected.decidedAt, reason: deletionRejected.reason },
        grievances: grievances.map(grievanceBody),
      },
      200,
    );
  });
}

export function registerClientDeletionRequest(app: App): void {
  app.openapi(deletionRoute, async (c) => {
    const personId = clientOf(c).subjectId;
    const now = c.var.deps.now();
    const { request } = await requestDeletion(
      c.env.DB,
      personId,
      now,
      clientAudit(personId, c.var.requestId, { action: "deletion.request" }),
    );
    return c.json({ state: "requested" as const, requested_at: request.createdAt }, 202);
  });
}
