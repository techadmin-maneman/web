// A city's draft visits as the re-plan (./replan-day.ts) and the room booking makes (./make-room.ts) read and move
// them (docs/decisions/0290-allotted-the-evening-before.md): which drafts may move, who may take each as booking would
// offer it, and a draft's move written as a move on the board is.

import { statusIn, VISIT_NOT_BEGUN } from "../../config/statuses.ts";
import type { VisitType } from "../../config/visit-types.ts";
import { failedNotNullOn, failedUniqueOn } from "../../lib/d1-errors.ts";
import { addDays, indiaInstant, indiaTime } from "../../lib/india-time.ts";
import { minuteOf } from "../../policy/day-plan.ts";
import type { Taking } from "../../policy/replan.ts";
import { allowedTechnicians, techniciansBarredOn, type ClientVisit } from "../../policy/technician-rotation.ts";
import type { OpsInputs } from "../platform/ops-settings.ts";
import { hasOpenProposal } from "../visits/open-proposals.ts";
import { reallottingDraft } from "../visits/technician-draft.ts";
import { CLIENT_MOVING } from "./hold-stages.ts";
import { fittingOf, techniciansFor } from "./occupancy.ts";
import type { DayPlans } from "./day-plans.ts";
import { pinColumns, standings, type Radius } from "./standings.ts";
import { tieRange } from "./technician-choice.ts";

export interface DraftRow {
  readonly id: string;
  readonly person_id: string | null;
  readonly type: VisitType | null;
  readonly tier: string | null;
  readonly window_start: string;
  readonly technician_id: string;
  readonly service_pincode: string | null;
  /** The city it is booked in, whose evening lock fixes it. */
  readonly service_city: string | null;
  /** Where it is (./start-offers.ts pinColumns); null where neither the client nor the pincode has a pin. */
  readonly lat: number | null;
  readonly lng: number | null;
  /** Whether its client is one of staging's test records, who is booked only with a test technician. */
  readonly test_record: number | null;
}

/** Who a draft could go to, as booking reads it (./occupancy.ts). */
export type Able = Awaited<ReturnType<typeof techniciansFor>>;

/**
 * Who could take each draft, read once for each pincode and kind of client among the drafts that fit nothing, which
 * nothing else of the client's changes; and for each fit, by its client's piece.
 */
export function ableOnce(db: D1Database): (row: DraftRow) => Promise<Able> {
  const read = new Map<string, Promise<Able>>();
  return (row) => {
    const fitting = fittingOf(row.type, row.tier);
    const place = { pincode: row.service_pincode, personId: row.person_id };
    if (fitting !== null) return techniciansFor(db, null, place, fitting);
    const key = `${row.service_pincode ?? ""}|${String(row.test_record)}`;
    const known = read.get(key) ?? techniciansFor(db, null, place);
    read.set(key, known);
    return known;
  };
}

/** Who may take a draft, as booking would offer it: in the city, trained, in their ring, allowed by the rotation. */
export function takersOf(
  row: DraftRow,
  read: {
    readonly radii: ReadonlyMap<string, Radius>;
    readonly working: ReadonlySet<string>;
    readonly inputs: OpsInputs;
    /** Who may no longer take it, Google's drive having left their day no room for it (./evening-check.ts). */
    readonly ruledOut: ReadonlySet<string>;
  },
  found: { readonly able: Able; readonly visits: readonly ClientVisit[]; readonly date: string },
): Map<string, Taking> {
  const { able, visits, date } = found;
  const pin = row.lat === null || row.lng === null ? null : { lat: row.lat, lng: row.lng };
  const where = standings(able.technicians, read.radii, { pin, keeping: null, inputs: read.inputs });
  const barred = techniciansBarredOn(visits, date);
  const allowed = allowedTechnicians(
    able.technicians.filter((each) => where.has(each.id) && read.working.has(each.id) && !read.ruledOut.has(each.id)),
    (each) => barred.has(each.id),
  );
  const homeKnown = (id: string) => {
    const radius = read.radii.get(id);
    if (radius === undefined) return false;
    return radius.home_lat !== null && radius.home_lng !== null;
  };
  // Who has it now may keep it, so the plan starts from one that fits, unless Google's drive ruled them out.
  const takers = new Map<string, Taking>();
  if (!read.ruledOut.has(row.technician_id)) {
    takers.set(row.technician_id, { overflow: false, piece: null, homeKnown: homeKnown(row.technician_id) });
  }
  for (const each of allowed) {
    takers.set(each.id, {
      overflow: where.get(each.id)?.standing === "overflow",
      piece: able.pieces.get(each.id) ?? null,
      homeKnown: homeKnown(each.id),
    });
  }
  return takers;
}

/** A draft's columns, as DraftRow reads them, of the appointments `a`. */
export const DRAFT_COLUMNS = `a.id, a.person_id, a.type, a.tier, a.window_start, a.technician_id, a.service_pincode,
  a.service_city,
  ${pinColumns("a.person_id", "a.service_pincode")},
  (SELECT p.test_record FROM people p WHERE p.id = a.person_id) AS test_record`;

/**
 * Whether the appointment `a` is a draft the plan may move: not begun, not being moved by its client, and with no move
 * proposal open at `now`, a statement's parameter.
 */
export const draftOpen = (now: string): string =>
  `a.technician_draft = 1 AND a.deleted_at IS NULL AND a.technician_id IS NOT NULL
   AND ${statusIn("a.status", VISIT_NOT_BEGUN)} AND NOT ${CLIENT_MOVING} AND NOT ${hasOpenProposal("a", now)}`;

/** The drafts the plan may move that the technicians named have, India's days `from` to `to`. */
export async function draftsOf(
  db: D1Database,
  of: { readonly technicianIds: readonly string[]; readonly from: string; readonly to: string; readonly now: Date },
): Promise<DraftRow[]> {
  if (of.technicianIds.length === 0) return [];
  const { results } = await db
    .prepare(
      `SELECT ${DRAFT_COLUMNS} FROM appointments a
       WHERE a.technician_id IN (SELECT value FROM json_each(?1)) AND a.window_start >= ?2 AND a.window_start < ?3
         AND ${draftOpen("?4")}`,
    )
    .bind(
      JSON.stringify(of.technicianIds),
      indiaInstant(of.from, "00:00").toISOString(),
      indiaInstant(addDays(of.to, 1), "00:00").toISOString(),
      of.now.toISOString(),
    )
    .all<DraftRow>();
  return results;
}

/** The start of a draft on its day, in minutes from midnight, as its stop there begins. */
export const startOf = (row: Pick<DraftRow, "window_start">): number => minuteOf(indiaTime(new Date(row.window_start)));

/**
 * A draft's move to another technician, as a move on the board is written (ADR 0069): recorded, only while the visit is
 * still the draft as read; the day it goes to locked one past the lock `revision` read, unless the batch locked it
 * already; and the visit given to its new technician. The lock is kept, so the day reads as changed to a hold planned
 * on it before. A hold placed on that day since, or a draft fixed, moved or proposed since, fails the batch.
 */
export function draftMove(
  db: D1Database,
  move: {
    readonly row: Pick<DraftRow, "id" | "technician_id" | "window_start">;
    readonly to: string;
    readonly date: string;
    readonly revision: number;
    readonly lock: boolean;
  },
  at: string,
): { readonly statements: D1PreparedStatement[] } {
  const { row, to } = move;
  const moveId = crypto.randomUUID();
  const statements = [
    db
      .prepare(
        `INSERT INTO dispatch_moves (id, appointment_id, was_technician_id, now_technician_id, was_start, now_start,
           reason, actor, fsm_write_state, write_state, created_at, updated_at)
         VALUES (?1,
           (SELECT a.id FROM appointments a
            WHERE a.id = ?2 AND a.technician_id IS ?3 AND a.window_start = ?5 AND a.technician_draft = 1
              AND a.deleted_at IS NULL AND ${statusIn("a.status", VISIT_NOT_BEGUN)} AND NOT ${CLIENT_MOVING}
              AND NOT ${hasOpenProposal("a", "?6")}),
           ?3, ?4, ?5, ?5, 'zone_rebalance', 'allotment', 'written', 'written', ?6, ?6)`,
      )
      .bind(moveId, row.id, row.technician_id, to, row.window_start, at),
    ...(move.lock
      ? [
          db
            .prepare("INSERT INTO slot_claims (technician_id, date, claim, move_id) VALUES (?1, ?2, ?3, ?4)")
            .bind(to, move.date, `rev:${String(move.revision + 1)}`, moveId),
        ]
      : []),
    reallottingDraft(db, { visitId: row.id, technicianId: to, at }),
  ];
  return { statements };
}

/** Whether a batch failed for a draft or a day changed since it was read, which the next look tries again. */
export const draftChanged = (error: unknown): boolean =>
  failedUniqueOn(error, "slot_claims") || failedNotNullOn(error, "dispatch_moves.appointment_id");

/** Minutes booked on a technician's days over the week around `date`. */
export function weekOf(plans: DayPlans, technicianId: string, date: string): number {
  let minutes = 0;
  for (let day = tieRange(date).from; day <= tieRange(date).to; day = addDays(day, 1)) {
    for (const stop of plans.day(technicianId, day)?.stops ?? []) minutes += stop.end - stop.start;
  }
  return minutes;
}
