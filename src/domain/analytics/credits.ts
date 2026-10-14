// Free service visits in the reporting copy (docs/decisions/0153-supply-and-credits-in-the-copy.md): every entry of the
// credit ledger, valued at a standard service visit's price on its day, so what is owed can be read at any date. As the
// dashboards read it, a grant is "granted" and adds what it gives; every other entry takes off what it shows, so a visit
// given back, which the ledger adds, shows a negative. Records marked as tests are left out; an erased client's entries
// stay, with no key.

import { indiaDate, indiaDateSql } from "../../lib/india-time.ts";
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

/** The ledger's kinds as the dashboards name them. */
const KIND_WORDS: Readonly<Record<string, string>> = {
  grant: "granted",
  redeem: "used",
  restore: "given_back",
  expire: "expired",
  clawback: "taken_back",
  adjust: "adjusted",
};

export async function creditRows(db: D1Database, keys: ReadonlyMap<string, string>): Promise<TableRows> {
  const { results } = await db
    .prepare(
      `SELECT c.id, c.person_id, p.erased_at IS NOT NULL AS erased, c.created_at, c.kind, c.visits,
         ${clientCityOf("p")} AS city,
         (SELECT b.amount_ex_gst FROM price_book b WHERE b.item = 'service' AND b.tier = 'standard'
            AND b.valid_from <= ${indiaDateSql("c.created_at")} ORDER BY b.valid_from DESC LIMIT 1) AS price
       FROM credit_ledger c JOIN people p ON p.id = c.person_id WHERE p.test_record = 0`,
    )
    .all<CreditRow>();
  return {
    table: "fact_credit",
    key: ["entry_key"],
    stamped: true,
    rows: results.map((row) => {
      // A grant counts what it adds; every other entry what it takes off.
      const visits = row.kind === "grant" ? row.visits : -row.visits;
      return {
        entry_key: row.id,
        entry_date: indiaDate(new Date(row.created_at)),
        client_key: row.erased === 1 ? null : (keys.get(row.person_id) ?? null),
        city: row.city,
        kind: KIND_WORDS[row.kind] ?? row.kind,
        visits,
        value: row.price === null ? null : Math.round(visits * row.price) / 100,
      };
    }),
  };
}
