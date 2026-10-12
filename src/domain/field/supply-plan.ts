// The supply plan, drafted (docs/decisions/0180-supply-plan.md): from a forecast run, each stock code each city needs
// over its supplier's lead time and a period, with safety stock, against what the city can use: what its places hold,
// what is on its way to it, less what is reserved to custom orders. A short city borrows from a city with spare, then
// from the warehouse, each a transfer between stockrooms; what is still short, less what is on order, is ordered from
// the supplier who sells it cheapest, in whole packs. A new draft replaces the last one's proposals.

import {
  lend,
  needOver,
  orderQuantity,
  periodsCovering,
  shortOf,
  spareOf,
  type PeriodForecast,
} from "../../policy/supply-plan.ts";

type ForecastRow = { consumable_code: string; city: string; period: number; expected: number; high: number };
type TermsRow = {
  code: string;
  supplier_id: string;
  unit_price: number;
  pack_size: number;
  minimum_order: number;
  lead_time_days: number;
};
type HeldRow = { code: string; kind: string; city: string | null; held: number };
type ByCity = { code: string; city: string | null; quantity: number };

interface Line {
  readonly kind: "transfer" | "order";
  readonly code: string;
  readonly city: string | null;
  readonly from: string | null;
  readonly to: string | null;
  readonly supplierId: string | null;
  readonly proposed: number;
  readonly usable: number;
  readonly need: number;
  readonly safety: number;
}

/** What the plan reads, for the codes the forecast names. */
async function standing(db: D1Database, runId: string) {
  const { results: forecast } = await db
    .prepare(
      "SELECT consumable_code, city, period, expected, high FROM forecast_lines WHERE run_id = ?1 AND city <> ''",
    )
    .bind(runId)
    .all<ForecastRow>();
  const codes = JSON.stringify([...new Set(forecast.map((row) => row.consumable_code))]);
  const [terms, held, moving, reserved, coming, rooms] = await db.batch<
    TermsRow | HeldRow | ByCity | { id: string; kind: string; city: string | null }
  >([
    db
      .prepare(
        `SELECT i.consumable_code AS code, i.supplier_id, i.unit_price, i.pack_size, i.minimum_order, i.lead_time_days
         FROM supplier_items i JOIN suppliers s ON s.id = i.supplier_id
         WHERE i.consumable_code IN (SELECT value FROM json_each(?1)) AND s.retired_at IS NULL`,
      )
      .bind(codes),
    db
      .prepare(
        `SELECT b.consumable_code AS code, p.kind, COALESCE(p.city, t.city) AS city, SUM(b.quantity) AS held
         FROM stock_balances b JOIN stock_places p ON p.id = b.place LEFT JOIN technicians t ON t.id = p.technician_id
         WHERE b.consumable_code IN (SELECT value FROM json_each(?1)) AND b.quantity > 0 GROUP BY 1, 2, 3`,
      )
      .bind(codes),
    db.prepare(
      `SELECT x.consumable_code AS code, COALESCE(p.city, t.city) AS city, SUM(x.quantity) AS quantity
       FROM stock_transfers x INDEXED BY stock_transfers_in_transit JOIN stock_places p ON p.id = x.to_place
       LEFT JOIN technicians t ON t.id = p.technician_id WHERE x.state = 'in_transit' GROUP BY 1, 2`,
    ),
    db.prepare(
      `SELECT u.consumable_code AS code, COALESCE(p.city, t.city) AS city, COUNT(*) AS quantity
       FROM stock_units u INDEXED BY stock_units_reserved JOIN stock_places p ON p.id = u.place
       LEFT JOIN technicians t ON t.id = p.technician_id
       WHERE u.custom_order_id IS NOT NULL AND u.state = 'held' GROUP BY 1, 2`,
    ),
    db.prepare(
      `SELECT l.consumable_code AS code, NULL AS city, SUM(l.quantity - l.received_quantity) AS quantity
       FROM purchase_orders o INDEXED BY purchase_orders_open JOIN po_lines l ON l.po_id = o.id
       WHERE o.state IN ('approved', 'sent', 'part_received') AND l.custom_order_id IS NULL GROUP BY 1`,
    ),
    db.prepare("SELECT id, kind, city FROM stock_places WHERE kind IN ('warehouse', 'stockroom')"),
  ]);
  return {
    forecast,
    terms: (terms?.results ?? []) as TermsRow[],
    held: (held?.results ?? []) as HeldRow[],
    moving: (moving?.results ?? []) as ByCity[],
    reserved: (reserved?.results ?? []) as ByCity[],
    coming: (coming?.results ?? []) as ByCity[],
    rooms: (rooms?.results ?? []) as { id: string; kind: string; city: string | null }[],
  };
}

const sumOf = (rows: readonly ByCity[], code: string, city: string | null) =>
  rows.filter((row) => row.code === code && row.city === city).reduce((sum, row) => sum + row.quantity, 0);

/** The lines one stock code's plan proposes: loans, sends from the warehouse, and an order. */
function linesFor(code: string, read: Awaited<ReturnType<typeof standing>>, periodDays: number): Line[] {
  const terms = read.terms.filter((row) => row.code === code);
  const cheapest = [...terms].sort((a, b) => a.unit_price - b.unit_price)[0];
  const periods = periodsCovering(cheapest?.lead_time_days ?? 0, periodDays);
  const roomOf = (city: string) =>
    read.rooms.find((room) => room.kind === "stockroom" && room.city === city)?.id ?? null;
  const warehouse = read.rooms.find((room) => room.kind === "warehouse")?.id ?? null;
  const cities = [...new Set(read.forecast.filter((row) => row.consumable_code === code).map((row) => row.city))];
  const standings = cities.map((city) => {
    const forecast: PeriodForecast[] = read.forecast.filter((row) => row.consumable_code === code && row.city === city);
    const held = read.held.filter((row) => row.code === code && row.city === city && row.kind !== "warehouse");
    const usable =
      held.reduce((sum, row) => sum + row.held, 0) + sumOf(read.moving, code, city) - sumOf(read.reserved, code, city);
    return { city, usable, ...needOver(forecast, periods) };
  });
  const figures = new Map(standings.map((each) => [each.city, each]));
  const transfer = (move: { city: string; from: string; to: string; quantity: number }): Line => {
    const each = figures.get(move.city);
    const { city, from, to, quantity } = move;
    return {
      kind: "transfer",
      code,
      city,
      from,
      to,
      supplierId: null,
      proposed: quantity,
      usable: each?.usable ?? 0,
      need: each?.need ?? 0,
      safety: each?.safety ?? 0,
    };
  };
  const placed = standings.filter((each) => roomOf(each.city) !== null);
  const { loans, short } = lend(
    placed
      .map((each) => ({ city: each.city, short: shortOf(each.usable, each.need, each.safety) }))
      .filter((each) => each.short > 0),
    placed
      .map((each) => ({ city: each.city, spare: spareOf(each.usable, each.need, each.safety) }))
      .filter((each) => each.spare > 0),
  );
  const lines: Line[] = loans.map((loan) =>
    transfer({ city: loan.to, from: roomOf(loan.from) ?? "", to: roomOf(loan.to) ?? "", quantity: loan.quantity }),
  );
  let spare = read.held
    .filter((row) => row.code === code && row.kind === "warehouse")
    .reduce((sum, row) => sum + row.held, 0);
  spare -= sumOf(read.reserved, code, null);
  for (const [city, wanted] of short) {
    const sent = Math.min(Math.max(spare, 0), wanted);
    if (sent > 0 && warehouse !== null)
      lines.push(transfer({ city, from: warehouse, to: roomOf(city) ?? "", quantity: sent }));
    spare -= sent;
  }
  const unplaced = standings.filter((each) => roomOf(each.city) === null);
  const stillShort =
    [...short.values()].reduce((sum, value) => sum + value, 0) -
    lines.filter((line) => line.from === warehouse).reduce((sum, line) => sum + line.proposed, 0) +
    unplaced.reduce((sum, each) => sum + shortOf(each.usable, each.need, each.safety), 0);
  const toOrder = stillShort - Math.max(spare, 0) - sumOf(read.coming, code, null);
  if (toOrder > 0 && cheapest !== undefined) {
    lines.push({
      kind: "order",
      code,
      city: null,
      from: null,
      to: null,
      supplierId: cheapest.supplier_id,
      proposed: orderQuantity(toOrder, cheapest.pack_size, cheapest.minimum_order),
      usable: Math.max(spare, 0) + sumOf(read.coming, code, null),
      need: standings.reduce((sum, each) => sum + each.need, 0),
      safety: Math.round(Math.sqrt(standings.reduce((sum, each) => sum + each.safety ** 2, 0)) * 10) / 10,
    });
  }
  return lines;
}

/** The plan drafted from a forecast run, replacing the last one's proposals. How many lines it proposes. */
export async function draftPlan(db: D1Database, runId: string, now: Date, periodDays: number): Promise<number> {
  const read = await standing(db, runId);
  const codes = [...new Set(read.forecast.map((row) => row.consumable_code))];
  const lines = codes.flatMap((code) => linesFor(code, read, periodDays));
  const at = now.toISOString();
  await db.batch([
    db.prepare("DELETE FROM plan_lines WHERE state = 'proposed' AND run_id NOT LIKE 'kit-check:%'"),
    ...lines.map((line) =>
      db
        .prepare(
          `INSERT INTO plan_lines (id, run_id, kind, consumable_code, city, from_place, to_place, supplier_id, proposed,
             usable, need, safety, state, drafted_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 'proposed', ?13)`,
        )
        .bind(
          crypto.randomUUID(),
          runId,
          line.kind,
          line.code,
          line.city,
          line.from,
          line.to,
          line.supplierId,
          line.proposed,
          line.usable,
          line.need,
          line.safety,
          at,
        ),
    ),
  ]);
  return lines.length;
}
