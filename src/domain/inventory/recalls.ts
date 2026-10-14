// Recalls (docs/decisions/0187-recalls.md): a lot blocked everywhere in one action. Its pieces leave the technicians'
// piece lists, its stock is taken last by every deduction and goes back with a kit's expired stock, and each piece of
// it a client wears is made due for replacement that day, so the Tasks board asks for its order, dated from the recall.
// Each client wearing it is told, and Care calls them until the replacement is booked. Where its stock is and who
// wears it are read from the ledger and the pieces.

import { auditStatement } from "../platform/audit.ts";
import type { Place } from "./stock-places.ts";
import type { Written } from "./stock.ts";
import { queueMessage } from "../messages/queued-messages.ts";
import { read, readAll } from "../../lib/read-all.ts";
import { type Refusal, refusal } from "../../lib/refusal.ts";

export interface Recall {
  readonly id: string;
  readonly number: number;
  readonly lotId: string;
  readonly lotCode: string;
  readonly code: string;
  readonly name: string;
  /** What one of the lot's item is counted in: strip, ml, piece. */
  readonly unit: string;
  readonly reason: string;
  readonly raisedAt: string;
  readonly closedAt: string | null;
}

export interface RecallDetail extends Recall {
  readonly held: { readonly placeId: Place; readonly place: string; readonly quantity: number }[];
  readonly worn: {
    readonly pieceId: string;
    readonly pieceCode: string;
    readonly personId: string;
    readonly person: string;
    readonly dueOn: string | null;
  }[];
}

export interface RecallableLot {
  readonly id: string;
  readonly lotCode: string;
  readonly code: string;
  readonly name: string;
}

type RecallRow = {
  id: string;
  number: number;
  lot_id: string;
  lot_code: string;
  code: string;
  name: string;
  unit: string;
  reason: string;
  raised_at: string;
  closed_at: string | null;
};

const recallOf = (row: RecallRow): Recall => ({
  id: row.id,
  number: row.number,
  lotId: row.lot_id,
  lotCode: row.lot_code,
  code: row.code,
  name: row.name,
  unit: row.unit,
  reason: row.reason,
  raisedAt: row.raised_at,
  closedAt: row.closed_at,
});

const RECALL = `SELECT r.id, r.number, r.lot_id, l.lot_code, l.consumable_code AS code, c.name, c.unit, r.reason, r.raised_at,
    r.closed_at
  FROM recalls r JOIN stock_lots l ON l.id = r.lot_id JOIN consumables c ON c.code = l.consumable_code`;

/** Every recall, the open first, then the latest. */
export async function recalls(db: D1Database): Promise<Recall[]> {
  const { results } = await db.prepare(`${RECALL} ORDER BY r.closed_at IS NOT NULL, r.raised_at DESC`).all<RecallRow>();
  return results.map(recallOf);
}

/** The lots not yet recalled that still have stock somewhere or a piece fitted, the latest received first. */
export async function recallableLots(db: D1Database): Promise<RecallableLot[]> {
  const { results } = await db
    .prepare(
      `SELECT l.id, l.lot_code, l.consumable_code AS code, c.name FROM stock_lots l
       JOIN consumables c ON c.code = l.consumable_code
       WHERE l.recalled_at IS NULL
         AND (EXISTS (SELECT 1 FROM stock_lot_balances b WHERE b.lot_id = l.id AND b.quantity > 0)
              OR EXISTS (SELECT 1 FROM stock_units u WHERE u.lot_id = l.id AND u.state = 'fitted'))
       ORDER BY l.received_at DESC LIMIT 200`,
    )
    .all<{ id: string; lot_code: string; code: string; name: string }>();
  return results.map((row) => ({ id: row.id, lotCode: row.lot_code, code: row.code, name: row.name }));
}

/** A recall with where its lot's stock is and who wears its pieces; null where there is none. */
export async function recallDetail(db: D1Database, id: string): Promise<RecallDetail | null> {
  const row = await db.prepare(`${RECALL} WHERE r.id = ?1`).bind(id).first<RecallRow>();
  if (row === null) return null;
  const { held, worn } = await readAll(db, {
    held: read<{ place: string; name: string | null; quantity: number }>(
      db
        .prepare(
          `SELECT b.place, COALESCE(p.name, t.name) AS name, b.quantity FROM stock_lot_balances b
         LEFT JOIN stock_places p ON p.id = b.place LEFT JOIN technicians t ON t.id = p.technician_id
         WHERE b.lot_id = ?1 AND b.quantity > 0 ORDER BY b.quantity DESC`,
        )
        .bind(row.lot_id),
    ),
    worn: read<{ id: string; code: string; person_id: string; person: string; due_on: string | null }>(
      db
        .prepare(
          `SELECT p.id, p.piece_code AS code, p.person_id, pe.name AS person, p.replacement_due_at AS due_on
         FROM stock_units u JOIN pieces p ON p.piece_code = u.code JOIN people pe ON pe.id = p.person_id
         WHERE u.lot_id = ?1 AND u.state = 'fitted' AND p.deleted_at IS NULL AND p.failed_at IS NULL
           AND p.replaced_at IS NULL AND pe.erased_at IS NULL
         ORDER BY pe.name COLLATE NOCASE`,
        )
        .bind(row.lot_id),
    ),
  });
  return {
    ...recallOf(row),
    held: held.map((each) => ({
      placeId: each.place,
      place: each.name ?? each.place,
      quantity: each.quantity,
    })),
    worn: worn.map((each) => ({
      pieceId: each.id,
      pieceCode: each.code,
      personId: each.person_id,
      person: each.person,
      dueOn: each.due_on,
    })),
  };
}

/**
 * A lot recalled, with why: blocked, and each piece of it a client wears made due today, keeping the day it was due
 * before. The recall's ID, or why not: no such lot, or one recalled already.
 */
export async function raiseRecall(
  db: D1Database,
  input: { readonly lotId: string; readonly reason: string; readonly today: string },
  written: Written,
): Promise<
  { readonly ok: true; readonly id: string; readonly messageIds: readonly string[] } | Refusal<"invalid_request">
> {
  const lot = await db
    .prepare("SELECT recalled_at FROM stock_lots WHERE id = ?1")
    .bind(input.lotId)
    .first<{ recalled_at: string | null }>();
  if (lot?.recalled_at !== null) return refusal("invalid_request", ["lot_id"]);
  const id = crypto.randomUUID();
  const at = written.now.toISOString();
  await db.batch([
    db
      .prepare(
        `INSERT INTO recalls (id, number, lot_id, reason, raised_by, raised_at)
         SELECT ?1, COALESCE(MAX(number), 0) + 1, ?2, ?3, ?4, ?5 FROM recalls`,
      )
      .bind(id, input.lotId, input.reason, written.actor.id, at),
    db.prepare("UPDATE stock_lots SET recalled_at = ?2 WHERE id = ?1 AND recalled_at IS NULL").bind(input.lotId, at),
    db
      .prepare(
        `INSERT INTO recall_pieces (recall_id, piece_id, due_before)
         SELECT ?1, p.id, p.replacement_due_at FROM stock_units u JOIN pieces p ON p.piece_code = u.code
         WHERE u.lot_id = ?2 AND u.state = 'fitted' AND p.deleted_at IS NULL AND p.failed_at IS NULL
           AND p.replaced_at IS NULL`,
      )
      .bind(id, input.lotId),
    db
      .prepare(
        `UPDATE pieces SET replacement_due_at = ?2
         WHERE id IN (SELECT piece_id FROM recall_pieces WHERE recall_id = ?1)
           AND (replacement_due_at IS NULL OR replacement_due_at > ?2)`,
      )
      .bind(id, input.today),
    auditStatement(
      db,
      {
        surface: "ops",
        actor: written.actor,
        action: "recall.raise",
        subject: { kind: "recall", id },
        requestId: written.requestId,
        detail: { lot_id: input.lotId },
      },
      written.now,
    ),
  ]);
  return { ok: true, id, messageIds: await tellWearers(db, id, written.now) };
}

/** Each client who wears the recalled lot, told once: one message each, however many of its pieces they wear. */
async function tellWearers(db: D1Database, recallId: string, now: Date): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT DISTINCT p.person_id FROM recall_pieces rp JOIN pieces p ON p.id = rp.piece_id
       JOIN people pe ON pe.id = p.person_id WHERE rp.recall_id = ?1 AND pe.erased_at IS NULL`,
    )
    .bind(recallId)
    .all<{ person_id: string }>();
  const messages = results.map((row) => ({ id: crypto.randomUUID(), personId: row.person_id }));
  if (messages.length === 0) return [];
  const at = now.toISOString();
  await db.batch(
    messages.map((message) =>
      queueMessage(db, { ...message, kind: "recall_notice", subject: { kind: "recall", id: recallId }, at }),
    ),
  );
  return messages.map((message) => message.id);
}

/** A recall closed once its stock and pieces are dealt with; the lot stays blocked. Whether there was one open. */
export async function closeRecall(db: D1Database, id: string, written: Written): Promise<boolean> {
  const closed = await db
    .prepare("UPDATE recalls SET closed_by = ?2, closed_at = ?3 WHERE id = ?1 AND closed_at IS NULL")
    .bind(id, written.actor.id, written.now.toISOString())
    .run();
  if (closed.meta.changes !== 1) return false;
  await auditStatement(
    db,
    {
      surface: "ops",
      actor: written.actor,
      action: "recall.close",
      subject: { kind: "recall", id },
      requestId: written.requestId,
    },
    written.now,
  ).run();
  return true;
}

/** The pieces a kit holds of recalled lots, by label: kept from the piece step's list. */
export async function recalledIn(db: D1Database, kit: Place): Promise<Map<string, string>> {
  const { results } = await db
    .prepare(
      `SELECT u.code, u.consumable_code FROM stock_units u INDEXED BY stock_units_held JOIN stock_lots l ON l.id = u.lot_id
       WHERE u.place = ?1 AND u.state = 'held' AND l.recalled_at IS NOT NULL`,
    )
    .bind(kit)
    .all<{ code: string; consumable_code: string }>();
  return new Map(results.map((row) => [row.code, row.consumable_code]));
}
