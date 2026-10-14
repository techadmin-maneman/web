// What a client is owed again, free (docs/decisions/0192-free-remakes.md): a first fit or replacement left partly done
// that ops have not closed, a piece they wear from a recalled lot, and a piece that failed with none fitted since. Ops
// book it from the Tasks row, the recall or the client's page, with nothing to pay and no late fee; the payment the
// client made for the visit left partly done stays with it.

import { statusIn, VISIT_LIVE } from "../../config/statuses.ts";
import { FREE_CHANGE_NOTICE_HOURS, type SoldTerms } from "../../policy/moving-a-visit.ts";
import { paidNotBooked } from "./hold-stages.ts";

/** A remake costs the client nothing to move, cancel or miss. */
export const REMAKE_TERMS: SoldTerms = {
  noticeHours: FREE_CHANGE_NOTICE_HOURS,
  lateCharge: "nothing",
  noShowCharge: "nothing",
};

/** Why a visit is owed: partly done, a recalled lot, or a piece that failed. */
type RemakeWhy = "partial" | "recall" | "failed";

export interface Remake {
  /** The visit left partly done, or the piece to replace. */
  readonly id: string;
  readonly why: RemakeWhy;
  readonly kind: "first_fit" | "replacement";
  /** The piece's label; null for a visit. */
  readonly pieceCode: string | null;
  /** When it became owed: the visit's start, the recall, or the failure. */
  readonly since: string;
}

/** The first fits and replacements of client ?1's left partly done, whose Tasks row ops have not closed. */
export const PARTIAL_OWED = `SELECT a.id, 'partial' AS why, a.type AS kind, NULL AS piece_code,
    a.window_start AS since
  FROM visit_outcomes v JOIN appointments a ON a.id = v.appointment_id
  WHERE a.person_id = ?1 AND a.deleted_at IS NULL AND a.type IN ('first_fit', 'replacement')
    AND v.outcome = 'partial' AND v.followed_up = 0 AND COALESCE(v.partial_reason, '') <> 'no_show'
    AND NOT EXISTS (SELECT 1 FROM task_closures c WHERE c.task_group = 'partial_visit' AND c.subject_id = a.id)`;

/**
 * Client ?1's pieces of an open recall, and those that failed, with no piece fitted after them and no replacement on
 * its way: booked, or paid for and still to be booked.
 */
export const PIECES_OWED = `SELECT p.id,
    CASE WHEN r.id IS NULL THEN 'failed' ELSE 'recall' END AS why, 'replacement' AS kind, p.piece_code,
    COALESCE(r.raised_at, p.failed_at) AS since
  FROM pieces p
  LEFT JOIN recall_pieces rp ON rp.piece_id = p.id
  LEFT JOIN recalls r ON r.id = rp.recall_id AND r.closed_at IS NULL
  WHERE p.person_id = ?1 AND p.deleted_at IS NULL AND p.fitted_at IS NOT NULL AND p.replaced_at IS NULL
    AND (r.id IS NOT NULL OR p.failed_at IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM pieces n
                     WHERE n.person_id = p.person_id AND n.deleted_at IS NULL AND n.fitted_at > p.fitted_at)
    AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.person_id = p.person_id AND a.type = 'replacement'
                     AND a.deleted_at IS NULL AND ${statusIn("a.status", VISIT_LIVE)})
    AND NOT EXISTS (SELECT 1 FROM slot_holds h WHERE h.person_id = p.person_id AND h.type = 'replacement'
                     AND ${paidNotBooked("h")})`;

interface RemakeRow {
  id: string;
  why: RemakeWhy;
  kind: "first_fit" | "replacement";
  piece_code: string | null;
  since: string;
}

/** Everything the client is owed, oldest first; one piece in a recall and failed is owed once, for the recall. */
export async function remakesOwed(db: D1Database, personId: string): Promise<Remake[]> {
  const { results } = await db
    .prepare(`SELECT * FROM (${PARTIAL_OWED} UNION ALL ${PIECES_OWED}) ORDER BY since, id`)
    .bind(personId)
    .all<RemakeRow>();
  const seen = new Map<string, Remake>();
  for (const row of results) {
    const was = seen.get(row.id);
    if (was === undefined || row.why === "recall") {
      seen.set(row.id, { id: row.id, why: row.why, kind: row.kind, pieceCode: row.piece_code, since: row.since });
    }
  }
  return [...seen.values()];
}

/** Closes the partly done visit's Tasks row as the remake is booked, so it is owed once. */
export function remakeBookedStatement(
  db: D1Database,
  remake: Remake,
  by: { readonly actor: string; readonly now: Date },
): D1PreparedStatement | null {
  if (remake.why !== "partial") return null;
  return db
    .prepare(
      `INSERT OR IGNORE INTO task_closures (id, task_group, subject_id, reason, closed_by, closed_at)
       VALUES (?1, 'partial_visit', ?2, 'Booked again, free', ?3, ?4)`,
    )
    .bind(crypto.randomUUID(), remake.id, by.actor, by.now.toISOString());
}
