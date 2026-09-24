// One client's record on the ops surface behind Access (Ops Console, B1 to B3;
// docs/decisions/0031-access-and-audit.md):
//   POST /api/clients/search               find a client by mobile number
//   GET  /api/clients/:id                  who they are, their address, their visits, their payments and their history
//   GET  /api/clients/:id/photos           which photographs exist, by visit. No links: this is the locked view
//   GET  /api/clients/:id/photos/:photoId  one photograph, audited before its bytes leave
//   GET  /api/clients/:id/consents         every consent with its notice version and date, and any deletion request
//
// A client is always found by their ID. The number is searched for in a request
// body, never in a path, so that it stays out of URLs, referrers and logs.
//
// The records are the ones the client reads of themselves, through the same
// domain functions, so the two surfaces cannot drift apart. An erased person is
// "not found" here: their photographs, address and details are gone (ADR 0049),
// and what is kept of them is a record for the deletion queue, not a page to read.

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../app.ts";
import { VISIT_TYPES } from "../config/visit-types.ts";
import { actorOf, recordAudit } from "../domain/audit.ts";
import {
  CLIENT_STATES,
  clientStateOf,
  isFitted,
  listVisits,
  ownPhotoKey,
  visitOutcomes,
} from "../domain/client-visits.ts";
import { creditBalance } from "../domain/credits.ts";
import { consentRecordsOf, currentAddress } from "../domain/profile.ts";
import { ANGLES, PHASES } from "../domain/visit-photos.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { indiaDate } from "../lib/india-time.ts";
import { INDIAN_MOBILE_PATTERN, toE164 } from "../lib/mobile.ts";
import { CONSENT_PURPOSES } from "../policy/consents.ts";
import { clientHistory } from "../domain/client-history.ts";
import { EntrySchema, paymentEntries } from "./client-payments.ts";
import { HISTORY_FIGURES, VisitSummarySchema } from "./client-visits.ts";

const json = <T extends z.ZodType>(schema: T) => ({ content: { "application/json": { schema } } });
const clientId = z.object({ id: z.uuid() });
const unknownClient = errorResponse("not_found: no such client, or the client has been erased");

const AddressSchema = z
  .object({
    line1: z.string(),
    line2: z.union([z.string(), z.null()]),
    locality: z.string(),
    city: z.string(),
    pincode: z.string(),
    access_notes: z
      .union([z.string(), z.null()])
      .openapi({ description: "For the technician: gate code, parking and the like." }),
  })
  .strict()
  .openapi("ClientAddress");

const ClientVisitSchema = VisitSummarySchema.extend({
  outcome: z
    .union([z.enum(["done", "partial"]), z.null()])
    .openapi({ description: "What FSM closed the visit as; null until it is closed." }),
}).openapi("ClientVisit");

/**
 * The same derivation the client reads of themselves, with the replacement's
 * own day beside the month: ops order a piece against a date, and the board's
 * task queue already names one (src/domain/tasks.ts).
 */
const OpsHistorySchema = z
  .object({
    ...HISTORY_FIGURES,
    replacement_due: z
      .union([z.object({ on: z.iso.date(), month: z.string(), piece_code: z.string() }).strict(), z.null()])
      .openapi({ description: "When the piece now in wear falls due; null when the client is wearing none." }),
  })
  .strict()
  .openapi("ClientRecordHistory");

const ClientRecordSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    mobile: z.string().openapi({ description: "E.164, as ops need it to call or message." }),
    state: z.enum(CLIENT_STATES),
    known_since: z.iso.datetime().openapi({ description: "When the person's record was first written." }),
    address: z.union([AddressSchema, z.null()]).openapi({ description: "The address visits go to now." }),
    credits: z
      .union([z.object({ visits: z.number().int(), earliest_expiry: z.iso.datetime().nullable() }).strict(), z.null()])
      .openapi({ description: "Service visits left and when the soonest expires; null with none left." }),
    visits: z
      .object({ upcoming: z.array(ClientVisitSchema), past: z.array(ClientVisitSchema) })
      .strict()
      .openapi({ description: "Upcoming soonest first; past newest first." }),
    payments: z.array(EntrySchema).openapi({ description: "Payments and refunds as one list, newest first." }),
    history: OpsHistorySchema,
  })
  .strict()
  .openapi("ClientRecord");

const PhotoSchema = z
  .object({
    id: z.uuid().openapi({ description: "For GET /api/clients/{id}/photos/{photo_id}, which is audited." }),
    phase: z.enum(PHASES),
    angle: z.enum(ANGLES),
    width: z.union([z.number().int(), z.null()]),
    height: z.union([z.number().int(), z.null()]),
    taken_at: z.iso.datetime(),
  })
  .strict()
  .openapi("ClientPhoto");

const ClientPhotosSchema = z
  .object({
    visits: z.array(
      z
        .object({
          visit_id: z.uuid(),
          date: z.iso.date(),
          type: z.union([z.enum(VISIT_TYPES), z.null()]),
          technician: z.union([z.object({ name: z.string(), initials: z.string() }).strict(), z.null()]),
          photos: z.array(PhotoSchema).openapi({ description: "Before then after, each in the design's angle order." }),
        })
        .strict(),
    ),
  })
  .strict()
  .openapi("ClientPhotos");

const ClientConsentsSchema = z
  .object({
    consents: z.array(
      z
        .object({
          purpose: z.enum(CONSENT_PURPOSES),
          state: z.enum(["given", "withdrawn", "not_given"]).openapi({
            description: "not_given until the client first switches it on; withdrawn once they switch it back off.",
          }),
          notice_version: z
            .union([z.string(), z.null()])
            .openapi({ description: "The notice the client saw when they last switched it." }),
          at: z.union([z.iso.datetime(), z.null()]).openapi({ description: "When they last switched it." }),
        })
        .strict(),
    ),
    deletion: z
      .union([
        z
          .object({
            id: z.uuid(),
            state: z.enum(["requested", "rejected"]),
            requested_at: z.iso.datetime(),
            decided_at: z.union([z.iso.datetime(), z.null()]),
          })
          .strict(),
        z.null(),
      ])
      .openapi({ description: "Their latest deletion request. A processed one leaves no client to read." }),
  })
  .strict()
  .openapi("ClientConsents");

const searchRoute = createRoute({
  method: "post",
  path: "/api/clients/search",
  summary: "Find a client by mobile number. A POST, so the number stays out of the URL",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({ mobile: z.string().regex(INDIAN_MOBILE_PATTERN) })
          .strict()
          .openapi("ClientSearch"),
      ),
    },
  },
  responses: {
    200: {
      description: "The client, to open their page with",
      ...json(z.object({ id: z.uuid(), name: z.string(), mobile: z.string() }).strict()),
    },
    400: errorResponse("invalid_request: not an Indian mobile number"),
    404: unknownClient,
  },
});

const recordRoute = createRoute({
  method: "get",
  path: "/api/clients/{id}",
  summary: "The client's record: who they are, their address, their visits, their payments and their history",
  request: { params: clientId },
  responses: { 200: { description: "The record", ...json(ClientRecordSchema) }, 404: unknownClient },
});

const photosRoute = createRoute({
  method: "get",
  path: "/api/clients/{id}/photos",
  summary: "Which photographs the client has, by visit, newest first. No image is served here",
  request: { params: clientId },
  responses: { 200: { description: "Visits that have photographs", ...json(ClientPhotosSchema) }, 404: unknownClient },
});

const photoRoute = createRoute({
  method: "get",
  path: "/api/clients/{id}/photos/{photo_id}",
  summary: "One of the client's photographs. The audit entry is written before the image is",
  request: { params: clientId.extend({ photo_id: z.uuid() }) },
  responses: {
    200: {
      description: "The image",
      content: { "image/jpeg": { schema: z.string() }, "image/png": { schema: z.string() } },
    },
    404: errorResponse("not_found: no such photograph of this client's"),
    503: errorResponse("unavailable: the view could not be audited, so no photograph is served"),
  },
});

const consentsRoute = createRoute({
  method: "get",
  path: "/api/clients/{id}/consents",
  summary: "The client's consents and any deletion request. Ops read them and never grant one",
  request: { params: clientId },
  responses: { 200: { description: "Consents and data", ...json(ClientConsentsSchema) }, 404: unknownClient },
});

interface PersonRow {
  id: string;
  name: string;
  mobile_e164: string;
  created_at: string;
}

/** The client by ID, or null when there is no such person or they have been erased. */
function clientById(db: D1Database, id: string): Promise<PersonRow | null> {
  return db
    .prepare("SELECT id, name, mobile_e164, created_at FROM people WHERE id = ?1 AND erased_at IS NULL")
    .bind(id)
    .first<PersonRow>();
}

interface PhotoListRow {
  id: string;
  appointment_id: string;
  window_start: string;
  type: (typeof VISIT_TYPES)[number] | null;
  technician_name: string | null;
  technician_initials: string | null;
  phase: (typeof PHASES)[number];
  angle: (typeof ANGLES)[number];
  width: number | null;
  height: number | null;
  taken_at: string;
}

export function registerOpsClients(app: App): void {
  app.openapi(searchRoute, async (c) => {
    const mobile = toE164(c.req.valid("json").mobile);
    if (mobile === null) return c.json(errorBody("invalid_request", c.var.requestId, ["mobile"]), 400);
    const person = await c.env.DB.prepare(
      "SELECT id, name, mobile_e164, created_at FROM people WHERE mobile_e164 = ?1 AND erased_at IS NULL",
    )
      .bind(mobile)
      .first<PersonRow>();
    if (person === null) return c.json(errorBody("not_found", c.var.requestId), 404);
    return c.json({ id: person.id, name: person.name, mobile: person.mobile_e164 }, 200);
  });

  app.openapi(recordRoute, async (c) => {
    const { id } = c.req.valid("param");
    const db = c.env.DB;
    const person = await clientById(db, id);
    if (person === null) return c.json(errorBody("not_found", c.var.requestId), 404);

    const now = c.var.deps.now();
    const [address, credits, visits, fitted, payments, history, proposal] = await Promise.all([
      currentAddress(db, id),
      creditBalance(db, id, now),
      listVisits(db, id, now),
      isFitted(db, id),
      paymentEntries(db, id),
      clientHistory(db, id),
      // A Phase 1 booking still waiting for FSM makes the person a lead, as it does on /api/me.
      db
        .prepare("SELECT 1 FROM leads WHERE person_id = ?1 AND proposed_visit_date IS NOT NULL LIMIT 1")
        .bind(id)
        .first(),
    ]);
    const outcomes = await visitOutcomes(
      db,
      [...visits.upcoming, ...visits.past].map((visit) => visit.id),
    );
    const withOutcome = (list: typeof visits.upcoming) =>
      list.map((visit) => ({ ...visit, outcome: outcomes.get(visit.id) ?? null }));

    return c.json(
      {
        id: person.id,
        name: person.name,
        mobile: person.mobile_e164,
        state: clientStateOf(fitted, visits.upcoming.length > 0 || proposal !== null),
        known_since: person.created_at,
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
        credits: credits.visits > 0 ? { visits: credits.visits, earliest_expiry: credits.earliestExpiry } : null,
        visits: { upcoming: withOutcome(visits.upcoming), past: withOutcome(visits.past) },
        payments,
        history,
      },
      200,
    );
  });

  app.openapi(photosRoute, async (c) => {
    const { id } = c.req.valid("param");
    const db = c.env.DB;
    if ((await clientById(db, id)) === null) return c.json(errorBody("not_found", c.var.requestId), 404);

    const { results } = await db
      .prepare(
        `SELECT p.id, s.appointment_id, s.phase, p.angle, p.width, p.height, p.taken_at,
           a.window_start, a.type, t.name AS technician_name, t.initials AS technician_initials
         FROM photos p
         JOIN photo_sets s ON s.id = p.photo_set_id
         JOIN appointments a ON a.id = s.appointment_id
         LEFT JOIN technicians t ON t.id = a.technician_id
         WHERE a.person_id = ?1 AND a.deleted_at IS NULL AND a.window_start IS NOT NULL
         ORDER BY a.window_start DESC`,
      )
      .bind(id)
      .all<PhotoListRow>();

    // The rows arrive newest visit first; each visit keeps that order, and its
    // photographs are sorted before then after, each in the design's angle order.
    const byVisit = new Map<string, { visit: PhotoListRow; photos: PhotoListRow[] }>();
    for (const row of results) {
      const group = byVisit.get(row.appointment_id) ?? { visit: row, photos: [] };
      group.photos.push(row);
      byVisit.set(row.appointment_id, group);
    }
    const order = (row: PhotoListRow) => PHASES.indexOf(row.phase) * ANGLES.length + ANGLES.indexOf(row.angle);

    return c.json(
      {
        visits: [...byVisit.values()].map(({ visit, photos }) => ({
          visit_id: visit.appointment_id,
          date: indiaDate(new Date(visit.window_start)),
          type: visit.type,
          technician:
            visit.technician_name === null || visit.technician_initials === null
              ? null
              : { name: visit.technician_name, initials: visit.technician_initials },
          photos: photos.sort((a, b) => order(a) - order(b)).map(photoOf),
        })),
      },
      200,
    );
  });

  app.openapi(photoRoute, async (c) => {
    const { id, photo_id: photoId } = c.req.valid("param");
    const db = c.env.DB;
    if ((await clientById(db, id)) === null) return c.json(errorBody("not_found", c.var.requestId), 404);
    // The same lookup the client's own photographs go through: a photograph of
    // anyone else is not found, whatever ID is asked for.
    const photo = await ownPhotoKey(db, id, photoId);
    if (photo === null) return c.json(errorBody("not_found", c.var.requestId), 404);

    const identity = c.var.accessIdentity;
    if (identity === undefined) throw new Error("ops routes run after requireAccess");
    // Written before the image is read, and a failure serves no photograph:
    // a locked view that could not be recorded did not happen (ADR 0031).
    try {
      await recordAudit(
        db,
        {
          surface: "ops",
          actor: actorOf(identity),
          action: "photo.view",
          subject: { kind: "photo", id: photoId },
          requestId: c.var.requestId,
          detail: { person_id: id },
        },
        c.var.deps.now(),
      );
    } catch (error) {
      c.var.log.error("audit_write_failed", { action: "photo.view", error });
      return c.json(errorBody("unavailable", c.var.requestId), 503);
    }

    const object = await c.env.CLIENT_PHOTOS.get(photo.key);
    if (object === null) return c.json(errorBody("not_found", c.var.requestId), 404);
    return new Response(object.body, {
      headers: { "Content-Type": photo.contentType, "Cache-Control": "private, no-store" },
    });
  });

  app.openapi(consentsRoute, async (c) => {
    const { id } = c.req.valid("param");
    const db = c.env.DB;
    if ((await clientById(db, id)) === null) return c.json(errorBody("not_found", c.var.requestId), 404);

    const [consents, deletion] = await Promise.all([
      consentRecordsOf(db, id),
      db
        .prepare(
          `SELECT id, state, created_at, decided_at FROM deletion_requests
           WHERE person_id = ?1 AND state != 'done' ORDER BY created_at DESC LIMIT 1`,
        )
        .bind(id)
        .first<{ id: string; state: "requested" | "rejected"; created_at: string; decided_at: string | null }>(),
    ]);
    return c.json(
      {
        consents: consents.map((consent) => ({
          purpose: consent.purpose,
          state: consent.granted
            ? ("given" as const)
            : consent.since === null
              ? ("not_given" as const)
              : ("withdrawn" as const),
          notice_version: consent.noticeVersion,
          at: consent.since,
        })),
        deletion:
          deletion === null
            ? null
            : {
                id: deletion.id,
                state: deletion.state,
                requested_at: deletion.created_at,
                decided_at: deletion.decided_at,
              },
      },
      200,
    );
  });
}

const photoOf = (row: PhotoListRow) => ({
  id: row.id,
  phase: row.phase,
  angle: row.angle,
  width: row.width,
  height: row.height,
  taken_at: row.taken_at,
});
