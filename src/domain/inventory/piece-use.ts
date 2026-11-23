// A piece fitted, out of the technician's kit (docs/decisions/0156-hair-systems-in-stock.md): the hair system the piece
// step names comes out of their kit as the step lands, once however often it does, and a later step naming another
// corrects by the difference, as a job's use of consumables does (src/domain/field/job-use.ts). A step naming none,
// or a one visit's client deciding against the fit, takes nothing.
//
// The piece is the unit its label names, where the kit holds it, and that unit is fitted
// (docs/decisions/0161-pieces-as-units.md). A label we never made takes a piece never labelled, or failing one, a unit,
// which has then gone missing. A piece with no label at all takes one the job card would offer (./made-labels.ts), and it
// is fitted; a unit so taken carries the label made for the piece, so a recall, a warranty or a supplier's failures,
// which find a unit's piece by its label, still find it. A correction puts the units the visit took back in the kit,
// each under its own label. A piece that came off is held in the kit as returned (src/domain/inventory/piece-returns.ts).

import { useStillToRecord } from "../../policy/stock.ts";
import { latestStep, takenFor, takenFromKit } from "../field/job-use.ts";
import { failureWordsOf, jobSheet } from "../field/job-sheet-settings.ts";
import { pieceStepOf } from "./pieces.ts";
import { fitsNothing, pieceBodyOf } from "../field/job-event-bodies.ts";
import { pieceReturnStatements } from "./piece-returns.ts";
import { noLabelTake, ownLabelsBack } from "./made-labels.ts";
import { givenBackToLots } from "./stock-lots.ts";
import { hairSystemProduct, takenFrom, takesOf, unitChanges, type Taken } from "./stock-units.ts";

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
    if (move.noLabel) {
      const at = { code: move.code, kit, visitId: move.jobId, day: move.day };
      return { ...(await noLabelTake(db, at, -move.quantity)).taken, state: "fitted" };
    }
    const named = move.label === null ? null : [move.label];
    const fitted = named === null ? null : await takenFrom(db, { code: move.code, place: kit, quantity: 1, named });
    if (fitted !== null) return { ...fitted, state: "fitted" };
    // A label read but not the kit's: a piece never labelled, or failing one, a unit, gone missing.
    const taken = await takenFrom(db, { code: move.code, place: kit, quantity: -move.quantity, prefer: "unlabelled" });
    return { units: taken?.units ?? [], takes: taken?.takes ?? [], state: "missing" };
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
 * The unit the technician fitted last on the visit, of the hair system a step with no label names, takes the label made
 * for its piece, taken by this step or an earlier one of theirs, while the step is still their latest; one unit only,
 * never one another technician fitted on the visit before it came to them, and not where another unit carries that
 * label already, when the fit still lands and the unit keeps its own.
 */
function relabelled(
  db: D1Database,
  fit: {
    readonly label: string | null;
    readonly stock: string | null;
    readonly jobId: string;
    readonly technicianId: string;
    readonly eventId: string;
  },
): D1PreparedStatement[] {
  if (fit.label === null || fit.stock === null) return [];
  return [
    db
      .prepare(
        `UPDATE stock_units SET code = ?1
         WHERE id = (SELECT u.id FROM stock_units u INDEXED BY stock_units_by_visit
                     WHERE u.appointment_id = ?2 AND u.consumable_code = ?3 AND u.state = 'fitted'
                       AND EXISTS (SELECT 1 FROM stock_unit_events e
                                   WHERE e.unit_id = u.id AND e.state = 'fitted' AND e.appointment_id = ?2
                                     AND e.actor = ?5)
                     ORDER BY u.moved_at DESC LIMIT 1)
           AND code IS NOT ?1
           AND ?4 = (${latestStep({ job: "?2", technician: "?5" }, "piece")})
           AND NOT EXISTS (SELECT 1 FROM stock_units WHERE code = ?1)`,
      )
      .bind(fit.label, fit.jobId, fit.stock, fit.eventId, fit.technicianId),
  ];
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
  const label = pieceStepOf(body).fitted?.code ?? null;
  const fittedBody = pieceBodyOf(body);
  const noLabel = fittedBody !== null && !fitsNothing(fittedBody) && fittedBody.no_label === true;
  const fit = { label, stock: code, jobId, technicianId, eventId: latest.id };
  const labels = noLabel ? relabelled(db, fit) : [];
  const owed = useStillToRecord(fitted, await takenFor(db, { jobId, technicianId, hairSystems: true }));
  if (owed.size === 0) {
    // A step naming the same hair system again moves nothing, but a piece it now says had no label takes the made one.
    if (returned.length + labels.length > 0) await db.batch([...returned, ...labels]);
    return { lowered: false };
  }
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
  const restored: D1PreparedStatement[] = [];
  for (const [stock, move] of moves) {
    const product = move.state === "held" && move.units.length > 0 ? await hairSystemProduct(db, stock) : null;
    if (product !== null) restored.push(...ownLabelsBack(db, move.units, product));
  }
  const results = await db.batch<{ quantity: number }>([
    ...taken.movements,
    ...taken.lots,
    ...units,
    ...restored,
    ...labels,
    ...returned,
  ]);
  const moved = results.slice(0, taken.movements.length).flatMap((result) => result.results);
  return { lowered: moved.some((row) => row.quantity < 0) };
}
