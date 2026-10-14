// The events calendar (docs/decisions/0182-the-events-calendar.md): what ops know will lift or drop demand, a wedding
// season, a festival, a campaign, in one city or every city, by a percent, which the forecast's baseline reads
// (./forecast-layers.ts). An event is taken off, never edited, and kept.

import { auditStatement } from "../platform/audit.ts";
import type { Written } from "../inventory/stock.ts";

export interface DemandEvent {
  readonly id: string;
  readonly name: string;
  readonly city: string | null;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly upliftPercent: number;
}

type EventRow = {
  id: string;
  name: string;
  city: string | null;
  starts_on: string;
  ends_on: string;
  uplift_percent: number;
};

/** The events still to end, soonest first. */
export async function upcomingEvents(db: D1Database, today: string): Promise<DemandEvent[]> {
  const { results } = await db
    .prepare(
      `SELECT id, name, city, starts_on, ends_on, uplift_percent FROM demand_events INDEXED BY demand_events_by_end
       WHERE deleted_at IS NULL AND ends_on >= ?1 ORDER BY starts_on, name`,
    )
    .bind(today)
    .all<EventRow>();
  return results.map((row) => ({
    id: row.id,
    name: row.name,
    city: row.city,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    upliftPercent: row.uplift_percent,
  }));
}

/** An event added; refused, naming the field, for one that ends before it starts or a city we do not serve. */
export async function addEvent(
  db: D1Database,
  event: Omit<DemandEvent, "id">,
  written: Written,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly fields: string[] }> {
  if (event.endsOn < event.startsOn) return { ok: false, fields: ["ends_on"] };
  if (event.city !== null) {
    const known = await db.prepare("SELECT 1 FROM cities WHERE name = ?1 AND active = 1").bind(event.city).first();
    if (known === null) return { ok: false, fields: ["city"] };
  }
  const id = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        `INSERT INTO demand_events (id, name, city, starts_on, ends_on, uplift_percent, created_by, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      )
      .bind(
        id,
        event.name,
        event.city,
        event.startsOn,
        event.endsOn,
        event.upliftPercent,
        written.actor.id,
        written.now.toISOString(),
      ),
    auditStatement(
      db,
      {
        surface: "ops",
        actor: written.actor,
        action: "demand_event.add",
        subject: { kind: "demand_event", id },
        requestId: written.requestId,
        detail: { uplift_percent: event.upliftPercent },
      },
      written.now,
    ),
  ]);
  return { ok: true };
}

/** An event taken off. Whether it was there to take off. */
export async function removeEvent(db: D1Database, id: string, written: Written): Promise<boolean> {
  const removed = await db
    .prepare("UPDATE demand_events SET deleted_at = ?2 WHERE id = ?1 AND deleted_at IS NULL")
    .bind(id, written.now.toISOString())
    .run();
  if (removed.meta.changes !== 1) return false;
  await auditStatement(
    db,
    {
      surface: "ops",
      actor: written.actor,
      action: "demand_event.remove",
      subject: { kind: "demand_event", id },
      requestId: written.requestId,
    },
    written.now,
  ).run();
  return true;
}
