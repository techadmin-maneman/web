// What the stock needs a person for, told each morning (docs/decisions/0159-stock-views-and-expiry.md): each place
// holding a lot that expires within EXPIRY_WARNING_DAYS, or has expired, in one alert for the place naming each lot;
// and each transfer still on its way TRANSFER_OVERDUE_DAYS after it was sent. An alert closes once what it was about is
// gone: the lots used, moved or written off, the transfer received or sent back.

import { MINUTE_MS } from "../../lib/durations.ts";
import { addDays, indiaDate, indiaHour } from "../../lib/india-time.ts";
import { EXPIRY_WARNING_DAYS, TRANSFER_OVERDUE_DAYS } from "../../policy/stock.ts";
import type { AlertOnce, ResolveAlert } from "../ops/alerts.ts";
import { refreshStockRisks } from "./stock-risks.ts";

const EXPIRING_KEY = "stock_expiring:";
const OVERDUE_KEY = "transfer_overdue:";

/** India's date in the hour from 9 am, when the stock is looked at; null in every other hour. */
function stockWatchDueOn(now: Date): string | null {
  return indiaHour(now).endsWith("T09") ? indiaDate(now) : null;
}

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
async function tellOfExpiring(
  db: D1Database,
  deps: { readonly alertOnce: AlertOnce; readonly resolveAlert: ResolveAlert },
  today: string,
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
    .bind(addDays(today, EXPIRY_WARNING_DAYS))
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
      message: `Stock in ${placeWords(first)} expires within ${String(EXPIRY_WARNING_DAYS)} days: ${lots.join("; ")}. Use it first, move it, or write it off on the Stock page.`,
      link: "/stock",
    });
  }
  await closeTheRest(db, deps.resolveAlert, EXPIRING_KEY, new Set(byPlace.keys()));
}

/** A place in a chat message, in SQL: its name, or a kit by its technician's ID. */
const PLACE_WORDS = (alias: string) =>
  `CASE WHEN ${alias}.kind = 'kit' THEN 'technician ' || ${alias}.id || '''s kit' ELSE ${alias}.name END`;

/** One alert for each transfer on its way too long; closes those received or sent back. */
async function tellOfOverdue(
  db: D1Database,
  deps: { readonly alertOnce: AlertOnce; readonly resolveAlert: ResolveAlert },
  now: Date,
): Promise<void> {
  const sentBy = new Date(now.getTime() - TRANSFER_OVERDUE_DAYS * 24 * 60 * MINUTE_MS).toISOString();
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
      message:
        `${String(row.quantity)} ${row.unit} of ${row.item}, sent from ${row.from_place} to ${row.to_place} on ` +
        `${indiaDate(new Date(row.sent_at))}, has not been received. Receive it, or send it back, on the Stock page.`,
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

/** The morning look at the stock: what expires soon, and what is long on its way. */
export async function watchStock(
  db: D1Database,
  deps: { readonly alertOnce: AlertOnce; readonly resolveAlert: ResolveAlert; readonly now: () => Date },
): Promise<void> {
  const now = deps.now();
  // Each hour: the fits booked ahead with no hair system in reach, kept as tasks (./stock-risks.ts).
  await refreshStockRisks(db, indiaDate(now), now);
  const today = stockWatchDueOn(now);
  if (today === null) return;
  await tellOfExpiring(db, deps, today);
  await tellOfOverdue(db, deps, now);
}
