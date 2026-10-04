// Sessions (docs/decisions/0029-sessions.md): a 32-byte random token in a
// cookie, stored only as its SHA-256. A session lasts 90 days from its last
// use, and can be revoked.

import { toBase64Url } from "../lib/base64url.ts";
import { sha256Hex } from "../lib/hash.ts";
import { DAY_MS, HOUR_MS } from "../lib/durations.ts";

export const SESSION_TTL_MS = 90 * DAY_MS;
/** A session's expiry moves on at most this often, so a busy app is not a write per request. */
export const SESSION_TOUCH_MS = HOUR_MS;

export type SessionKind = "client" | "technician";

export interface Session {
  readonly id: string;
  readonly subjectId: string;
  readonly lastSeenAt: Date;
  readonly expiresAt: Date;
}

/** A session's cookie token: 32 random bytes, of which only the SHA-256 is kept. */
export const newSessionToken = (): string => toBase64Url(crypto.getRandomValues(new Uint8Array(32)));

/** Opens a session and returns the token for the cookie. */
export async function openSession(
  db: D1Database,
  options: { kind: SessionKind; subjectId: string; deviceLabel: string | null; now: Date },
): Promise<string> {
  const token = newSessionToken();
  const at = options.now.toISOString();
  await db
    .prepare(
      `INSERT INTO sessions (id, subject_kind, subject_id, created_at, last_seen_at, expires_at, device_label)
       VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?6)`,
    )
    .bind(
      await sha256Hex(token),
      options.kind,
      options.subjectId,
      at,
      new Date(options.now.getTime() + SESSION_TTL_MS).toISOString(),
      options.deviceLabel,
    )
    .run();
  return token;
}

/** The live session a cookie's token names, if any. */
export async function findSession(
  db: D1Database,
  kind: SessionKind,
  token: string,
  now: Date,
): Promise<Session | null> {
  const row = await db
    .prepare(
      `SELECT id, subject_id, last_seen_at, expires_at FROM sessions
       WHERE id = ?1 AND subject_kind = ?2 AND revoked_at IS NULL AND expires_at > ?3`,
    )
    .bind(await sha256Hex(token), kind, now.toISOString())
    .first<{ id: string; subject_id: string; last_seen_at: string; expires_at: string }>();
  return row === null
    ? null
    : {
        id: row.id,
        subjectId: row.subject_id,
        lastSeenAt: new Date(row.last_seen_at),
        expiresAt: new Date(row.expires_at),
      };
}

/** Moves the session's expiry to 90 days from now. */
export async function touchSession(db: D1Database, session: Session, now: Date): Promise<void> {
  await db
    .prepare("UPDATE sessions SET last_seen_at = ?2, expires_at = ?3 WHERE id = ?1 AND revoked_at IS NULL")
    .bind(session.id, now.toISOString(), new Date(now.getTime() + SESSION_TTL_MS).toISOString())
    .run();
}

export async function revokeSession(db: D1Database, sessionId: string, now: Date): Promise<void> {
  await db
    .prepare("UPDATE sessions SET revoked_at = ?2 WHERE id = ?1 AND revoked_at IS NULL")
    .bind(sessionId, now.toISOString())
    .run();
}

/** Checked in order: an Edge or Chrome User-Agent also names Safari, and an iPhone's names Mac OS X. */
const BROWSERS: readonly (readonly [marker: string, name: string])[] = [
  ["Edg/", "Edge"],
  ["Firefox/", "Firefox"],
  ["Chrome/", "Chrome"],
  ["Safari/", "Safari"],
];
const SYSTEMS: readonly (readonly [marker: string, name: string])[] = [
  ["Android", "Android"],
  ["iPhone", "iOS"],
  ["iPad", "iOS"],
  ["Windows", "Windows"],
  ["Mac OS X", "macOS"],
];

/** "Chrome on Android", or null: a label for the profile's list of devices, never the full User-Agent. */
export function deviceLabel(userAgent: string | undefined): string | null {
  if (userAgent === undefined) return null;
  const named = (table: typeof BROWSERS) => table.find(([marker]) => userAgent.includes(marker))?.[1] ?? null;
  const parts = [named(BROWSERS), named(SYSTEMS)].filter((part) => part !== null);
  return parts.length === 0 ? null : parts.join(" on ");
}

/** A session as its own client sees it: never the token, nor the hash the cookie is looked up by. */
export interface SignedIn {
  /** The session's handle (sessionHandle). */
  readonly id: string;
  readonly device: string | null;
  readonly signedInAt: string;
  readonly lastUsedAt: string;
}

/** The first 16 hex of a session's stored hash: it names the session to its own client, and opens nothing. */
export const sessionHandle = (sessionId: string): string => sessionId.slice(0, 16);

/** Most sessions a list shows: a client signed in on more than this many browsers sees the latest. */
const LISTED_SESSIONS = 20;

/** The subject's live sessions, the one used last first. */
export async function liveSessions(
  db: D1Database,
  subject: { kind: SessionKind; id: string },
  now: Date,
): Promise<{ readonly sessionId: string; readonly signedIn: SignedIn }[]> {
  const { results } = await db
    .prepare(
      `SELECT id, device_label, created_at, last_seen_at FROM sessions
       WHERE subject_kind = ?1 AND subject_id = ?2 AND revoked_at IS NULL AND expires_at > ?3
       ORDER BY last_seen_at DESC LIMIT ?4`,
    )
    .bind(subject.kind, subject.id, now.toISOString(), LISTED_SESSIONS)
    .all<{ id: string; device_label: string | null; created_at: string; last_seen_at: string }>();
  return results.map((row) => ({
    sessionId: row.id,
    signedIn: {
      id: sessionHandle(row.id),
      device: row.device_label,
      signedInAt: row.created_at,
      lastUsedAt: row.last_seen_at,
    },
  }));
}

/** Ends the subject's live session with this handle. Whether there was one. */
export async function revokeByHandle(
  db: D1Database,
  subject: { kind: SessionKind; id: string },
  handle: string,
  now: Date,
): Promise<boolean> {
  const revoked = await db
    .prepare(
      `UPDATE sessions SET revoked_at = ?4
       WHERE subject_kind = ?1 AND subject_id = ?2 AND substr(id, 1, 16) = ?3 AND revoked_at IS NULL AND expires_at > ?4
       RETURNING id`,
    )
    .bind(subject.kind, subject.id, handle, now.toISOString())
    .all();
  return revoked.results.length > 0;
}

/** Ends every live session of the subject but `keep`, or every one where `keep` is null. */
export function revokeOthersStatement(
  db: D1Database,
  subject: { kind: SessionKind; id: string },
  keep: string | null,
  now: Date,
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE sessions SET revoked_at = ?4
       WHERE subject_kind = ?1 AND subject_id = ?2 AND id IS NOT ?3 AND revoked_at IS NULL AND expires_at > ?4`,
    )
    .bind(subject.kind, subject.id, keep, now.toISOString());
}
