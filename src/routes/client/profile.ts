// The client's profile, on the client surface (docs/decisions/0042-client-profile.md):
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

import { clientRoute } from "../../http/session-routes.ts";
import { z } from "@hono/zod-openapi";
import type { App } from "../../http/context.ts";
import { addressChangeRefusal } from "../../domain/address-change.ts";
import { auditStatementIfWritten, type AuditEntry } from "../../domain/audit.ts";
import { lastRejectedDeletion, openDeletion, requestDeletion } from "../../domain/deletion.ts";
import {
  lastDecidedChange,
  openNumberChange,
  startNumberChange,
  verifyNumberChange,
  withdrawNumberChange,
  type NumberChange,
} from "../../domain/number-change.ts";
import { switchNotice } from "../../config/notices.ts";
import { recordConsent } from "../../domain/consents.ts";
import { consentsOf, currentAddress, liveContact, maskedMobile, type Address } from "../../domain/profile.ts";
import { takeOne } from "../../domain/rate-limit.ts";
import { clientOf } from "../../http/client-session.ts";
import { errorBody, errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { saveClientAddress, suggestBuildings } from "../../http/address-save.ts";
import { numberChangeCodes, sendCodeAfterResponse, withinCodeCeiling } from "../../http/send-code.ts";
import { visitorOf } from "../../http/visitor.ts";
import { INDIAN_MOBILE_PATTERN, toE164 } from "../../lib/mobile.ts";
import { APP_SWITCH_SOURCES, CONSENT_PURPOSES, screenAsks } from "../../policy/consents.ts";
import { DECISION_SHOWN_DAYS } from "../../policy/decision-reasons.ts";
import { CODE_TEXT } from "../../policy/one-time-code.ts";
import { GRIEVANCES_SHOWN } from "../../policy/grievances.ts";
import { latestGrievances, type ShownGrievance } from "../../domain/grievances.ts";
import { revokeCard } from "../../domain/referral-cards.ts";

const blankToNull = (value: string | null | undefined): string | null =>
  value === undefined || value === null || value.trim() === "" ? null : value;

/**
 * Nullish rather than nullable: an address saved before migration 0028 holds
 * nothing in these, and a client that predates them sends nothing. Both must
 * keep working, so leaving one out means the same as sending null.
 */
const part = (max: number) => z.string().trim().max(max).nullish();

const optional = (max: number) => z.string().trim().max(max).nullable();

/** The one address shape, which the site's booking forms take too (src/routes/public/consultations.ts). */
export const AddressSchema = z
  .object({
    line1: z.string().trim().min(1).max(120),
    line2: z.string().trim().max(120).nullable(),
    locality: z.string().trim().min(1).max(80),
    city: z.string().trim().min(1).max(40),
    pincode: z.string().regex(CODE_TEXT),
    access_notes: optional(300).openapi({
      description: "For the technician, from the day before the visit: gate code, parking.",
    }),
    building: part(120).openapi({ description: "The building as chosen from the suggestions; null if typed." }),
    flat: part(40),
    floor: part(20),
    tower: part(40),
    landmark: part(120),
    place_id: part(300).openapi({ description: "Google's Place ID for the building, if one was chosen." }),
  })
  .strict()
  .openapi("Address");

/**
 * The flat or house number, which every address given from now on must carry, so the technician finds the door
 * (the owner's ruling of 27 September 2026, docs/open-points.md, items 45 and 150). An address saved before holds
 * none and still reads.
 */
export const RequiredFlatSchema = z.string().trim().min(1).max(40);

/**
 * What the app sends. `session_token` is the same string the app passed to every
 * suggestion request; it groups them into one billed session, and without it
 * Google bills per keystroke (docs/decisions/0054-address-capture.md). The
 * coordinate is never sent: only this API may put one on an address, and only
 * by geocoding the Place ID itself.
 */
export const AddressSaveSchema = AddressSchema.extend({
  flat: RequiredFlatSchema,
  session_token: part(100),
})
  .strict()
  .openapi("AddressSave");

export const SuggestionsSchema = z
  .object({
    suggestions: z.array(z.object({ place_id: z.string(), primary: z.string(), secondary: z.string() }).strict()),
    /** Google requires their name against content shown without a Google map. */
    attribution: z.literal("Google Maps"),
  })
  .strict()
  .openapi("AddressSuggestions");

const NumberChangeSchema = z
  .object({
    request_id: z.uuid(),
    state: z.enum(["verifying", "awaiting_ops"]),
    new_mobile: z.string().openapi({ description: "Masked, as the design shows it: +91 98xxx x4417." }),
    old_verified: z.boolean(),
    new_verified: z.boolean(),
  })
  .strict()
  .openapi("NumberChange");

export const ProfileSchema = z
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
        description: `What ops decided about the client's latest change of number, for ${String(DECISION_SHOWN_DAYS)} days after, while no other change is under way. A rejection once vanished from the app (OPS-09).`,
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

/** An address as it was sent, a part left blank held as none. */
export function addressOf(body: z.infer<typeof AddressSchema>): Address {
  return {
    line1: body.line1,
    line2: blankToNull(body.line2),
    locality: body.locality,
    city: body.city,
    pincode: body.pincode,
    accessNotes: blankToNull(body.access_notes),
    building: blankToNull(body.building),
    flat: blankToNull(body.flat),
    floor: blankToNull(body.floor),
    tower: blankToNull(body.tower),
    landmark: blankToNull(body.landmark),
    placeId: blankToNull(body.place_id),
  };
}

const signedIn = { 401: errorResponse("session_required") };

export const profileRoute = clientRoute({
  method: "get",
  path: "/api/profile",
  summary:
    "The profile: name, number, address, consents, any number change or deletion under way, and the latest concerns raised",
  responses: { 200: { description: "The profile", ...json(ProfileSchema) }, ...signedIn },
});

// A POST, not a GET: each answer spends from Google's budget, and a GET goes with the cookie from any
// page that links to it. A POST is held to the app's own Origin, as every write is.
export const addressSuggestionsRoute = clientRoute({
  method: "post",
  path: "/api/address/suggestions",
  summary: "Buildings matching what the client has typed, for the address form",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({
            q: z.string().trim().min(1).max(200).openapi({ description: "What the client has typed so far." }),
            session: z
              .string()
              .trim()
              .min(1)
              .max(100)
              .openapi({ description: "One token for the whole search, sent again when the address is saved." }),
          })
          .strict()
          .openapi("AddressSuggestionsAsk"),
      ),
    },
  },
  responses: {
    200: { description: "The suggestions, which may be empty", ...json(SuggestionsSchema) },
    400: errorResponse("invalid_request"),
    503: errorResponse("busy: today's address-lookup ceiling is reached; unavailable: Google could not be reached"),
    ...signedIn,
  },
});

export const addressRoute = clientRoute({
  method: "patch",
  path: "/api/profile/address",
  summary: "Replace the address visits go to, with its access notes",
  request: { body: { required: true, ...json(AddressSaveSchema) } },
  responses: {
    200: { description: "Saved", ...json(AddressSchema) },
    400: errorResponse("invalid_request"),
    409: errorResponse("visit_booked: a visit still to come is in another city, which the address may not leave"),
    422: errorResponse("not_served: the pincode is not one we come to"),
    ...signedIn,
  },
});

const ConsentSwitchSchema = z
  .object({
    granted: z.boolean(),
    source: z.enum(APP_SWITCH_SOURCES).optional().openapi({
      description:
        "The app's screen the switch was made on: the profile (any purpose), the booking sheet (whatsapp_visits) or the share sheet (photos_referral_cards). Kept on the consent; one sent without it is kept with no place, and one that does not ask for the purpose is refused.",
    }),
  })
  .strict()
  .openapi("ConsentSwitch");

export const consentRoute = clientRoute({
  method: "patch",
  path: "/api/consents/{purpose}",
  summary: "Switch one consent on or off. Each switch is kept, with its date; a repeat is not a switch",
  request: {
    params: z.object({ purpose: z.enum(CONSENT_PURPOSES) }),
    body: { required: true, ...json(ConsentSwitchSchema) },
  },
  responses: {
    200: {
      description: "Switched",
      ...json(z.object({ purpose: z.enum(CONSENT_PURPOSES), granted: z.boolean(), since: z.iso.datetime() }).strict()),
    },
    400: errorResponse("invalid_request: the screen named does not ask for this purpose"),
    ...signedIn,
  },
});

export const numberChangeRoute = clientRoute({
  method: "post",
  path: "/api/number-change",
  summary: "Start a number change: a code goes to both numbers. Starting again withdraws the last one",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({ new_mobile: z.string().regex(INDIAN_MOBILE_PATTERN) })
          .strict()
          .openapi("NumberChangeStart"),
      ),
    },
  },
  responses: {
    202: {
      description: "Codes on their way to both numbers",
      ...json(z.object({ request_id: z.uuid(), expires_in_s: z.number().int() }).strict()),
    },
    400: errorResponse("invalid_request: not an Indian mobile number, or the number already in use here"),
    429: errorResponse("rate_limited: three changes a day"),
    503: errorResponse("busy"),
    ...signedIn,
  },
});

export const numberChangeWithdrawRoute = clientRoute({
  method: "delete",
  path: "/api/number-change",
  summary: "Withdraw the number change under way, before ops decide it. With none under way, nothing happens",
  responses: { 204: { description: "Withdrawn, or there was none" }, ...signedIn },
});

export const numberChangeVerifyRoute = clientRoute({
  method: "post",
  path: "/api/number-change/verify",
  summary: "One number's code. With both numbers proven, the change waits for ops to confirm",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({ request_id: z.uuid(), number: z.enum(["old", "new"]), code: z.string().regex(CODE_TEXT) })
          .strict()
          .openapi("NumberChangeVerify"),
      ),
    },
  },
  responses: {
    200: {
      description: "Checked. attempts_left is null when the code was right",
      ...json(NumberChangeSchema.extend({ attempts_left: z.number().int().nullable() }).strict()),
    },
    410: errorResponse("code_expired: the code or the change is closed; start again"),
    ...signedIn,
  },
});

export const deletionRoute = clientRoute({
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

function numberChangeBody(change: NumberChange) {
  return {
    request_id: change.id,
    state: change.state === "awaiting_ops" ? ("awaiting_ops" as const) : ("verifying" as const),
    new_mobile: maskedMobile(change.newMobileE164),
    old_verified: change.oldVerified,
    new_verified: change.newVerified,
  };
}

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
  /** The signed-in client, as an audit actor. */
  const audit = (personId: string, requestId: string, entry: Pick<AuditEntry, "action" | "subject" | "detail">) => ({
    surface: "client" as const,
    actor: { kind: "client" as const, id: personId },
    requestId,
    ...entry,
  });

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

  app.openapi(addressSuggestionsRoute, async (c) => {
    const { q, session } = c.req.valid("json");
    const answer = await suggestBuildings(c, {
      limitScope: "address_suggest",
      asker: clientOf(c).subjectId,
      q,
      session,
    });
    if (!answer.ok) return c.json(errorBody(answer.code, c.var.requestId), 503);
    return c.json({ suggestions: answer.suggestions, attribution: "Google Maps" as const }, 200);
  });

  app.openapi(addressRoute, async (c) => {
    const personId = clientOf(c).subjectId;
    const body = c.req.valid("json");
    const address = addressOf(body);
    const refusal = await addressChangeRefusal(c.env.DB, personId, address.pincode);
    if (refusal === "not_served") return refuse(c, "not_served");
    if (refusal === "visit_booked") return refuse(c, "visit_booked");
    await saveClientAddress(c, {
      personId,
      address,
      sessionToken: body.session_token,
      givenToOps: null,
    });
    return c.json(
      {
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
      200,
    );
  });

  app.openapi(consentRoute, async (c) => {
    const personId = clientOf(c).subjectId;
    const { purpose } = c.req.valid("param");
    const { granted, source = null } = c.req.valid("json");
    // A screen is kept against a consent only if it asks for it (docs/decisions/0094-where-a-consent-was-given.md).
    if (source !== null && !screenAsks(source, purpose)) {
      return refuse(c, "invalid_request", ["source"]);
    }
    const now = c.var.deps.now();
    const db = c.env.DB;
    const consent = recordConsent(db, {
      person: { id: personId },
      purpose,
      granted,
      notice: switchNotice(purpose, source),
      source,
      rule: "if_changed",
      ipHash: (await visitorOf(c)).ipHash,
      givenAt: now.toISOString(),
    });
    const [switched] = await db.batch<{ created_at: string }>([
      consent.statement,
      auditStatementIfWritten(
        db,
        audit(personId, c.var.requestId, { action: "consent.switch", detail: { purpose, granted } }),
        now,
        { table: "consents", id: consent.id },
      ),
    ]);
    // "You can switch it off at any time, and new opens will show our house example instead."
    if (purpose === "photos_referral_cards" && !granted) await revokeCard(db, c.env.REFERRAL_CARDS, personId, now);
    // A request that changed nothing is answered with the date the ledger holds, not with its own
    // moment: the client is told when they agreed, which is not necessarily now (ADR 0058).
    const written = switched?.results[0]?.created_at;
    const since = written ?? (await consentsOf(db, personId)).find((one) => one.purpose === purpose)?.since;
    return c.json({ purpose, granted, since: since ?? now.toISOString() }, 200);
  });

  app.openapi(numberChangeRoute, async (c) => {
    const { requestId, deps, config } = c.var;
    const personId = clientOf(c).subjectId;
    const db = c.env.DB;
    const now = deps.now();

    const newMobile = toE164(c.req.valid("json").new_mobile);
    // A live session's person is never erased: the erasure ends their sessions.
    const contact = await liveContact(db, personId);
    const current = contact?.mobileE164 ?? null;
    if (newMobile === null || newMobile === current) return refuse(c, "invalid_request", ["new_mobile"]);

    const allowed = await takeOne(db, "number_change:person", personId, { now, settings: config.settings });
    if (!allowed) return refuse(c, "rate_limited");
    if (!(await withinCodeCeiling(c, now)) || !(await withinCodeCeiling(c, now))) {
      return refuse(c, "busy");
    }

    const testRecord = contact?.testRecord ?? false;
    const started = await startNumberChange(db, {
      personId,
      sessionId: clientOf(c).id,
      newMobileE164: newMobile,
      pepper: config.settings.login.codePepper,
      audit: audit(personId, requestId, { action: "number_change.request" }),
      now,
      knownCodes: numberChangeCodes(config.settings.login, testRecord),
    });
    await sendCodeAfterResponse(c, current, testRecord, "whatsapp", started.codes.old.code);
    await sendCodeAfterResponse(c, newMobile, testRecord, "whatsapp", started.codes.new.code);
    const expiresIn = Math.round((started.codes.new.challenge.expiresAt.getTime() - now.getTime()) / 1000);
    return c.json({ request_id: started.change.id, expires_in_s: expiresIn }, 202);
  });

  app.openapi(numberChangeWithdrawRoute, async (c) => {
    const personId = clientOf(c).subjectId;
    await withdrawNumberChange(c.env.DB, {
      personId,
      audit: audit(personId, c.var.requestId, { action: "number_change.withdraw" }),
      now: c.var.deps.now(),
    });
    return c.body(null, 204);
  });

  app.openapi(numberChangeVerifyRoute, async (c) => {
    const { deps, config } = c.var;
    const personId = clientOf(c).subjectId;
    const { request_id: id, number, code } = c.req.valid("json");
    const change = await openNumberChange(c.env.DB, personId);
    if (change?.id !== id) return refuse(c, "code_expired");

    const result = await verifyNumberChange(c.env.DB, {
      change,
      which: number,
      code,
      pepper: config.settings.login.codePepper,
      now: deps.now(),
    });
    if (result.verification.outcome === "closed") return refuse(c, "code_expired");
    const attemptsLeft = result.verification.outcome === "mismatch" ? result.verification.attemptsLeft : null;
    return c.json({ ...numberChangeBody(result.change), attempts_left: attemptsLeft }, 200);
  });

  app.openapi(deletionRoute, async (c) => {
    const personId = clientOf(c).subjectId;
    const now = c.var.deps.now();
    const { request } = await requestDeletion(
      c.env.DB,
      personId,
      now,
      audit(personId, c.var.requestId, { action: "deletion.request" }),
    );
    return c.json({ state: "requested" as const, requested_at: request.createdAt }, 202);
  });
}
