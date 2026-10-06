// Areas' Waiting tab and the launch. Nothing is sent until the second
// press: choosing a pincode only asks the API what a launch would send, and
// the panel shows both counts so the gap between them is visible.

import type { Page, Route } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { answer, AREAS, fails, json, LAUNCHED, PREVIEW, type Call } from "./fixtures.ts";

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
  await page.goto("/areas");
  await expect(page.getByRole("heading", { level: 1, name: "Areas" })).toBeVisible();
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
  await expect(served).toContainText("Live");
  await expect(served.getByRole("button")).toHaveAccessibleName("Tell those waiting in 122018, Sector 65");
});

// The area was packed into what the figure columns left, each drawn wider than the board draws it.
test("gives the area the room the board does, and each figure the board's own width", async ({ page }) => {
  await open(page);
  const width = async (name: string) =>
    (await page.getByRole("columnheader", { name, exact: true }).boundingBox())?.width ?? 0;
  expect(Math.round(await width("Pincode"))).toBe(76);
  expect(Math.round(await width("Count"))).toBe(54);
  expect(Math.round(await width("Oldest"))).toBe(76);
  expect(Math.round(await width("Came by referral"))).toBe(60);
  expect(Math.round(await width("Asked to be told"))).toBe(62);
  // What is left of the panel's 442 px within its border and padding, as the board's 1fr is.
  expect(Math.round(await width("Area"))).toBe(114);
});

// The waitlist was read whole, however many pincodes had people waiting.
test("says when more pincodes are waiting than the table lists", async ({ page }) => {
  await answer(page, { "GET /api/waitlist": json({ ...AREAS, more: true }) });
  await page.goto("/areas");
  await expect(page.getByText("More pincodes have people waiting than are listed.")).toBeVisible();
});

test("asks what a launch would send before anything goes out", async ({ page }) => {
  await open(page);
  const asked = page.waitForRequest(LAUNCH);
  await page.getByRole("button", { name: "Mark 400050 live, Bandra W" }).click();
  expect((await asked).postDataJSON()).toEqual({ confirm: false });

  const panel = page.getByRole("region", { name: "Mark 400050 live" });
  await expect(panel.getByText("This messages 84 people")).toBeVisible();
  await expect(panel.getByText("On the list")).toBeVisible();
  await expect(panel.getByText("Asked to be told")).toBeVisible();
  await expect(panel.getByText("Came by referral")).toBeVisible();
  await expect(panel).toContainText("Mane Man now comes to Bandra W");
  await expect(panel).toContainText("The 33 who did not opt in are not messaged.");
});

test("launches the pincode on the second press, and says how many went out", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Mark 400050 live, Bandra W" }).click();
  await expect(page.getByText("This messages 84 people")).toBeVisible();

  // The first call was the preview; this one confirms it, and only this one sends anything.
  const sent = page.waitForRequest((request) => request.url().includes(LAUNCH) && request.method() === "POST");
  await page.getByRole("button", { name: "Send to 84" }).click();
  expect((await sent).postDataJSON()).toEqual({ confirm: true });
  await expect(page.getByRole("status").filter({ hasText: "Launched" })).toHaveText("Launched. 84 on their way.");
});

test("closes the panel on Not now, without sending anything", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Mark 400050 live, Bandra W" }).click();
  await page.getByRole("button", { name: "Not now" }).click();
  await expect(page.getByText("This messages 84 people")).toBeHidden();
});

test("says so when the launch is refused, and keeps the panel open", async ({ page }) => {
  await open(page, fails(404, "not_found"));
  await page.getByRole("button", { name: "Mark 400050 live, Bandra W" }).click();
  await page.getByRole("button", { name: "Send to 84" }).click();
  await expect(page.getByRole("alert")).toContainText("We do not hold that pincode. Add it first.");
  await expect(page.getByRole("button", { name: "Send to 84" })).toBeVisible();
});

test("says nobody is waiting when the list is empty", async ({ page }) => {
  await answer(page, { "GET /api/waitlist": json({ areas: [], more: false, cities: [] }) });
  await page.goto("/areas");
  await expect(page.getByText("Nobody is waiting outside the areas we serve.")).toBeVisible();
});

test("meets WCAG 2.2 AA with the list, and with the launch panel open", async ({ page }) => {
  await open(page);
  expect(await axeViolations(page)).toEqual([]);

  await page.getByRole("button", { name: "Mark 400050 live, Bandra W" }).click();
  await expect(page.getByText("This messages 84 people")).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
});
