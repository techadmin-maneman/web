// The hourly check of each service's Books item, without FSM. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createAlertOnce, createResolveAlert } from "../../../src/domain/alerts.ts";
import { checkBooksItems, type BooksItemsOptions } from "../../../src/domain/books-items.ts";
import { createCallBudget } from "../../../src/lib/call-budget.ts";
import { createLogger } from "../../../src/log.ts";
import { BOOKS_ITEM_PAGES, type BooksItem } from "../../../src/providers/books/index.ts";
import { createStubBooks, type StubBooks } from "../../../src/providers/books/stub.ts";
import { captureLogs } from "../helpers.ts";

/** Two minutes past the hour (UTC) on Wednesday 23 September, when staging's book has no GST. */
const AT = new Date("2026-09-23T05:02:00.000Z");
const HOUR = 60 * 60 * 1000;
const anHourOn = (hours: number) => new Date(AT.getTime() + hours * HOUR);

const PRICES_LINK = "http://ops.localhost:4323/settings/prices";

let alerted: string[];

/** What Books holds that agrees with the seeded services on the day: each kind's standard one, at its price. */
const AGREEING: readonly BooksItem[] = [
  { id: "item-consultation", name: "Consultation", rate: 0, active: true, sac: null },
  { id: "item-first-fit", name: "First fit", rate: 3_000_000, active: true, sac: null },
  { id: "item-service", name: "Service visit", rate: 200_000, active: true, sac: null },
  { id: "item-replacement", name: "Replacement", rate: 1_500_000, active: true, sac: null },
];

function check(books: StubBooks, options: Partial<BooksItemsOptions> = {}) {
  const now = options.now ?? AT;
  const alert = (message: string) => {
    alerted.push(message);
    return Promise.resolve();
  };
  const alertOnce = createAlertOnce({ db: env.DB, alert, now: () => now, environment: "local", log: createLogger() });
  const resolveAlert = createResolveAlert({ db: env.DB, now: () => now });
  return checkBooksItems(
    env.DB,
    { books, alertOnce, resolveAlert, log: createLogger() },
    { push: false, sac: null, now, budget: createCallBudget(40), ...options },
  );
}

const keptItems = async () => {
  const { results } = await env.DB.prepare("SELECT kind, books_item_id FROM services ORDER BY kind").all();
  return results;
};

beforeEach(() => {
  alerted = [];
  captureLogs();
});

describe("each service's Books item", () => {
  it("is found by its name, whatever its case, and kept, so the invoice pass bills on it", async () => {
    const books = createStubBooks({
      items: AGREEING.map((item) => (item.id === "item-service" ? { ...item, name: "Service visit" } : item)),
    });
    expect(await check(books)).toEqual({ differs: [], written: 0 });
    expect(await keptItems()).toEqual([
      { kind: "consultation", books_item_id: "item-consultation" },
      { kind: "first_fit", books_item_id: "item-first-fit" },
      { kind: "replacement", books_item_id: "item-replacement" },
      { kind: "service", books_item_id: "item-service" },
    ]);
    expect(alerted).toEqual([]);
  });

  it("with the push off, tells ops once of an item missing or differing, and closes it once Books agrees", async () => {
    const differing = AGREEING.filter((item) => item.id !== "item-consultation").map((item) =>
      item.id === "item-service" ? { ...item, rate: 150_000 } : item,
    );
    const books = createStubBooks({ items: differing });

    expect(await check(books)).toEqual({ differs: ["consultation/standard", "service/standard"], written: 0 });
    expect(alerted).toEqual([
      'Books has no item named "Consultation", so its visits cannot be invoiced. Add it in Books as a service at ' +
        `Rs. 0, GST included, named exactly so: the next hourly check finds it by its name. ${PRICES_LINK}`,
      'Books\' item item-service ("Service visit") is Rs. 1,500, and the price book has Rs. 2,000, GST included. ' +
        "Set it in Books by hand. An invoice carries its own price, so this changes only what Books offers an " +
        `invoice raised by hand. ${PRICES_LINK}`,
    ]);
    expect(books.made.itemsMade).toEqual([]);
    expect(books.made.itemUpdates).toEqual([]);

    await check(books, { now: anHourOn(1) });
    expect(alerted).toHaveLength(2);

    const agreeing = createStubBooks({ items: AGREEING });
    expect(await check(agreeing, { now: anHourOn(2) })).toEqual({ differs: [], written: 0 });
    const open = await env.DB.prepare("SELECT COUNT(*) AS n FROM alerts WHERE resolved_at IS NULL").first();
    expect(open).toEqual({ n: 0 });
  });

  it("with the push on, makes an item Books lacks at the price book's price with GST, and keeps it", async () => {
    // Sunday 20 September, when the book had 5% GST: a service visit was Rs. 2,000 before it.
    const sunday = new Date("2026-09-20T05:02:00.000Z");
    const books = createStubBooks({
      items: AGREEING.filter((item) => item.id !== "item-service").map((item) =>
        item.id === "item-first-fit" ? { ...item, rate: 3_150_000 } : item,
      ),
    });
    const before = AGREEING.find((item) => item.id === "item-replacement");
    await env.DB.prepare("UPDATE services SET books_item_id = 'item-replacement' WHERE kind = 'replacement'").run();

    const checked = await check(books, { push: true, now: sunday });
    expect(books.made.itemsMade).toEqual([{ name: "Service visit", rate: 210_000, sac: null }]);
    expect(books.made.itemUpdates).toEqual([{ itemId: before?.id, name: "Replacement", rate: 1_575_000, sac: null }]);
    expect(checked).toEqual({ differs: [], written: 2 });
    const kept = await keptItems();
    expect(kept).toContainEqual({ kind: "service", books_item_id: expect.stringMatching(/^stub-item-/) as string });
    expect(alerted).toEqual([]);
  });

  it("with the push on, writes the console's name over the item kept on the service, whatever Books calls it", async () => {
    const renamed = AGREEING.map((item) => (item.id === "item-service" ? { ...item, name: "Old service name" } : item));
    await env.DB.prepare("UPDATE services SET books_item_id = 'item-service' WHERE kind = 'service'").run();
    const books = createStubBooks({ items: renamed });

    await check(books, { push: true });
    expect(books.made.itemUpdates).toEqual([
      { itemId: "item-service", name: "Service visit", rate: 200_000, sac: null },
    ]);
    expect(books.made.itemsMade).toEqual([]);
  });

  it("never takes, by its name, an item another service keeps", async () => {
    // Ops gave the replacement's old item a new name, the service visit's: it is still the replacement's.
    const items = [
      ...AGREEING.filter((item) => item.id !== "item-service" && item.id !== "item-replacement"),
      { id: "item-replacement", name: "Service visit", rate: 1_500_000, active: true, sac: null },
    ];
    await env.DB.prepare("UPDATE services SET books_item_id = 'item-replacement' WHERE kind = 'replacement'").run();
    const books = createStubBooks({ items });

    await check(books, { push: true });
    expect(books.made.itemsMade).toEqual([{ name: "Service visit", rate: 200_000, sac: null }]);
    expect(books.made.itemUpdates).toEqual([
      { itemId: "item-replacement", name: "Replacement", rate: 1_500_000, sac: null },
    ]);
  });

  it("with the push on, tells ops only of an item still unsettled an hour after a write failed", async () => {
    const books = createStubBooks({ items: AGREEING.filter((item) => item.id !== "item-service") });
    books.refuseNext("createItem", "1001");
    expect(await check(books, { push: true })).toEqual({ differs: ["service/standard"], written: 0 });
    expect(alerted).toEqual([]);

    books.refuseNext("createItem", "1001");
    await check(books, { push: true, now: anHourOn(1) });
    expect(alerted).toEqual([
      'Books still has no item named "Service visit" an hour after it was asked to make one, so its visits ' +
        `cannot be invoiced. Add it in Books as a service at Rs. 2,000, GST included, named exactly so. ${PRICES_LINK}`,
    ]);

    await check(books, { push: true, now: anHourOn(2) });
    expect(books.made.itemsMade).toHaveLength(1);
    const open = await env.DB.prepare("SELECT COUNT(*) AS n FROM alerts WHERE resolved_at IS NULL").first();
    expect(open).toEqual({ n: 0 });
  });

  it("writes the SAC code once the CA has given one", async () => {
    const books = createStubBooks({ items: AGREEING });
    await check(books, { push: true, sac: "999721" });
    expect(books.made.itemUpdates).toHaveLength(4);
    expect(books.made.itemUpdates[0]).toMatchObject({ sac: "999721" });

    books.made.itemUpdates.length = 0;
    await check(books, { push: true, sac: "999721", now: anHourOn(1) });
    expect(books.made.itemUpdates).toEqual([]);
  });

  it("closes what ops were told of a service no longer offered", async () => {
    const books = createStubBooks({ items: AGREEING.filter((item) => item.id !== "item-service") });
    await check(books);
    expect(alerted).toHaveLength(1);

    await env.DB.prepare("UPDATE services SET retired_date = '2026-09-23' WHERE kind = 'service'").run();
    expect(await check(books, { now: anHourOn(1) })).toEqual({ differs: [], written: 0 });
    const open = await env.DB.prepare("SELECT COUNT(*) AS n FROM alerts WHERE resolved_at IS NULL").first();
    expect(open).toEqual({ n: 0 });
  });

  it("runs on the hour, and only with calls enough left to read Books' list", async () => {
    const books = createStubBooks({ items: AGREEING });
    expect(await check(books, { now: new Date("2026-09-23T05:10:00.000Z") })).toBeNull();
    expect(await check(books, { budget: createCallBudget(BOOKS_ITEM_PAGES - 1) })).toBeNull();
    expect(await check(books, { budget: createCallBudget(BOOKS_ITEM_PAGES) })).toEqual({ differs: [], written: 0 });
  });
});
