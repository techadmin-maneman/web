// The FSM reconciliation (docs/decisions/0032-fsm-mirror.md): the mirror's
// repair for whatever FSM's webhooks missed. It runs with the sweeper, every
// five minutes, and only ever puts appointments on the fsm-sync queue; the
// consumer reads them afresh, as it does for a webhook.
//
//   every run   the first page of FSM's appointments, latest change first
//   overnight   1 to 5 am India time, the whole list a page a run; then every
//               copy the pass did not see, which FSM may have deleted; then
//               one alert if the pass repaired anything the webhook missed
//   hourly      visits closed in the last three days still short of their
//               ten photographs, which FSM may have received since

import type { Dependencies } from "../dependencies.ts";
import type { Logger } from "../log.ts";
import type { FsmAppointment } from "../providers/fsm.ts";
import type { FsmSyncMessage } from "../queues/fsm-sync.ts";
import { PHOTOS_PER_VISIT } from "../domain/visit-photos.ts";
import { indiaDate, indiaHour } from "../lib/india-time.ts";

export const PAGE_SIZE = 50;
/** India hours of the nightly pass: from 1 am up to 5 am. */
const NIGHT_START_HOUR = 1;
const NIGHT_END_HOUR = 5;
/** A copy this far behind FSM should have come by webhook; one fresher may be on its way. */
const DRIFT_GRACE_MS = 10 * 60 * 1000;
/** Copies FSM did not list, checked per run at the end of a pass. */
const UNSEEN_LIMIT = 50;
/** How long after a visit its photographs are looked for again, and how many visits an hour. */
const PHOTO_RETRY_MS = 3 * 24 * 60 * 60 * 1000;
const PHOTO_RETRY_LIMIT = 20;

export type ReconcileEnv = Pick<Env, "DB" | "FSM_QUEUE">;

export interface ReconcileSummary {
  /** Appointments put on the queue this run. */
  readonly queued: number;
  /** The page the nightly pass read this run, if it ran. */
  readonly nightPage?: number;
}

export async function reconcileFsm(env: ReconcileEnv, deps: Dependencies, log: Logger): Promise<ReconcileSummary> {
  const now = deps.now();
  const db = env.DB;

  const latest = await deps.fsm.appointments(1, PAGE_SIZE);
  const queue = new Set(await staleOf(db, latest.appointments));

  if (now.getUTCMinutes() < 5) {
    for (const fsmId of await shortOfPhotos(db, now)) queue.add(fsmId);
  }

  let nightPage: number | undefined;
  if (isNight(now)) {
    const night = await nightlyPass(db, deps, log, now, latest);
    nightPage = night.page;
    for (const fsmId of night.toSync) queue.add(fsmId);
  }

  const messages = [...queue].map((fsmId) => ({
    body: { fsm_id: fsmId, request_id: "reconcile" } satisfies FsmSyncMessage,
  }));
  if (messages.length > 0) await env.FSM_QUEUE.sendBatch(messages);
  log.info("fsm_reconciled", { queued: messages.length, night_page: nightPage });
  return nightPage === undefined ? { queued: messages.length } : { queued: messages.length, nightPage };
}

function isNight(now: Date): boolean {
  const hour = Number(indiaHour(now).slice(11, 13));
  return hour >= NIGHT_START_HOUR && hour < NIGHT_END_HOUR;
}

/** FSM IDs of the appointments whose copy is missing or older than FSM's. */
async function staleOf(db: D1Database, appointments: readonly FsmAppointment[]): Promise<string[]> {
  if (appointments.length === 0) return [];
  const copies = await copiesOf(
    db,
    appointments.map((appointment) => appointment.id),
  );
  return appointments
    .filter((appointment) => {
      const copy = copies.get(appointment.id);
      return copy === undefined || Date.parse(copy) < Date.parse(appointment.modifiedAt);
    })
    .map((appointment) => appointment.id);
}

async function copiesOf(db: D1Database, fsmIds: readonly string[]): Promise<Map<string, string>> {
  const placeholders = fsmIds.map((_, index) => `?${String(index + 1)}`).join(", ");
  const { results } = await db
    .prepare(`SELECT fsm_id, fsm_modified_at FROM appointments WHERE fsm_id IN (${placeholders})`)
    .bind(...fsmIds)
    .all<{ fsm_id: string; fsm_modified_at: string }>();
  return new Map(results.map((row) => [row.fsm_id, row.fsm_modified_at]));
}

interface Cursor {
  pass_date: string | null;
  next_page: number;
  pass_started_at: string | null;
  repaired: number;
}

/** One run of the nightly pass: one page of the list, or, once the list is read, the copies it did not see. */
async function nightlyPass(
  db: D1Database,
  deps: Dependencies,
  log: Logger,
  now: Date,
  latest: { appointments: FsmAppointment[]; more: boolean },
): Promise<{ page: number; toSync: string[] }> {
  const at = now.toISOString();
  const tonight = indiaDate(now);
  const stored = await db
    .prepare("SELECT pass_date, next_page, pass_started_at, repaired FROM sync_cursors WHERE name = 'fsm_appointments'")
    .first<Cursor>();
  const cursor: Cursor =
    stored?.pass_date === tonight ? stored : { pass_date: tonight, next_page: 1, pass_started_at: at, repaired: 0 };
  if (cursor.next_page === 0) return { page: 0, toSync: [] };

  const page = cursor.next_page;
  const listed = page === 1 ? latest : await deps.fsm.appointments(page, PAGE_SIZE);
  const stale = await staleOf(db, listed.appointments);
  const drifted = listed.appointments.filter(
    (appointment) =>
      stale.includes(appointment.id) && now.getTime() - Date.parse(appointment.modifiedAt) > DRIFT_GRACE_MS,
  ).length;
  await markReconciled(
    db,
    listed.appointments.map((appointment) => appointment.id),
    at,
  );

  const toSync = [...stale];
  let repaired = cursor.repaired + drifted;
  let nextPage = listed.more ? page + 1 : 0;

  if (nextPage === 0) {
    // The list is read. Copies FSM did not list may be appointments it has deleted: read each afresh.
    const { results } = await db
      .prepare(
        `SELECT fsm_id FROM appointments
         WHERE deleted_at IS NULL AND (reconciled_at IS NULL OR reconciled_at < ?1)
         ORDER BY fsm_id LIMIT ?2`,
      )
      .bind(cursor.pass_started_at ?? at, UNSEEN_LIMIT)
      .all<{ fsm_id: string }>();
    const unseen = results.map((row) => row.fsm_id);
    // Marked seen now, so the next run takes the next ones rather than these again.
    await markReconciled(db, unseen, at);
    toSync.push(...unseen);
    repaired += unseen.length;
    if (unseen.length === UNSEEN_LIMIT) {
      nextPage = page; // more unseen copies: this step again next run
    } else if (repaired > 0) {
      log.warn("fsm_drift_repaired", { repaired });
      await deps.alert(
        `FSM reconciliation repaired ${String(repaired)} appointment(s) tonight that the webhook missed or FSM deleted.`,
      );
    }
  }

  await db
    .prepare(
      `INSERT INTO sync_cursors (name, pass_date, next_page, pass_started_at, repaired, updated_at)
       VALUES ('fsm_appointments', ?1, ?2, ?3, ?4, ?5)
       ON CONFLICT (name) DO UPDATE SET pass_date = excluded.pass_date, next_page = excluded.next_page,
         pass_started_at = excluded.pass_started_at, repaired = excluded.repaired, updated_at = excluded.updated_at`,
    )
    .bind(tonight, nextPage, cursor.pass_started_at ?? at, repaired, at)
    .run();
  return { page, toSync };
}

async function markReconciled(db: D1Database, fsmIds: readonly string[], at: string): Promise<void> {
  if (fsmIds.length === 0) return;
  const placeholders = fsmIds.map((_, index) => `?${String(index + 2)}`).join(", ");
  await db
    .prepare(`UPDATE appointments SET reconciled_at = ?1 WHERE fsm_id IN (${placeholders})`)
    .bind(at, ...fsmIds)
    .run();
}

/** Visits closed in the last three days with fewer than ten photographs. Consultations take none. */
async function shortOfPhotos(db: D1Database, now: Date): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT a.fsm_id FROM appointments a
       WHERE a.status IN ('completed', 'terminated') AND a.deleted_at IS NULL AND a.type IS NOT 'consultation'
         AND a.window_end BETWEEN ?1 AND ?2
         AND (SELECT COUNT(*) FROM photos p JOIN photo_sets s ON s.id = p.photo_set_id WHERE s.appointment_id = a.id) < ?3
       ORDER BY a.window_end DESC LIMIT ?4`,
    )
    .bind(
      new Date(now.getTime() - PHOTO_RETRY_MS).toISOString(),
      now.toISOString(),
      PHOTOS_PER_VISIT,
      PHOTO_RETRY_LIMIT,
    )
    .all<{ fsm_id: string }>();
  return results.map((row) => row.fsm_id);
}
