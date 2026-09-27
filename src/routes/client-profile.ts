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
// to the state a purpose already holds writes no ledger row (ADR 0058). A number
// change or deletion request is audited as it is made; its effect comes only
// with ops' decision, which is audited in turn (src/routes/ops-profile.ts).

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { App, AppEnv } from "../http/context.ts";
import { auditStatement, type AuditEntry } from "../domain/audit.ts";
import { alertCeilingReached, takeFromCeiling } from "../domain/ceilings.ts";
import { openDeletion, requestDeletion } from "../domain/deletion.ts";
import {
  DECISION_SHOWN_DAYS,
  lastDecidedChange,
  openNumberChange,
  startNumberChange,
  verifyNumberChange,
  withdrawNumberChange,
  type NumberChange,
} from "../domain/number-change.ts";
import {
  consentsOf,
  currentAddress,
  maskedMobile,
  saveAddress,
  switchConsent,
  type AddressPin,
} from "../domain/profile.ts";
import { takeOne } from "../domain/rate-limit.ts";
import { requireClientSession } from "../http/client-session.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { json } from "../http/openapi.ts";
import { queueContactSync } from "../http/contact-sync.ts";
import { sendCodeAfterResponse, withinCodeCeiling } from "../http/send-code.ts";
import { visitorOf } from "../http/visitor.ts";
import { indiaDate } from "../lib/india-time.ts";
import { INDIAN_MOBILE_PATTERN, toE164 } from "../lib/mobile.ts";
import type { LookupFailure } from "../providers/geocode.ts";
import { CONSENT_PURPOSES } from "../policy/consents.ts";
import { revokeCard } from "../domain/referral-cards.ts";

/** Number changes a client may start in a day. */
const NUMBER_CHANGES_PER_DAY = 3;

/** Suggestions one client may ask for in a day, so one cannot spend the global ceiling. */
const SUGGESTIONS_PER_DAY = 120;

const blankToNull = (value: string | null | undefined): string | null =>
  value === undefined || value === null || value.trim() === "" ? null : value;

/**
 * Counts one Google request against the day's ceiling; false, with one alert a
 * day, once it is reached. Every call is counted, free SKU or not: the free
 * ones are free only while the session token does its work, and a ceiling that
 * assumed that would be no ceiling at all
 * (docs/decisions/0054-address-capture.md).
 */
async function withinGeocodeCeiling(c: Context<AppEnv>, now: Date): Promise<boolean> {
  const ceiling = c.var.config.settings.geocode.dailyCeiling;
  if (await takeFromCeiling(c.env.DB, "geocode", ceiling, now)) return true;
  await alertCeilingReached(c.env.DB, c.var.deps.alert, "geocode", ceiling, now);
  return false;
}

/**
 * A lookup that failed is logged. One Google refused is ops' to put right — the
 * key, its APIs or its quota — and until then no address gets a pin, so they
 * are told, once a day while it lasts, in Google's own words.
 */
async function lookupFailed(
  c: Context<AppEnv>,
  event: string,
  failure: { reason: LookupFailure; detail: string },
): Promise<void> {
  c.var.log.warn(event, { reason: failure.reason, detail: failure.detail });
  if (failure.reason !== "refused") return;
  await c.var.deps.alertOnce({
    key: `google_refused:${indiaDate(c.var.deps.now())}`,
    message:
      `Google refused the address search (${failure.detail}). Clients can still type an address, but none gets ` +
      "a pin. Check the key, its APIs and its quotas (runbook, section 13).",
  });
}

/**
 * Nullish rather than nullable: an address saved before migration 0028 holds
 * nothing in these, and a client that predates them sends nothing. Both must
 * keep working, so leaving one out means the same as sending null.
 */
const part = (max: number) => z.string().trim().max(max).nullish();

const optional = (max: number) => z.string().trim().max(max).nullable();

const AddressSchema = z
  .object({
    line1: z.string().trim().min(1).max(120),
    line2: z.string().trim().max(120).nullable(),
    locality: z.string().trim().min(1).max(80),
    city: z.string().trim().min(1).max(40),
    pincode: z.string().regex(/^\d{6}$/),
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
 * What the app sends. `session_token` is the same string the app passed to every
 * suggestion request; it groups them into one billed session, and without it
 * Google bills per keystroke (docs/decisions/0054-address-capture.md). The
 * coordinate is never sent: only this API may put one on an address, and only
 * by geocoding the Place ID itself.
 */
const AddressSaveSchema = AddressSchema.extend({
  session_token: part(100),
})
  .strict()
  .openapi("AddressSave");

const SuggestionsSchema = z
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
  })
  .strict()
  .openapi("Profile");

const signedIn = { 401: errorResponse("session_required") };

export const profileRoute = createRoute({
  method: "get",
  path: "/api/profile",
  summary: "The profile: name, number, address, consents, and any number change or deletion under way",
  responses: { 200: { description: "The profile", ...json(ProfileSchema) }, ...signedIn },
});

// A POST, not a GET: each answer spends from Google's budget, and a GET goes with the cookie from any
// page that links to it. A POST is held to the app's own Origin, as every write is.
export const addressSuggestionsRoute = createRoute({
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

export const addressRoute = createRoute({
  method: "patch",
  path: "/api/profile/address",
  summary: "Replace the address visits go to, with its access notes",
  request: { body: { required: true, ...json(AddressSaveSchema) } },
  responses: {
    200: { description: "Saved", ...json(AddressSchema) },
    400: errorResponse("invalid_request"),
    ...signedIn,
  },
});

const ConsentSwitchSchema = z.object({ granted: z.boolean() }).strict().openapi("ConsentSwitch");

export const consentRoute = createRoute({
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
    400: errorResponse("invalid_request"),
    ...signedIn,
  },
});

export const numberChangeRoute = createRoute({
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

export const numberChangeWithdrawRoute = createRoute({
  method: "delete",
  path: "/api/number-change",
  summary: "Withdraw the number change under way, before ops decide it. With none under way, nothing happens",
  responses: { 204: { description: "Withdrawn, or there was none" }, ...signedIn },
});

export const numberChangeVerifyRoute = createRoute({
  method: "post",
  path: "/api/number-change/verify",
  summary: "One number's code. With both numbers proven, the change waits for ops to confirm",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({ request_id: z.uuid(), number: z.enum(["old", "new"]), code: z.string().regex(/^\d{6}$/) })
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

export const deletionRoute = createRoute({
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

export function registerClientProfile(app: App): void {
  for (const path of [
    "/api/profile",
    "/api/profile/*",
    // Suggestions cost money, so only a signed-in client may ask for them.
    "/api/address/suggestions",
    "/api/consents/*",
    "/api/number-change",
    "/api/number-change/*",
    "/api/deletion-request",
  ]) {
    app.use(path, requireClientSession);
  }

  /** The signed-in client, as an audit actor. */
  const audit = (personId: string, requestId: string, entry: Pick<AuditEntry, "action" | "subject" | "detail">) => ({
    surface: "client" as const,
    actor: { kind: "client" as const, id: personId },
    requestId,
    ...entry,
  });

  app.openapi(profileRoute, async (c) => {
    const personId = c.var.clientSession?.subjectId ?? "";
    const db = c.env.DB;
    const person = await db
      .prepare("SELECT name, mobile_e164 FROM people WHERE id = ?1 AND erased_at IS NULL")
      .bind(personId)
      .first<{ name: string; mobile_e164: string }>();
    if (person === null) return c.json(errorBody("session_required", c.var.requestId), 401);

    const [address, consents, change, decided, deletion] = await Promise.all([
      currentAddress(db, personId),
      consentsOf(db, personId),
      openNumberChange(db, personId),
      lastDecidedChange(db, personId, c.var.deps.now()),
      openDeletion(db, personId),
    ]);
    return c.json(
      {
        name: person.name,
        mobile: maskedMobile(person.mobile_e164),
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
      },
      200,
    );
  });

  app.openapi(addressSuggestionsRoute, async (c) => {
    const personId = c.var.clientSession?.subjectId ?? "";
    const { q, session } = c.req.valid("json");
    const now = c.var.deps.now();

    // Per client first, so one client cannot spend the day's ceiling on their own.
    const within = await takeOne(c.env.DB, {
      scope: "address_suggest",
      key: personId,
      window: indiaDate(now),
      limit: SUGGESTIONS_PER_DAY,
    });
    if (!within) return c.json(errorBody("busy", c.var.requestId), 503);
    if (!(await withinGeocodeCeiling(c, now))) return c.json(errorBody("busy", c.var.requestId), 503);

    const answer = await c.var.deps.geocode.suggest(q, session);
    if (!answer.ok) {
      // The form carries on without suggestions: an address can always be typed.
      await lookupFailed(c, "address_suggest_failed", answer);
      return c.json(errorBody("unavailable", c.var.requestId), 503);
    }
    return c.json(
      {
        suggestions: answer.suggestions.map((one) => ({
          place_id: one.placeId,
          primary: one.primary,
          secondary: one.secondary,
        })),
        attribution: "Google Maps" as const,
      },
      200,
    );
  });

  app.openapi(addressRoute, async (c) => {
    const personId = c.var.clientSession?.subjectId ?? "";
    const body = c.req.valid("json");
    const now = c.var.deps.now();

    // A chosen building is geocoded here, once, and its coordinate kept. A typed
    // address has no Place ID and saves no pin: the geofence then measures
    // nothing rather than measuring zero (ADR 0036's honest degradation).
    let pin: AddressPin | null = null;
    const placeId = blankToNull(body.place_id);
    if (placeId !== null && (await withinGeocodeCeiling(c, now))) {
      const resolved = await c.var.deps.geocode.resolve(
        placeId,
        blankToNull(body.session_token) ?? crypto.randomUUID(),
      );
      if (resolved.ok) pin = { lat: resolved.place.lat, lng: resolved.place.lng, source: "google_geocoding" };
      else await lookupFailed(c, "address_resolve_failed", resolved);
    }

    const address = {
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
      placeId,
    };
    await saveAddress(c.env.DB, personId, address, pin, now);
    await queueContactSync(c, personId);
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
    const personId = c.var.clientSession?.subjectId ?? "";
    const { purpose } = c.req.valid("param");
    const { granted } = c.req.valid("json");
    const now = c.var.deps.now();
    const db = c.env.DB;
    const [switched] = await db.batch<{ created_at: string }>([
      switchConsent(db, { personId, purpose, granted, ipHash: (await visitorOf(c)).ipHash, now }),
      auditStatement(
        db,
        audit(personId, c.var.requestId, { action: "consent.switch", detail: { purpose, granted } }),
        now,
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
    const personId = c.var.clientSession?.subjectId ?? "";
    const db = c.env.DB;
    const now = deps.now();

    const newMobile = toE164(c.req.valid("json").new_mobile);
    const current = await db
      .prepare("SELECT mobile_e164 FROM people WHERE id = ?1")
      .bind(personId)
      .first<string>("mobile_e164");
    if (newMobile === null || newMobile === current)
      return c.json(errorBody("invalid_request", requestId, ["new_mobile"]), 400);

    const allowed = await takeOne(db, {
      scope: "number_change:person",
      key: personId,
      window: indiaDate(now),
      limit: NUMBER_CHANGES_PER_DAY,
    });
    if (!allowed) return c.json(errorBody("rate_limited", requestId), 429);
    if (!(await withinCodeCeiling(c, now)) || !(await withinCodeCeiling(c, now))) {
      return c.json(errorBody("busy", requestId), 503);
    }

    const started = await startNumberChange(db, {
      personId,
      newMobileE164: newMobile,
      pepper: config.settings.login.codePepper,
      audit: audit(personId, requestId, { action: "number_change.request" }),
      now,
      fixedCode: config.settings.login.fixedCode,
    });
    await sendCodeAfterResponse(c, current, "whatsapp", started.codes.old.code);
    await sendCodeAfterResponse(c, newMobile, "whatsapp", started.codes.new.code);
    const expiresIn = Math.round((started.codes.new.challenge.expiresAt.getTime() - now.getTime()) / 1000);
    return c.json({ request_id: started.change.id, expires_in_s: expiresIn }, 202);
  });

  app.openapi(numberChangeWithdrawRoute, async (c) => {
    const personId = c.var.clientSession?.subjectId ?? "";
    await withdrawNumberChange(c.env.DB, {
      personId,
      audit: audit(personId, c.var.requestId, { action: "number_change.withdraw" }),
      now: c.var.deps.now(),
    });
    return c.body(null, 204);
  });

  app.openapi(numberChangeVerifyRoute, async (c) => {
    const { requestId, deps, config } = c.var;
    const personId = c.var.clientSession?.subjectId ?? "";
    const { request_id: id, number, code } = c.req.valid("json");
    const change = await openNumberChange(c.env.DB, personId);
    if (change?.id !== id) return c.json(errorBody("code_expired", requestId), 410);

    const result = await verifyNumberChange(c.env.DB, {
      change,
      which: number,
      code,
      pepper: config.settings.login.codePepper,
      now: deps.now(),
    });
    if (result.verification.outcome === "closed") return c.json(errorBody("code_expired", requestId), 410);
    const attemptsLeft = result.verification.outcome === "mismatch" ? result.verification.attemptsLeft : null;
    return c.json({ ...numberChangeBody(result.change), attempts_left: attemptsLeft }, 200);
  });

  app.openapi(deletionRoute, async (c) => {
    const personId = c.var.clientSession?.subjectId ?? "";
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
