// A piece fitted, out of the technician's kit (docs/decisions/0156-hair-systems-in-stock.md): the hair system the piece
// step names comes out of their kit as the step lands, once however often it does, and a later step naming another
// corrects by the difference, as a job's use of consumables does (src/domain/field/job-use.ts). A step naming none,
// or a one visit's client deciding against the fit, takes nothing.

import { useStillToRecord } from "../../policy/stock.ts";
import { latestStep, takenFor, takenFromKit } from "./job-use.ts";

/** The hair system a piece step's body names, if any. */
function stockCodeOf(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("stock_code" in body)) return null;
  return typeof body.stock_code === "string" ? body.stock_code : null;
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

  const code = stockCodeOf(JSON.parse(latest.body));
  const fitted = new Map(code === null ? [] : [[code, 1]]);
  const owed = useStillToRecord(fitted, await takenFor(db, { jobId, technicianId, hairSystems: true }));
  if (owed.size === 0) return { lowered: false };
  const step = { jobId, technicianId, eventId: latest.id, kind: "piece", at: input.now.toISOString() } as const;
  const taken = await takenFromKit(db, step, owed);
  const results = await db.batch<{ quantity: number }>([...taken.movements, ...taken.lots]);
  const moved = results.slice(0, taken.movements.length).flatMap((result) => result.results);
  return { lowered: moved.some((row) => row.quantity < 0) };
}
