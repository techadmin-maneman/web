// A piece fitted, out of the technician's kit (docs/decisions/0156-hair-systems-in-stock.md): the hair system the piece
// step names comes out of their kit as the step lands, once however often it does, and a later step naming another
// corrects by the difference, as a job's use of consumables does (src/domain/field/job-use.ts). A step naming none,
// or a one visit's client deciding against the fit, takes nothing.
//
// The piece is the unit its label names, where the kit holds it, and that unit is fitted
// (docs/decisions/0161-pieces-as-units.md). A label we never made takes a piece never labelled, or failing one, a unit,
// which has then gone missing. A correction puts the units the visit took back in the kit.

import { useStillToRecord } from "../../policy/stock.ts";
import { latestStep, takenFor, takenFromKit } from "./job-use.ts";
import { pieceStepOf } from "./pieces.ts";
import { givenBackToLots } from "./stock-lots.ts";
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
  move: { readonly code: string; readonly quantity: number; readonly label: string | null; readonly jobId: string },
  kit: string,
): Promise<PieceMove> {
  if (move.quantity < 0) {
    const named = move.label === null ? null : [move.label];
    const fitted = named === null ? null : await takenFrom(db, { code: move.code, place: kit, quantity: 1, named });
    if (fitted !== null) return { ...fitted, state: "fitted" };
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

/** Records the piece the technician's latest piece step fitted, from their kit. Returns whether their kit went down. */
export async function recordPieceUse(
  db: D1Database,
  input: { readonly jobId: string; readonly technicianId: string; readonly now: Date },
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
  const owed = useStillToRecord(fitted, await takenFor(db, { jobId, technicianId, hairSystems: true }));
  if (owed.size === 0) return { lowered: false };
  const label = pieceStepOf(body).fitted?.code ?? null;
  const moves = new Map<string, PieceMove>();
  for (const [stock, quantity] of owed) {
    moves.set(stock, await pieceMove(db, { code: stock, quantity, label, jobId }, technicianId));
  }
  const step = { jobId, technicianId, eventId: latest.id, kind: "piece", at: input.now.toISOString() } as const;
  const taken = await takenFromKit(db, step, owed, (stock) => moves.get(stock)?.takes ?? []);
  const units = [...moves].flatMap(([stock, move]) =>
    unitChanges(db, {
      units: move.units,
      state: move.state,
      place: move.state === "held" ? technicianId : null,
      movementId: taken.ids.get(stock) ?? crypto.randomUUID(),
      appointmentId: jobId,
      at: step.at,
      actor: technicianId,
    }),
  );
  const results = await db.batch<{ quantity: number }>([...taken.movements, ...taken.lots, ...units]);
  const moved = results.slice(0, taken.movements.length).flatMap((result) => result.results);
  return { lowered: moved.some((row) => row.quantity < 0) };
}
