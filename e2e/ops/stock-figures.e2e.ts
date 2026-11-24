// Above Stock's On hand, the redesign's figures alone (docs/decisions/0308-the-inventory-screens-to-the-22-november-redesign.md):
// the items to reorder where the table looks, the kits short for their technicians' allotted visits by name, and the
// stock's value at cost for those who may read unit costs. Every name and number here is made up.

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { answer, CONSUMABLES, IMRAN, json, STOCK, type Answers, type OpsReply } from "./fixtures.ts";
import { ROUTE_NEEDS } from "../../src/policy/console-routes.ts";
import { rupees } from "../../packages/web-kit/money.ts";
import { stock } from "../../apps/ops/src/content/stock.ts";
import { shell } from "../../apps/ops/src/content.ts";

const words = stock.figures;

const AHEAD = {
  days: 28,
  demand: [],
  at_risk: [],
  kits_short: [
    {
      technician_id: IMRAN,
      technician: "Imran Qureshi",
      city: "Gurgaon",
      consumable_code: "solvent",
      expected: 40,
      held: 25,
    },
  ],
} satisfies OpsReply<"/api/stock/demand">;

/** Someone who may run Stock but not read unit costs: every call but the items' own read. */
const NO_COSTS = json({
  signed_in_as: "ops@localhost",
  sign_out: null,
  staff: {
    enforced: true,
    listed: true,
    grants: [{ department: "operations", level: "manage", geography: "national", place: null }],
    may_call: Object.keys(ROUTE_NEEDS).filter((call) => call !== "GET /api/consumables"),
  },
  cities: ["Gurgaon"],
  every_city: true,
} satisfies OpsReply<"/api/whoami">);

async function open(page: Page, extra: Answers = {}): Promise<void> {
  await answer(page, {
    "GET /api/stock": json(STOCK),
    "GET /api/stock/demand": json(AHEAD),
    "GET /api/consumables": json(CONSUMABLES),
    ...extra,
  });
  await page.goto("/stock");
  await expect(page.getByRole("heading", { level: 1, name: stock.title })).toBeVisible();
}

/** A figure's tile, by its name. */
const tile = (page: Page, name: string) => page.getByText(name, { exact: true }).locator("..");

test("says what to reorder, the kits short by name, and the stock's value at cost", async ({ page }) => {
  await open(page);
  const cost = (code: string) => CONSUMABLES.consumables.find((each) => each.code === code)?.unit_cost ?? 0;
  const value = STOCK.holdings.reduce(
    (sum, holding) => sum + Math.max(holding.quantity, 0) * cost(holding.consumable_code),
    0,
  );
  await expect(tile(page, words.kitsShort)).toContainText("1");
  await expect(tile(page, words.kitsShort)).toContainText("Imran Qureshi");
  await expect(tile(page, words.value)).toContainText(rupees(value));
  await expect(tile(page, words.value)).toContainText(words.atCost);
  await expect(tile(page, words.reorder)).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
});

test("shows the stock's value to nobody who may not read unit costs, and reads none for them", async ({ page }) => {
  const asked: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/consumables") asked.push(request.url());
  });
  await open(page, { "GET /api/whoami": NO_COSTS });
  await expect(tile(page, words.reorder)).toBeVisible();
  await expect(page.getByText(words.value, { exact: true })).toHaveCount(0);
  expect(asked).toEqual([]);
});

test("says where the costs did not load, rather than waiting on them", async ({ page }) => {
  await open(page, { "GET /api/consumables": (route) => route.abort() });
  await expect(tile(page, words.value)).toContainText(words.unread);
});

test("stands a view of Stock's beneath Stock in the trail, as the redesign's Inventory / Stock / Expiring", async ({
  page,
}) => {
  await open(page);
  await page.goto("/stock/expiring");
  const trail = page.getByRole("navigation", { name: shell.crumbs });
  await expect(trail).toContainText(shell.nav.inventory);
  await expect(trail.getByRole("link", { name: stock.title })).toHaveAttribute("href", "/stock");
  await expect(trail).toContainText(stock.views.names.expiring);
});
