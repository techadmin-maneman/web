// A technician's ask of ops for what their kit is short of over the next seven days (docs/decisions/0249-schedule-kit-
// and-me.md): the shortfall the week ahead finds, worked out here rather than taken from the phone, kept as it was when
// asked. A task on the board until ops close it, which settles it. One open a kit at a time.

import { kitView } from "./kit.ts";
import { weekAheadOf } from "./kit-week.ts";

/** An open ask, as the Kit screen shows it: when, and what. */
export interface KitAsked {
  readonly asked_at: string;
  readonly items: readonly { readonly name: string; readonly unit: string; readonly quantity: number }[];
}

/** The kit's open ask; null for none. */
export async function kitAskedOf(db: D1Database, kit: string): Promise<KitAsked | null> {
  const row = await db
    .prepare(
      `SELECT r.requested_at,
              (SELECT json_group_array(json_object('name', c.name, 'unit', c.unit, 'quantity', j.value ->> 'quantity'))
                 FROM json_each(r.items) j JOIN consumables c ON c.code = j.value ->> 'code') AS items
         FROM kit_requests r INDEXED BY kit_requests_open
        WHERE r.technician_id = ?1 AND r.settled_at IS NULL`,
    )
    .bind(kit)
    .first<{ requested_at: string; items: string }>();
  return row === null ? null : { asked_at: row.requested_at, items: JSON.parse(row.items) as KitAsked["items"] };
}

/**
 * Asks ops for what the week ahead finds the kit short of; "nothing_short" where it finds nothing. The answer is the
 * ask that stands, new or open already.
 */
export async function askForKit(
  db: D1Database,
  input: { kit: string; today: string; now: Date },
): Promise<KitAsked | "nothing_short"> {
  const short = (await weekAheadOf(db, input.kit, input.today, await kitView(db, input.kit, input.today)))
    .map((item) => ({ code: item.code, quantity: item.need - Math.max(item.have, 0) }))
    .filter((item) => item.quantity > 0);
  const open = await kitAskedOf(db, input.kit);
  if (open !== null) return open;
  if (short.length === 0) return "nothing_short";
  await db
    .prepare(`INSERT OR IGNORE INTO kit_requests (id, technician_id, items, requested_at) VALUES (?1, ?2, ?3, ?4)`)
    .bind(crypto.randomUUID(), input.kit, JSON.stringify(short), input.now.toISOString())
    .run();
  return (await kitAskedOf(db, input.kit)) ?? "nothing_short";
}
