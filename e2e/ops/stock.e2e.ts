// Stock: what each place holds (the warehouse, hubs, stockrooms and technicians' kits), which is low, the movements
// ops record, and the places themselves (docs/decisions/0087-consumables-and-stock.md, 0155-the-stock-place-tree.md).
// Each movement shows what each place holds now beside what it will hold before
// it is sent (docs/decisions/0071-what-ops-see-before-a-setting-changes.md).

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { answer, fails, IMRAN, json, STOCK, type Answers, type OpsReply } from "./fixtures.ts";
import { expectOneBoxALine } from "./one-box-a-line.ts";
import * as opsCopy from "../../apps/ops/src/content.ts";
import { stock } from "../../apps/ops/src/content/stock.ts";
import { stockPlaces } from "../../apps/ops/src/content/stock-places.ts";
import { stockTransit } from "../../apps/ops/src/content/stock-transit.ts";
import { stockLabels } from "../../apps/ops/src/content/stock-labels.ts";
import { stockViews } from "../../apps/ops/src/content/stock-views.ts";
import { review } from "../../apps/ops/src/content/common.ts";
import { activity } from "../../apps/ops/src/content/activity.ts";

const WAREHOUSE = "National warehouse";

/** Nothing booked ahead uses stock. */
const NO_DEMAND = { days: 28, demand: [], at_risk: [] };

async function open(page: Page, extra: Answers = {}): Promise<void> {
  await answer(page, { "GET /api/stock": json(STOCK), "GET /api/stock/demand": json(NO_DEMAND), ...extra });
  await page.goto("/stock");
  await expect(page.getByRole("heading", { level: 1, name: stock.title })).toBeVisible();
}

const posted = (page: Page, path: string) =>
  page.waitForRequest((request) => request.url().endsWith(path) && request.method() === "POST");

const onHand = (page: Page) => page.getByRole("region", { name: stock.onHand });
/** The form that records a movement, opened from the page's head. */
async function recording(page: Page) {
  await page.getByRole("button", { name: stock.record.title }).click();
  return page.getByRole("dialog", { name: stock.record.title });
}

test("is a section of its own beside the technicians, titled by what it is", async ({ page }) => {
  await open(page);
  await expect(page).toHaveTitle("Stock · Mane Man Ops");
  await expect(page.getByRole("navigation").getByRole("link", { name: stock.title })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("shows what each place holds, a low kit in words, a store below nothing, and a kit whose technician left", async ({
  page,
}) => {
  await open(page);
  const table = onHand(page);
  await expect(table.getByRole("columnheader", { name: WAREHOUSE })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Sameer Bhatt (left)" })).toBeVisible();

  const tape = table.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "Tape strips" }) });
  await expect(tape.getByRole("cell").nth(0)).toContainText("120 strips");
  await expect(tape.getByRole("cell").nth(0)).toContainText("Counted Mon 20 Sep");
  await expect(tape.getByRole("cell").nth(1)).toContainText("3 strips");
  await expect(tape.getByRole("cell").nth(1)).toContainText(stock.low);
  await expect(tape.getByRole("cell").nth(2)).not.toContainText(stock.low);
  const solvent = table.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "Solvent" }) });
  await expect(solvent.getByRole("cell").nth(0)).toHaveText(`-20 ml${stock.belowZero}`);
});

// A column a kit was unreadable past eight or ten.
test("past six places, shows the warehouse and one place, picked, marking each place low on anything", async ({
  page,
}) => {
  const kits = Array.from({ length: 6 }, (_, index) => ({
    ...STOCK.places[1],
    id: `e2e00000-0000-4000-8000-00000000000${String(index + 1)}`,
    name: `Technician ${String(index + 1)}`,
  }));
  const holdings = kits.map((kit, index) => ({
    consumable_code: "tape_strips",
    place_id: kit.id,
    quantity: index + 1,
    low: index === 4,
    counted_at: null,
    lots: [],
  }));
  const many = { ...STOCK, places: [STOCK.places[0], ...kits], holdings: [...STOCK.holdings, ...holdings] };
  await answer(page, { "GET /api/stock/demand": json(NO_DEMAND), "GET /api/stock": json(many) });
  await page.goto("/stock");
  const table = onHand(page);
  await expect(table.getByRole("columnheader")).toHaveText([stock.record.consumable, WAREHOUSE, "Technician 1"]);

  // One control: past a handful of places, it names the one beside the warehouse, among the totals.
  const show = page.getByLabel(stock.totalsBy);
  await expect(show.getByRole("option", { name: "Technician 5 · low" })).toHaveCount(1);
  await expect(table.getByLabel(stockLabels.place)).toHaveCount(0);
  await show.selectOption({ label: "Technician 5 · low" });
  await expect(table.getByRole("columnheader")).toHaveText([stock.record.consumable, WAREHOUSE, "Technician 5"]);
  const tape = table.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "Tape strips" }) });
  await expect(tape.getByRole("cell").nth(1)).toContainText("5 strips");
  await expect(tape.getByRole("cell").nth(1)).toContainText(stock.low);
  expect(await axeViolations(page)).toEqual([]);
});

test("records a delivery into the store, showing what it holds before and after", async ({ page }) => {
  await open(page, { "POST /api/stock/deliveries": json(STOCK) });
  const form = await recording(page);
  await form.getByLabel(stock.record.consumable).selectOption({ label: "Tape strips" });
  await form.getByLabel(stock.record.quantity).fill("100");
  await form.getByLabel(stock.record.note).fill("Supplier’s note 4418");
  await form.getByRole("button", { name: stock.record.check }).click();

  const check = form.getByRole("group", { name: review.title });
  await expect(check).toBeFocused();
  await expect(check).toContainText(`${WAREHOUSE}: 120 strips → 220 strips`);
  const sent = posted(page, "/api/stock/deliveries");
  await check.getByRole("button", { name: review.send }).click();
  expect((await sent).postDataJSON()).toEqual({
    consumable_code: "tape_strips",
    quantity: 100,
    note: "Supplier’s note 4418",
    lot_code: null,
    expires_on: null,
  });
  await expect(form.getByRole("status")).toHaveText(stock.recorded);
});

test("takes a delivery’s supplier lot and its expiry", async ({ page }) => {
  await open(page, { "POST /api/stock/deliveries": json(STOCK) });
  const form = await recording(page);
  await form.getByLabel(stock.record.consumable).selectOption({ label: "Solvent" });
  await form.getByLabel(stock.record.quantity).fill("500");
  await form.getByLabel(stock.record.lot).fill("SV-2611");
  await form.getByLabel(stock.record.expires).fill("2027-11-30");
  await form.getByRole("button", { name: stock.record.check }).click();
  const sent = posted(page, "/api/stock/deliveries");
  await form.getByRole("button", { name: review.send }).click();
  expect((await sent).postDataJSON()).toMatchObject({ lot_code: "SV-2611", expires_on: "2027-11-30" });
});

const LOT = { id: "lot-1", lot_code: "TS-0901", expires_on: "2027-10-31", quantity: 120 };
const withLot = {
  ...STOCK,
  holdings: STOCK.holdings.map((holding) =>
    holding.consumable_code === "tape_strips" && holding.place_id === "central" ? { ...holding, lots: [LOT] } : holding,
  ),
};

test("says when the soonest lot a place holds expires, and writes off the lot named", async ({ page }) => {
  await answer(page, {
    "GET /api/stock/demand": json(NO_DEMAND),
    "GET /api/stock": json(withLot),
    "POST /api/stock/write-offs": json(withLot),
  });
  await page.goto("/stock");
  const tape = onHand(page)
    .getByRole("row")
    .filter({ has: page.getByRole("rowheader", { name: "Tape strips" }) });
  await expect(tape.getByRole("cell").nth(0)).toContainText("Expires 31 Oct 2027");

  const form = await recording(page);
  await form.getByLabel(stock.record.kinds.write_off).check();
  await form.getByLabel(stock.record.consumable).selectOption({ label: "Tape strips" });
  await form.getByLabel(stock.record.lostLot).selectOption({ label: "TS-0901 · expires 31 Oct 2027" });
  await form.getByLabel(stock.record.quantity).fill("20");
  await form.getByLabel(stock.record.lossNote).fill("Past its date");
  await form.getByRole("button", { name: stock.record.check }).click();
  const sent = posted(page, "/api/stock/write-offs");
  await form.getByRole("button", { name: review.send }).click();
  expect((await sent).postDataJSON()).toMatchObject({ lot_id: "lot-1", quantity: 20 });
});

test("a transfer shows both places, and says when the store would hold less than nothing", async ({ page }) => {
  await open(page, { "POST /api/stock/transfers": json(STOCK) });
  const form = await recording(page);
  await form.getByLabel(stock.record.kinds.transfer).check();
  await form.getByLabel(stock.record.consumable).selectOption({ label: "Solvent" });
  await form.getByLabel(stock.record.from, { exact: true }).selectOption({ label: WAREHOUSE });
  await form.getByLabel(stock.record.to, { exact: true }).selectOption({ label: "Imran Qureshi" });
  await form.getByLabel(stock.record.quantity).fill("10");
  await form.getByRole("button", { name: stock.record.check }).click();
  const check = form.getByRole("group", { name: review.title });
  await expect(check).toContainText(stock.confirm.onItsWay("Imran Qureshi"));
  await check.getByRole("button", { name: review.edit }).click();

  // Handed over in person, it arrives at once.
  await form.getByLabel(stock.record.waitForScan).uncheck();
  await form.getByRole("button", { name: stock.record.check }).click();
  await expect(check).toContainText(`${WAREHOUSE}: -20 ml → -30 ml`);
  await expect(check).toContainText("Imran Qureshi: 150 ml → 160 ml");
  await expect(check).toContainText(`${WAREHOUSE} would go below zero`);
  const sent = posted(page, "/api/stock/transfers");
  await check.getByRole("button", { name: review.send }).click();
  expect((await sent).postDataJSON()).toEqual({
    consumable_code: "solvent",
    quantity: 10,
    from: "central",
    to: IMRAN,
    wait_for_scan: false,
  });
});

test("will not move stock to the place it is in", async ({ page }) => {
  await open(page);
  const form = await recording(page);
  await form.getByLabel(stock.record.kinds.transfer).check();
  await form.getByLabel(stock.record.from, { exact: true }).selectOption({ label: "Imran Qureshi" });
  await form.getByLabel(stock.record.to, { exact: true }).selectOption({ label: "Imran Qureshi" });
  await form.getByLabel(stock.record.quantity).fill("2");
  await expect(form.getByRole("button", { name: stock.record.check })).toBeDisabled();
});

test("a count shows the figure it finds, and one that agrees says it records only the count", async ({ page }) => {
  await open(page, { "POST /api/stock/counts": json(STOCK) });
  const form = await recording(page);
  await form.getByLabel(stock.record.kinds.count).check();
  await form.getByLabel(stock.record.consumable).selectOption({ label: "Tape strips" });
  await form.getByLabel(stock.record.place).selectOption({ label: "Imran Qureshi" });
  await form.getByLabel(stock.record.counted).fill("3");
  await form.getByRole("button", { name: stock.record.check }).click();
  await expect(form.getByRole("group", { name: review.title })).toContainText(stock.confirm.same);

  await form.getByRole("button", { name: review.edit }).click();
  await form.getByLabel(stock.record.counted).fill("2");
  await form.getByRole("button", { name: stock.record.check }).click();
  await expect(form.getByRole("group", { name: review.title })).toContainText("Imran Qureshi: 3 strips → 2 strips");
  const sent = posted(page, "/api/stock/counts");
  await form.getByRole("button", { name: review.send }).click();
  expect((await sent).postDataJSON()).toEqual({
    consumable_code: "tape_strips",
    place_id: IMRAN,
    counted: 2,
    note: null,
    lot_code: null,
    expires_on: null,
  });
});

test("a loss needs its words, and a refusal names what was wrong", async ({ page }) => {
  await open(page, { "POST /api/stock/write-offs": fails(400, "invalid_request", ["place_id"]) });
  const form = await recording(page);
  await form.getByLabel(stock.record.kinds.write_off).check();
  await form.getByLabel(stock.record.quantity).fill("2");
  await expect(form.getByRole("button", { name: stock.record.check })).toBeDisabled();

  await form.getByLabel(stock.record.lossNote).fill("Two burst in the heat");
  await form.getByRole("button", { name: stock.record.check }).click();
  await form.getByRole("button", { name: review.send }).click();
  await expect(page.getByText("Unknown place. Here’s the latest.")).toBeVisible();
});

test("lists the latest movements, a job’s use under the technician who recorded it", async ({ page }) => {
  await open(page);
  const movements = page.getByRole("region", { name: stock.movements.title });
  const used = movements.getByRole("row").filter({ hasText: stock.movements.reasons.used });
  await expect(used).toContainText("Tape strips");
  await expect(used).toContainText("-4");
  await expect(used.getByRole("cell").last()).toHaveText("Imran Qureshi");
  await expect(movements.getByRole("row").filter({ hasText: stock.movements.reasons.received })).toContainText("+100");
});

test("sorts the movements by a column, and narrows them by a list or a search", async ({ page }) => {
  await open(page);
  const movements = page.getByRole("region", { name: stock.movements.title });
  const rows = movements.getByRole("row");
  await expect(movements.getByRole("columnheader", { name: activity.columns.when })).toHaveAttribute(
    "aria-sort",
    "descending",
  );
  await expect(rows.nth(1)).toContainText(stock.movements.reasons.used);

  await movements.getByRole("button", { name: stock.movements.columns[3], exact: true }).click();
  await expect(movements.getByRole("columnheader", { name: stock.movements.columns[3] })).toHaveAttribute(
    "aria-sort",
    "ascending",
  );
  await expect(rows.nth(1)).toContainText("-4");
  await movements.getByRole("button", { name: stock.movements.columns[3], exact: true }).click();
  await expect(rows.nth(1)).toContainText("+100");

  await movements.getByLabel(opsCopy.clients.payments.refundReason).selectOption("Delivered");
  await expect(rows).toHaveCount(2);
  await expect(movements).toContainText("1 of 2");
  await movements.getByRole("button", { name: opsCopy.tables.clear, exact: true }).click();
  await expect(rows).toHaveCount(3);

  await movements.getByLabel(opsCopy.tables.search).fill("imran");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText(stock.movements.reasons.used);
  await movements.getByLabel(opsCopy.tables.search).fill("nothing like it");
  await expect(movements.getByText(opsCopy.tables.none)).toBeVisible();
});

const ROOM = "e2e00000-0000-4000-8000-0000000000aa";
const withRoom = {
  ...STOCK,
  places: [
    ...STOCK.places,
    {
      id: ROOM,
      kind: "stockroom",
      name: "Gurgaon stockroom",
      parent_id: "central",
      zone: "NCR",
      city: "Gurgaon",
      active: true,
    },
  ],
} satisfies OpsReply<"/api/stock">;

test("adds a stockroom under the warehouse, and closes it again", async ({ page }) => {
  await open(page, { "POST /api/stock/places": json(withRoom), [`POST /api/stock/places/${ROOM}`]: json(STOCK) });
  const places = page.getByRole("region", { name: stockPlaces.title });
  await expect(places.getByRole("button", { name: stockPlaces.open(WAREHOUSE) })).toBeVisible();
  await places.getByRole("button", { name: stockPlaces.add.title }).click();
  const add = page.getByRole("dialog", { name: stockPlaces.add.title });
  await add.getByLabel(stockPlaces.add.name).fill("Gurgaon stockroom");
  await add.getByLabel(stockPlaces.add.city).selectOption("Gurgaon");
  const added = posted(page, "/api/stock/places");
  await add.getByRole("button", { name: stockPlaces.add.add, exact: true }).click();
  expect((await added).postDataJSON()).toEqual({
    kind: "stockroom",
    name: "Gurgaon stockroom",
    parent_id: "central",
    city: "Gurgaon",
  });

  await places.getByRole("button", { name: stockPlaces.open("Gurgaon stockroom") }).click();
  const record = page.getByRole("dialog", { name: "Gurgaon stockroom" });
  await record.getByRole("button", { name: stockPlaces.closing.label("Gurgaon stockroom") }).click();
  await expect(record.getByText(stockPlaces.closing.warning("Gurgaon stockroom"))).toBeVisible();
  const closed = posted(page, `/api/stock/places/${ROOM}`);
  await record.getByRole("button", { name: stockPlaces.closing.confirm, exact: true }).click();
  expect((await closed).postDataJSON()).toEqual({ active: false });
  await expect(places.getByRole("button", { name: stockPlaces.open("Gurgaon stockroom") })).toHaveCount(0);
  expect(await axeViolations(page)).toEqual([]);
});

test("receives a transfer short, saying what was lost on the way", async ({ page }) => {
  const sent = {
    consumable_code: "solvent",
    from: "central",
    to: ROOM,
    sent_at: "2027-09-20T06:00:00.000Z",
    sent_by: "ops@maneman.in",
  };
  const onTheWay = {
    ...withRoom,
    in_transit: [
      { ...sent, id: "tr-1", quantity: 200 },
      { ...sent, id: "tr-2", quantity: 50 },
    ],
  } satisfies OpsReply<"/api/stock">;
  await open(page, {
    "GET /api/stock": json(onTheWay),
    "POST /api/stock/transfers/{id}/receive": json(withRoom),
    "POST /api/stock/transfers/{id}/send-back": json(withRoom),
  });
  const panel = page.getByRole("region", { name: stockTransit.title });
  await panel
    .getByRole("button", { name: stockTransit.receiveLabel("Solvent", "Gurgaon stockroom") })
    .first()
    .click();
  await panel.getByLabel(`${stockTransit.arrived} (ml)`).fill("180");
  await expect(panel).toContainText(stockTransit.short(20, "ml"));
  expect(await axeViolations(page)).toEqual([]);
  const received = posted(page, "/api/stock/transfers/tr-1/receive");
  await panel.getByRole("button", { name: stockTransit.confirm }).click();
  expect((await received).postDataJSON()).toEqual({ received: 180 });
});

test("adds up every place, and each city, and lists the lots that expire soon", async ({ page }) => {
  const soon = { id: "lot-2", lot_code: "SV-0930", expires_on: "2027-09-30", quantity: 150 };
  const expiring = {
    ...STOCK,
    holdings: STOCK.holdings.map((holding) =>
      holding.consumable_code === "solvent" && holding.place_id === IMRAN ? { ...holding, lots: [soon] } : holding,
    ),
  };
  await answer(page, { "GET /api/stock/demand": json(NO_DEMAND), "GET /api/stock": json(expiring) });
  await page.goto("/stock");
  const table = onHand(page);
  await table.getByLabel(stock.totalsBy).selectOption({ label: stock.byCity });
  await expect(table.getByRole("columnheader")).toHaveText([
    stock.record.consumable,
    stockViews.totals.national,
    "Gurgaon",
    stockViews.totals.noCity,
  ]);
  const tape = table.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "Tape strips" }) });
  await expect(tape.getByRole("cell").nth(0)).toHaveText("129 strips");
  await expect(tape.getByRole("cell").nth(1)).toHaveText("9 strips");

  const panel = page.getByRole("region", { name: stockViews.expiring.title });
  await expect(panel.getByRole("row").filter({ hasText: "SV-0930" })).toContainText("Imran Qureshi");
  expect(await axeViolations(page)).toEqual([]);
});

test("shows what the next four weeks will use beside what each city holds, and the fits at risk", async ({ page }) => {
  const ahead = {
    days: 28,
    demand: [{ consumable_code: "solvent", city: "Gurgaon", expected: 156, held: 150 }],
    at_risk: [
      { appointment_id: "ap-9", window_start: "2027-09-24T05:30:00.000Z", city: "Gurgaon", consumable_code: null },
    ],
  } satisfies OpsReply<"/api/stock/demand">;
  await open(page, { "GET /api/stock/demand": json(ahead) });
  const panel = page.getByRole("region", { name: stockViews.demand.title });
  await expect(panel.getByRole("row").filter({ hasText: "Solvent" })).toContainText(stockViews.demand.short(6));
  await expect(panel).toContainText(stockViews.demand.fit("Fri 24 Sep", "Gurgaon", stockViews.demand.noProfile));
});

const HAIR = {
  code: "hs_essential",
  name: "Mane Man Essential · 8 × 10 in · #1B · 20% grey · 100% density",
  unit: "piece",
  retired: false,
  hair_system: true,
  reorder_kit: 1,
  reorder_central: null,
  reorder_store: null,
};
const withPieces = { ...STOCK, consumables: [...STOCK.consumables, HAIR] };
const UNITS = {
  consumable_code: HAIR.code,
  place_id: "central",
  units: [
    { code: "MM-ESS-0000003-D", lot_code: "HS-1", expires_on: "2028-03-31", labelled_at: "2026-09-21T06:30:00.000Z" },
    { code: "MM-ESS-0000002-C", lot_code: "HS-1", expires_on: "2028-03-31", labelled_at: "2026-09-21T06:30:00.000Z" },
    { code: "MM-ESS-0000001-B", lot_code: null, expires_on: null, labelled_at: "2026-09-14T06:30:00.000Z" },
  ],
  unlabelled: 0,
  max_labelled: 500,
} satisfies OpsReply<"/api/stock/units">;

/** Stands in for the print dialog: what the sheet held when it printed, after which the dialog closes. */
async function catchPrints(page: Page): Promise<() => Promise<string[]>> {
  await page.evaluate(() => {
    const printed: string[] = [];
    Object.assign(window, { printed });
    window.print = () => {
      for (const label of document.querySelectorAll("#label-sheet > div")) printed.push(label.textContent);
      window.dispatchEvent(new Event("afterprint"));
    };
  });
  return () => page.evaluate(() => (window as unknown as { printed: string[] }).printed);
}

test("opens a hair system’s labels after its delivery, the latest batch ticked, and prints them", async ({ page }) => {
  await open(page, {
    "GET /api/stock": json(withPieces),
    "POST /api/stock/deliveries": json(withPieces),
    "GET /api/stock/units": json(UNITS),
  });
  const printed = await catchPrints(page);
  const form = await recording(page);
  await form.getByLabel(stock.record.consumable).selectOption({ label: HAIR.name });
  await form.getByLabel(stock.record.quantity).fill("2");
  await form.getByRole("button", { name: stock.record.check }).click();
  await form.getByRole("button", { name: review.send }).click();

  const labels = page.getByRole("region", { name: stockLabels.title });
  await expect(labels.getByLabel(stockLabels.item)).toHaveValue(HAIR.code);
  await expect(labels.getByLabel(stockLabels.place)).toHaveValue("central");
  await expect(labels.getByRole("checkbox", { name: stockLabels.batch("Mon 21 Sep, 12 pm", 2) })).toBeChecked();
  await expect(labels.getByRole("checkbox", { name: stockLabels.batch("Mon 14 Sep, 12 pm", 1) })).not.toBeChecked();
  await labels.getByRole("button", { name: stockLabels.print(2) }).click();
  await expect
    .poll(printed)
    .toEqual([
      `MM-ESS-0000003-D${HAIR.name}HS-1 · Exp 31 Mar 2028`,
      `MM-ESS-0000002-C${HAIR.name}HS-1 · Exp 31 Mar 2028`,
    ]);
  expect(await axeViolations(page)).toEqual([]);
});

test("labels the pieces a place held before labels", async ({ page }) => {
  const before = { ...UNITS, units: [], unlabelled: 4 };
  await open(page, {
    "GET /api/stock": json(withPieces),
    "GET /api/stock/units": json(before),
    "POST /api/stock/units": json(UNITS),
  });
  const labels = page.getByRole("region", { name: stockLabels.title });
  await labels.getByLabel(stockLabels.item).selectOption({ label: HAIR.name });
  await expect(labels).toContainText(stockLabels.unlabelled(4));
  const sent = posted(page, "/api/stock/units");
  await labels.getByRole("button", { name: stockLabels.labelThem(4) }).click();
  expect((await sent).postDataJSON()).toEqual({ consumable_code: HAIR.code, place_id: "central", quantity: 4 });
  await expect(labels.getByRole("button", { name: stockLabels.print(2) })).toBeVisible();
});

test("prints a lot’s label for each of its boxes", async ({ page }) => {
  await open(page, {
    "GET /api/stock": json(withLot),
    "POST /api/stock/lots/{id}/label": json({ label: "MM-LT-0000001-B" }),
  });
  const printed = await catchPrints(page);
  const labels = page.getByRole("region", { name: stockLabels.title });
  await labels.getByLabel(stockLabels.item).selectOption({ label: "Tape strips" });
  await labels.getByLabel(stockLabels.copies).fill("3");
  await labels.getByRole("button", { name: stockLabels.print(3) }).click();
  await expect
    .poll(printed)
    .toEqual(Array.from({ length: 3 }, () => "MM-LT-0000001-BTape stripsTS-0901 · Exp 31 Oct 2027"));
});

test("names a hair system’s pieces by their labels, as a scanner types them, and counts them", async ({ page }) => {
  await open(page, { "GET /api/stock": json(withPieces), "POST /api/stock/transfers": json(withPieces) });
  const form = await recording(page);
  await form.getByRole("radio", { name: stock.record.kinds.transfer }).check();
  await form.getByLabel(stock.record.consumable).selectOption({ label: HAIR.name });
  const scan = form.getByLabel(stockLabels.scan.label, { exact: true });
  for (const typed of ["mm-ess-0000001-b", "MM-ESS-0000002-C", "MM-ESS-0000002-C"]) {
    await scan.fill(typed);
    await scan.press("Enter");
  }
  await expect(form).toContainText(stockLabels.scanned(2));
  await expect(form.getByLabel(/^How many/)).toHaveCount(0);
  await form.getByRole("button", { name: stockLabels.removeLabel("MM-ESS-0000001-B") }).click();
  await expect(form).toContainText(stockLabels.scanned(1));
  await form.getByRole("button", { name: stock.record.check }).click();
  const sent = posted(page, "/api/stock/transfers");
  await form.getByRole("button", { name: review.send }).click();
  expect((await sent).postDataJSON()).toEqual({
    consumable_code: HAIR.code,
    quantity: 1,
    from: "central",
    to: IMRAN,
    units: ["MM-ESS-0000002-C"],
    wait_for_scan: true,
  });
});

test("receives a hair system’s transfer by the pieces scanned, the rest missing", async ({ page }) => {
  const onTheWay = {
    ...withRoom,
    consumables: [...withRoom.consumables, HAIR],
    in_transit: [
      {
        id: "tr-9",
        consumable_code: HAIR.code,
        quantity: 2,
        from: "central",
        to: ROOM,
        sent_at: "2027-09-20T06:00:00.000Z",
        sent_by: "ops@maneman.in",
      },
    ],
  } satisfies OpsReply<"/api/stock">;
  await open(page, {
    "GET /api/stock": json(onTheWay),
    "POST /api/stock/transfers/{id}/receive": json(withRoom),
  });
  const panel = page.getByRole("region", { name: stockTransit.title });
  await panel.getByRole("button", { name: stockTransit.receiveLabel(HAIR.name, "Gurgaon stockroom") }).click();
  const scan = panel.getByLabel(stockLabels.scan.label, { exact: true });
  await scan.fill("MM-ESS-0000001-B");
  await scan.press("Enter");
  await expect(panel.getByLabel(`${stockTransit.arrived} (piece)`)).toHaveValue("1");
  await expect(panel).toContainText(stockTransit.short(1, "piece"));
  const received = posted(page, "/api/stock/transfers/tr-9/receive");
  await panel.getByRole("button", { name: stockTransit.confirm }).click();
  expect((await received).postDataJSON()).toEqual({ received: 1, units: ["MM-ESS-0000001-B"] });
});

test("finds the piece a label names, where it is and its history", async ({ page }) => {
  const found = {
    code: "MM-ESS-0000001-B",
    consumable_code: HAIR.code,
    lot_code: "HS-1",
    expires_on: "2028-03-31",
    state: "held",
    place_id: IMRAN,
    history: [
      { at: "2026-09-14T06:30:00.000Z", state: "held", place_id: "central", by: "ops@maneman.in" },
      { at: "2026-09-21T06:30:00.000Z", state: "held", place_id: IMRAN, by: "ops@maneman.in" },
    ],
  } satisfies OpsReply<"/api/stock/units/{code}">;
  await open(page, { "GET /api/stock": json(withPieces), "GET /api/stock/units/{code}": json(found) });
  const labels = page.getByRole("region", { name: stockLabels.title });
  const find = labels.getByLabel(stockLabels.find);
  await find.fill("MM-ESS-0000001-B");
  await find.press("Enter");
  const status = labels.getByRole("status");
  await expect(status).toContainText(`MM-ESS-0000001-B · ${HAIR.name} · HS-1 · Exp 31 Mar 2028`);
  await expect(status).toContainText(stockLabels.where("Held", "Imran Qureshi"));
  await expect(labels.getByRole("list", { name: stockLabels.history }).getByRole("listitem")).toHaveCount(2);
  expect(await axeViolations(page)).toEqual([]);
});

test("says so when no camera opens, leaving the label to be typed", async ({ page }) => {
  await open(page, { "GET /api/stock": json(withPieces) });
  await page.evaluate(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: () => Promise.reject(new Error("No camera")) },
    });
  });
  const labels = page.getByRole("region", { name: stockLabels.title });
  await labels.getByRole("button", { name: stockLabels.scan.camera }).click();
  await expect(labels.getByRole("alert")).toHaveText(stockLabels.scan.refused);
  await expect(labels.getByLabel(stockLabels.find)).toBeEditable();
});

test("meets WCAG 2.2 AA, a box to a line, with a movement being checked as well", async ({ page }) => {
  await open(page);
  expect(await axeViolations(page)).toEqual([]);

  const form = await recording(page);
  await expectOneBoxALine(page, stock.record.title);
  await form.getByLabel(stock.record.quantity).fill("5");
  await form.getByRole("button", { name: stock.record.check }).click();
  await expect(form.getByRole("group", { name: review.title })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
});
