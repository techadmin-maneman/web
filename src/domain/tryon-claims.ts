// A try-on claimed at the gate (docs/decisions/0014-try-on-api.md): the person, their two consents, the lead, the
// session and the result message, written together; or, for a job its number claimed before, a fresh session.
// POST /api/tryon/claim (src/routes/tryon-claim.ts) checks the request and the limits first, and queues the lead and
// the message after.
//
// A try-on lead does not make the person contactable: the gate's consent
// permits sending this result and nothing else (docs/decisions/0012-zoho-sync.md).

import { TRYON_SESSION_TTL_MS } from "../config/tryon.ts";
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

export interface NewClaim {
  readonly job: JobRow;
  readonly mobileE164: string;
  readonly name: string;
  /** The gate's notice the page showed. */
  readonly gateNotice: string;
  readonly attribution: Attribution;
  readonly ipHash: string;
  readonly requestId: string;
  readonly now: Date;
}

export interface Claimed {
  readonly leadId: string;
  readonly sessionId: string;
  readonly messageId: string;
  /** Queued when the result is already ready, so it can go at once; else it waits for the render. */
  readonly messageState: "queued" | "waiting";
}

/** Writes a reserved job's claim in one batch. If the batch fails, the job's reservation is let go. */
export async function recordClaim(db: D1Database, claim: NewClaim): Promise<Claimed> {
  const { job, mobileE164, attribution, now } = claim;
  const leadId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const messageId = crypto.randomUUID();
  const at = now.toISOString();
  const personId = "(SELECT id FROM people WHERE mobile_e164 = ?)";
  const messageState = job.state === "ready" ? "queued" : "waiting";

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
          `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at, ip_hash)
           VALUES (?, ${personId}, 'result_delivery', ?, 1, ?, ?)`,
        )
        .bind(crypto.randomUUID(), mobileE164, claim.gateNotice, at, claim.ipHash),
      // The photo consent was given before the upload; it is recorded now that we know who gave it.
      db
        .prepare(
          `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at, ip_hash)
           VALUES (?, ${personId}, 'tryon_photo', ?, 1, ?, ?)`,
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
          job.stage,
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
      db
        .prepare(`INSERT INTO tryon_sessions (id, person_id, created_at, expires_at) VALUES (?, ${personId}, ?, ?)`)
        .bind(sessionId, mobileE164, at, new Date(now.getTime() + TRYON_SESSION_TTL_MS).toISOString()),
      db
        .prepare(`UPDATE tryon_jobs SET person_id = ${personId}, lead_id = ?, session_id = ? WHERE id = ?`)
        .bind(mobileE164, leadId, sessionId, job.id),
      db
        .prepare(
          `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_id, state, queued_at)
           VALUES (?, ?, ${personId}, 'tryon_result', ?, ?, ?)`,
        )
        .bind(messageId, at, mobileE164, job.id, messageState, messageState === "queued" ? at : null),
      recordEvent(db, "tryon_claimed", leadId, { job_id: job.id, job_state: job.state }, now),
    ]);
  } catch (error) {
    await db.prepare("UPDATE tryon_jobs SET claimed_at = NULL WHERE id = ?1").bind(job.id).run();
    throw error;
  }
  return { leadId, sessionId, messageId, messageState };
}

/**
 * A job already claimed, claimed again: by the same number it gets a fresh session (the first cookie may have been
 * lost); by another it is refused, null, so a job ID alone never opens someone else's result.
 */
export async function reclaimJob(
  db: D1Database,
  input: { job: JobRow; mobileE164: string; now: Date },
): Promise<{ readonly leadId: string; readonly sessionId: string } | null> {
  const { job, now } = input;
  const owner = await db
    .prepare("SELECT id FROM people WHERE id = ?1 AND mobile_e164 = ?2")
    .bind(job.person_id, input.mobileE164)
    .first<{ id: string }>();
  if (owner === null || job.lead_id === null) return null;

  const sessionId = crypto.randomUUID();
  await db.batch([
    db
      .prepare("INSERT INTO tryon_sessions (id, person_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)")
      .bind(sessionId, owner.id, now.toISOString(), new Date(now.getTime() + TRYON_SESSION_TTL_MS).toISOString()),
    db.prepare("UPDATE tryon_jobs SET session_id = ?1 WHERE id = ?2").bind(sessionId, job.id),
  ]);
  return { leadId: job.lead_id, sessionId };
}
