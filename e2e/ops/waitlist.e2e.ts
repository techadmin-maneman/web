// The waitlist and the launch (board C3). Nothing is sent until the second
// press: choosing a pincode only asks the API what a launch would send, and
// the panel shows both counts so the gap between them is visible.

import AxeBuilder from "@axe-core/playwright";
import type { Page, Route } from "@playwright/test";
import { expect, test } from "../support.ts";
import { answer, AREAS, fails, json, LAUNCHED, PREVIEW } from "./fixtures.ts";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const LAUNCH = "/api/pincodes/400050/launch";

/** Answers the launch route with the preview while confirm is false, then `confirmed` once it is true. */
function launchRoute(confirmed = json(LAUNCHED)) {
  return (route: Route) => {
    const body = route.request().postDataJSON() as { confirm: boolean };
    return body.confirm ? confirmed(route) : json(PREVIEW)(route);
  };
}

async function open(page: Page, confirmed?: ReturnType<typeof json>): Promise<void> {
  await answer(page, { "/api/waitlist": json(AREAS), [LAUNCH]: launchRoute(confirmed) });
  await page.goto("/waitlist");
  await expect(page.getByRole("heading", { level: 1, name: "Waitlist" })).toBeVisible();
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

test("asks what a launch would send before anything goes out", async ({ page }) => {
  await open(page);
  const asked = page.waitForRequest(LAUNCH);
  await page.getByRole("button", { name: "Mark 400050 live, Bandra W" }).click();
  expect((await asked).postDataJSON()).toEqual({ confirm: false });

  const panel = page.getByRole("region", { name: "Mark 400050 live" });
  await expect(panel.getByText("This messages 84 people")).toBeVisible();
  await expect(panel.getByText("On the list")).toBeVisible();
  await expect(panel.getByText("Opted in to alerts")).toBeVisible();
  await expect(panel.getByText("Held referral invites")).toBeVisible();
  await expect(panel).toContainText("we now come to Bandra W");
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
  await expect(page.getByRole("alert")).toContainText("We have no such pincode.");
  await expect(page.getByRole("button", { name: "Send to 84" })).toBeVisible();
});

test("says nobody is waiting when the list is empty", async ({ page }) => {
  await answer(page, { "/api/waitlist": json({ areas: [] }) });
  await page.goto("/waitlist");
  await expect(page.getByText("Nobody is waiting outside the areas we serve.")).toBeVisible();
});

test("meets WCAG 2.2 AA with the list, and with the launch panel open", async ({ page }) => {
  await open(page);
  const list = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(list.violations.map((violation) => violation.id)).toEqual([]);

  await page.getByRole("button", { name: "Mark 400050 live, Bandra W" }).click();
  await expect(page.getByText("This messages 84 people")).toBeVisible();
  const panel = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(panel.violations.map((violation) => violation.id)).toEqual([]);
});
