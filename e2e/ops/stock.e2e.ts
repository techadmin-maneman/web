// Stock: what each place holds (the warehouse, hubs, stockrooms and technicians' kits), which is low, the movements
// ops record, and the places themselves (docs/decisions/0087-consumables-and-stock.md, 0155-the-stock-place-tree.md).
// Each movement shows what each place holds now beside what it will hold before
// it is sent (docs/decisions/0071-what-ops-see-before-a-setting-changes.md).

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { answer, fails, IMRAN, json, STOCK, type Answers, type OpsReply } from "./fixtures.ts";
import * as opsCopy from "../../apps/ops/src/content.ts";
import { stockPlaces } from "../../apps/ops/src/content/stock-places.ts";
import { stockTransit } from "../../apps/ops/src/content/stock-transit.ts";

const WAREHOUSE = "National warehouse";

async function open(page: Page, extra: Answers = {}): Promise<void> {
  await answer(page, { "GET /api/stock": json(STOCK), ...extra });
  await page.goto("/stock");
  await expect(page.getByRole("heading", { level: 1, name: "Stock" })).toBeVisible();
}

const posted = (page: Page, path: string) =>
  page.waitForRequest((request) => request.url().endsWith(path) && request.method() === "POST");

const onHand = (page: Page) => page.getByRole("region", { name: opsCopy.stock.onHand });
const recording = (page: Page) => page.getByRole("region", { name: opsCopy.stock.record.title });

test("is a section of its own beside the technicians, titled by what it is", async ({ page }) => {
  await open(page);
  await expect(page).toHaveTitle("Stock · Mane Man operations");
  await expect(page.getByRole("navigation").getByRole("link", { name: "Stock" })).toHaveAttribute(
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
  await expect(tape.getByRole("cell").nth(0)).toContainText("120 strip");
  await expect(tape.getByRole("cell").nth(0)).toContainText("Counted Mon 20 Sep");
  await expect(tape.getByRole("cell").nth(1)).toContainText("3 strip");
  await expect(tape.getByRole("cell").nth(1)).toContainText("Low");
  await expect(tape.getByRole("cell").nth(2)).not.toContainText("Low");
  const solvent = table.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "Solvent" }) });
  await expect(solvent.getByRole("cell").nth(0)).toHaveText("-20 ml");
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
  await answer(page, { "GET /api/stock": json(many) });
  await page.goto("/stock");
  const table = onHand(page);
  await expect(table.getByRole("columnheader")).toHaveText(["Consumable", WAREHOUSE, "Technician 1"]);

  const kit = table.getByLabel("Place");
  await expect(kit.getByRole("option", { name: "Technician 5 · low" })).toHaveCount(1);
  await kit.selectOption({ label: "Technician 5 · low" });
  await expect(table.getByRole("columnheader")).toHaveText(["Consumable", WAREHOUSE, "Technician 5"]);
  const tape = table.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "Tape strips" }) });
  await expect(tape.getByRole("cell").nth(1)).toContainText("5 strip");
  await expect(tape.getByRole("cell").nth(1)).toContainText("Low");
  expect(await axeViolations(page)).toEqual([]);
});

test("records a delivery into the store, showing what it holds before and after", async ({ page }) => {
  await open(page, { "POST /api/stock/deliveries": json(STOCK) });
  const form = recording(page);
  await form.getByLabel("Consumable").selectOption({ label: "Tape strips" });
  await form.getByLabel("How many").fill("100");
  await form.getByLabel(opsCopy.stock.record.note).fill("Supplier's note 4418");
  await form.getByRole("button", { name: "Review" }).click();

  const check = form.getByRole("group", { name: opsCopy.stock.confirm.title });
  await expect(check).toBeFocused();
  await expect(check).toContainText(`${WAREHOUSE}: 120 strip → 220 strip`);
  const sent = posted(page, "/api/stock/deliveries");
  await check.getByRole("button", { name: "Record" }).click();
  expect((await sent).postDataJSON()).toEqual({
    consumable_code: "tape_strips",
    quantity: 100,
    note: "Supplier's note 4418",
    lot_code: null,
    expires_on: null,
  });
  await expect(form.getByRole("status")).toHaveText(opsCopy.stock.recorded);
});

test("takes a delivery's supplier lot and its expiry", async ({ page }) => {
  await open(page, { "POST /api/stock/deliveries": json(STOCK) });
  const form = recording(page);
  await form.getByLabel("Consumable").selectOption({ label: "Solvent" });
  await form.getByLabel("How many").fill("500");
  await form.getByLabel(opsCopy.stock.record.lot).fill("SV-2611");
  await form.getByLabel(opsCopy.stock.record.expires).fill("2027-11-30");
  await form.getByRole("button", { name: "Review" }).click();
  const sent = posted(page, "/api/stock/deliveries");
  await form.getByRole("button", { name: "Record" }).click();
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
  await answer(page, { "GET /api/stock": json(withLot), "POST /api/stock/write-offs": json(withLot) });
  await page.goto("/stock");
  const tape = onHand(page)
    .getByRole("row")
    .filter({ has: page.getByRole("rowheader", { name: "Tape strips" }) });
  await expect(tape.getByRole("cell").nth(0)).toContainText("Expires Sun 31 Oct");

  const form = recording(page);
  await form.getByLabel("Loss").check();
  await form.getByLabel("Consumable").selectOption({ label: "Tape strips" });
  await form.getByLabel(opsCopy.stock.record.lostLot).selectOption({ label: "TS-0901 · expires Sun 31 Oct" });
  await form.getByLabel("How many").fill("20");
  await form.getByLabel(opsCopy.stock.record.lossNote).fill("Past its date");
  await form.getByRole("button", { name: "Review" }).click();
  const sent = posted(page, "/api/stock/write-offs");
  await form.getByRole("button", { name: "Record" }).click();
  expect((await sent).postDataJSON()).toMatchObject({ lot_id: "lot-1", quantity: 20 });
});

test("a transfer shows both places, and says when the store would hold less than nothing", async ({ page }) => {
  await open(page, { "POST /api/stock/transfers": json(STOCK) });
  const form = recording(page);
  await form.getByLabel("Transfer").check();
  await form.getByLabel("Consumable").selectOption({ label: "Solvent" });
  await form.getByLabel("From", { exact: true }).selectOption({ label: WAREHOUSE });
  await form.getByLabel("To", { exact: true }).selectOption({ label: "Imran Qureshi" });
  await form.getByLabel("How many").fill("10");
  await form.getByRole("button", { name: "Review" }).click();

  const check = form.getByRole("group", { name: opsCopy.stock.confirm.title });
  await expect(check).toContainText(`${WAREHOUSE}: -20 ml → -30 ml`);
  await expect(check).toContainText("Imran Qureshi: 150 ml → 160 ml");
  await expect(check).toContainText(`${WAREHOUSE} would go below zero`);
  const sent = posted(page, "/api/stock/transfers");
  await check.getByRole("button", { name: "Record" }).click();
  expect((await sent).postDataJSON()).toEqual({ consumable_code: "solvent", quantity: 10, from: "central", to: IMRAN });
});

test("will not move stock to the place it is in", async ({ page }) => {
  await open(page);
  const form = recording(page);
  await form.getByLabel("Transfer").check();
  await form.getByLabel("From", { exact: true }).selectOption({ label: "Imran Qureshi" });
  await form.getByLabel("To", { exact: true }).selectOption({ label: "Imran Qureshi" });
  await form.getByLabel("How many").fill("2");
  await expect(form.getByRole("button", { name: "Review" })).toBeDisabled();
});

test("a count shows the figure it finds, and one that agrees says it records only the count", async ({ page }) => {
  await open(page, { "POST /api/stock/counts": json(STOCK) });
  const form = recording(page);
  await form.getByLabel("Count").check();
  await form.getByLabel("Consumable").selectOption({ label: "Tape strips" });
  await form.getByLabel("Where").selectOption({ label: "Imran Qureshi" });
  await form.getByLabel(opsCopy.stock.record.counted).fill("3");
  await form.getByRole("button", { name: "Review" }).click();
  await expect(form.getByRole("group", { name: opsCopy.stock.confirm.title })).toContainText(
    "Matches what's held. Records the count only.",
  );

  await form.getByRole("button", { name: "Edit" }).click();
  await form.getByLabel(opsCopy.stock.record.counted).fill("2");
  await form.getByRole("button", { name: "Review" }).click();
  await expect(form.getByRole("group", { name: opsCopy.stock.confirm.title })).toContainText(
    "Imran Qureshi: 3 strip → 2 strip",
  );
  const sent = posted(page, "/api/stock/counts");
  await form.getByRole("button", { name: "Record" }).click();
  expect((await sent).postDataJSON()).toEqual({
    consumable_code: "tape_strips",
    place_id: IMRAN,
    counted: 2,
    note: null,
  });
});

test("a loss needs its words, and a refusal names what was wrong", async ({ page }) => {
  await open(page, { "POST /api/stock/write-offs": fails(400, "invalid_request", ["place_id"]) });
  const form = recording(page);
  await form.getByLabel("Loss").check();
  await form.getByLabel("How many").fill("2");
  await expect(form.getByRole("button", { name: "Review" })).toBeDisabled();

  await form.getByLabel(opsCopy.stock.record.lossNote).fill("Two burst in the heat");
  await form.getByRole("button", { name: "Review" }).click();
  await form.getByRole("button", { name: "Record" }).click();
  await expect(form.getByRole("alert")).toHaveText("Unknown place. Reload.");
});

test("lists the latest movements, a job's use under the technician who recorded it", async ({ page }) => {
  await open(page);
  const movements = page.getByRole("region", { name: opsCopy.stock.movements.title });
  const used = movements.getByRole("row").filter({ hasText: opsCopy.stock.movements.reasons.used });
  await expect(used).toContainText("Tape strips");
  await expect(used).toContainText("-4");
  await expect(used.getByRole("cell").last()).toHaveText("Imran Qureshi");
  await expect(movements.getByRole("row").filter({ hasText: opsCopy.stock.movements.reasons.received })).toContainText(
    "+100",
  );
});

test("sorts the movements by a column, and narrows them by a list or a search", async ({ page }) => {
  await open(page);
  const movements = page.getByRole("region", { name: opsCopy.stock.movements.title });
  const rows = movements.getByRole("row");
  await expect(movements.getByRole("columnheader", { name: "When" })).toHaveAttribute("aria-sort", "descending");
  await expect(rows.nth(1)).toContainText("Used on a job");

  await movements.getByRole("button", { name: "Change", exact: true }).click();
  await expect(movements.getByRole("columnheader", { name: "Change" })).toHaveAttribute("aria-sort", "ascending");
  await expect(rows.nth(1)).toContainText("-4");
  await movements.getByRole("button", { name: "Change", exact: true }).click();
  await expect(rows.nth(1)).toContainText("+100");

  await movements.getByLabel("Why").selectOption("Delivered");
  await expect(rows).toHaveCount(2);
  await expect(movements).toContainText("1 of 2");
  await movements.getByRole("button", { name: opsCopy.tables.clear, exact: true }).click();
  await expect(rows).toHaveCount(3);

  await movements.getByLabel(opsCopy.tables.search).fill("imran");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText("Used on a job");
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
  await expect(places.getByRole("rowheader", { name: WAREHOUSE })).toBeVisible();
  await places.getByLabel(stockPlaces.add.name).fill("Gurgaon stockroom");
  await places.getByLabel(stockPlaces.add.city).selectOption("Gurgaon");
  const added = posted(page, "/api/stock/places");
  await places.getByRole("button", { name: stockPlaces.add.send }).click();
  expect((await added).postDataJSON()).toEqual({
    kind: "stockroom",
    name: "Gurgaon stockroom",
    parent_id: "central",
    city: "Gurgaon",
  });

  await places.getByRole("button", { name: stockPlaces.editLabel("Gurgaon stockroom") }).click();
  const closed = posted(page, `/api/stock/places/${ROOM}`);
  await places.getByRole("button", { name: stockPlaces.change.close }).click();
  expect((await closed).postDataJSON()).toEqual({ active: false });
  await expect(places.getByRole("rowheader", { name: "Gurgaon stockroom" })).toHaveCount(0);
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

test("meets WCAG 2.2 AA, with a movement being checked as well", async ({ page }) => {
  await open(page);
  expect(await axeViolations(page)).toEqual([]);

  await recording(page).getByLabel("How many").fill("5");
  await recording(page).getByRole("button", { name: "Review" }).click();
  await expect(recording(page).getByRole("group", { name: opsCopy.stock.confirm.title })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
});
