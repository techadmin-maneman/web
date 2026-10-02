// A try-on claimed at the gate (docs/decisions/0014-try-on-api.md): the person, their two consents, the lead and the
// result message, written together; or, for a job its number claimed before, that claim's lead again.
// POST /api/tryon/claim (src/routes/tryon-claim.ts) checks the request and the limits first, and queues the lead and
// the message after.
//
// The claim comes before the render, since the look goes to WhatsApp only and the number is where it goes
// (docs/decisions/0104-the-try-ons-look-on-whatsapp-only.md). It opens no session: nothing on the site shows the look.
//
// A try-on lead does not make the person contactable: the gate's consent
// permits sending this result and nothing else (docs/decisions/0012-zoho-sync.md).

import type { LossExtent } from "../config/booking.ts";
import type { Attribution } from "./leads.ts";
import { recordEvent, type JobRow } from "./tryon.ts";

/**
 * Reserves the job for this claim, so two claims at once cannot both create a lead; false when another claim
 * already has it.
 */
export async function reserveJob(db: D1Database, jobId: string, now: Date): Promise<boolean> {
  const reserved = await db
    .prepare("UPDATE tryon_jobs SET claimed_at = ?2 WHERE id = ?1 AND claimed_at IS NULL RETURNING id")
    .bind(jobId, now.toISOString())
    .first();
  return reserved !== null;
}

/** Whether this number had a look made, or being made, since `since`: a render asked for that did not fail. */
export async function hadLookSince(db: D1Database, mobileE164: string, since: Date): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS found FROM tryon_jobs j JOIN people p ON p.id = j.person_id
       WHERE p.mobile_e164 = ? AND j.claimed_at >= ? AND j.submit_started_at IS NOT NULL AND j.state <> 'failed'
       LIMIT 1`,
    )
    .bind(mobileE164, since.toISOString())
    .first<{ found: number }>();
  return row !== null;
}

export interface NewClaim {
  readonly job: JobRow;
  readonly mobileE164: string;
  readonly name: string;
  /** The stage the visitor chose: the lead's extent of hair loss, and the stage the render is made for. */
  readonly stage: LossExtent;
  /** The gate's notice the page showed. */
  readonly gateNotice: string;
  readonly attribution: Attribution;
  readonly ipHash: string;
  readonly requestId: string;
  readonly now: Date;
}

/**
 * Writes a reserved job's claim in one batch, and returns its lead. The look's message waits for the render, which
 * the claim comes before (src/queues/render.ts queues it once the look is stored). If the batch fails, the job's
 * reservation is let go.
 */
export async function recordClaim(db: D1Database, claim: NewClaim): Promise<string> {
  const { job, mobileE164, attribution, now } = claim;
  const leadId = crypto.randomUUID();
  const at = now.toISOString();
  const personId = "(SELECT id FROM people WHERE mobile_e164 = ?)";

  try {
    await db.batch([
      // A returning person keeps their ID and whether they are contactable.
      db
        .prepare(
          `INSERT INTO people (id, created_at, mobile_e164, name, contactable) VALUES (?, ?, ?, ?, 0)
           ON CONFLICT (mobile_e164) DO UPDATE SET name = excluded.name`,
        )
        .bind(crypto.randomUUID(), at, mobileE164, claim.name),
      db
        .prepare(
          `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at, ip_hash, source)
           VALUES (?, ${personId}, 'result_delivery', ?, 1, ?, ?, 'try_on')`,
        )
        .bind(crypto.randomUUID(), mobileE164, claim.gateNotice, at, claim.ipHash),
      // The photo consent was given before the upload; it is recorded now that we know who gave it.
      db
        .prepare(
          `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at, ip_hash, source)
           VALUES (?, ${personId}, 'tryon_photo', ?, 1, ?, ?, 'try_on')`,
        )
        .bind(crypto.randomUUID(), mobileE164, job.photo_consent_version, job.photo_consent_at, job.ip_hash),
      db
        .prepare(
          `INSERT INTO leads (id, person_id, created_at, source, loss_extent, utm_source, utm_medium, utm_campaign,
             utm_content, gclid, fbclid, referrer, landing_path, request_id)
           VALUES (?, ${personId}, ?, 'tryon', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          leadId,
          mobileE164,
          at,
          claim.stage,
          attribution.utm_source ?? null,
          attribution.utm_medium ?? null,
          attribution.utm_campaign ?? null,
          attribution.utm_content ?? null,
          attribution.gclid ?? null,
          attribution.fbclid ?? null,
          attribution.referrer ?? null,
          attribution.landing_path ?? null,
          claim.requestId,
        ),
      // The render is made for the stage the lead records (src/routes/tryon-generate.ts).
      db
        .prepare(`UPDATE tryon_jobs SET person_id = ${personId}, lead_id = ?, stage = ? WHERE id = ?`)
        .bind(mobileE164, leadId, claim.stage, job.id),
      db
        .prepare(
          `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_id, state)
           VALUES (?, ?, ${personId}, 'tryon_result', ?, 'waiting')`,
        )
        .bind(crypto.randomUUID(), at, mobileE164, job.id),
      recordEvent(db, "tryon_claimed", leadId, { job_id: job.id, job_state: job.state }, now),
    ]);
  } catch (error) {
    await db.prepare("UPDATE tryon_jobs SET claimed_at = NULL WHERE id = ?1").bind(job.id).run();
    throw error;
  }
  return leadId;
}

/**
 * The lead of a job already claimed, when its own number claims it again (the first answer may have been lost);
 * null for any other number, so a job ID alone never joins someone else's try-on.
 */
export async function leadOfOwnClaim(db: D1Database, job: JobRow, mobileE164: string): Promise<string | null> {
  const owner = await db
    .prepare("SELECT id FROM people WHERE id = ?1 AND mobile_e164 = ?2")
    .bind(job.person_id, mobileE164)
    .first<{ id: string }>();
  return owner === null ? null : job.lead_id;
}
