// Returned pieces handed in (docs/decisions/0169-supplier-claims.md): each traced, where it is one of ours, to the
// receipt it came in on by its unit's first move, and settled once: claimed on its supplier while inside the supplier's
// warranty, or written off with why. Either way its unit is written off, since a piece that came off a client never
// goes back into stock.

import { indiaDate } from "../../lib/india-time.ts";
import { warrantyEndsOn } from "../../policy/purchasing.ts";
import { auditStatementWhen, type AuditAction } from "../platform/audit.ts";
import { unitChanges } from "./stock-units.ts";
import type { Written } from "./stock.ts";
import { NEXT_CLAIM_NUMBER } from "../purchasing/supplier-claims.ts";

export interface ReturnedPiece {
  readonly id: string;
  readonly pieceCode: string;
  /** Its stock code's name; null for a piece that carries none of our labels. */
  readonly name: string | null;
  readonly reason: string | null;
  readonly returnedAt: string;
  readonly handedInAt: string;
  readonly handedInTo: string | null;
  readonly supplierId: string | null;
  /** The last day of its supplier's warranty, in India; null where it came in on no receipt. */
  readonly warrantyEndsOn: string | null;
  readonly inWarranty: boolean;
}

/** How many unsettled pieces the list shows, oldest handed in first. */
const SHOWN = 200;

type PieceRow = {
  id: string;
  piece_code: string;
  name: string | null;
  reason: string | null;
  returned_at: string;
  handed_in_at: string | null;
  handed_in_to: string | null;
  settled_at: string | null;
  unit_id: string | null;
  receipt_line_id: string | null;
  supplier_id: string | null;
  warranty_days: number | null;
  received_at: string | null;
};

// A piece, its unit while held as returned, and the receipt line its unit's first move came in on.
const PIECE_SQL = (from: string) => `SELECT pr.id, pr.piece_code, c.name, pr.reason, pr.returned_at, pr.handed_in_at,
    p.name AS handed_in_to, pr.settled_at, u.id AS unit_id, l.id AS receipt_line_id, o.supplier_id, s.warranty_days, r.received_at
  FROM ${from}
  LEFT JOIN stock_places p ON p.id = pr.handed_in_to
  LEFT JOIN stock_units u ON u.code = pr.piece_code AND u.state = 'returned'
  LEFT JOIN consumables c ON c.code = u.consumable_code
  LEFT JOIN receipt_lines l ON l.movement_id = (SELECT e.movement_id FROM stock_unit_events e
    WHERE e.unit_id = u.id AND e.movement_id IS NOT NULL ORDER BY e.at LIMIT 1)
  LEFT JOIN receipts r ON r.id = l.receipt_id
  LEFT JOIN purchase_orders o ON o.id = r.po_id
  LEFT JOIN suppliers s ON s.id = o.supplier_id`;

function pieceOf(row: PieceRow): ReturnedPiece {
  const ends =
    row.received_at === null || row.warranty_days === null ? null : warrantyEndsOn(row.received_at, row.warranty_days);
  return {
    id: row.id,
    pieceCode: row.piece_code,
    name: row.name,
    reason: row.reason,
    returnedAt: row.returned_at,
    handedInAt: row.handed_in_at ?? "",
    handedInTo: row.handed_in_to,
    supplierId: row.supplier_id,
    warrantyEndsOn: ends,
    inWarranty: ends !== null && indiaDate(new Date(row.returned_at)) <= ends,
  };
}

/** Every returned piece handed in and not yet settled, oldest first. */
export async function returnedPieces(db: D1Database): Promise<ReturnedPiece[]> {
  const { results } = await db
    .prepare(
      `${PIECE_SQL("piece_returns pr INDEXED BY piece_returns_to_settle")}
       WHERE pr.handed_in_at IS NOT NULL AND pr.settled_at IS NULL ORDER BY pr.handed_in_at LIMIT ?1`,
    )
    .bind(SHOWN)
    .all<PieceRow>();
  return results.map(pieceOf);
}

export type Settled =
  | { readonly ok: true }
  | { readonly ok: false; readonly missing: true }
  | { readonly ok: false; readonly state: true }
  | { readonly ok: false; readonly outOfWarranty: true };

/**
 * The return marked settled under `token`, where it is handed in, unsettled, and any claim it names was made; then its
 * unit written off and the audit entry, each only where the settlement landed.
 */
function settlement(
  db: D1Database,
  piece: {
    readonly row: PieceRow;
    readonly claimId: string | null;
    readonly reason: string | null;
    readonly photoId: string | null;
  },
  settled: { readonly action: AuditAction; readonly token: string },
  written: Written,
): D1PreparedStatement[] {
  const { row, claimId } = piece;
  const at = written.now.toISOString();
  const entry = {
    surface: "ops" as const,
    actor: written.actor,
    action: settled.action,
    subject: { kind: "piece_return", id: row.id },
    requestId: written.requestId,
    detail: { claim: claimId },
  };
  const landed = "EXISTS (SELECT 1 FROM piece_returns WHERE id = ? AND settlement_id = ?)";
  return [
    db
      .prepare(
        `UPDATE piece_returns SET settled_at = ?2, settled_by = ?3, claim_id = ?4, write_off_reason = ?5, settlement_id = ?6,
           photo_id = ?7
         WHERE id = ?1 AND handed_in_at IS NOT NULL AND settled_at IS NULL
           AND (?4 IS NULL OR EXISTS (SELECT 1 FROM supplier_claims WHERE id = ?4))`,
      )
      .bind(row.id, at, written.actor.id, claimId, piece.reason, settled.token, piece.photoId),
    ...unitChanges(
      db,
      {
        units: row.unit_id === null ? [] : [row.unit_id],
        state: "written_off",
        place: null,
        movementId: null,
        at,
        actor: written.actor.id,
      },
      { sql: landed, binds: [row.id, settled.token] },
    ),
    auditStatementWhen(db, entry, written.now, {
      sql: "EXISTS (SELECT 1 FROM piece_returns WHERE id = ?10 AND settlement_id = ?11)",
      binds: [row.id, settled.token],
    }),
  ];
}

/** Whether the settlement under `token` landed; where not, why. */
async function outcome(db: D1Database, id: string, token: string): Promise<Settled> {
  const row = await db
    .prepare("SELECT settlement_id FROM piece_returns WHERE id = ?1")
    .bind(id)
    .first<{ settlement_id: string | null }>();
  if (row === null) return { ok: false, missing: true };
  return row.settlement_id === token ? { ok: true } : { ok: false, state: true };
}

function pieceRow(db: D1Database, id: string): Promise<PieceRow | null> {
  return db
    .prepare(`${PIECE_SQL("piece_returns pr")} WHERE pr.id = ?1`)
    .bind(id)
    .first<PieceRow>();
}

/**
 * A claim on the supplier of a returned piece inside its warranty: one piece, at its order line's price. Refused for
 * a piece settled already, and for one that came in on no receipt or whose warranty has ended.
 */
export async function claimReturn(db: D1Database, id: string, written: Written): Promise<Settled> {
  const row = await pieceRow(db, id);
  if (row === null) return { ok: false, missing: true };
  if (row.settled_at !== null || row.handed_in_at === null) return { ok: false, state: true };
  if (!pieceOf(row).inWarranty || row.receipt_line_id === null || row.unit_id === null) {
    return { ok: false, outOfWarranty: true };
  }
  const claimId = crypto.randomUUID();
  const token = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        `INSERT INTO supplier_claims (id, number, supplier_id, consumable_code, quantity, reason, receipt_line_id,
           unit_id, unit_price, currency, state, drafted_by, drafted_at)
         SELECT ?1, ${NEXT_CLAIM_NUMBER}, o.supplier_id, p.consumable_code, 1, 'warranty', l.id, ?3, p.unit_price,
           o.currency, 'drafted', ?4, ?5
         FROM receipt_lines l JOIN po_lines p ON p.id = l.po_line_id JOIN purchase_orders o ON o.id = p.po_id
         WHERE l.id = ?2
           AND EXISTS (SELECT 1 FROM piece_returns WHERE id = ?6 AND handed_in_at IS NOT NULL AND settled_at IS NULL)`,
      )
      .bind(claimId, row.receipt_line_id, row.unit_id, written.actor.id, written.now.toISOString(), id),
    ...settlement(db, { row, claimId, reason: null, photoId: null }, { action: "piece_return.claim", token }, written),
  ]);
  return outcome(db, id, token);
}

/** A returned piece written off, with why and its photograph: out of warranty, or not worth claiming. */
export async function writeOffReturn(
  db: D1Database,
  id: string,
  writeOff: { readonly reason: string; readonly photoId: string },
  written: Written,
): Promise<Settled> {
  const row = await pieceRow(db, id);
  if (row === null) return { ok: false, missing: true };
  const token = crypto.randomUUID();
  const piece = { row, claimId: null, reason: writeOff.reason, photoId: writeOff.photoId };
  await db.batch(settlement(db, piece, { action: "piece_return.write_off", token }, written));
  return outcome(db, id, token);
}
