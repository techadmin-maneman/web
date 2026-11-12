// The client's sign-off of a fit (docs/decisions/0254-client-signs-off-the-fit.md), one row a visit: the technician
// asks, and asks again once a flag is put right; the client signs or flags, in their own app or on the technician's
// phone with the code the ask gave it; or the technician records that the client declined to sign, with why. A fit
// that needs one (src/policy/sign-off.ts) closes done only once it is signed or declined.

import { sha256Hex } from "../../lib/hash.ts";
import {
  PHONE_CODE_MS,
  SIGN_OFF_CHECKS,
  type SignedOn,
  type SignOffCheck,
  type SignOffState,
} from "../../policy/sign-off.ts";

export type SignOffChecks = Readonly<Record<SignOffCheck, boolean>>;

export interface SignOff {
  readonly state: SignOffState;
  readonly checks: SignOffChecks | null;
  readonly flag_text: string | null;
  readonly declined_reason: string | null;
  readonly asked_at: string;
  readonly asks: number;
  readonly signed_at: string | null;
  readonly signed_on: SignedOn | null;
}

interface SignOffRow extends Omit<SignOff, "checks"> {
  readonly appointment_id: string;
  readonly checks: string | null;
  readonly phone_code_hash: string | null;
  readonly phone_code_expires_at: string | null;
}

const COLUMNS = `appointment_id, state, checks, flag_text, declined_reason, asked_at, asks, signed_at, signed_on,
  phone_code_hash, phone_code_expires_at`;

function checksOf(stored: string | null): SignOffChecks | null {
  if (stored === null) return null;
  const parsed = JSON.parse(stored) as Partial<Record<SignOffCheck, unknown>>;
  return Object.fromEntries(SIGN_OFF_CHECKS.map((check) => [check, parsed[check] === true])) as SignOffChecks;
}

const signOffOfRow = (row: SignOffRow): SignOff => ({
  state: row.state,
  checks: checksOf(row.checks),
  flag_text: row.flag_text,
  declined_reason: row.declined_reason,
  asked_at: row.asked_at,
  asks: row.asks,
  signed_at: row.signed_at,
  signed_on: row.signed_on,
});

async function rowOf(db: D1Database, appointmentId: string): Promise<SignOffRow | null> {
  return db
    .prepare(`SELECT ${COLUMNS} FROM fit_sign_offs WHERE appointment_id = ?1`)
    .bind(appointmentId)
    .first<SignOffRow>();
}

/** The visit's sign-off as it stands; null while none was asked for. */
export async function signOffOf(db: D1Database, appointmentId: string): Promise<SignOff | null> {
  const row = await rowOf(db, appointmentId);
  return row === null ? null : signOffOfRow(row);
}

/** These visits' sign-offs, by visit; one with none is left out. */
export async function signOffsOf(db: D1Database, appointmentIds: readonly string[]): Promise<Map<string, SignOff>> {
  if (appointmentIds.length === 0) return new Map();
  const marks = appointmentIds.map((_, at) => `?${String(at + 1)}`).join(", ");
  const { results } = await db
    .prepare(`SELECT ${COLUMNS} FROM fit_sign_offs WHERE appointment_id IN (${marks})`)
    .bind(...appointmentIds)
    .all<SignOffRow>();
  return new Map(results.map((row) => [row.appointment_id, signOffOfRow(row)]));
}

/** Six digits, for the client to sign on the technician's phone. */
const newCode = (): string => String(100_000 + ((crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) % 900_000));

/**
 * Asks the client to sign off: first, or again once a flag is put right. The code a signature on the technician's
 * phone must carry, made fresh with each ask; null where the fit is signed or declined already, which nothing reopens.
 */
export async function askSignOff(
  db: D1Database,
  ask: { readonly appointmentId: string; readonly technicianId: string; readonly now: Date },
): Promise<{ readonly state: SignOffState; readonly code: string | null }> {
  const code = newCode();
  const at = ask.now.toISOString();
  const expires = new Date(ask.now.getTime() + PHONE_CODE_MS).toISOString();
  await db
    .prepare(
      `INSERT INTO fit_sign_offs (appointment_id, state, asked_at, asks, phone_code_hash, phone_code_expires_at,
         technician_id, updated_at)
       VALUES (?1, 'asked', ?2, 1, ?3, ?4, ?5, ?2)
       ON CONFLICT (appointment_id) DO UPDATE SET
         asks = asks + (CASE WHEN state = 'flagged' THEN 1 ELSE 0 END),
         state = CASE WHEN state IN ('signed', 'declined') THEN state ELSE 'asked' END,
         asked_at = CASE WHEN state = 'flagged' THEN excluded.asked_at ELSE asked_at END,
         phone_code_hash = CASE WHEN state IN ('signed', 'declined') THEN phone_code_hash ELSE excluded.phone_code_hash END,
         phone_code_expires_at =
           CASE WHEN state IN ('signed', 'declined') THEN phone_code_expires_at ELSE excluded.phone_code_expires_at END,
         technician_id = excluded.technician_id,
         updated_at = excluded.updated_at`,
    )
    .bind(ask.appointmentId, at, await sha256Hex(code), expires, ask.technicianId)
    .run();
  const row = await rowOf(db, ask.appointmentId);
  const state = row?.state ?? "asked";
  return { state, code: state === "asked" ? code : null };
}

/** The client's answer: happy with the fit, every check ticked; or something isn't right, in their words. */
export type SignOffAnswer =
  | { readonly result: "signed"; readonly checks: SignOffChecks }
  | { readonly result: "flagged"; readonly checks: SignOffChecks; readonly flagText: string };

export type AnswerRefusal = "not_asked" | "closed" | "checks_open" | "code_wrong";

/** Records the client's answer to an ask still open: a flag may be answered again, a sign-off is final. */
async function answer(
  db: D1Database,
  row: SignOffRow,
  given: SignOffAnswer & { readonly on: SignedOn; readonly now: Date },
): Promise<SignOff | AnswerRefusal> {
  if (given.result === "signed" && !SIGN_OFF_CHECKS.every((check) => given.checks[check])) return "checks_open";
  const at = given.now.toISOString();
  const signed = given.result === "signed";
  await db
    .prepare(
      `UPDATE fit_sign_offs SET state = ?2, checks = ?3, flag_text = ?4, signed_at = ?5, signed_on = ?6,
         phone_code_hash = NULL, phone_code_expires_at = NULL, updated_at = ?7
       WHERE appointment_id = ?1 AND state IN ('asked', 'flagged')`,
    )
    .bind(
      row.appointment_id,
      given.result,
      JSON.stringify(given.checks),
      signed ? null : given.flagText,
      signed ? at : null,
      signed ? given.on : null,
      at,
    )
    .run();
  const now = await rowOf(db, row.appointment_id);
  return now === null ? "not_asked" : signOffOfRow(now);
}

/** Whether the ask can be answered: asked, or flagged and not yet asked again. */
function openOrRefused(row: SignOffRow | null): SignOffRow | AnswerRefusal {
  if (row === null) return "not_asked";
  return row.state === "asked" || row.state === "flagged" ? row : "closed";
}

/** The client's answer from their own app, on a visit of theirs; "not_found" for any other. */
export async function signOffInApp(
  db: D1Database,
  given: SignOffAnswer & { readonly appointmentId: string; readonly personId: string; readonly now: Date },
): Promise<SignOff | AnswerRefusal | "not_found"> {
  const theirs = await db
    .prepare("SELECT 1 FROM appointments WHERE id = ?1 AND person_id = ?2 AND deleted_at IS NULL")
    .bind(given.appointmentId, given.personId)
    .first();
  if (theirs === null) return "not_found";
  const row = openOrRefused(await rowOf(db, given.appointmentId));
  if (typeof row === "string") return row;
  return answer(db, row, { ...given, on: "client_app" });
}

/** The client's answer on the technician's phone, which carries the code the ask gave it, once and in time. */
export async function signOffOnPhone(
  db: D1Database,
  given: SignOffAnswer & { readonly appointmentId: string; readonly code: string; readonly now: Date },
): Promise<SignOff | AnswerRefusal> {
  const row = openOrRefused(await rowOf(db, given.appointmentId));
  if (typeof row === "string") return row;
  const inTime = row.phone_code_expires_at !== null && Date.parse(row.phone_code_expires_at) > given.now.getTime();
  if (!inTime || row.phone_code_hash !== (await sha256Hex(given.code))) return "code_wrong";
  return answer(db, row, { ...given, on: "technician_phone" });
}

/**
 * Records that the client declined to sign, with why: the technician's only way to close a fit that needs a sign-off
 * without one, which opens a Tasks row. A fit signed already stays signed.
 */
export async function declineSignOff(
  db: D1Database,
  decline: {
    readonly appointmentId: string;
    readonly technicianId: string;
    readonly reason: string;
    readonly now: Date;
  },
): Promise<SignOff | "closed"> {
  const at = decline.now.toISOString();
  await db
    .prepare(
      `INSERT INTO fit_sign_offs (appointment_id, state, declined_reason, asked_at, asks, technician_id, updated_at)
       VALUES (?1, 'declined', ?2, ?3, 0, ?4, ?3)
       ON CONFLICT (appointment_id) DO UPDATE SET state = 'declined', declined_reason = excluded.declined_reason,
         phone_code_hash = NULL, phone_code_expires_at = NULL, technician_id = excluded.technician_id,
         updated_at = excluded.updated_at
       WHERE state <> 'signed'`,
    )
    .bind(decline.appointmentId, decline.reason, at, decline.technicianId)
    .run();
  const row = await rowOf(db, decline.appointmentId);
  if (row === null) return "closed";
  return row.state === "declined" ? signOffOfRow(row) : "closed";
}
