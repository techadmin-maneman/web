// Settings: the business inputs ops set for themselves
// (docs/decisions/0060-ops-editable-inputs.md). Three panels, and the thing
// each one has to get right is the same: say the unit and the bounds before
// anything is typed, and say what went wrong when a figure is refused.

import AxeBuilder from "@axe-core/playwright";
import type { Page, Route } from "@playwright/test";
import { expect, test } from "../support.ts";
import { answer, fails, json, PRICES, SERVICE_AREA, SETTINGS } from "./fixtures.ts";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

type Replies = Readonly<Record<string, (route: Route) => Promise<void>>>;

const ROUTES: Replies = {
  "/api/settings": json(SETTINGS),
  "/api/prices": json(PRICES),
  "/api/service-area": json(SERVICE_AREA),
};

async function open(page: Page, path = "/settings", extra: Replies = {}): Promise<void> {
  await answer(page, { ...ROUTES, ...extra });
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
}

test("shows each rule with its unit and what it may be, before anything is typed", async ({ page }) => {
  await open(page);
  const radius = page.getByRole("group", { name: "Check-in radius" });
  await expect(radius.getByLabel("Check-in radius")).toHaveValue("200");
  await expect(radius).toContainText("metres");
  await expect(radius).toContainText("50 to 1000 metres, a whole number");
});

test("says who set a rule, and says when nobody has", async ({ page }) => {
  await open(page);
  await expect(page.getByText("Set by ops@maneman.in on 20 Sep 2027")).toBeVisible();
  await expect(
    page.getByText("Nobody has set this. The figure in the code stands (src/policy/check-in.ts)."),
  ).toBeVisible();
});

test("gives a rule with keys one box for each of them", async ({ page }) => {
  await open(page);
  const wait = page.getByRole("group", { name: "No-show wait" });
  await expect(wait.getByLabel("first fit", { exact: true })).toHaveValue("20");
  await expect(wait.getByLabel("service", { exact: true })).toHaveValue("15");
});

test("sends the figure ops typed, and says it saved", async ({ page }) => {
  await open(page, "/settings", {
    "/api/settings/checkin_radius_m": json({
      ...SETTINGS.settings[0],
      value: 150,
      set_by: "ops@maneman.in",
      set_at: "2027-09-21T06:00:00.000Z",
    }),
  });
  const sent = page.waitForRequest((request) => request.url().includes("/api/settings/checkin_radius_m"));
  await page.getByLabel("Check-in radius").fill("150");
  await page.getByRole("button", { name: "Save" }).first().click();
  expect((await sent).postDataJSON()).toEqual({ value: 150 });
  await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
});

test("will not send an empty box, which would read as nought", async ({ page }) => {
  await open(page);
  await page.getByLabel("Check-in radius").fill("");
  await expect(page.getByRole("button", { name: "Save" }).first()).toBeDisabled();
});

test("says what went wrong when the API refuses a figure", async ({ page }) => {
  await open(page, "/settings", { "/api/settings/checkin_radius_m": fails(400, "invalid_request") });
  await page.getByLabel("Check-in radius").fill("900");
  await page.getByRole("button", { name: "Save" }).first().click();
  await expect(page.getByRole("alert")).toContainText("outside what this rule allows");
});

test("offers a base of its own on the open rule, and none where the keys are fixed", async ({ page }) => {
  await open(page);
  await expect(
    page.getByRole("group", { name: "Replacement cycle" }).getByLabel("Base, exactly as FSM names it"),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "No-show wait" }).getByLabel("Base, exactly as FSM names it"),
  ).toHaveCount(0);
});

test("marks the price in force, and the one still to come", async ({ page }) => {
  await open(page, "/settings/prices");
  const inForce = page.getByRole("row").filter({ hasText: "Rs. 2,000" });
  await expect(inForce).toContainText("In force");
  const scheduled = page.getByRole("row").filter({ hasText: "Rs. 2,500" });
  await expect(scheduled).toContainText("To come");
  await expect(scheduled).toContainText("1 Oct 2027");
});

test("sends a price in paise from the day it applies", async ({ page }) => {
  await open(page, "/settings/prices", {
    "/api/prices": (route) =>
      route.request().method() === "POST" ? json({ prices: PRICES.prices })(route) : json(PRICES)(route),
  });
  await page.getByLabel("Price before GST, in rupees").fill("2500");
  await page.getByLabel("Applies from").fill("2027-10-01");
  const sent = page.waitForRequest((request) => request.url().includes("/api/prices") && request.method() === "POST");
  await page.getByRole("button", { name: "Set this price" }).click();
  expect((await sent).postDataJSON()).toMatchObject({
    item: "first_fit",
    amount_ex_gst: 250_000,
    valid_from: "2027-10-01",
  });
});

test("says a price cannot be back-dated when the API refuses the date", async ({ page }) => {
  await open(page, "/settings/prices", {
    "/api/prices": (route) =>
      route.request().method() === "POST" ? fails(400, "valid_from")(route) : json(PRICES)(route),
  });
  await page.getByLabel("Price before GST, in rupees").fill("2500");
  await page.getByRole("button", { name: "Set this price" }).click();
  await expect(page.getByRole("alert")).toContainText("applies from today or a day after it");
});

test("lists one city at a time, since 198 pincodes is not a page", async ({ page }) => {
  await open(page, "/settings/area");
  await expect(page.getByRole("button", { name: "Delhi · 1 of 2" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Saket" })).toBeVisible();
  // Gurgaon's pincode is not drawn until its city is chosen.
  await expect(page.getByRole("row").filter({ hasText: "Sector 65" })).toHaveCount(0);

  await page.getByRole("button", { name: "Gurgaon · 0 of 1" }).click();
  await expect(page.getByRole("row").filter({ hasText: "Sector 65" })).toBeVisible();
});

test("sends only the pincodes that changed", async ({ page }) => {
  await open(page, "/settings/area", {
    "/api/service-area": (route) =>
      route.request().method() === "POST" ? json({ changed: 1, served: 2 })(route) : json(SERVICE_AREA)(route),
  });
  await expect(page.getByRole("button", { name: "Save these pincodes" })).toBeDisabled();
  await page.getByRole("checkbox", { name: "Served 110024" }).check();

  const sent = page.waitForRequest(
    (request) => request.url().includes("/api/service-area") && request.method() === "POST",
  );
  await page.getByRole("button", { name: "Save these pincodes" }).click();
  expect((await sent).postDataJSON()).toEqual({ changes: [{ pincode: "110024", served: true, launch_on: null }] });
  await expect(page.getByRole("status").filter({ hasText: "One pincode changed." })).toBeVisible();
});

test("fills a whole city in one press", async ({ page }) => {
  await open(page, "/settings/area");
  await page.getByRole("button", { name: "Serve all of Delhi" }).click();
  await expect(page.getByRole("button", { name: "Delhi · 2 of 2" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Served 110024" })).toBeChecked();
});

test("says so when a change would leave nowhere served", async ({ page }) => {
  await open(page, "/settings/area", {
    "/api/service-area": (route) =>
      route.request().method() === "POST" ? fails(400, "no_service_area")(route) : json(SERVICE_AREA)(route),
  });
  await page.getByRole("checkbox", { name: "Served 110017" }).uncheck();
  await page.getByRole("button", { name: "Save these pincodes" }).click();
  await expect(page.getByRole("alert")).toContainText("leave no pincode served");
});

test("meets WCAG 2.2 AA on all three panels", async ({ page }) => {
  for (const path of ["/settings", "/settings/prices", "/settings/area"]) {
    await open(page, path);
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(
      results.violations.map((violation) => violation.id),
      path,
    ).toEqual([]);
  }
});
