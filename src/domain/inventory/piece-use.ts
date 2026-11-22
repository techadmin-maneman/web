// A piece fitted, out of the technician's kit (docs/decisions/0156-hair-systems-in-stock.md): the hair system the piece
// step names comes out of their kit as the step lands, once however often it does, and a later step naming another
// corrects by the difference, as a job's use of consumables does (src/domain/field/job-use.ts). A step naming none,
// or a one visit's client deciding against the fit, takes nothing.
//
// The piece is the unit its label names, where the kit holds it, and that unit is fitted
// (docs/decisions/0161-pieces-as-units.md). A label we never made takes a piece never labelled, or failing one, a unit,
// which has then gone missing. A piece with no label at all (docs/decisions/0291-pieces-without-labels.md) takes one the
// same way, in date first, and it is fitted; a unit so taken carries the label made for the piece from then on, so a recall, a
// warranty or a supplier's failures, which find a unit's piece by its label, still find it. A correction puts the units
// the visit took back in the kit. A piece that came off is held in the kit as returned
// (src/domain/inventory/piece-returns.ts).

import { useStillToRecord } from "../../policy/stock.ts";
import { latestStep, takenFor, takenFromKit } from "../field/job-use.ts";
import { failureWordsOf, jobSheet } from "../field/job-sheet-settings.ts";
import { pieceStepOf } from "./pieces.ts";
import { fitsNothing, pieceBodyOf } from "../field/job-event-bodies.ts";
import { pieceReturnStatements } from "./piece-returns.ts";
import { givenBackToLots, inDateAt } from "./stock-lots.ts";
import { takenFrom, takesOf, unitChanges, type Taken } from "./stock-units.ts";

/** The hair system a piece step's body names, if any. */
function stockCodeOf(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("stock_code" in body)) return null;
  return typeof body.stock_code === "string" ? body.stock_code : null;
}

/** What one stock code's row moves of the kit's pieces, and the state its units go into. */
interface PieceMove extends Taken {
  readonly state: "fitted" | "missing" | "held";
}

async function pieceMove(
  db: D1Database,
  move: {
    readonly code: string;
    readonly quantity: number;
    readonly label: string | null;
    readonly noLabel: boolean;
    readonly jobId: string;
    readonly day: string;
  },
  kit: string,
): Promise<PieceMove> {
  if (move.quantity < 0) {
    const named = move.label === null || move.noLabel ? null : [move.label];
    const fitted = named === null ? null : await takenFrom(db, { code: move.code, place: kit, quantity: 1, named });
    if (fitted !== null) return { ...fitted, state: "fitted" };
    // With no label to read its expiry from, the piece is one of a lot in date on the visit's day, where the kit has one.
    const lotId = move.noLabel ? (await inDateAt(db, { code: move.code, place: kit, day: move.day })).lotId : null;
    const leaving = { code: move.code, place: kit, quantity: -move.quantity, lotId, prefer: "unlabelled" } as const;
    const taken = await takenFrom(db, leaving);
    // A label read but not the kit's is a unit gone missing; a piece with none to read is the one fitted.
    return { units: taken?.units ?? [], takes: taken?.takes ?? [], state: move.noLabel ? "fitted" : "missing" };
  }
  const { results } = await db
    .prepare(
      `SELECT id, lot_id FROM stock_units INDEXED BY stock_units_by_visit
       WHERE appointment_id = ?1 AND consumable_code = ?2 AND state IN ('fitted', 'missing')
       ORDER BY moved_at DESC LIMIT ?3`,
    )
    .bind(move.jobId, move.code, move.quantity)
    .all<{ id: string; lot_id: string | null }>();
  const takes =
    results.length === move.quantity
      ? takesOf(results.map((row) => ({ lotId: row.lot_id })))
      : await givenBackToLots(db, { jobId: move.jobId, kit, code: move.code, quantity: move.quantity });
  return { units: results.map((row) => row.id), takes, state: "held" };
}

/**
 * A unit fitted where the piece had no label to read takes the label made for it, unless another unit carries that
 * label already, when the fit still lands and the unit keeps its own.
 */
function relabelled(
  db: D1Database,
  fit: { readonly moves: Iterable<PieceMove>; readonly label: string | null; readonly jobId: string },
): D1PreparedStatement[] {
  if (fit.label === null) return [];
  const units = [...fit.moves].flatMap((move) => (move.state === "fitted" ? move.units : []));
  return units.map((unit) =>
    db
      .prepare(
        `UPDATE stock_units SET code = ?1 WHERE id = ?2 AND state = 'fitted' AND appointment_id = ?3
           AND NOT EXISTS (SELECT 1 FROM stock_units WHERE code = ?1)`,
      )
      .bind(fit.label, unit, fit.jobId),
  );
}

/** The piece a replacement's step names as come off, with why where it failed; null for none. */
function oldPieceOf(body: unknown): { readonly code: string; readonly reason: string | null } | null {
  const piece = pieceBodyOf(body);
  if (piece === null || fitsNothing(piece) || piece.old_piece === null || piece.old_piece === undefined) return null;
  return { code: piece.old_piece.piece_code, reason: piece.old_piece.failure_reason ?? null };
}

/**
 * Why the piece that came off goes back: the step's reason, in its words; else the failure Care marked on it before the
 * visit (docs/decisions/0273-why-a-hair-system-failed.md); none for one that was due.
 */
async function returnReason(
  db: D1Database,
  jobId: string,
  oldPiece: { readonly code: string; readonly reason: string | null },
): Promise<string | null> {
  if (oldPiece.reason !== null) return failureWordsOf(await jobSheet(db), oldPiece.reason).words;
  return db
    .prepare(
      `SELECT p.failure_reason FROM pieces p JOIN appointments a ON a.person_id = p.person_id
       WHERE a.id = ?1 AND p.piece_code = ?2 AND p.deleted_at IS NULL AND p.failed_at IS NOT NULL`,
    )
    .bind(jobId, oldPiece.code)
    .first<string>("failure_reason");
}

/** Records the piece the technician's latest piece step fitted, from their kit. Returns whether their kit went down. */
export async function recordPieceUse(
  db: D1Database,
  input: { readonly jobId: string; readonly technicianId: string; readonly now: Date; readonly day: string },
): Promise<{ readonly lowered: boolean }> {
  const { jobId, technicianId } = input;
  const latest = await db
    .prepare(`SELECT id, body FROM job_events WHERE id = (${latestStep({ job: "?1", technician: "?2" }, "piece")})`)
    .bind(jobId, technicianId)
    .first<{ id: string; body: string }>();
  if (latest === null) return { lowered: false };

  const body: unknown = JSON.parse(latest.body);
  const code = stockCodeOf(body);
  const fitted = new Map(code === null ? [] : [[code, 1]]);
  const at = input.now.toISOString();
  // The piece that came off goes back into the kit to hand in, whether it failed or was due, why in its reason's words.
  const oldPiece = oldPieceOf(body);
  const reason = oldPiece === null ? null : await returnReason(db, jobId, oldPiece);
  const returned =
    oldPiece === null ? [] : pieceReturnStatements(db, { jobId, technicianId, label: oldPiece.code, reason, at });
  const owed = useStillToRecord(fitted, await takenFor(db, { jobId, technicianId, hairSystems: true }));
  if (owed.size === 0) {
    if (returned.length > 0) await db.batch(returned);
    return { lowered: false };
  }
  const label = pieceStepOf(body).fitted?.code ?? null;
  const fittedBody = pieceBodyOf(body);
  const noLabel = fittedBody !== null && !fitsNothing(fittedBody) && fittedBody.no_label === true;
  const moves = new Map<string, PieceMove>();
  for (const [stock, quantity] of owed) {
    const move = { code: stock, quantity, label, noLabel, jobId, day: input.day };
    moves.set(stock, await pieceMove(db, move, technicianId));
  }
  const step = { jobId, technicianId, eventId: latest.id, kind: "piece", at } as const;
  const taken = await takenFromKit(db, step, owed, (stock) => moves.get(stock)?.takes ?? []);
  const units = [...moves].flatMap(([stock, move]) =>
    unitChanges(db, {
      units: move.units,
      state: move.state,
      place: move.state === "held" ? technicianId : null,
      movementId: taken.ids.get(stock) ?? crypto.randomUUID(),
      appointmentId: jobId,
      from: move.state === "held" ? { states: ["fitted", "missing"] } : { states: ["held"], place: technicianId },
      at: step.at,
      actor: technicianId,
    }),
  );
  const labels = noLabel ? relabelled(db, { moves: moves.values(), label, jobId }) : [];
  const results = await db.batch<{ quantity: number }>([
    ...taken.movements,
    ...taken.lots,
    ...units,
    ...labels,
    ...returned,
  ]);
  const moved = results.slice(0, taken.movements.length).flatMap((result) => result.results);
  return { lowered: moved.some((row) => row.quantity < 0) };
}
