// Who may log in to the technician app, and the phone he logs in on
// (docs/prompts/phase2-backend.md, "Technician and dispatch rules, from the
// designs"; docs/decisions/0029-sessions.md).
//
// The code is the client's: same table, same ten minutes, same five wrong
// attempts (docs/decisions/0030-one-time-codes.md). What differs is the
// subject. A technician is recognised only while ops have him switched on, so
// the number is looked up among the technicians and nowhere else, and his
// session is bound to one phone.

import { sha256Hex } from "../../lib/hash.ts";
import { auditStatement, type AuditEntry } from "../ops/audit.ts";
import { checkLoginCode } from "../sign-in/one-time-codes.ts";
import { newSessionToken, SESSION_TTL_MS } from "../sign-in/sessions.ts";

interface FieldTechnician {
  readonly id: string;
  readonly name: string;
  readonly mobileE164: string;
}

/**
 * The active technician this number belongs to. Two active technicians never share a number now; where an older row
 * written by hand into staging still does, the other comes first (migration 0046).
 */
export async function findFieldTechnician(db: D1Database, mobileE164: string): Promise<FieldTechnician | null> {
  const row = await db
    .prepare(
      "SELECT id, name FROM technicians WHERE mobile_e164 = ?1 AND active = 1 ORDER BY hand_written, rowid LIMIT 1",
    )
    .bind(mobileE164)
    .first<{ id: string; name: string }>();
  return row === null ? null : { id: row.id, name: row.name, mobileE164 };
}

type TechnicianVerification =
  | { readonly outcome: "verified"; readonly technicianId: string }
  | { readonly outcome: "mismatch"; readonly attemptsLeft: number }
  | { readonly outcome: "closed" };

/** Checks a technician's login code (src/domain/sign-in/one-time-codes.ts). */
export async function verifyTechnicianCode(
  db: D1Database,
  options: { challengeId: string; code: string; pepper: string; now: Date },
): Promise<TechnicianVerification> {
  const checked = await checkLoginCode(db, { ...options, purpose: "login", holder: "technician" });
  return checked.outcome === "verified" ? { outcome: "verified", technicianId: checked.holderId } : checked;
}

/** The phone a technician works from, as the technician_devices row holds it. */
interface TechnicianDevice {
  readonly id: string;
  readonly technicianId: string;
  readonly deviceId: string;
  readonly revokedAt: string | null;
}

/** A session's phone, and whether its technician is still switched on. */
interface SessionDevice extends TechnicianDevice {
  readonly technicianActive: boolean;
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
  const token = newSessionToken();
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

/** A technician and the phone he is signed in on, for GET /api/tech/me. */
interface SignedInTechnician {
  readonly name: string;
  readonly deviceId: string;
  readonly label: string | null;
  readonly enrolledAt: string;
}

/** Who this session belongs to, and since when this phone has been enrolled. */
export async function signedInTechnician(
  db: D1Database,
  options: { technicianId: string; deviceRowId: string },
): Promise<SignedInTechnician | null> {
  const row = await db
    .prepare(
      `SELECT t.name, d.device_id, d.label, d.created_at FROM technician_devices d
       JOIN technicians t ON t.id = d.technician_id
       WHERE d.id = ?1 AND d.technician_id = ?2`,
    )
    .bind(options.deviceRowId, options.technicianId)
    .first<{ name: string; device_id: string; label: string | null; created_at: string }>();
  return row === null
    ? null
    : { name: row.name, deviceId: row.device_id, label: row.label, enrolledAt: row.created_at };
}

/** The device a live session belongs to, revoked or not, with whether its technician is still active. */
export async function deviceOfSession(db: D1Database, sessionId: string): Promise<SessionDevice | null> {
  const row = await db
    .prepare(
      `SELECT d.id, d.technician_id, d.device_id, d.revoked_at, t.active FROM technician_devices d
       JOIN technicians t ON t.id = d.technician_id
       WHERE d.session_id = ?1`,
    )
    .bind(sessionId)
    .first<{ id: string; technician_id: string; device_id: string; revoked_at: string | null; active: number }>();
  if (row === null) return null;
  return {
    id: row.id,
    technicianId: row.technician_id,
    deviceId: row.device_id,
    revokedAt: row.revoked_at,
    technicianActive: row.active === 1,
  };
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
 * told to drop its cached jobs the next time it called. No phone of his signs in
 * again until ops let him (allowSignIn): the lost phone still gets his code on
 * WhatsApp, so a code alone must not undo the revoke. The revoke's audit entry
 * goes in the same batch (src/domain/ops/audit.ts). Null when there is no such
 * device of that technician's.
 */
export async function revokeDevice(
  db: D1Database,
  options: { technicianId: string; deviceId: string; actor: string; audit: AuditEntry; now: Date },
): Promise<TechnicianDevice | null> {
  const at = options.now.toISOString();
  const device = await db
    .prepare("SELECT id, session_id, revoked_at FROM technician_devices WHERE technician_id = ?1 AND device_id = ?2")
    .bind(options.technicianId, options.deviceId)
    .first<{ id: string; session_id: string | null; revoked_at: string | null }>();
  if (device === null) return null;
  await db.batch([
    db
      .prepare(
        `UPDATE technician_devices SET revoked_at = COALESCE(revoked_at, ?2), revoked_by = COALESCE(revoked_by, ?3)
         WHERE id = ?1`,
      )
      .bind(device.id, at, options.actor),
    db
      .prepare("UPDATE technicians SET sign_in_stopped_at = COALESCE(sign_in_stopped_at, ?2) WHERE id = ?1")
      .bind(options.technicianId, at),
    ...(device.session_id === null
      ? []
      : [
          db
            .prepare("UPDATE sessions SET revoked_at = COALESCE(revoked_at, ?2) WHERE id = ?1")
            .bind(device.session_id, at),
        ]),
    auditStatement(db, options.audit, options.now),
  ]);
  return {
    id: device.id,
    technicianId: options.technicianId,
    deviceId: options.deviceId,
    revokedAt: device.revoked_at ?? at,
  };
}

/** Ops let a technician sign in again after a revoke, with their audit entry. False when he was not stopped. */
export async function allowSignIn(
  db: D1Database,
  technicianId: string,
  audit: AuditEntry,
  now: Date,
): Promise<boolean> {
  const stopped = await db
    .prepare("SELECT 1 FROM technicians WHERE id = ?1 AND sign_in_stopped_at IS NOT NULL")
    .bind(technicianId)
    .first();
  if (stopped === null) return false;
  await db.batch([
    db.prepare("UPDATE technicians SET sign_in_stopped_at = NULL WHERE id = ?1").bind(technicianId),
    auditStatement(db, audit, now),
  ]);
  return true;
}

/** Records that a revoked device has dropped its cached jobs. Written once, on its next contact. */
export async function markWiped(db: D1Database, deviceRowId: string, now: Date): Promise<void> {
  await db
    .prepare("UPDATE technician_devices SET wiped_at = ?2 WHERE id = ?1 AND wiped_at IS NULL")
    .bind(deviceRowId, now.toISOString())
    .run();
}

interface Device {
  readonly device_id: string;
  readonly label: string | null;
  readonly last_seen_at: string;
  readonly revoked_at: string | null;
  /** Whether the phone's last session is still live: false once he signed out, it ran out, or it was revoked. */
  readonly signed_in: boolean;
}

/**
 * The phones every active technician has logged in on, by technician, the
 * latest used first. One read for the whole roster, however many there are.
 */
export async function devicesByTechnician(db: D1Database, now: Date): Promise<Map<string, Device[]>> {
  const { results } = await db
    .prepare(
      `SELECT d.technician_id, d.device_id, d.label, d.last_seen_at, d.revoked_at,
         (s.id IS NOT NULL AND s.revoked_at IS NULL AND s.expires_at > ?1) AS signed_in
       FROM technician_devices d JOIN technicians t ON t.id = d.technician_id
       LEFT JOIN sessions s ON s.id = d.session_id
       WHERE t.active = 1 ORDER BY d.last_seen_at DESC`,
    )
    .bind(now.toISOString())
    .all<Omit<Device, "signed_in"> & { technician_id: string; signed_in: number }>();
  const devices = new Map<string, Device[]>();
  for (const { technician_id: technicianId, signed_in: signedIn, ...device } of results) {
    devices.set(technicianId, [...(devices.get(technicianId) ?? []), { ...device, signed_in: signedIn === 1 }]);
  }
  return devices;
}
