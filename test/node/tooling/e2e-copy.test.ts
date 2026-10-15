// The browser tests look for copy by the content modules' own strings, and for prices by e2e/prices.ts, so a copy pass
// or a price change moves the tests with the screens rather than turning them red with nothing wrong (./e2e-copy.ts).

import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { LOCAL_PRICES } from "../../../e2e/prices.ts";
import { rupees } from "../../../packages/web-kit/money.ts";
import { LOCAL_HAIR_SYSTEMS } from "../../../src/config/local-hair-systems.ts";
import { migratedDatabase } from "../d1-over-sqlite.ts";
import {
  browserTests,
  CONTENT,
  contentModules,
  literalsIn,
  stringsOf,
  surfacesOf,
  type CopyString,
  type Surface,
} from "./e2e-copy.ts";

const copy: Record<Surface, CopyString[]> = { app: [], ops: [], tech: [], site: [] };

beforeAll(async () => {
  for (const surface of Object.keys(CONTENT) as Surface[]) {
    for (const module of contentModules(surface)) {
      const exports = (await import(/* @vite-ignore */ `../../../${module}`)) as Record<string, unknown>;
      copy[surface].push(...stringsOf(module, exports));
    }
  }
});

const TESTS = browserTests().map((file) => ({ file, text: readFileSync(file, "utf8") }));

describe("the browser tests' words", () => {
  it("are read from the content modules, never written out again", () => {
    expect(copy.app.length).toBeGreaterThan(100);
    const written = TESTS.flatMap(({ file, text }) => {
      const words = new Map(
        surfacesOf(file, text).flatMap((surface) => copy[surface].map((each) => [each.value, each])),
      );
      return literalsIn(file, text).flatMap((literal) => {
        const found = words.get(literal.value);
        return found === undefined
          ? []
          : [`${file}: "${literal.value}" is ${found.exportName}.${found.path.join(".")}`];
      });
    });
    expect(written).toEqual([]);
  });
});

/** Each price the migrations leave in the price book, by item, in paise with its GST. */
function priceBook(): Record<string, number> {
  const rows = migratedDatabase()
    .prepare(
      `SELECT item, amount_ex_gst, gst_percent FROM price_book p WHERE tier = 'standard'
         AND valid_from = (SELECT max(valid_from) FROM price_book q WHERE q.item = p.item AND q.tier = p.tier)`,
    )
    .all() as { item: string; amount_ex_gst: number; gst_percent: number }[];
  return Object.fromEntries(rows.map((row) => [row.item, Math.round(row.amount_ex_gst * (1 + row.gst_percent / 100))]));
}

describe("the browser tests' prices", () => {
  it("are the local database's, as the migrations leave its price book", () => {
    const book = priceBook();
    expect(LOCAL_PRICES).toEqual({
      service: book.service,
      firstFit: book.first_fit,
      replacement: book.replacement,
      lateFeeFirstFit: book.late_fee_first_fit,
      lateFeeReplacement: book.late_fee_replacement,
    });
  });

  // A client sees the price book: a test written against it in figures broke on a price change with nothing wrong.
  it("are never written out in figures in a client's tests, but named from e2e/prices.ts", () => {
    const figures = [...Object.values(LOCAL_PRICES), ...LOCAL_HAIR_SYSTEMS.map((each) => each.price)].map(rupees);
    const pattern = new RegExp(`(${figures.map((figure) => figure.replaceAll(".", "\\.")).join("|")})(?![\\d,])`);
    const clients = TESTS.filter(({ file }) => file !== "e2e/prices.ts" && /^e2e\/(app\/)?[^/]+$/.test(file));
    const written = clients.flatMap(({ file, text }) =>
      literalsIn(file, text)
        .filter((literal) => pattern.test(literal.value))
        .map((literal) => `${file}: "${literal.value}"`),
    );
    expect(written).toEqual([]);
  });
});
