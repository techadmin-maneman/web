// The references clients and suppliers read (src/lib/references.ts): a payment's random, an order's or a claim's
// number drawn at random from those not taken, so neither tells how many came before.

import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { drawnNumbers, freshNumber, paymentReference } from "../../../src/lib/references.ts";

describe("a payment's reference", () => {
  it("is MM and eight letters or digits no one misreads, different each time", () => {
    const made = Array.from({ length: 50 }, paymentReference);
    for (const reference of made) expect(reference).toMatch(/^MM-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
    expect(new Set(made).size).toBe(made.length);
  });
});

describe("an order's number", () => {
  it("is six digits, the first drawn that no order has", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE purchase_orders (number INTEGER NOT NULL UNIQUE)");
    const drawn = JSON.parse(drawnNumbers()) as number[];
    expect(drawn).toHaveLength(5);
    expect(drawn.every((number) => number >= 100_000 && number < 1_000_000)).toBe(true);

    const taken = JSON.stringify([123_456, 234_567, 345_678]);
    db.prepare("INSERT INTO purchase_orders (number) VALUES (123456)").run();
    const insert = db.prepare(`INSERT INTO purchase_orders (number) SELECT ${freshNumber("purchase_orders", "?1")}`);
    insert.run(taken);
    insert.run(taken);
    const rows = db.prepare("SELECT number FROM purchase_orders ORDER BY rowid").all();
    expect(rows).toEqual([{ number: 123_456 }, { number: 234_567 }, { number: 345_678 }]);
  });
});
