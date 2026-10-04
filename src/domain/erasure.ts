// Erasing a person on request. The photo notice promises "Message us and it is
// deleted the same day"; this is what both of the ops console's doors do: a
// client's page, and a deletion request ops decide. See
// docs/decisions/0019-erasure.md and 0066-erasure-all-or-nothing.md.
//
// In order: one D1 batch blanks the person and what they left, ends their
// sessions, cancels their unsent messages and expires their jobs, with who
// erased them and any deletion request of theirs still open in the same batch,
// so all of it happens or none of it does. Then their files are deleted from
// R2, each before the row that names it. If that fails part-way, the person is
// erased all the same and the cron's erased_files job deletes what is left. The
// CRM is told at once, by its queue; Books by the cron's own pass
// (src/domain/books-erasure.ts).
//
// Nothing is erased while the person has a visit or booking still to happen, a
// payment held with no visit behind it, or a payment link unpaid
// (src/policy/account-deletion.ts): the caller asks erasureBlockers first. When
// ops erase all the same, the batch lets go of every booking of theirs not yet a
// visit, so none is booked for nobody, and their open payment links are then
// cancelled at Razorpay.
//
// A render still running cannot store its result once its job is expired: the
// render consumer deletes what it wrote when it finds the job has moved on.

import type { NoticePurpose } from "../config/notices.ts";
import type { BookingWindow } from "../config/scheduling.ts";
import type { VisitType } from "../config/visit-types.ts";
import { failureReason, type Logger } from "../log.ts";
import { LIVE_VISIT_STATUSES } from "../policy/account-deletion.ts";
import type { PaymentsProvider } from "../providers/payments.ts";
import type { CrmSyncMessage } from "../queues/crm-sync.ts";
import type { AlertOnce } from "./alerts.ts";
import { auditStatement, type AuditEntry } from "./audit.ts";
import { recordConsent } from "./consents.ts";
import { blankProfiles } from "./hair-profiles.ts";
import { copyKey, keptLookKey } from "./kept-try-ons.ts";
import { deleteCounted, deleteUnder } from "./storage-meter.ts";
import { recordEvent } from "./tryon.ts";

/** R2 deletes at most 1,000 keys a call. */
const R2_DELETE_BATCH = 1000;
/**
 * Most erased people whose files one cron run finishes. Each costs about fifteen calls to D1 and R2 and one list for
 * each of their visits, and a run shares Cloudflare's 1,000 such calls an invocation with every other cron job: five
 * clients of five years' monthly visits come to under 400.
 */
const LEFT_FILES_PER_RUN = 5;

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

export type ErasureEnv = Pick<Env, "DB" | "UPLOADS" | "RESULTS" | "CLIENT_PHOTOS" | "REFERRAL_CARDS">;
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
 * the payments held with no visit behind them, and the payment links still unpaid.
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
       WHERE person_id = ?1 AND state = 'held' AND confirmed_at IS NOT NULL AND moves_appointment_id IS NULL
       ORDER BY date, start_unit`,
    )
    .bind(personId)
    .all<ErasureBlockers["bookings"][number]>();
  const { results: payments } = await db
    .prepare(
      `SELECT id, reference, amount FROM payments
       WHERE person_id = ?1 AND appointment_id IS NULL AND status = 'captured'
       ORDER BY captured_at`,
    )
    .bind(personId)
    .all<ErasureBlockers["payments"][number]>();
  const { results: links } = await db
    .prepare(
      `SELECT l.id, l.reference, l.amount ${UNPAID_VISIT_LINKS}
       UNION ALL SELECT id, reference, amount ${OPEN_BOOKING_LINKS}`,
    )
    .bind(personId, now.toISOString())
    .all<ErasureBlockers["links"][number]>();
  return { visits, bookings, payments, links };
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
export async function erasePerson(
  env: ErasureEnv,
  personId: string,
  now: Date,
  log: Logger,
  alongside: readonly D1PreparedStatement[] = [],
): Promise<ErasureSummary | null> {
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
    ...alongside,
    ...letGoOfBookings(db, personId, at),
    ...(await personalDataStatements(db, personId, at)),
    recordEvent(db, "person_erased", personId, { photos: counts.photos, results: counts.results }, now),
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
 * The one way a person is erased. Who erased them, and any deletion request of theirs still open, go in the
 * erasure's batch; the CRM's blanking is queued at once rather than left to the sweeper, and their payment links still
 * open are cancelled. Null when they are already erased.
 */
export async function eraseAndQueue(
  env: ErasureQueueEnv,
  personId: string,
  options: EraseOptions,
): Promise<ErasureSummary | null> {
  const { audit, now, log } = options;
  // Read before the batch, which lets go of the bookings they belong to.
  const linkIds = await openLinkIds(env.DB, personId, now);
  const summary = await erasePerson(env, personId, now, log, [
    ...(options.alongside ?? []),
    closeOpenRequests(env.DB, personId, audit.actor.id, now),
    auditStatement(env.DB, audit, now),
  ]);
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

/** A deletion request the person still has open is done by their erasure, under whoever erased them. */
function closeOpenRequests(db: D1Database, personId: string, decidedBy: string, now: Date): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE deletion_requests SET state = 'done', decided_at = ?2, decided_by = ?3
       WHERE person_id = ?1 AND state = 'requested'`,
    )
    .bind(personId, now.toISOString(), decidedBy);
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

/** Of the person's addresses, one a technician's check-in was measured against. */
const MEASURED_AGAINST = "EXISTS (SELECT 1 FROM checkins c WHERE c.address_id = addresses.id)";

/**
 * Everything else the batch changes, in an order the foreign keys allow: what
 * points at a row is dealt with before the row is deleted.
 */
async function personalDataStatements(db: D1Database, personId: string, at: string): Promise<D1PreparedStatement[]> {
  // One withdrawal row for each purpose the person had agreed to, recorded as the erasure's. Consents are append-only.
  const { results: granted } = await db
    .prepare("SELECT DISTINCT purpose FROM consents WHERE person_id = ?1 AND granted = 1")
    .bind(personId)
    .all<{ purpose: NoticePurpose }>();
  const withdrawals = granted.map(
    ({ purpose }) =>
      recordConsent(db, {
        person: { id: personId },
        purpose,
        granted: false,
        notice: "withdrawal",
        source: "erasure",
        rule: "always",
        ipHash: null,
        givenAt: at,
      }).statement,
  );

  return [
    // Expired jobs stop any render storing its result; the files go after the batch.
    db
      .prepare(
        "UPDATE tryon_jobs SET state = CASE WHEN state = 'failed' THEN state ELSE 'expired' END WHERE person_id = ?1",
      )
      .bind(personId),
    db.prepare("DELETE FROM tryon_sessions WHERE person_id = ?1").bind(personId),
    // The client app: every session ends, and every open login code stops working (docs/decisions/0029, 0030).
    db
      .prepare(
        "UPDATE sessions SET revoked_at = ?2 WHERE subject_kind = 'client' AND subject_id = ?1 AND revoked_at IS NULL",
      )
      .bind(personId, at),
    db
      .prepare("UPDATE otp_challenges SET voided_at = ?2, code_hash = NULL WHERE person_id = ?1 AND voided_at IS NULL")
      .bind(personId, at),
    // Waiting for a pincode needs the person's number; an invite they sent stays, with the house card
    // (docs/decisions/0048-referrals.md). The card's file is deleted after the batch.
    db.prepare("DELETE FROM waitlist_entries WHERE person_id = ?1").bind(personId),
    db
      .prepare(
        `UPDATE referral_codes SET card_state = 'house', card_version = card_version + 1, updated_at = ?2
         WHERE person_id = ?1 AND card_state = 'personal'`,
      )
      .bind(personId, at),
    // Phase 2's own personal data (docs/decisions/0049-dpdp.md): where they live, the numbers they changed
    // between, and the words of any grievance. Visits, payments and credits stay, as records. An address a
    // technician's check-in was measured against is blanked to its city and pincode rather than deleted: the
    // check-in points at it, and stays as the evidence ops rule a no-show on.
    db
      .prepare(
        `UPDATE addresses SET line1 = 'Erased', line2 = NULL, locality = 'Erased', access_notes = NULL, lat = NULL,
           lng = NULL, geocoded_at = NULL, building = NULL, flat = NULL, floor = NULL, tower = NULL, landmark = NULL,
           place_id = NULL, geocode_source = NULL, given_to_staff = NULL
         WHERE person_id = ?1 AND ${MEASURED_AGAINST}`,
      )
      .bind(personId),
    db.prepare(`DELETE FROM addresses WHERE person_id = ?1 AND NOT ${MEASURED_AGAINST}`).bind(personId),
    db
      .prepare(
        "DELETE FROM otp_challenges WHERE number_change_id IN (SELECT id FROM number_change_requests WHERE person_id = ?1)",
      )
      .bind(personId),
    db.prepare("DELETE FROM number_change_requests WHERE person_id = ?1").bind(personId),
    db.prepare("UPDATE grievances SET text = 'Erased', response = NULL WHERE person_id = ?1").bind(personId),
    // How they reached us, and how much hair they had lost; the lead stays, as the record of a booking.
    db
      .prepare(
        `UPDATE leads SET loss_extent = NULL, utm_source = NULL, utm_medium = NULL, utm_campaign = NULL,
           utm_content = NULL, gclid = NULL, fbclid = NULL, referrer = NULL, landing_path = NULL
         WHERE person_id = ?1`,
      )
      .bind(personId),
    ...opsWordsAbout(db, personId),
    // Their first name on a referral, which the referrer's tracker shows until now; blank, it reads "A friend",
    // which says nothing of the erasure (LIFE-13). Counsel may rule it can stay (docs/open-points.md, item 63).
    db
      .prepare("UPDATE referral_attributions SET friend_first_name = NULL WHERE referred_person_id = ?1")
      .bind(personId),
    // And the client's own words to the technician on a visit (src/domain/client-notes.ts), and why they disputed a
    // no-show's charge (src/domain/no-show-disputes.ts).
    db.prepare("UPDATE appointments SET client_note = NULL, client_note_at = NULL WHERE person_id = ?1").bind(personId),
    db.prepare("UPDATE no_show_disputes SET reason = NULL WHERE person_id = ?1").bind(personId),
    // What a pay step showed them, kept on the hold until the booking is confirmed, and their hashed address.
    db
      .prepare("UPDATE slot_holds SET consents_shown = NULL, consents_ip_hash = NULL WHERE person_id = ?1")
      .bind(personId),
    // Their hair profile, its fit spec and their health history, in every version; who took each, and when, stay
    // (docs/decisions/0106-a-clients-hair-profile.md).
    blankProfiles(db, personId),
    // Where the technician's phone was at their door (ADR 0025, ruling 34). The check-in's time, the distance
    // measured, the radius and whether it passed stay: they place nobody, and a no-show is ruled on them
    // (docs/decisions/0094-where-a-consent-was-given.md).
    db
      .prepare(
        `UPDATE checkins SET lat = NULL, lng = NULL, accuracy_m = NULL
         WHERE appointment_id IN (SELECT id FROM appointments WHERE person_id = ?1)`,
      )
      .bind(personId),
    // The number is replaced, not kept: a later booking from it starts afresh, with a new consent.
    db
      .prepare(
        `UPDATE people SET erased_at = ?2, name = 'Erased', email = NULL, mobile_e164 = 'erased:' || id,
           contactable = 0
         WHERE id = ?1`,
      )
      .bind(personId, at),
    ...withdrawals,
  ];
}

/**
 * Ops' own words about the person, kept with a decision (docs/decisions/0072-ops-clients-and-queues.md): the review
 * of a grant they were either side of, why ops attached an invite they were either side of (ADR 0089), the ruling on
 * a visit of theirs they were not home for and on their dispute of its charge (ADR 0096), why ops closed a visit
 * of theirs left partly done without a follow-up (ADR 0092), and why ops cancelled a visit of theirs or closed one by
 * hand. The decisions themselves stay, as records.
 */
function opsWordsAbout(db: D1Database, personId: string): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `UPDATE referral_attributions SET review_reason = NULL, attach_reason = NULL
         WHERE referred_person_id = ?1 OR code IN (SELECT code FROM referral_codes WHERE person_id = ?1)`,
      )
      .bind(personId),
    // Found through the check-in, which each case is keyed on, so the lookup is indexed.
    db
      .prepare(
        `UPDATE no_show_cases SET decision_reason = NULL
         WHERE checkin_id IN (
           SELECT c.id FROM checkins c JOIN appointments a ON a.id = c.appointment_id WHERE a.person_id = ?1)`,
      )
      .bind(personId),
    db.prepare("UPDATE no_show_disputes SET ruling_reason = NULL WHERE person_id = ?1").bind(personId),
    // Found through the visit, which each is keyed on, so the lookups are indexed.
    db
      .prepare(
        `UPDATE visit_changes SET cancel_reason = NULL
         WHERE appointment_id IN (SELECT id FROM appointments WHERE person_id = ?1)`,
      )
      .bind(personId),
    db
      .prepare(
        `UPDATE visits SET close_reason = NULL
         WHERE appointment_id IN (SELECT id FROM appointments WHERE person_id = ?1)`,
      )
      .bind(personId),
    db
      .prepare(
        `UPDATE task_closures SET reason = NULL
         WHERE task_group = 'partial_visit' AND subject_id IN (SELECT id FROM appointments WHERE person_id = ?1)`,
      )
      .bind(personId),
  ];
}

/**
 * An erased person's files: their try-on photographs, results, small copies and kept looks, their visit
 * photographs (docs/decisions/0049-dpdp.md) and their referral card. Each is
 * deleted from R2 before the row that names it, so a run that fails part-way
 * leaves the rest for the next.
 */
async function deleteErasedFiles(env: ErasureEnv, personId: string, now: Date): Promise<void> {
  await deleteTryOnFiles(env, personId, now);
  await deleteVisitPhotos(env, personId);
  await deleteReferralCard(env, personId);
  await env.DB.prepare("UPDATE people SET files_erased_at = ?2 WHERE id = ?1").bind(personId, now.toISOString()).run();
}

async function deleteTryOnFiles(env: ErasureEnv, personId: string, now: Date): Promise<void> {
  const { results: jobs } = await env.DB.prepare(
    "SELECT id, upload_key, upload_deleted_at, result_key FROM tryon_jobs WHERE person_id = ?1",
  )
    .bind(personId)
    .all<{ id: string; upload_key: string; upload_deleted_at: string | null; result_key: string | null }>();
  const photos = jobs.filter((job) => job.upload_deleted_at === null).map((job) => job.upload_key);
  // Both keys a render can store its result under, for a render that stored one after it was read.
  const results = jobs.flatMap((job) => [
    ...(job.result_key === null ? [] : [job.result_key]),
    `results/${job.id}.png`,
    `results/${job.id}.jpg`,
  ]);
  // A client's kept copy and look (docs/decisions/0084-a-clients-try-on-is-kept.md), under every key either can
  // have, for a sweep that stored one and was stopped before it said so.
  const kept = jobs.flatMap((job) => [
    copyKey(job.id),
    keptLookKey(job.id, "image/png"),
    keptLookKey(job.id, "image/jpeg"),
  ]);
  await deleteKeys(env.UPLOADS, photos);
  await deleteKeys(env.RESULTS, results);
  await deleteCounted(env.DB, env.CLIENT_PHOTOS, kept);
  await env.DB.prepare(
    `UPDATE tryon_jobs SET result_key = NULL, upload_deleted_at = COALESCE(upload_deleted_at, ?2), copy_key = NULL,
       kept_look_key = NULL
     WHERE person_id = ?1`,
  )
    .bind(personId, now.toISOString())
    .run();
}

/**
 * Every photograph and thumbnail the person's rows name, and everything else under each of their visits in the
 * bucket: a photograph taken again at the same angle, which no row names any more
 * (docs/decisions/0028-photographs-from-the-app.md), and its thumbnail. One list a visit, then one delete for each
 * thousand keys and two updates of the storage meter, however many visits there were.
 */
async function deleteVisitPhotos(env: ErasureEnv, personId: string): Promise<void> {
  const db = env.DB;
  const { results: photos } = await db
    .prepare(
      `SELECT s.appointment_id, ph.r2_key, ph.thumbnail_key FROM photos ph JOIN photo_sets s ON s.id = ph.photo_set_id
       JOIN appointments a ON a.id = s.appointment_id WHERE a.person_id = ?1`,
    )
    .bind(personId)
    .all<{ appointment_id: string; r2_key: string; thumbnail_key: string | null }>();
  // A row may name a key outside its visit's prefix, as older records and the browser tests' seed do.
  const named = photos.flatMap((photo) => [
    photo.r2_key,
    ...(photo.thumbnail_key === null ? [] : [photo.thumbnail_key]),
  ]);
  await deleteCounted(db, env.CLIENT_PHOTOS, named);
  const visits = new Set(photos.map((photo) => photo.appointment_id));
  await deleteUnder(
    db,
    env.CLIENT_PHOTOS,
    [...visits].map((visit) => `visits/${visit}/`),
  );
  const theirSets =
    "SELECT s.id FROM photo_sets s JOIN appointments a ON a.id = s.appointment_id WHERE a.person_id = ?1";
  // The sets go after their photographs, for the foreign key. An empty set holds no personal data,
  // but it is a record of photographs that no longer exist.
  await db.batch([
    db.prepare(`DELETE FROM photos WHERE photo_set_id IN (${theirSets})`).bind(personId),
    db.prepare(`DELETE FROM photo_sets WHERE id IN (${theirSets})`).bind(personId),
  ]);
}

async function deleteReferralCard(env: ErasureEnv, personId: string): Promise<void> {
  const card = await env.DB.prepare(
    "SELECT code, card_key FROM referral_codes WHERE person_id = ?1 AND card_key IS NOT NULL",
  )
    .bind(personId)
    .first<{ code: string; card_key: string }>();
  if (card === null) return;
  await deleteCounted(env.DB, env.REFERRAL_CARDS, [card.card_key]);
  await env.DB.prepare("UPDATE referral_codes SET card_key = NULL WHERE code = ?1").bind(card.code).run();
}

async function deleteKeys(bucket: R2Bucket, keys: readonly string[]): Promise<void> {
  const unique = [...new Set(keys)];
  for (let start = 0; start < unique.length; start += R2_DELETE_BATCH) {
    await bucket.delete(unique.slice(start, start + R2_DELETE_BATCH));
  }
}

/** The files an erasure could not delete at the time, a few people a run; the number of people finished. */
export async function deleteLeftFiles(env: ErasureEnv, now: Date, log: Logger): Promise<number> {
  const { results: people } = await env.DB.prepare(
    "SELECT id FROM people WHERE erased_at IS NOT NULL AND files_erased_at IS NULL ORDER BY erased_at LIMIT ?1",
  )
    .bind(LEFT_FILES_PER_RUN)
    .all<{ id: string }>();
  let finished = 0;
  for (const { id } of people) {
    try {
      await deleteErasedFiles(env, id, now);
      finished += 1;
    } catch (error) {
      log.warn("erasure_files_left", { person_id: id, error });
    }
  }
  return finished;
}
