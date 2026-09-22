// The client's profile, on the client surface (docs/decisions/0042-client-profile.md):
//   GET   /api/profile
//   PATCH /api/profile/address
//   PATCH /api/consents/:purpose
//   POST  /api/number-change          a code to each number
//   POST  /api/number-change/verify   one number's code; with both, the change waits for ops
//   POST  /api/deletion-request
// Each consent switch is audited in the same batch as the switch. A number
// change or deletion request is audited as it is made; its effect comes only
// with ops' decision, which is audited in turn (src/routes/ops-profile.ts).

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../app.ts";
import { auditStatement, recordAudit, type AuditEntry } from "../domain/audit.ts";
import { openDeletion, requestDeletion } from "../domain/deletion.ts";
import { openNumberChange, startNumberChange, verifyNumberChange, type NumberChange } from "../domain/number-change.ts";
import { consentsOf, currentAddress, maskedMobile, saveAddress, switchConsent } from "../domain/profile.ts";
import { takeOne } from "../domain/rate-limit.ts";
import { requireClientSession } from "../http/client-session.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { sendCodeAfterResponse, withinCodeCeiling } from "../http/send-code.ts";
import { visitorOf } from "../http/visitor.ts";
import { indiaDate } from "../lib/india-time.ts";
import { INDIAN_MOBILE_PATTERN, toE164 } from "../lib/mobile.ts";
import { CONSENT_PURPOSES } from "../policy/consents.ts";

/** Number changes a client may start in a day. */
const NUMBER_CHANGES_PER_DAY = 3;

const AddressSchema = z
  .object({
    line1: z.string().trim().min(1).max(120),
    line2: z.string().trim().max(120).nullable(),
    locality: z.string().trim().min(1).max(80),
    city: z.string().trim().min(1).max(40),
    pincode: z.string().regex(/^\d{6}$/),
    access_notes: z
      .string()
      .trim()
      .max(300)
      .nullable()
      .openapi({ description: "For the technician, from the day before the visit: gate code, parking." }),
  })
  .strict()
  .openapi("Address");

const NumberChangeSchema = z
  .object({
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
    address: AddressSchema.nullable(),
    consents: z
      .array(
        z
          .object({ purpose: z.enum(CONSENT_PURPOSES), granted: z.boolean(), since: z.iso.datetime().nullable() })
          .strict(),
      )
      .openapi({ description: "The five purposes, in order. Off until the client first switches one on." }),
    number_change: NumberChangeSchema.nullable(),
    deletion: z
      .object({ state: z.literal("requested"), requested_at: z.iso.datetime() })
      .strict()
      .nullable(),
  })
  .strict()
  .openapi("Profile");

const json = <T extends z.ZodType>(schema: T) => ({ content: { "application/json": { schema } } });
const signedIn = { 401: errorResponse("session_required") };

export const profileRoute = createRoute({
  method: "get",
  path: "/api/profile",
  summary: "The profile: name, number, address, consents, and any number change or deletion under way",
  responses: { 200: { description: "The profile", ...json(ProfileSchema) }, ...signedIn },
});

export const addressRoute = createRoute({
  method: "patch",
  path: "/api/profile/address",
  summary: "Replace the address visits go to, with its access notes",
  request: { body: { required: true, ...json(AddressSchema) } },
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
  summary: "Switch one consent on or off. Each switch is kept, with its date",
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

    const [address, consents, change, deletion] = await Promise.all([
      currentAddress(db, personId),
      consentsOf(db, personId),
      openNumberChange(db, personId),
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
              },
        consents,
        number_change: change === null ? null : numberChangeBody(change),
        deletion: deletion === null ? null : { state: "requested" as const, requested_at: deletion.createdAt },
      },
      200,
    );
  });

  app.openapi(addressRoute, async (c) => {
    const personId = c.var.clientSession?.subjectId ?? "";
    const body = c.req.valid("json");
    await saveAddress(
      c.env.DB,
      personId,
      {
        line1: body.line1,
        line2: body.line2 === "" ? null : body.line2,
        locality: body.locality,
        city: body.city,
        pincode: body.pincode,
        accessNotes: body.access_notes === "" ? null : body.access_notes,
      },
      c.var.deps.now(),
    );
    return c.json(body, 200);
  });

  app.openapi(consentRoute, async (c) => {
    const personId = c.var.clientSession?.subjectId ?? "";
    const { purpose } = c.req.valid("param");
    const { granted } = c.req.valid("json");
    const now = c.var.deps.now();
    const db = c.env.DB;
    await db.batch([
      switchConsent(db, { personId, purpose, granted, ipHash: (await visitorOf(c)).ipHash, now }),
      auditStatement(
        db,
        audit(personId, c.var.requestId, { action: "consent.switch", detail: { purpose, granted } }),
        now,
      ),
    ]);
    return c.json({ purpose, granted, since: now.toISOString() }, 200);
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
      now,
      fixedCode: config.settings.login.fixedCode,
    });
    await recordAudit(
      db,
      audit(personId, requestId, {
        action: "number_change.request",
        subject: { kind: "number_change", id: started.change.id },
      }),
      now,
    );
    await sendCodeAfterResponse(c, current, "whatsapp", started.codes.old.code);
    await sendCodeAfterResponse(c, newMobile, "whatsapp", started.codes.new.code);
    const expiresIn = Math.round((started.codes.new.challenge.expiresAt.getTime() - now.getTime()) / 1000);
    return c.json({ request_id: started.change.id, expires_in_s: expiresIn }, 202);
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
    const { request, created } = await requestDeletion(c.env.DB, personId, now);
    if (created) {
      await recordAudit(
        c.env.DB,
        audit(personId, c.var.requestId, { action: "deletion.request", subject: { kind: "deletion", id: request.id } }),
        now,
      );
    }
    return c.json({ state: "requested" as const, requested_at: request.createdAt }, 202);
  });
}
