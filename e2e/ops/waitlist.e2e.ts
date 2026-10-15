// The Waitlist and the launch. Nothing is sent until the second
// press: choosing a pincode only asks the API what a launch would send, and
// the panel shows both counts so the gap between them is visible.

import type { Page, Route } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { answer, AREAS, fails, json, LAUNCHED, PREVIEW, type Call } from "./fixtures.ts";
import * as opsCopy from "../../apps/ops/src/content.ts";

const LAUNCH = "/api/pincodes/400050/launch";
const LAUNCH_IT: Call = `POST ${LAUNCH}`;

/** Answers the launch route with the preview while confirm is false, then `confirmed` once it is true. */
function launchRoute(confirmed = json(LAUNCHED)) {
  return (route: Route) => {
    const body = route.request().postDataJSON() as { confirm: boolean };
    return body.confirm ? confirmed(route) : json(PREVIEW)(route);
  };
}

async function open(page: Page, confirmed?: ReturnType<typeof json>): Promise<void> {
  await answer(page, { "GET /api/waitlist": json(AREAS), [LAUNCH_IT]: launchRoute(confirmed) });
  await page.goto("/waitlist");
  await expect(page.getByRole("heading", { level: 1, name: opsCopy.shell.sections.waitlist })).toBeVisible();
}

test("lists the pincodes with their counts, and marks the ones we already come to", async ({ page }) => {
  await open(page);
  const bandra = page.getByRole("row").filter({ hasText: "400050" });
  await expect(bandra).toContainText("Bandra W");
  await expect(bandra).toContainText("117");
  await expect(bandra).toContainText("84");
  await expect(bandra).toContainText("4 Feb 2027");
  // Sector 65 is served, so it offers no launch; it offers to tell whoever there is still untold (e2e/ops/launch.e2e.ts).
  const served = page.getByRole("row").filter({ hasText: "122018" });
  await expect(served).toContainText(opsCopy.waitlist.live);
  await expect(served.getByRole("button")).toHaveAccessibleName("Tell those waiting in 122018, Sector 65");
});

// The area was packed into what the figure columns left, each drawn wider than it needs.
test("gives the area the room the figures leave, and each figure its own width", async ({ page }) => {
  await open(page);
  const width = async (name: string) =>
    (await page.getByRole("columnheader", { name, exact: true }).boundingBox())?.width ?? 0;
  const figures = { Pincode: 76, Waiting: 54, Oldest: 76, Referred: 60, "Opted in": 62 };
  for (const [name, wide] of Object.entries(figures)) expect(Math.round(await width(name)), name).toBe(wide);
  const table = (await page.getByRole("table").boundingBox())?.width ?? 0;
  const taken = Object.values(figures).reduce((sum, wide) => sum + wide, 0);
  expect(Math.abs((await width("Area")) - (table - taken))).toBeLessThan(2);
});

// The waitlist was read whole, however many pincodes had people waiting.
test("says when more pincodes are waiting than the table lists", async ({ page }) => {
  await answer(page, { "GET /api/waitlist": json({ ...AREAS, more: true }) });
  await page.goto("/waitlist");
  await expect(page.getByText(opsCopy.waitlist.more)).toBeVisible();
});

test("asks what a launch would send before anything goes out", async ({ page }) => {
  await open(page);
  const asked = page.waitForRequest(LAUNCH);
  await page.getByRole("button", { name: "Mark 400050 live, Bandra W" }).click();
  expect((await asked).postDataJSON()).toEqual({ confirm: false });

  const panel = page.getByRole("region", { name: "Mark 400050 live" });
  await expect(panel.getByText("Messages 84 people")).toBeVisible();
  await expect(panel.getByText(opsCopy.areas.launch.rows.waiting)).toBeVisible();
  await expect(panel.getByText(opsCopy.areas.launch.rows.alerts)).toBeVisible();
  await expect(panel.getByText(opsCopy.areas.launch.rows.referred)).toBeVisible();
  await expect(panel).toContainText("Mane Man now comes to Bandra W");
  await expect(panel).toContainText("33 didn’t opt in and won’t be messaged.");
});

test("launches the pincode on the second press, and says how many went out", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Mark 400050 live, Bandra W" }).click();
  await expect(page.getByText("Messages 84 people")).toBeVisible();

  // The first call was the preview; this one confirms it, and only this one sends anything.
  const sent = page.waitForRequest((request) => request.url().includes(LAUNCH) && request.method() === "POST");
  await page.getByRole("button", { name: "Send to 84" }).click();
  expect((await sent).postDataJSON()).toEqual({ confirm: true });
  await expect(page.getByRole("status").filter({ hasText: "Live." })).toHaveText("Live. 84 messages sent.");
});

test("closes the panel on Not now, without sending anything", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Mark 400050 live, Bandra W" }).click();
  await page.getByRole("button", { name: opsCopy.areas.launch.cancel }).click();
  await expect(page.getByText("Messages 84 people")).toBeHidden();
});

test("says so when the launch is refused, and keeps the panel open", async ({ page }) => {
  await open(page, fails(404, "not_found"));
  await page.getByRole("button", { name: "Mark 400050 live, Bandra W" }).click();
  await page.getByRole("button", { name: "Send to 84" }).click();
  await expect(page.getByRole("alert")).toContainText(opsCopy.areas.launch.errors.not_found);
  await expect(page.getByRole("button", { name: "Send to 84" })).toBeVisible();
});

test("says nobody is waiting when the list is empty", async ({ page }) => {
  await answer(page, { "GET /api/waitlist": json({ areas: [], more: false, cities: [] }) });
  await page.goto("/waitlist");
  await expect(page.getByText(opsCopy.waitlist.empty)).toBeVisible();
});

test("meets WCAG 2.2 AA with the list, and with the launch panel open", async ({ page }) => {
  await open(page);
  expect(await axeViolations(page)).toEqual([]);

  await page.getByRole("button", { name: "Mark 400050 live, Bandra W" }).click();
  await expect(page.getByText("Messages 84 people")).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
});

test("sorts the waitlist by a column, and narrows it by a search", async ({ page }) => {
  await open(page);
  const rows = page.getByRole("table").getByRole("row");
  await page.getByRole("button", { name: opsCopy.areas.add.pincode, exact: true }).click();
  await expect(page.getByRole("columnheader", { name: opsCopy.areas.add.pincode, exact: true })).toHaveAttribute(
    "aria-sort",
    "ascending",
  );
  await expect(rows.nth(1)).toContainText("122018");
  await page.getByLabel(opsCopy.tables.search).fill("bandra");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText("400050");
});
