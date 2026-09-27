// Try-on jobs, sessions and result messages in D1. The routes, the render
// consumer and the sweeper share these; single-use SQL stays where it is used.
// See docs/decisions/0014-try-on-api.md.

import type { Endpoint } from "../config/presets.ts";
import type { FailureCode, HairColor, JobState, UnknownColorRoute } from "../config/tryon.ts";
import type { LossExtent } from "../config/booking.ts";
import type { ProviderColor } from "../providers/image.ts";

export interface JobRow {
  id: string;
  created_at: string;
  upload_key: string;
  uploaded_at: string | null;
  upload_deleted_at: string | null;
  parent_job_id: string | null;
  stage: LossExtent | null;
  preset: string | null;
  hair_color: HairColor | null;
  endpoint: Endpoint | null;
  provider_color: ProviderColor | null;
  color_route: ColorRoute | null;
  state: JobState;
  submit_started_at: string | null;
  submit_attempts: number;
  submitted_at: string | null;
  provider_task_id: string | null;
  provider_result_url: string | null;
  provider_result_expires_at: string | null;
  download_attempts: number;
  download_attempted_at: string | null;
  result_key: string | null;
  failure_code: FailureCode | null;
  provider_error_detail: string | null;
  latency_ms: number | null;
  person_id: string | null;
  lead_id: string | null;
  session_id: string | null;
  claimed_at: string | null;
  expires_at: string | null;
  photo_consent_version: string;
  photo_consent_at: string;
  ip_hash: string;
  request_id: string;
  /** A client's try-on, kept (docs/decisions/0084-a-clients-try-on-is-kept.md): the small copy, when it was kept, and the kept look. */
  copy_key: string | null;
  kept_at: string | null;
  kept_look_key: string | null;
}

export type ColorRoute = "as_detected" | UnknownColorRoute;

/** What a render asks the provider for. */
export interface RenderChoice {
  readonly stage: LossExtent;
  readonly preset: string;
  readonly hairColor: HairColor;
  readonly endpoint: Endpoint;
  readonly providerColor: ProviderColor;
  readonly colorRoute: ColorRoute;
}

export function loadJob(db: D1Database, jobId: string): Promise<JobRow | null> {
  return db.prepare("SELECT * FROM tryon_jobs WHERE id = ?1").bind(jobId).first<JobRow>();
}

/**
 * Fails a job and skips any message waiting for its result. Only a job that
 * has not already finished changes; the return value says whether this one did.
 */
export async function failJob(
  db: D1Database,
  jobId: string,
  code: FailureCode,
  detail: string | null,
  now: Date,
): Promise<boolean> {
  const [changed] = await db.batch([
    db
      .prepare(
        `UPDATE tryon_jobs SET state = 'failed', failure_code = ?2, provider_error_detail = ?3,
           latency_ms = CAST((julianday(?4) - julianday(created_at)) * 86400000 AS INTEGER)
         WHERE id = ?1 AND state NOT IN ('ready', 'failed', 'expired')
         RETURNING id`,
      )
      .bind(jobId, code, detail, now.toISOString()),
    db
      .prepare(
        "UPDATE outbound_messages SET state = 'skipped', last_error = ?2 WHERE subject_id = ?1 AND state = 'waiting'",
      )
      .bind(jobId, `job failed: ${code}`),
  ]);
  return (changed?.results.length ?? 0) > 0;
}

export interface SessionRow {
  id: string;
  person_id: string;
  expires_at: string;
}

/** A session that exists and has not expired, or null. */
export function loadSession(db: D1Database, sessionId: string, now: Date): Promise<SessionRow | null> {
  return db
    .prepare("SELECT id, person_id, expires_at FROM tryon_sessions WHERE id = ?1 AND expires_at > ?2")
    .bind(sessionId, now.toISOString())
    .first<SessionRow>();
}

export function recordEvent(
  db: D1Database,
  name: string,
  subjectId: string,
  payload: Record<string, unknown>,
  now: Date,
): D1PreparedStatement {
  return db
    .prepare("INSERT INTO events (id, created_at, name, subject_id, payload_json) VALUES (?1, ?2, ?3, ?4, ?5)")
    .bind(crypto.randomUUID(), now.toISOString(), name, subjectId, JSON.stringify(payload));
}
