// Who may log in to the technician app, and the phone he logs in on
// (src/policy/technician-login.ts, docs/decisions/0029-sessions.md).
//
// The code is the client's: same table, same ten minutes, same five wrong
// attempts (docs/decisions/0030-one-time-codes.md). What differs is the
// subject. A technician is recognised only if FSM lists him as an active field
// technician, so the number is looked up in the mirror of FSM's service
// resources and nowhere else, and his session is bound to one phone.

import { sha256Hex, secretsMatch } from "../lib/hash.ts";
import { attemptsLeft, CODE_TTL_MS, ONE_TIME_CODE } from "../policy/one-time-code.ts";
import { codeHashOf } from "./login.ts";
import { SESSION_TTL_MS } from "./sessions.ts";

export interface FieldTechnician {
  readonly id: string;
  readonly name: string;
  readonly mobileE164: string;
}

/** The active field technician this number belongs to, as FSM lists him. */
export async function findFieldTechnician(db: D1Database, mobileE164: string): Promise<FieldTechnician | null> {
  const row = await db
    .prepare("SELECT id, name FROM technicians WHERE mobile_e164 = ?1 AND active = 1")
    .bind(mobileE164)
    .first<{ id: string; name: string }>();
  return row === null ? null : { id: row.id, name: row.name, mobileE164 };
}

export interface TechnicianChallenge {
  readonly id: string;
  readonly technicianId: string | null;
  readonly createdAt: Date;
  readonly lastSentAt: Date;
  readonly expiresAt: Date;
}

/**
 * A challenge for a technician's number. With no technician (a number FSM does
 * not list) it holds no code hash, so nothing is sent and no code matches, and
 * the login screen answers the same either way.
 */
export async function createTechnicianChallenge(
  db: D1Database,
  options: { technicianId: string | null; code: string; pepper: string; now: Date },
): Promise<TechnicianChallenge> {
  const id = crypto.randomUUID();
  const at = options.now.toISOString();
  const expiresAt = new Date(options.now.getTime() + CODE_TTL_MS);
  const codeHash = options.technicianId === null ? null : await codeHashOf(options.pepper, id, options.code);
  await db
    .prepare(
      `INSERT INTO otp_challenges
         (id, created_at, person_id, technician_login, technician_id, purpose, channel, code_hash, last_sent_at,
          expires_at)
       VALUES (?1, ?2, NULL, 1, ?3, 'login', 'whatsapp', ?4, ?2, ?5)`,
    )
    .bind(id, at, options.technicianId, codeHash, expiresAt.toISOString())
    .run();
  return {
    id,
    technicianId: options.technicianId,
    createdAt: options.now,
    lastSentAt: options.now,
    expiresAt,
  };
}

export type TechnicianVerification =
  | { readonly outcome: "verified"; readonly technicianId: string }
  | { readonly outcome: "mismatch"; readonly attemptsLeft: number }
  | { readonly outcome: "closed" };

/**
 * Checks the code, counting the attempt first so parallel guesses cannot share
 * one. The fifth wrong code voids the challenge; a right one closes it.
 */
export async function verifyTechnicianCode(
  db: D1Database,
  options: { challengeId: string; code: string; pepper: string; now: Date },
): Promise<TechnicianVerification> {
  const counted = await db
    .prepare(
      `UPDATE otp_challenges SET attempts = attempts + 1
       WHERE id = ?1 AND purpose = 'login' AND technician_login = 1
         AND verified_at IS NULL AND voided_at IS NULL AND expires_at > ?2 AND attempts < ?3
       RETURNING technician_id, code_hash, attempts`,
    )
    .bind(options.challengeId, options.now.toISOString(), ONE_TIME_CODE.wrongAttemptsBeforeVoid)
    .first<{ technician_id: string | null; code_hash: string | null; attempts: number }>();
  if (counted === null) return { outcome: "closed" };

  const given = await codeHashOf(options.pepper, options.challengeId, options.code);
  if (counted.technician_id !== null && counted.code_hash !== null && (await secretsMatch(given, counted.code_hash))) {
    const closed = await db
      .prepare("UPDATE otp_challenges SET verified_at = ?2 WHERE id = ?1 AND verified_at IS NULL RETURNING id")
      .bind(options.challengeId, options.now.toISOString())
      .first();
    return closed === null ? { outcome: "closed" } : { outcome: "verified", technicianId: counted.technician_id };
  }

  const left = attemptsLeft(counted.attempts);
  if (left === 0) {
    await db
      .prepare("UPDATE otp_challenges SET voided_at = ?2 WHERE id = ?1")
      .bind(options.challengeId, options.now.toISOString())
      .run();
  }
  return { outcome: "mismatch", attemptsLeft: left };
}

/** The phone a technician works from, as the technician_devices row holds it. */
export interface TechnicianDevice {
  readonly id: string;
  readonly technicianId: string;
  readonly deviceId: string;
  readonly revokedAt: string | null;
}

/**
 * Opens a session bound to one phone: the session row, and the device row that
 * names it. A fresh login on the same phone reuses its row and lets the old
 * session go, so one phone holds one live session. Returns the cookie's token.
 */
export async function openTechnicianSession(
  db: D1Database,
  options: { technicianId: string; deviceId: string; label: string | null; now: Date },
): Promise<string> {
  const token = newToken();
  const sessionId = await sha256Hex(token);
  const at = options.now.toISOString();
  const expiresAt = new Date(options.now.getTime() + SESSION_TTL_MS).toISOString();
  await db.batch([
    db
      .prepare(
        `UPDATE sessions SET revoked_at = ?3 WHERE revoked_at IS NULL AND subject_kind = 'technician'
           AND id IN (SELECT session_id FROM technician_devices
                      WHERE technician_id = ?1 AND device_id = ?2 AND session_id IS NOT NULL)`,
      )
      .bind(options.technicianId, options.deviceId, at),
    db
      .prepare(
        `INSERT INTO sessions (id, subject_kind, subject_id, created_at, last_seen_at, expires_at, device_label)
         VALUES (?1, 'technician', ?2, ?3, ?3, ?4, ?5)`,
      )
      .bind(sessionId, options.technicianId, at, expiresAt, options.label),
    db
      .prepare(
        `INSERT INTO technician_devices
           (id, technician_id, device_id, session_id, label, created_at, last_seen_at, revoked_at, wiped_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, NULL, NULL)
         ON CONFLICT (technician_id, device_id) DO UPDATE SET
           session_id = excluded.session_id, label = excluded.label, last_seen_at = excluded.last_seen_at,
           revoked_at = NULL, revoked_by = NULL, wiped_at = NULL`,
      )
      .bind(crypto.randomUUID(), options.technicianId, options.deviceId, sessionId, options.label, at),
  ]);
  return token;
}

/** The device a live session belongs to, revoked or not. */
export async function deviceOfSession(db: D1Database, sessionId: string): Promise<TechnicianDevice | null> {
  const row = await db
    .prepare("SELECT id, technician_id, device_id, revoked_at FROM technician_devices WHERE session_id = ?1")
    .bind(sessionId)
    .first<{ id: string; technician_id: string; device_id: string; revoked_at: string | null }>();
  return row === null
    ? null
    : { id: row.id, technicianId: row.technician_id, deviceId: row.device_id, revokedAt: row.revoked_at };
}

/** Moves the device's last-seen time on; hourly, like the session's own expiry. */
export async function touchDevice(db: D1Database, deviceRowId: string, now: Date): Promise<void> {
  await db
    .prepare("UPDATE technician_devices SET last_seen_at = ?2 WHERE id = ?1")
    .bind(deviceRowId, now.toISOString())
    .run();
}

/**
 * Ops revoke a phone: its session ends, and the row records that the device was
 * told to drop its cached jobs the next time it called. Null when there is no
 * such device of that technician's.
 */
export async function revokeDevice(
  db: D1Database,
  options: { technicianId: string; deviceId: string; actor: string; now: Date },
): Promise<TechnicianDevice | null> {
  const at = options.now.toISOString();
  const device = await db
    .prepare(
      `UPDATE technician_devices SET revoked_at = COALESCE(revoked_at, ?3), revoked_by = COALESCE(revoked_by, ?4)
       WHERE technician_id = ?1 AND device_id = ?2
       RETURNING id, technician_id, device_id, session_id, revoked_at`,
    )
    .bind(options.technicianId, options.deviceId, at, options.actor)
    .first<{
      id: string;
      technician_id: string;
      device_id: string;
      session_id: string | null;
      revoked_at: string | null;
    }>();
  if (device === null) return null;
  if (device.session_id !== null) {
    await db
      .prepare("UPDATE sessions SET revoked_at = COALESCE(revoked_at, ?2) WHERE id = ?1")
      .bind(device.session_id, at)
      .run();
  }
  return {
    id: device.id,
    technicianId: device.technician_id,
    deviceId: device.device_id,
    revokedAt: device.revoked_at,
  };
}

/** Records that a revoked device has dropped its cached jobs. Written once, on its next contact. */
export async function markWiped(db: D1Database, deviceRowId: string, now: Date): Promise<void> {
  await db
    .prepare("UPDATE technician_devices SET wiped_at = ?2 WHERE id = ?1 AND wiped_at IS NULL")
    .bind(deviceRowId, now.toISOString())
    .run();
}

/** The phones a technician has logged in on, newest first. */
export async function devicesOf(
  db: D1Database,
  technicianId: string,
): Promise<{ device_id: string; label: string | null; last_seen_at: string; revoked_at: string | null }[]> {
  const { results } = await db
    .prepare(
      `SELECT device_id, label, last_seen_at, revoked_at FROM technician_devices
       WHERE technician_id = ?1 ORDER BY last_seen_at DESC`,
    )
    .bind(technicianId)
    .all<{ device_id: string; label: string | null; last_seen_at: string; revoked_at: string | null }>();
  return results;
}

/** A 32-byte random cookie token, as src/domain/sessions.ts makes one. */
function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
