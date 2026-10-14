// What the stock needs a person for, told each morning by the cron's stock jobs (src/scheduled/cron.ts;
// docs/decisions/0159-stock-views-and-expiry.md): each place holding a lot that expires within ops' warning days
// (`stock_watch`), or has expired, in one alert for the place naming each lot; and each transfer still on its way past
// ops' overdue days after it was sent. An alert closes once what it was about is gone: the lots used, moved or written
// off, the transfer received or sent back.

import { MINUTE_MS } from "../../lib/durations.ts";
import { addDays, indiaDate } from "../../lib/india-time.ts";
import type { AlertOnce, ResolveAlert } from "../platform/alerts.ts";
import { ALERT_WORDS } from "../../config/alert-words.ts";

const EXPIRING_KEY = "stock_expiring:";
const OVERDUE_KEY = "transfer_overdue:";

interface ExpiringRow {
  readonly place: string;
  readonly kind: string;
  readonly name: string | null;
  readonly item: string;
  readonly unit: string;
  readonly lot_code: string;
  readonly expires_on: string;
  readonly quantity: number;
}

/** "Stockroom Gurgaon stockroom" or "technician <id>'s kit": a kit by its technician's ID, never their name. */
const placeWords = (row: ExpiringRow) =>
  row.kind === "kit" ? `technician ${row.place}'s kit` : (row.name ?? row.place);

/** One alert for each place holding stock that expires soon, or has; closes those whose places hold none now. */
export async function tellOfExpiring(
  db: D1Database,
  deps: { readonly alertOnce: AlertOnce; readonly resolveAlert: ResolveAlert },
  today: string,
  warningDays: number,
): Promise<void> {
  const { results } = await db
    .prepare(
      `SELECT b.place, p.kind, p.name, c.name AS item, c.unit, l.lot_code, l.expires_on, b.quantity
       FROM stock_lot_balances b INDEXED BY stock_lot_balances_held
       JOIN stock_lots l ON l.id = b.lot_id
       JOIN consumables c ON c.code = l.consumable_code
       LEFT JOIN stock_places p ON p.id = b.place
       WHERE l.expires_on IS NOT NULL AND l.expires_on <= ?1 AND b.quantity > 0
       ORDER BY b.place, l.expires_on`,
    )
    .bind(addDays(today, warningDays))
    .all<ExpiringRow>();
  const byPlace = Map.groupBy(results, (row) => row.place);
  for (const [place, rows] of byPlace) {
    const first = rows[0];
    if (first === undefined) continue;
    const lots = rows.map(
      (row) =>
        `${row.item} lot ${row.lot_code}, ${String(row.quantity)} ${row.unit}, ` +
        `${row.expires_on < today ? "expired" : "expires"} ${row.expires_on}`,
    );
    await deps.alertOnce({
      key: `${EXPIRING_KEY}${place}`,
      message: ALERT_WORDS.stock_expiring({ place: placeWords(first), days: warningDays, lots: lots.join("; ") }),
      link: "/stock",
    });
  }
  await closeTheRest(db, deps.resolveAlert, EXPIRING_KEY, new Set(byPlace.keys()));
}

/** A place in a chat message, in SQL: its name, or a kit by its technician's ID. */
const PLACE_WORDS = (alias: string) =>
  `CASE WHEN ${alias}.kind = 'kit' THEN 'technician ' || ${alias}.id || '''s kit' ELSE ${alias}.name END`;

/** One alert for each transfer on its way too long; closes those received or sent back. */
export async function tellOfOverdue(
  db: D1Database,
  deps: { readonly alertOnce: AlertOnce; readonly resolveAlert: ResolveAlert },
  now: Date,
  overdueDays: number,
): Promise<void> {
  const sentBy = new Date(now.getTime() - overdueDays * 24 * 60 * MINUTE_MS).toISOString();
  const { results } = await db
    .prepare(
      `SELECT t.id, c.name AS item, c.unit, t.quantity, t.sent_at, ${PLACE_WORDS("f")} AS from_place,
         ${PLACE_WORDS("o")} AS to_place
       FROM stock_transfers t JOIN consumables c ON c.code = t.consumable_code
       JOIN stock_places f ON f.id = t.from_place JOIN stock_places o ON o.id = t.to_place
       WHERE t.state = 'in_transit' AND t.sent_at <= ?1`,
    )
    .bind(sentBy)
    .all<{
      id: string;
      item: string;
      unit: string;
      quantity: number;
      from_place: string;
      to_place: string;
      sent_at: string;
    }>();
  for (const row of results) {
    await deps.alertOnce({
      key: `${OVERDUE_KEY}${row.id}`,
      message: ALERT_WORDS.transfer_overdue({
        quantity: row.quantity,
        unit: row.unit,
        item: row.item,
        from: row.from_place,
        to: row.to_place,
        day: indiaDate(new Date(row.sent_at)),
      }),
      link: "/stock",
    });
  }
  await closeTheRest(db, deps.resolveAlert, OVERDUE_KEY, new Set(results.map((row) => row.id)));
}

/** Closes each open alert under the prefix whose subject is no longer among those still told. */
async function closeTheRest(db: D1Database, resolveAlert: ResolveAlert, prefix: string, still: ReadonlySet<string>) {
  const { results } = await db
    .prepare("SELECT key FROM alerts WHERE resolved_at IS NULL AND key >= ?1 AND key < ?2")
    .bind(prefix, `${prefix.slice(0, -1)};`)
    .all<{ key: string }>();
  for (const { key } of results) {
    if (!still.has(key.slice(prefix.length))) await resolveAlert(key);
  }
}
