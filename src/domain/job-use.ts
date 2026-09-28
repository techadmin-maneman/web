// A job's use of consumables, as the technician's step records it
// (docs/decisions/0087-consumables-and-stock.md; the rules are src/policy/stock.ts).
//
// It lands in our own records the moment the step does, not when FSM has taken
// the summary: stock is ours, and a job whose FSM write waits or fails still
// used what it used. The row of consumables_used keeps the consumable, what the
// job's service expected of it and what one cost that day; the ledger takes it
// out of the technician's kit.

import type { VisitType } from "../config/visit-types.ts";
import { useStillToRecord } from "../policy/stock.ts";
import { allConsumables, serviceOfJob, type Consumable } from "./consumables.ts";

/** One line of a consumables step, as a phone sent it: by code, or by name from before the codes. */
interface Line {
  readonly code: string | null;
  readonly name: string | null;
  readonly quantity: number;
}

function linesOf(body: Record<string, unknown>): Line[] {
  const items = body.items;
  if (!Array.isArray(items)) return [];
  return items.flatMap((item: unknown) => {
    const row = item as { code?: unknown; name?: unknown; quantity?: unknown };
    if (typeof row.quantity !== "number") return [];
    const code = typeof row.code === "string" ? row.code : null;
    const name = typeof row.name === "string" ? row.name : null;
    return code === null && name === null ? [] : [{ code, name, quantity: row.quantity }];
  });
}

/**
 * The consumable each line names: by its code, or, for a step a phone queued
 * before codes, by its name, whatever the case. A name that matches none is
 * kept as the technician entered it, and moves no stock.
 */
function resolve(line: Line, consumables: readonly Consumable[]): Consumable | null {
  if (line.code !== null) return consumables.find((each) => each.code === line.code) ?? null;
  const name = (line.name ?? "").trim().toLowerCase();
  return consumables.find((each) => each.name.toLowerCase() === name) ?? null;
}

/** A consumable the step named: matched to the catalogue, or kept by the name it was given. */
interface Used {
  readonly consumable: Consumable | null;
  readonly name: string;
  readonly quantity: number;
}

/** What a step says was used, each consumable once however many lines named it. */
function usedIn(body: Record<string, unknown>, consumables: readonly Consumable[]): Used[] {
  const used = new Map<string, Used>();
  for (const line of linesOf(body)) {
    const consumable = resolve(line, consumables);
    const name = consumable?.name ?? (line.name ?? "").trim();
    const key = consumable?.code ?? `name:${name}`;
    used.set(key, { consumable, name, quantity: (used.get(key)?.quantity ?? 0) + line.quantity });
  }
  return [...used.values()];
}

/** What the job's service is expected to use, by consumable. */
async function expectedOf(
  db: D1Database,
  job: { readonly id: string; readonly type: VisitType },
): Promise<Map<string, number>> {
  const service = await serviceOfJob(db, job);
  const { results } = await db
    .prepare("SELECT consumable_code, quantity FROM consumable_usage WHERE visit_type = ?1 AND tier = ?2")
    .bind(service.visitType, service.tier)
    .all<{ consumable_code: string; quantity: number }>();
  return new Map(results.map((row) => [row.consumable_code, row.quantity]));
}

/** The job's latest consumables step from the technician, the job being `?1` and the technician `?2`. */
const LATEST_STEP = `SELECT id FROM job_events
  WHERE appointment_id = ?1 AND technician_id = ?2 AND kind = 'consumables' AND superseded = 0
  ORDER BY received_at DESC, rowid DESC LIMIT 1`;

/** What the technician's kit has already given the job, by consumable. */
async function takenFor(db: D1Database, jobId: string, technicianId: string): Promise<Map<string, number>> {
  const { results } = await db
    .prepare(
      `SELECT consumable_code, SUM(quantity) AS taken FROM stock_movements
       WHERE appointment_id = ?1 AND reason = 'used' AND technician_id = ?2 GROUP BY consumable_code`,
    )
    .bind(jobId, technicianId)
    .all<{ consumable_code: string; taken: number }>();
  return new Map(results.map((row) => [row.consumable_code, row.taken]));
}

/**
 * Records a job's use as the technician's latest consumables step gives it:
 * a row of consumables_used for each consumable, with what the job's service
 * expected and what one cost that day, once for each event whatever the
 * consumable is called when the event is read again, and the movements out of
 * his kit.
 *
 * It reads the job's latest step, not the one just sent, so a replay of an
 * older step changes nothing; and it writes only what differs from what his
 * kit's rows for the job already took, so the same step, however often it
 * lands, moves stock once, and a later step corrects by the difference.
 *
 * The kit's rows are written only while the step read is still the job's
 * latest. A newer step landing between the read and the write is recorded by
 * its own request, from rows that do not yet hold this one's, so writing this
 * one's too would take the job's use twice.
 * Returns whether his kit went down.
 */
export async function recordJobUse(
  db: D1Database,
  input: {
    readonly job: { readonly id: string; readonly type: VisitType };
    readonly technicianId: string;
    readonly now: Date;
  },
): Promise<{ readonly lowered: boolean }> {
  const { job, technicianId, now } = input;
  const latest = await db
    .prepare(`SELECT id, body FROM job_events WHERE id = (${LATEST_STEP})`)
    .bind(job.id, technicianId)
    .first<{ id: string; body: string }>();
  if (latest === null) return { lowered: false };

  const used = usedIn(JSON.parse(latest.body) as Record<string, unknown>, await allConsumables(db));
  const expected = await expectedOf(db, job);
  const byCode = new Map(
    used.flatMap((line) => (line.consumable === null ? [] : [[line.consumable.code, line.quantity] as const])),
  );
  const owed = useStillToRecord(byCode, await takenFor(db, job.id, technicianId));

  const at = now.toISOString();
  const taken = [...owed].map(([code, quantity]) =>
    db
      .prepare(
        `INSERT INTO stock_movements (id, consumable_code, location, technician_id, quantity, reason,
           appointment_id, job_event_id, actor_kind, actor, created_at)
         SELECT ?3, ?4, 'kit', ?2, ?5, 'used', ?1, ?6, 'technician', ?2, ?7 WHERE ?6 = (${LATEST_STEP})
         ON CONFLICT (job_event_id, consumable_code) WHERE reason = 'used' DO NOTHING
         RETURNING quantity`,
      )
      .bind(job.id, technicianId, crypto.randomUUID(), code, quantity, latest.id, at),
  );
  const recorded = used.map((line) =>
    db
      .prepare(
        `INSERT INTO consumables_used (id, appointment_id, job_event_id, name, quantity, created_at,
           consumable_code, expected_quantity, unit_cost)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT DO NOTHING`,
      )
      .bind(
        crypto.randomUUID(),
        job.id,
        latest.id,
        line.name,
        line.quantity,
        at,
        line.consumable?.code ?? null,
        line.consumable === null ? null : (expected.get(line.consumable.code) ?? 0),
        line.consumable?.unitCost ?? null,
      ),
  );
  // "None used" is a step too, and writes nothing.
  if (taken.length + recorded.length === 0) return { lowered: false };
  const results = await db.batch<{ quantity: number }>([...taken, ...recorded]);
  const moved = results.slice(0, taken.length).flatMap((result) => result.results);
  return { lowered: moved.some((row) => row.quantity < 0) };
}
