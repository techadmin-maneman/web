// Free service visits in the reporting copy (docs/decisions/0153-supply-and-credits-in-the-copy.md): every entry of the
// credit ledger, whatever gave, used, gave back, let expire or took back a visit, signed as the ledger keeps it, and
// valued at a standard service visit's price on its day, so what is owed can be read at any date. Records marked as
// tests are left out; an erased client's entries stay, with no key.

import { indiaDate } from "../../lib/india-time.ts";
import type { TableRows } from "../../providers/warehouse/index.ts";
import { clientCityOf } from "../clients/places.ts";

interface CreditRow {
  readonly id: string;
  readonly person_id: string;
  readonly erased: number;
  readonly created_at: string;
  readonly kind: string;
  readonly visits: number;
  readonly city: string | null;
  readonly price: number | null;
}

export async function creditRows(db: D1Database, keys: ReadonlyMap<string, string>): Promise<TableRows> {
  const { results } = await db
    .prepare(
      `SELECT c.id, c.person_id, p.erased_at IS NOT NULL AS erased, c.created_at, c.kind, c.visits,
         ${clientCityOf("p")} AS city,
         (SELECT b.amount_ex_gst FROM price_book b WHERE b.item = 'service' AND b.tier = 'standard'
            AND b.valid_from <= date(c.created_at, '+330 minutes') ORDER BY b.valid_from DESC LIMIT 1) AS price
       FROM credit_ledger c JOIN people p ON p.id = c.person_id WHERE p.test_record = 0`,
    )
    .all<CreditRow>();
  return {
    table: "fact_credit",
    key: ["entry_key"],
    stamped: true,
    rows: results.map((row) => ({
      entry_key: row.id,
      entry_date: indiaDate(new Date(row.created_at)),
      client_key: row.erased === 1 ? null : (keys.get(row.person_id) ?? null),
      city: row.city,
      kind: row.kind,
      visits: row.visits,
      value: row.price === null ? null : Math.round(row.visits * row.price) / 100,
    })),
  };
}
