// A job's use of consumables, as the technician's step records it
// (docs/decisions/0087-consumables-and-stock.md; the rules are src/policy/stock.ts).
//
// It lands in our own records the moment the step does: a job used what it used. The row of consumables_used keeps the consumable, what the
// job's service expected of it and what one cost that day; the ledger takes it
// out of the technician's kit.

import type { VisitType } from "../../config/visit-types.ts";
import { useStillToRecord } from "../../policy/stock.ts";
import { allConsumables, serviceOfJob, type Consumable } from "./consumables.ts";
import { hairSystemSpecs } from "./hair-systems.ts";
import { givenBackToLots, lotMoves, soonestFirst, type LotTake } from "./stock-lots.ts";
import { usedLinesOf, type UsedLine } from "./job-event-bodies.ts";

/**
 * The consumable each line names: by its code, or, for a step a phone queued
 * before codes, by its name, whatever the case. A name that matches none is
 * kept as the technician entered it, and moves no stock.
 */
function resolve(line: UsedLine, consumables: readonly Consumable[]): Consumable | null {
  if ("code" in line) return consumables.find((each) => each.code === line.code) ?? null;
  const name = line.name.trim().toLowerCase();
  return consumables.find((each) => each.name.toLowerCase() === name) ?? null;
}

/** A consumable the step named: matched to the catalogue, or kept by the name it was given. */
interface Used {
  readonly consumable: Consumable | null;
  readonly name: string;
  readonly quantity: number;
}

/** What a step says was used, each consumable once however many lines named it. */
function usedIn(body: unknown, consumables: readonly Consumable[]): Used[] {
  const used = new Map<string, Used>();
  for (const line of usedLinesOf(body)) {
    const consumable = resolve(line, consumables);
    const name = consumable?.name ?? ("name" in line ? line.name.trim() : "");
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

/**
 * The job's latest step of a kind from the technician, each named by the placeholder its statement binds it to: the
 * consumables step here, the piece step for the hair system fitted (src/domain/field/piece-use.ts).
 */
export function latestStep(
  placeholders: { readonly job: string; readonly technician: string },
  kind: "consumables" | "piece" = "consumables",
): string {
  return `SELECT id FROM job_events
    WHERE appointment_id = ${placeholders.job} AND technician_id = ${placeholders.technician}
      AND kind = '${kind}' AND superseded = 0
    ORDER BY received_at DESC, rowid DESC LIMIT 1`;
}

/**
 * What the technician's kit has already given the job, by stock code: the consumables, or the hair systems, which the
 * piece step takes and the consumables step must never give back.
 */
export async function takenFor(
  db: D1Database,
  input: { readonly jobId: string; readonly technicianId: string; readonly hairSystems: boolean },
): Promise<Map<string, number>> {
  const { results } = await db
    .prepare(
      `SELECT consumable_code, SUM(quantity) AS taken FROM stock_movements
       WHERE appointment_id = ?1 AND reason = 'used' AND technician_id = ?2
         AND (consumable_code IN (SELECT code FROM hair_systems)) = ?3
       GROUP BY consumable_code`,
    )
    .bind(input.jobId, input.technicianId, input.hairSystems ? 1 : 0)
    .all<{ consumable_code: string; taken: number }>();
  return new Map(results.map((row) => [row.consumable_code, row.taken]));
}

/**
 * The kit's rows for what a step still owes the job, each written only while the step is still the job's latest of
 * its kind, and once for each step and stock code; each answers its quantity when it is written. Then each row's
 * lots: what the kit gives leaves from the lots that expire soonest, and what a correction gives back goes to the lots
 * the job took from (src/domain/field/stock-lots.ts), unless `lotsOf` says, as the pieces a piece step moved do. Each
 * row's ID is answered by its stock code.
 */
export async function takenFromKit(
  db: D1Database,
  step: {
    readonly jobId: string;
    readonly technicianId: string;
    readonly eventId: string;
    readonly kind: "consumables" | "piece";
    readonly at: string;
  },
  owed: ReadonlyMap<string, number>,
  lotsOf?: (code: string) => readonly LotTake[],
): Promise<{
  readonly movements: D1PreparedStatement[];
  readonly lots: D1PreparedStatement[];
  readonly ids: ReadonlyMap<string, string>;
}> {
  const movements: D1PreparedStatement[] = [];
  const lots: D1PreparedStatement[] = [];
  const ids = new Map<string, string>();
  const kit = step.technicianId;
  for (const [code, quantity] of owed) {
    const id = crypto.randomUUID();
    ids.set(code, id);
    movements.push(
      db
        .prepare(
          `INSERT INTO stock_movements (id, consumable_code, location, technician_id, quantity, reason,
             appointment_id, job_event_id, actor_kind, actor, created_at)
           SELECT ?1, ?2, 'kit', ?3, ?4, 'used', ?5, ?6, 'technician', ?3, ?7
            WHERE ?6 = (${latestStep({ job: "?5", technician: "?3" }, step.kind)})
           ON CONFLICT (job_event_id, consumable_code) WHERE reason = 'used' DO NOTHING
           RETURNING quantity`,
        )
        .bind(id, code, kit, quantity, step.jobId, step.eventId, step.at),
    );
    const takes =
      lotsOf?.(code) ??
      (quantity < 0
        ? await soonestFirst(db, { code, place: kit, quantity: -quantity })
        : await givenBackToLots(db, { jobId: step.jobId, kit, code, quantity }));
    lots.push(...lotMoves(db, { movementId: id, place: kit, takes, sign: quantity < 0 ? -1 : 1 }));
  }
  return { movements, lots, ids };
}

/**
 * Records a job's use as the technician's latest consumables step gives it:
 * a row of consumables_used for each consumable, with what the job's service
 * expected and what one cost that day, once for each event whatever the
 * consumable is called when the event is read again, and the movements out of
 * their kit.
 *
 * It reads the job's latest step, not the one just sent, so a replay of an
 * older step changes nothing; and it writes only what differs from what their
 * kit's rows for the job already took, so the same step, however often it
 * lands, moves stock once, and a later step corrects by the difference.
 *
 * The kit's rows are written only while the step read is still the job's
 * latest. A newer step landing between the read and the write is recorded by
 * its own request, from rows that do not yet hold this one's, so writing this
 * one's too would take the job's use twice.
 * Returns whether their kit went down.
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
    .prepare(`SELECT id, body FROM job_events WHERE id = (${latestStep({ job: "?1", technician: "?2" })})`)
    .bind(job.id, technicianId)
    .first<{ id: string; body: string }>();
  if (latest === null) return { lowered: false };

  // A hair system is the piece step's to take (src/domain/field/piece-use.ts), never this step's.
  const hairSystems = await hairSystemSpecs(db);
  const consumables = (await allConsumables(db)).filter((consumable) => !hairSystems.has(consumable.code));
  const used = usedIn(JSON.parse(latest.body), consumables);
  const expected = await expectedOf(db, job);
  const byCode = new Map(
    used.flatMap((line) => (line.consumable === null ? [] : [[line.consumable.code, line.quantity] as const])),
  );
  const owed = useStillToRecord(byCode, await takenFor(db, { jobId: job.id, technicianId, hairSystems: false }));

  const at = now.toISOString();
  const taken = await takenFromKit(
    db,
    { jobId: job.id, technicianId, eventId: latest.id, kind: "consumables", at },
    owed,
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
  if (taken.movements.length + recorded.length === 0) return { lowered: false };
  const results = await db.batch<{ quantity: number }>([...taken.movements, ...recorded, ...taken.lots]);
  const moved = results.slice(0, taken.movements.length).flatMap((result) => result.results);
  return { lowered: moved.some((row) => row.quantity < 0) };
}
