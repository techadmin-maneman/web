// Migration 0220: each price in the book and each city's own gets what the client pays, GST included, as the Worker
// worked it out before, to the paisa (docs/decisions/0274-gst-on.md). Every figure here is made up.

import { describe, expect, it } from "vitest";
import { withGst } from "../../../src/config/gst.ts";
import { apply, databaseBefore, migrationNamed } from "./migrations.ts";

const THIS = migrationNamed("_prices_with_gst.sql");

const ROWS = [
  { item: "service", tier: "standard", amount_ex_gst: 200_000, gst_percent: 5, valid_from: "2027-01-01" },
  { item: "first_fit", tier: "standard", amount_ex_gst: 2_711_864, gst_percent: 18, valid_from: "2027-01-02" },
  // Rs. 1,694.92 before GST, which GST added back makes Rs. 2,000.01: kept so, as the Worker sold it.
  { item: "late_fee_first_fit", tier: "standard", amount_ex_gst: 169_492, gst_percent: 18, valid_from: "2027-01-03" },
  { item: "replacement", tier: "standard", amount_ex_gst: 1_500_000, gst_percent: 0, valid_from: "2027-01-04" },
];

describe("migration 0220", () => {
  it("gives each price what it came to with its GST, in the book and in a city", () => {
    expect(THIS).not.toBe("");
    const db = databaseBefore(THIS);
    const book = db.prepare(
      "INSERT INTO price_book (item, tier, amount_ex_gst, gst_percent, valid_from) VALUES (?1, ?2, ?3, ?4, ?5)",
    );
    for (const row of ROWS) book.run(row.item, row.tier, row.amount_ex_gst, row.gst_percent, row.valid_from);
    db.prepare(
      `INSERT INTO city_prices (item, tier, city, amount_ex_gst, gst_percent, valid_from)
       VALUES ('service', 'standard', 'Gurgaon', 400000, 18, '2027-01-01')`,
    ).run();

    apply(db, THIS);

    const read = db.prepare("SELECT amount_paise FROM price_book WHERE item = ?1 AND valid_from = ?2");
    for (const row of ROWS) {
      expect(read.get(row.item, row.valid_from), row.item).toEqual({
        amount_paise: withGst(row.amount_ex_gst, row.gst_percent),
      });
    }
    expect(db.prepare("SELECT amount_paise FROM city_prices WHERE city = 'Gurgaon'").get()).toEqual({
      amount_paise: 472_000,
    });
    db.close();
  });
});
