// POST /api/clients/:id/erasure: ops erase a client the day they ask, from the client's page
// (docs/decisions/0019-erasure.md). A request the client made in their app is decided in Deletion requests instead
// (src/routes/ops/profile.ts); both erase through eraseAndQueue, audited under the member of staff who did it, and
// keep to the caller's cities. Refused while the client has a visit or booking still to happen, a payment held or a
// payment link unpaid, unless ops say to erase anyway (docs/decisions/0066-erasure-all-or-nothing.md): then each visit
// still to come is cancelled free to the client, as a cancel on Visits is, and refunded in full.

import { opsRoute } from "../../http/session-routes.ts";
import { z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { BOOKING_WINDOWS } from "../../config/scheduling.ts";
import { VISIT_TYPES } from "../../config/visit-types.ts";
import type { AuditEntry } from "../../domain/platform/audit.ts";
import {
  eraseAndQueue,
  erasureBlockers,
  stillToErase,
  type ErasureBlockers,
  type ErasureSummary,
} from "../../domain/privacy/erasure.ts";
import { cancelVisit, type OpsCancel } from "../../domain/visits/visit-cancel.ts";
import { changeableVisitFor, changeTerms, opsCancelTerms, termsInForce } from "../../domain/visits/visit-changes.ts";
import { actorOf, staffMemberOf } from "../../http/audit.ts";
import type { App, AppEnv } from "../../http/context.ts";
import { opsInputs } from "../../http/ops-inputs.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { withinRouteReach } from "../../http/staff-access.ts";
import { erasureRefusal, LIVE_VISIT_STATUSES, type ErasureRefusal } from "../../policy/account-deletion.ts";

const OwedSchema = z
  .object({
    id: z.string(),
    reference: z.string().nullable(),
    amount: z.number().int().openapi({ description: "In paise." }),
  })
  .strict();

/**
 * Why an erasure waits, and what ops must settle first: the visits and bookings to cancel, the payments to refund, and
 * the payment links to be paid or let go.
 */
export const ErasureRefusedSchema = z
  .object({
    error: z
      .object({ code: z.enum(["visit_booked", "payment_held", "payment_owed"]), request_id: z.string() })
      .strict(),
    visits: z.array(
      z
        .object({
          id: z.string(),
          type: z.enum(VISIT_TYPES).nullable(),
          status: z.enum(LIVE_VISIT_STATUSES),
          window_start: z.iso.datetime().nullable(),
        })
        .strict(),
    ),
    bookings: z
      .array(
        z
          .object({
            id: z.string(),
            type: z.enum(VISIT_TYPES),
            date: z.iso.date(),
            window: z.enum(BOOKING_WINDOWS),
          })
          .strict(),
      )
      .openapi({ description: "Bookings paid for, or free, that are not yet visits." }),
    payments: z.array(OwedSchema).openapi({
      description:
        "Money owed back: a payment held with no visit behind it, or what a cancelled visit's refund has still to " +
        "return.",
    }),
    links: z.array(OwedSchema).openapi({
      description: "Payment links still unpaid: a fitted visit's, or one sent for a booking and still open.",
    }),
  })
  .strict()
  .openapi("ErasureRefused");

export function erasureRefused(
  code: ErasureRefusal,
  blockers: ErasureBlockers,
  requestId: string,
): z.infer<typeof ErasureRefusedSchema> {
  return {
    error: { code, request_id: requestId },
    visits: [...blockers.visits],
    bookings: [...blockers.bookings],
    payments: [...blockers.payments],
    links: [...blockers.links],
  };
}

const ErasureSchema = z
  .object({
    override_open_bookings: z
      .boolean()
      .optional()
      .openapi({
        description:
          "Erase even with a visit or booking still to happen, a payment held or a link unpaid. Visits still to come " +
          "are cancelled free to the client and refunded in full; bookings not yet visits are let go, their payments " +
          "left on Tasks to refund; open payment links are cancelled.",
      }),
  })
  .strict()
  .openapi("Erasure");

const ErasedSchema = z
  .object({
    erased_at: z.iso.datetime(),
    photos_deleted: z.number().int().openapi({ description: "Try-on photographs." }),
    results_deleted: z.number().int().openapi({ description: "Try-on results." }),
    visit_photos_deleted: z.number().int(),
    messages_cancelled: z.number().int().openapi({ description: "Messages not yet sent." }),
    sessions_ended: z.number().int().openapi({ description: "App sessions signed out." }),
    addresses_removed: z.number().int(),
  })
  .strict()
  .openapi("Erased");

const erasureRoute = opsRoute({
  method: "post",
  path: "/api/clients/{id}/erasure",
  summary: "Erase a client now: their photographs and details. The CRM and Books follow within minutes",
  request: {
    params: z.object({ id: z.uuid() }),
    body: { required: true, ...json(ErasureSchema) },
  },
  responses: {
    200: { description: "Erased", ...json(ErasedSchema) },
    400: errorResponse("invalid_request"),
    403: errorResponse("access_required: a service token, which names no member of staff"),
    404: errorResponse("not_found: nobody by that ID in the caller's cities, or erased already"),
    409: {
      description:
        "visit_booked, payment_held or payment_owed: settle what it names first, or say it will be settled today",
      ...json(ErasureRefusedSchema),
    },
  },
});

function erasedBody(summary: ErasureSummary): z.infer<typeof ErasedSchema> {
  return {
    erased_at: summary.erasedAt,
    photos_deleted: summary.photosDeleted,
    results_deleted: summary.resultsDeleted,
    visit_photos_deleted: summary.visitPhotosDeleted,
    messages_cancelled: summary.messagesCancelled,
    sessions_ended: summary.sessionsEnded,
    addresses_removed: summary.addressesRemoved,
  };
}

/** What a cancel made by erasing anyway says of itself, where ops would write their reason. */
const ERASED_REASON = "The client asked to be erased.";

/**
 * Erasing anyway: each visit still to come is cancelled free to the client, the whole payment refunded, so no
 * technician is sent to an erased client and nothing paid is kept. Its message is cancelled with the erasure's unsent
 * ones. A visit begun already, or one a cancel fails, is left on their page for ops.
 */
async function cancelStillToCome(c: Context<AppEnv>, visits: ErasureBlockers["visits"], now: Date): Promise<void> {
  const db = c.env.DB;
  const { deps, log, requestId } = c.var;
  const inputs = await opsInputs(c);
  for (const { id } of visits) {
    try {
      const visit = await changeableVisitFor(db, id, now);
      if (visit === null) continue;
      const terms = await changeTerms({ db, visit, now, inForce: termsInForce(inputs, visit.type) });
      const free = opsCancelTerms({ terms, onClientTerms: false });
      const ops: OpsCancel = {
        staff: actorOf(c).id,
        reason: ERASED_REASON,
        terms: "free",
        audit: {
          surface: "ops",
          actor: actorOf(c),
          action: "visit.cancel",
          subject: { kind: "appointment", id },
          requestId,
          detail: { terms: "free", refund: free.cancel.refund, kept: free.cancel.kept },
        },
      };
      await cancelVisit({ db, deps, terms: free, now, options: { log, ops } });
    } catch (error) {
      log.error("erasure_cancel_failed", { appointment_id: id, error });
    }
  }
}

export function registerOpsErasure(app: App): void {
  app.openapi(erasureRoute, async (c) => {
    const { id } = c.req.valid("param");
    const override = c.req.valid("json").override_open_bookings === true;
    const { requestId, log } = c.var;
    const staff = staffMemberOf(c);
    if (staff === null) return refuse(c, "access_required");
    const erasable = (await stillToErase(c.env.DB, id)) && (await withinRouteReach(c, "client", id));
    if (!erasable) return refuse(c, "not_found");

    const now = c.var.deps.now();
    const blockers = await erasureBlockers(c.env.DB, id, now);
    const refusal = erasureRefusal(blockers);
    if (refusal !== null && !override) return c.json(erasureRefused(refusal, blockers, requestId), 409);
    const settledByHand = refusal !== null;
    const counts = {
      visits: blockers.visits.length,
      bookings: blockers.bookings.length,
      payments: blockers.payments.length,
      links: blockers.links.length,
    };
    if (settledByHand) log.warn("erasure_override", { person_id: id, ...counts });
    if (settledByHand) await cancelStillToCome(c, blockers.visits, now);

    const audit: AuditEntry = {
      surface: "ops",
      actor: staff,
      action: "person.erase",
      subject: { kind: "person", id },
      requestId,
      detail: { settled_by_hand: settledByHand, ...counts },
    };
    const summary = await eraseAndQueue(c.env, id, {
      audit,
      payments: c.var.deps.payments,
      alertOnce: c.var.deps.alertOnce,
      requestId,
      now,
      log,
    });
    if (summary === null) return refuse(c, "not_found");
    return c.json(erasedBody(summary), 200);
  });
}
