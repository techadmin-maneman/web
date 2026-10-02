// Discount codes (docs/decisions/0108-discount-codes.md; the rules are src/policy/discount-codes.ts): ops make them
// in Settings · Discount codes, one at a press or a batch of single-use codes, and may switch one off at any time,
// which stops it being entered and leaves every use it has on record.
//
// A code entered on a booking is a use (src/domain/discount-code-uses.ts; a hold's, src/domain/discount-code-holds.ts).
// A use stands while it is not taken off and its booking still holds: one on a hold that was let go, or that stopped
// keeping its time with nothing paid, no longer stands. Only a use that stands counts against its code's limits, or
// takes money off.

import {
  CODE_ALPHABET,
  COVERABLE,
  GENERATED_LENGTH,
  normalisedCode,
  termsRefusal,
  type Coverable,
  type DiscountKind,
  type DiscountTerms,
} from "../policy/discount-codes.ts";
import { auditStatement, auditStatementIfStamped, type AuditActor, type AuditEntry } from "./audit.ts";
import { graceEnds } from "./scheduling.ts";

/** A code's row. */
export interface CodeRow {
  id: string;
  code: string;
  kind: DiscountKind;
  value: number;
  cap: number | null;
  covers_first_fit: number;
  covers_service: number;
  covers_replacement: number;
  expires_on: string | null;
  max_uses: number | null;
  once_per_client: number;
  batch_id: string | null;
  created_by: string;
  created_at: string;
  switched_off_by: string | null;
  switched_off_at: string | null;
}

/** A code's columns, `c` naming discount_codes in the query. */
export const CODE_COLUMNS = `c.id, c.code, c.kind, c.value, c.cap, c.covers_first_fit, c.covers_service,
  c.covers_replacement, c.expires_on, c.max_uses, c.once_per_client, c.batch_id, c.created_by, c.created_at,
  c.switched_off_by, c.switched_off_at`;

export const coversOf = (row: CodeRow): Coverable[] => COVERABLE.filter((kind) => row[`covers_${kind}`] === 1);

export const termsOf = (row: { kind: DiscountKind; value: number; cap: number | null }): DiscountTerms => ({
  kind: row.kind,
  value: row.value,
  cap: row.cap,
});

/**
 * Whether a use stands, `use` naming the discount_code_uses row and `now` the bound parameter for now: not taken off
 * its booking, not on a hold that was let go, or that stopped keeping its time with nothing paid, and not on a visit
 * cancelled, by the client, by ops or by FSM, which gives the code back, as the owner ruled on 1 October 2026.
 */
export const standing = (use: string, now: string): string =>
  `${use}.removed_at IS NULL AND (${use}.hold_id IS NULL OR EXISTS (
     SELECT 1 FROM slot_holds held WHERE held.id = ${use}.hold_id AND (held.state = 'booked'
       OR (held.state = 'held' AND (held.confirmed_at IS NOT NULL OR ${graceEnds("held")} > ${now})))))
   AND NOT EXISTS (SELECT 1 FROM appointments gone
     WHERE gone.id IN (${use}.appointment_id, (SELECT booked.appointment_id FROM slot_holds booked WHERE booked.id = ${use}.hold_id))
       AND (gone.status = 'cancelled' OR gone.deleted_at IS NOT NULL))`;

/** What ops ask for when they make codes. */
export interface NewCodes {
  /** A code ops typed, made alone; null to generate them. */
  readonly code: string | null;
  /** How many to generate: one, or a batch of single-use codes. */
  readonly count: number;
  readonly kind: DiscountKind;
  readonly value: number;
  readonly cap: number | null;
  readonly covers: readonly Coverable[];
  readonly expiresOn: string | null;
  readonly maxUses: number | null;
  readonly oncePerClient: boolean;
}

/** The most codes one press generates. */
export const BATCH_MOST = 100;

/** A code of GENERATED_LENGTH characters of the alphabet, each as likely as any other. */
function generatedCode(): string {
  // The largest multiple of the alphabet's length under 256: a byte at or above it is thrown away, so no character
  // is likelier than another.
  const below = 256 - (256 % CODE_ALPHABET.length);
  let code = "";
  while (code.length < GENERATED_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(GENERATED_LENGTH))) {
      if (byte < below && code.length < GENERATED_LENGTH) code += CODE_ALPHABET.charAt(byte % CODE_ALPHABET.length);
    }
  }
  return code;
}

type Made = { readonly kind: "made"; readonly codes: readonly string[] } | { readonly kind: "code_exists" };

/** Who makes a change, under which request, and when. */
interface Change {
  readonly actor: AuditActor;
  readonly requestId: string;
  readonly now: Date;
}

/** Generated codes that met one already made are generated again, this many times; a typed code is refused. */
const GENERATION_TRIES = 3;

/** Makes the codes, with their audit entry, IDs and codes only, in one batch. */
export async function makeCodes(db: D1Database, input: NewCodes, change: Change): Promise<Made> {
  const refused = termsRefusal(input);
  if (refused !== null) throw new Error(`A discount code cannot be made with that ${refused}.`);
  for (let tries = 0; tries < GENERATION_TRIES; tries += 1) {
    const codes =
      input.code === null ? Array.from({ length: input.count }, generatedCode) : [normalisedCode(input.code)];
    try {
      await db.batch(codeStatements(db, codes, input, change));
      return { kind: "made", codes };
    } catch (error) {
      if (!(error instanceof Error && error.message.includes("UNIQUE"))) throw error;
      if (input.code !== null) return { kind: "code_exists" };
    }
  }
  return { kind: "code_exists" };
}

function codeStatements(
  db: D1Database,
  codes: readonly string[],
  input: NewCodes,
  change: Change,
): D1PreparedStatement[] {
  const at = change.now.toISOString();
  const batchId = codes.length > 1 ? crypto.randomUUID() : null;
  const ids = codes.map(() => crypto.randomUUID());
  const covers = (kind: Coverable) => (input.covers.includes(kind) ? 1 : 0);
  const inserts = codes.map((code, index) =>
    db
      .prepare(
        `INSERT INTO discount_codes (id, code, kind, value, cap, covers_first_fit, covers_service, covers_replacement,
           expires_on, max_uses, once_per_client, batch_id, created_by, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
      )
      .bind(
        ids[index],
        code,
        input.kind,
        input.value,
        input.kind === "percent" ? input.cap : null,
        covers("first_fit"),
        covers("service"),
        covers("replacement"),
        input.expiresOn,
        input.maxUses,
        input.oncePerClient ? 1 : 0,
        batchId,
        change.actor.id,
        at,
      ),
  );
  const entry: AuditEntry = {
    surface: "ops",
    actor: change.actor,
    action: "discount_code.make",
    subject: { kind: "discount_code", id: batchId ?? ids[0] ?? "" },
    requestId: change.requestId,
    detail: { count: codes.length, codes: codes.join(" ") },
  };
  return [...inserts, auditStatement(db, entry, change.now)];
}

/** A code as the console lists it: its terms, who made it, whether it is off, and what it has taken off so far. */
interface ListedCode {
  readonly id: string;
  readonly code: string;
  readonly kind: DiscountKind;
  readonly value: number;
  readonly cap: number | null;
  readonly covers: Coverable[];
  readonly expires_on: string | null;
  readonly max_uses: number | null;
  readonly once_per_client: boolean;
  readonly batch_id: string | null;
  readonly created_by: string;
  readonly created_at: string;
  readonly switched_off: { readonly by: string; readonly at: string } | null;
  /** The bookings it stands on. */
  readonly uses: number;
  /** What it has taken off those bookings, in paise before GST, as far as their prices are known. */
  readonly given: number;
}

/** How many codes the list shows: the latest made. One code is found by its text, however old. */
export const LISTED_MOST = 200;

export async function listCodes(db: D1Database, now: Date, find: string | null): Promise<ListedCode[]> {
  const { results } = await db
    .prepare(
      `SELECT ${CODE_COLUMNS},
         (SELECT COUNT(*) FROM discount_code_uses u WHERE u.code_id = c.id AND ${standing("u", "?1")}) AS uses,
         (SELECT COALESCE(SUM(u.amount_off), 0) FROM discount_code_uses u
           WHERE u.code_id = c.id AND ${standing("u", "?1")}) AS given
       FROM discount_codes c WHERE ?2 IS NULL OR c.code = ?2
       ORDER BY c.created_at DESC, c.code LIMIT ?3`,
    )
    .bind(now.toISOString(), find === null ? null : normalisedCode(find), LISTED_MOST)
    .all<CodeRow & { uses: number; given: number }>();
  return results.map((row) => ({
    id: row.id,
    code: row.code,
    kind: row.kind,
    value: row.value,
    cap: row.cap,
    covers: coversOf(row),
    expires_on: row.expires_on,
    max_uses: row.max_uses,
    once_per_client: row.once_per_client === 1,
    batch_id: row.batch_id,
    created_by: row.created_by,
    created_at: row.created_at,
    switched_off:
      row.switched_off_by === null || row.switched_off_at === null
        ? null
        : { by: row.switched_off_by, at: row.switched_off_at },
    uses: row.uses,
    given: row.given,
  }));
}

/** Switches a code off, with its audit entry: no booking takes it from then on, and its uses stay as they are. */
export async function switchOff(
  db: D1Database,
  id: string,
  change: Change,
): Promise<"switched_off" | "already_off" | "not_found"> {
  const row = await db
    .prepare("SELECT code, switched_off_at FROM discount_codes WHERE id = ?1")
    .bind(id)
    .first<{ code: string; switched_off_at: string | null }>();
  if (row === null) return "not_found";
  if (row.switched_off_at !== null) return "already_off";
  const entry: AuditEntry = {
    surface: "ops",
    actor: change.actor,
    action: "discount_code.switch_off",
    subject: { kind: "discount_code", id },
    requestId: change.requestId,
    detail: { code: row.code },
  };
  await db.batch([
    db
      .prepare(
        "UPDATE discount_codes SET switched_off_by = ?2, switched_off_at = ?3 WHERE id = ?1 AND switched_off_at IS NULL",
      )
      .bind(id, change.actor.id, change.now.toISOString()),
    auditStatementIfStamped(db, entry, change.now, { table: "discount_codes", column: "switched_off_at", id }),
  ]);
  return "switched_off";
}
