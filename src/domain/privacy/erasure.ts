// Erasing a person on request. The photo notice promises "Message us and it is
// deleted the same day"; this is what both of the ops console's doors do: a
// client's page, and a deletion request ops decide. See
// docs/decisions/0019-erasure.md and 0066-erasure-all-or-nothing.md.
//
// In order: one D1 batch blanks the person and what they left, ends their
// sessions, cancels their unsent messages and expires their jobs, with who
// erased them, and their deletion requests, grievances and Customer Care
// alerts still open closed, in the same batch, so all of it happens or none of
// it does. Then their files are deleted from R2, each before the row that names
// it. If that fails part-way, the person is erased all the same and the cron's
// erased_files job deletes what is left. The CRM is told at once, by its
// queue; Books by the cron's own pass (src/domain/books/books-erasure.ts).
//
// Nothing is erased while the person has a visit or booking still to happen, a
// payment held with no visit behind it, a cancelled visit's refund not yet
// made, or a payment link unpaid
// (src/policy/account-deletion.ts): the caller asks erasureBlockers first. When
// ops erase all the same, the batch lets go of every booking of theirs not yet a
// visit, so none is booked for nobody, and their open payment links are then
// cancelled at Razorpay.
//
// A render still running cannot store its result once its job is expired: the
// render consumer deletes what it wrote when it finds the job has moved on.
//
// What the batch blanks is ./erasure-statements.ts, and the files deleted ./erasure-files.ts.

import type { BookingWindow } from "../../config/scheduling.ts";
import type { VisitType } from "../../config/visit-types.ts";
import { failureReason, type Logger } from "../../log.ts";
import { LIVE_VISIT_STATUSES } from "../../policy/account-deletion.ts";
import { CUSTOMER_CARE_KINDS, deletionWaitingKey } from "../../policy/alerts.ts";
import type { PaymentsProvider } from "../../providers/payments/index.ts";
import type { AlertOnce } from "../ops/alerts.ts";
import { auditStatement, type AuditEntry } from "../ops/audit.ts";
import { recordEvent } from "../try-on/tryon.ts";
import { type CrmSyncMessage } from "../../config/pipeline.ts";
import { paidNotBooked } from "../booking/hold-stages.ts";
import { personalDataStatements } from "./erasure-statements.ts";
import { deleteErasedFiles, type ErasureEnv } from "./erasure-files.ts";

export interface ErasureSummary {
  readonly personId: string;
  readonly erasedAt: string;
  readonly photosDeleted: number;
  readonly resultsDeleted: number;
  readonly messagesCancelled: number;
  readonly visitPhotosDeleted: number;
  readonly sessionsEnded: number;
  readonly addressesRemoved: number;
}

export interface ErasureBlockers {
  readonly visits: readonly {
    readonly id: string;
    readonly type: VisitType | null;
    readonly status: (typeof LIVE_VISIT_STATUSES)[number];
    readonly window_start: string | null;
  }[];
  /** Bookings paid for, or free, that are not yet visits. */
  readonly bookings: readonly {
    readonly id: string;
    readonly type: VisitType;
    readonly date: string;
    readonly window: BookingWindow;
  }[];
  readonly payments: readonly { readonly id: string; readonly reference: string | null; readonly amount: number }[];
  /** Payment links still unpaid: a fitted visit's, or one ops sent for a booking, still open. */
  readonly links: readonly { readonly id: string; readonly reference: string | null; readonly amount: number }[];
}

export type ErasureQueueEnv = ErasureEnv & Pick<Env, "CRM_QUEUE">;

export interface EraseOptions {
  /** Who erased them, written in the erasure's batch. */
  readonly audit: AuditEntry;
  /** More of the caller's statements for the batch, as a deletion request's decision. */
  readonly alongside?: readonly D1PreparedStatement[];
  /** Cancels their payment links still open. */
  readonly payments: PaymentsProvider;
  readonly alertOnce: AlertOnce;
  readonly requestId: string;
  readonly now: Date;
  readonly log: Logger;
}

/** The person, not yet erased, who has this number. */
export async function personWithMobile(db: D1Database, mobileE164: string): Promise<string | null> {
  const person = await db
    .prepare("SELECT id FROM people WHERE mobile_e164 = ?1 AND erased_at IS NULL")
    .bind(mobileE164)
    .first<{ id: string }>();
  return person?.id ?? null;
}

/** Whether there is a person by this ID not yet erased. */
export async function stillToErase(db: D1Database, personId: string): Promise<boolean> {
  const person = await db
    .prepare("SELECT 1 AS found FROM people WHERE id = ?1 AND erased_at IS NULL")
    .bind(personId)
    .first<{ found: number }>();
  return person !== null;
}

/** A fitted visit's payment link not yet paid, of the person `?1`. */
const UNPAID_VISIT_LINKS = `FROM payment_links l JOIN appointments a ON a.id = l.appointment_id
  WHERE a.person_id = ?1 AND l.paid_at IS NULL`;

/** A booking of the person `?1` that ops sent a payment link for, not yet paid, and still open at `?2`. */
const OPEN_BOOKING_LINKS = `FROM slot_holds
  WHERE person_id = ?1 AND state = 'held' AND pay_by_link = 1 AND confirmed_at IS NULL AND expires_at > ?2`;

/**
 * What ops settle before erasing: the visits still to happen, the bookings paid for or free that are not yet visits,
 * the payments held with no visit behind them, the refunds cancels still owe, and the payment links still unpaid.
 */
export async function erasureBlockers(db: D1Database, personId: string, now: Date): Promise<ErasureBlockers> {
  const { results: visits } = await db
    .prepare(
      `SELECT id, type, status, window_start FROM appointments
       WHERE person_id = ?1 AND deleted_at IS NULL AND status IN (SELECT value FROM json_each(?2))
       ORDER BY window_start`,
    )
    .bind(personId, JSON.stringify(LIVE_VISIT_STATUSES))
    .all<ErasureBlockers["visits"][number]>();
  // A booking that moves a visit is not counted: the visit it moves is, above.
  const { results: bookings } = await db
    .prepare(
      `SELECT id, type, date, window_label AS window FROM slot_holds
       WHERE person_id = ?1 AND ${paidNotBooked("slot_holds")} AND moves_appointment_id IS NULL ORDER BY date, start_unit`,
    )
    .bind(personId)
    .all<ErasureBlockers["bookings"][number]>();
  const { results: held } = await db
    .prepare(
      `SELECT id, reference, amount FROM payments
       WHERE person_id = ?1 AND appointment_id IS NULL AND status = 'captured'
       ORDER BY captured_at`,
    )
    .bind(personId)
    .all<ErasureBlockers["payments"][number]>();
  const payments = [...held, ...(await cancelRefundsOwed(db, personId))];
  const { results: links } = await db
    .prepare(
      `SELECT l.id, l.reference, l.amount ${UNPAID_VISIT_LINKS}
       UNION ALL SELECT id, reference, amount ${OPEN_BOOKING_LINKS}`,
    )
    .bind(personId, now.toISOString())
    .all<ErasureBlockers["links"][number]>();
  return { visits, bookings, payments, links };
}

/**
 * What their cancelled visits' refunds still owe them: refunds not yet made, whether the cron is still asking for one
 * or Razorpay refused it and it waits for ops. Each is owed until we hold its refund's ID or Razorpay reports refunds
 * of the payment that leave no more than the cancel kept.
 */
async function cancelRefundsOwed(db: D1Database, personId: string): Promise<ErasureBlockers["payments"]> {
  const { results } = await db
    .prepare(
      `SELECT p.id, p.reference, p.amount - p.refunded_amount - c.kept_amount AS amount
       FROM appointments a
         JOIN visit_changes c ON c.appointment_id = a.id AND c.kind = 'cancelled'
         JOIN payments p ON p.id = c.payment_id
       WHERE a.person_id = ?1 AND a.status = 'cancelled' AND c.refund_amount > 0 AND c.razorpay_refund_id IS NULL
         AND p.amount - p.refunded_amount > c.kept_amount
       ORDER BY c.created_at`,
    )
    .bind(personId)
    .all<ErasureBlockers["payments"][number]>();
  return results;
}

/** Razorpay's IDs for the person's payment links it would still take a payment on. */
async function openLinkIds(db: D1Database, personId: string, now: Date): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT l.razorpay_link_id AS link_id ${UNPAID_VISIT_LINKS} AND l.razorpay_link_id IS NOT NULL
       UNION ALL SELECT payment_link_id ${OPEN_BOOKING_LINKS} AND payment_link_id IS NOT NULL`,
    )
    .bind(personId, now.toISOString())
    .all<{ link_id: string }>();
  return results.map((row) => row.link_id);
}

/**
 * Cancels each link at Razorpay, so it neither takes a payment nor reminds the erased client. One Razorpay will not
 * cancel is left to ops, by its ID alone.
 */
async function cancelOpenLinks(linkIds: readonly string[], options: EraseOptions): Promise<void> {
  for (const linkId of linkIds) {
    try {
      await options.payments.cancelPaymentLink(linkId);
    } catch (error) {
      const reason = failureReason(error);
      options.log.warn("erased_link_not_cancelled", { link_id: linkId, reason });
      await options.alertOnce({
        key: `erased_link:${linkId}`,
        message:
          `Payment link ${linkId}, of a client erased since, could not be cancelled: ${reason}. ` +
          "Cancel it in Razorpay's dashboard.",
      });
    }
  }
}

/** Every booking of theirs not yet a visit is let go, its time freed, so that nothing books one for nobody. */
function letGoOfBookings(db: D1Database, personId: string, at: string): D1PreparedStatement[] {
  return [
    db
      .prepare(
        "DELETE FROM slot_claims WHERE hold_id IN (SELECT id FROM slot_holds WHERE person_id = ?1 AND state = 'held')",
      )
      .bind(personId),
    db
      .prepare("UPDATE slot_holds SET state = 'released', updated_at = ?2 WHERE person_id = ?1 AND state = 'held'")
      .bind(personId, at),
  ];
}

/**
 * Erases the person, with `alongside` in the same D1 batch, then deletes their
 * files. Null when they are already erased.
 */
export async function erasePerson({
  env,
  personId,
  now,
  log,
  alongside = [],
}: {
  env: ErasureEnv;
  personId: string;
  now: Date;
  log: Logger;
  alongside?: readonly D1PreparedStatement[];
}): Promise<ErasureSummary | null> {
  const db = env.DB;
  const counts = await db
    .prepare(
      `SELECT
         (SELECT COUNT(DISTINCT upload_key) FROM tryon_jobs WHERE person_id = ?1 AND upload_deleted_at IS NULL) AS photos,
         (SELECT COUNT(*) FROM tryon_jobs WHERE person_id = ?1 AND result_key IS NOT NULL) AS results,
         (SELECT COUNT(*) FROM photos ph JOIN photo_sets s ON s.id = ph.photo_set_id
            JOIN appointments a ON a.id = s.appointment_id WHERE a.person_id = ?1) AS visit_photos,
         (SELECT COUNT(*) FROM sessions
            WHERE subject_kind = 'client' AND subject_id = ?1 AND revoked_at IS NULL AND expires_at > ?2) AS sessions,
         (SELECT COUNT(*) FROM addresses WHERE person_id = ?1) AS addresses
       FROM people WHERE id = ?1 AND erased_at IS NULL`,
    )
    .bind(personId, now.toISOString())
    .first<{ photos: number; results: number; visit_photos: number; sessions: number; addresses: number }>();
  if (counts === null) return null;

  const at = now.toISOString();
  const outcome = await db.batch([
    db
      .prepare(
        `UPDATE outbound_messages SET state = 'skipped', last_error = 'person erased'
         WHERE person_id = ?1 AND state IN ('waiting', 'queued') RETURNING id`,
      )
      .bind(personId),
    ...letGoOfBookings(db, personId, at),
    ...(await personalDataStatements(db, personId, at)),
    // After the blanking, so a grievance the caller closes keeps the words it is closed with.
    ...alongside,
    recordEvent({
      db,
      name: "person_erased",
      subjectId: personId,
      payload: { photos: counts.photos, results: counts.results },
      now,
    }),
  ]);

  try {
    await deleteErasedFiles(env, personId, now);
  } catch (error) {
    log.warn("erasure_files_left", { person_id: personId, error }); // the cron's erased_files job finishes them
  }

  return {
    personId,
    erasedAt: at,
    photosDeleted: counts.photos,
    resultsDeleted: counts.results,
    messagesCancelled: outcome[0]?.results.length ?? 0,
    visitPhotosDeleted: counts.visit_photos,
    sessionsEnded: counts.sessions,
    addressesRemoved: counts.addresses,
  };
}

/**
 * The one way a person is erased. Who erased them, and what of theirs is still open for ops (a deletion request, a
 * grievance, a Customer Care alert), go in the erasure's batch; the CRM's blanking is queued at once rather than left to the
 * sweeper, and their payment links still open are cancelled. Null when they are already erased.
 */
export async function eraseAndQueue(
  env: ErasureQueueEnv,
  personId: string,
  options: EraseOptions,
): Promise<ErasureSummary | null> {
  const { audit, now, log } = options;
  // Read before the batch, which lets go of the bookings they belong to.
  const linkIds = await openLinkIds(env.DB, personId, now);
  const summary = await erasePerson({
    env,
    personId,
    now,
    log,
    alongside: [
      ...(options.alongside ?? []),
      resolveOpenRequestAlerts(env.DB, personId, now),
      closeOpenRequests(env.DB, personId, audit.actor.id, now),
      closeOpenGrievances(env.DB, personId, audit.actor.id, now),
      resolveAlertsAbout(env.DB, personId, now),
      auditStatement(env.DB, audit, now),
    ],
  });
  if (summary === null) return null;
  log.info("person_erased", {
    person_id: summary.personId,
    photos_deleted: summary.photosDeleted,
    results_deleted: summary.resultsDeleted,
    messages_cancelled: summary.messagesCancelled,
    visit_photos_deleted: summary.visitPhotosDeleted,
  });
  await queueOutsideErasure(env, summary.personId, options);
  await cancelOpenLinks(linkIds, options);
  return summary;
}

/** The alerts on Tasks for the deletion requests the erasure is about to close; before it closes them. */
function resolveOpenRequestAlerts(db: D1Database, personId: string, now: Date): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE alerts SET resolved_at = ?2 WHERE resolved_at IS NULL AND key IN
         (SELECT ?3 || id FROM deletion_requests WHERE person_id = ?1 AND state = 'requested')`,
    )
    .bind(personId, now.toISOString(), deletionWaitingKey(""));
}

/** A deletion request the person still has open is done by their erasure, under whoever erased them. */
function closeOpenRequests(db: D1Database, personId: string, decidedBy: string, now: Date): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE deletion_requests SET state = 'done', decided_at = ?2, decided_by = ?3
       WHERE person_id = ?1 AND state = 'requested'`,
    )
    .bind(personId, now.toISOString(), decidedBy);
}

/** An open grievance of theirs is closed by the erasure, under whoever erased them: nobody is left to answer. */
function closeOpenGrievances(db: D1Database, personId: string, closedBy: string, now: Date): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE grievances SET state = 'resolved', response = 'Client erased', resolved_by = ?2, resolved_at = ?3
       WHERE person_id = ?1 AND state = 'open'`,
    )
    .bind(personId, closedBy, now.toISOString());
}

/**
 * The person's open Customer Care alerts that link to their page are resolved: their messages, contact and notes went
 * with the erasure. Every other alert stays open, since a visit, a booking or money may still need settling, and their
 * page shows what is kept of those.
 */
function resolveAlertsAbout(db: D1Database, personId: string, now: Date): D1PreparedStatement {
  const page = `/clients/${personId}`;
  // An alert's kind is its key up to the first colon.
  return db
    .prepare(
      `UPDATE alerts SET resolved_at = ?3
       WHERE resolved_at IS NULL AND (link = ?1 OR instr(link, ?2) = 1)
         AND substr(key, 1, instr(key || ':', ':') - 1) IN (SELECT value FROM json_each(?4))`,
    )
    .bind(page, `${page}/`, now.toISOString(), JSON.stringify(CUSTOMER_CARE_KINDS));
}

/** The consumer does nothing for a person already done, so the sweeper finding them as well costs nothing. */
async function queueOutsideErasure(env: ErasureQueueEnv, personId: string, options: EraseOptions): Promise<void> {
  const message = { erase_person_id: personId, request_id: options.requestId };
  try {
    await env.CRM_QUEUE.send(message satisfies CrmSyncMessage);
  } catch (error) {
    options.log.warn("erasure_enqueue_failed", { person_id: personId, error }); // the sweeper sends it on
  }
}
