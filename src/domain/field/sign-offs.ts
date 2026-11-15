// The client's sign-off of a fit (docs/decisions/0254-client-signs-off-the-fit.md), one row a visit: the technician
// asks, and asks again once a flag is put right; the client signs or flags in their own app, and only there; or the
// technician records that the client declined to sign, with why. A fit that needs one (src/policy/sign-off.ts) closes
// done only once it is signed or declined.
//
// The technician's writes come through their phone's outbox, each with its event ID, so each lands once however often
// it is sent: an event sent again is answered as it was, and a write on a fit signed or declined since is answered with
// where it stands, so the phone's queue goes on to the close behind it.

import { SIGN_OFF_CHECKS, type SignOffCheck, type SignOffState } from "../../policy/sign-off.ts";

export type SignOffChecks = Readonly<Record<SignOffCheck, boolean>>;

export interface SignOff {
  readonly state: SignOffState;
  readonly checks: SignOffChecks | null;
  readonly flag_text: string | null;
  readonly declined_reason: string | null;
  readonly asked_at: string;
  readonly asks: number;
  readonly signed_at: string | null;
  /** The fit guarantee's days in force when it was signed or declined; null before then. */
  readonly guarantee_days: number | null;
}

interface SignOffRow extends Omit<SignOff, "checks"> {
  readonly appointment_id: string;
  readonly checks: string | null;
  readonly ask_event_id: string | null;
}

const COLUMNS = `appointment_id, state, checks, flag_text, declined_reason, asked_at, asks, signed_at, guarantee_days,
  ask_event_id`;

/** Signed or declined: nothing reopens it. */
const FINAL = "('signed', 'declined')";

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
  guarantee_days: row.guarantee_days,
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

/** The sign-off as the client is shown it: the technician's why they did not sign is written for Care, not for them. */
export function clientsView(signOff: SignOff): SignOff;
export function clientsView(signOff: SignOff | null): SignOff | null;
export function clientsView(signOff: SignOff | null): SignOff | null {
  return signOff === null ? null : { ...signOff, declined_reason: null };
}

/** The technician's write: whose, which visit, under which of their phone's events, and when. */
interface PhoneWrite {
  readonly appointmentId: string;
  readonly technicianId: string;
  readonly eventId: string;
  readonly now: Date;
}

/** Writes an ask, or asks again once a flag is put right, in one statement; nothing on a fit signed or declined. */
const askStatement = (db: D1Database, ask: PhoneWrite): D1PreparedStatement =>
  db
    .prepare(
      `INSERT INTO fit_sign_offs (appointment_id, state, asked_at, asks, ask_event_id, technician_id, updated_at)
       VALUES (?1, 'asked', ?2, 1, ?3, ?4, ?2)
       ON CONFLICT (appointment_id) DO UPDATE SET
         asks = asks + (CASE WHEN state = 'flagged' THEN 1 ELSE 0 END),
         asked_at = CASE WHEN state = 'flagged' THEN excluded.asked_at ELSE asked_at END,
         state = 'asked', ask_event_id = excluded.ask_event_id, technician_id = excluded.technician_id,
         updated_at = excluded.updated_at
       WHERE state NOT IN ${FINAL} AND ask_event_id IS NOT excluded.ask_event_id`,
    )
    .bind(ask.appointmentId, ask.now.toISOString(), ask.eventId, ask.technicianId);

/** Asks the client to sign off, first or again once a flag is put right; the sign-off as it then stands. */
export async function askSignOff(db: D1Database, ask: PhoneWrite): Promise<SignOff | null> {
  await askStatement(db, ask).run();
  return signOffOf(db, ask.appointmentId);
}

/** The client's answer: happy with the fit, every check ticked; or something isn't right, in their words. */
export type SignOffAnswer =
  | { readonly result: "signed"; readonly checks: SignOffChecks }
  | { readonly result: "flagged"; readonly checks: SignOffChecks; readonly flagText: string };

export type AnswerRefusal = "not_asked" | "closed" | "checks_open";

/**
 * Records the client's answer to an ask still open. A signature keeps the last flag's words, so Care can see the client
 * said something wasn't right first.
 */
async function answer(
  db: D1Database,
  appointmentId: string,
  given: SignOffAnswer & { readonly guaranteeDays: number; readonly now: Date },
): Promise<boolean> {
  const at = given.now.toISOString();
  const signed = given.result === "signed";
  const written = await db
    .prepare(
      `UPDATE fit_sign_offs SET state = ?2, checks = ?3, flag_text = COALESCE(?4, flag_text), signed_at = ?5,
         updated_at = ?6, guarantee_days = ?7
       WHERE appointment_id = ?1 AND state IN ('asked', 'flagged')`,
    )
    .bind(
      appointmentId,
      given.result,
      JSON.stringify(given.checks),
      signed ? null : given.flagText,
      signed ? at : null,
      at,
      signed ? given.guaranteeDays : null,
    )
    .run();
  return written.meta.changes === 1;
}

const allTicked = (given: SignOffAnswer): boolean =>
  given.result !== "signed" || SIGN_OFF_CHECKS.every((check) => given.checks[check]);

/** The client's answer from their own app, on a visit of theirs; "not_found" for any other. A sign-off is final. */
export async function signOffInApp(
  db: D1Database,
  given: SignOffAnswer & {
    readonly appointmentId: string;
    readonly personId: string;
    readonly guaranteeDays: number;
    readonly now: Date;
  },
): Promise<SignOff | AnswerRefusal | "not_found"> {
  const theirs = await db
    .prepare("SELECT 1 FROM appointments WHERE id = ?1 AND person_id = ?2 AND deleted_at IS NULL")
    .bind(given.appointmentId, given.personId)
    .first();
  if (theirs === null) return "not_found";
  if (!allTicked(given)) return "checks_open";
  const row = await rowOf(db, given.appointmentId);
  if (row === null) return "not_asked";
  if (row.state !== "asked" && row.state !== "flagged") return "closed";
  if (!(await answer(db, given.appointmentId, given))) return "closed";
  return (await signOffOf(db, given.appointmentId)) ?? "not_asked";
}

/** Writes that the client declined to sign, with why; nothing on a fit signed already. */
const declineStatement = (
  db: D1Database,
  decline: PhoneWrite & { readonly reason: string; readonly guaranteeDays: number },
): D1PreparedStatement =>
  db
    .prepare(
      `INSERT INTO fit_sign_offs (appointment_id, state, declined_reason, asked_at, asks, technician_id, updated_at,
         guarantee_days)
       VALUES (?1, 'declined', ?2, ?3, 0, ?4, ?3, ?5)
       ON CONFLICT (appointment_id) DO UPDATE SET state = 'declined', declined_reason = excluded.declined_reason,
         technician_id = excluded.technician_id, updated_at = excluded.updated_at,
         guarantee_days = excluded.guarantee_days
       WHERE state NOT IN ${FINAL}`,
    )
    .bind(
      decline.appointmentId,
      decline.reason,
      decline.now.toISOString(),
      decline.technicianId,
      decline.guaranteeDays,
    );

/**
 * Records that the client declined to sign, with why: the technician's only way to close a fit that needs a sign-off
 * without one, which gives Care a Tasks row once the fit closes. A fit signed, or declined, already stays as it is, and
 * is answered with where it stands.
 */
export async function declineSignOff(
  db: D1Database,
  decline: PhoneWrite & { readonly reason: string; readonly guaranteeDays: number },
): Promise<SignOff | null> {
  await declineStatement(db, decline).run();
  return signOffOf(db, decline.appointmentId);
}

/**
 * Written in the batch of ops' close of a fit by hand, as done, where the client never signed: recorded as declined,
 * ops' close as why, so Care are given its Tasks row as for any fit closed without one. It writes only where that
 * batch's close landed, by whom and when, so a close refused writes nothing.
 */
export const unsignedByHand = (
  db: D1Database,
  close: {
    readonly appointmentId: string;
    readonly technicianId: string | null;
    readonly reason: string;
    readonly guaranteeDays: number;
    readonly at: string;
    /** Who closed it, as the close records them. */
    readonly by: string;
  },
): D1PreparedStatement =>
  db
    .prepare(
      `INSERT INTO fit_sign_offs (appointment_id, state, declined_reason, asked_at, asks, technician_id, updated_at,
         guarantee_days)
       SELECT ?1, 'declined', ?2, ?3, 0, ?4, ?3, ?5
       WHERE EXISTS (SELECT 1 FROM visit_outcomes WHERE appointment_id = ?1 AND closed_by = ?6 AND updated_at = ?3)
       ON CONFLICT (appointment_id) DO UPDATE SET state = 'declined', declined_reason = excluded.declined_reason,
         updated_at = excluded.updated_at, guarantee_days = excluded.guarantee_days
       WHERE state NOT IN ${FINAL}`,
    )
    .bind(close.appointmentId, close.reason, close.at, close.technicianId, close.guaranteeDays, close.by);
