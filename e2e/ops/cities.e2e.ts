// Admin › Cities (docs/decisions/0198-cities-as-data.md): our cities with their states, a city added and renamed once
// checked, a city's own rule and price, and a state's GST registration. Every name and number is made up.

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { answer, empty, json, type Answers, type OpsReply } from "./fixtures.ts";
import { cities as copy } from "../../apps/ops/src/content/cities.ts";
import { review } from "../../apps/ops/src/content/common.ts";

const GURGAON = {
  name: "Gurgaon",
  state_code: "HR",
  state: "Haryana",
  zone: "NCR",
  served: true,
  active: true,
  sort: 10,
};
const MUMBAI = {
  name: "Mumbai",
  state_code: "MH",
  state: "Maharashtra",
  zone: null,
  served: false,
  active: true,
  sort: 60,
};

const BOOK = {
  cities: [GURGAON, MUMBAI],
  zones: ["NCR"],
  registrations: [],
  rules: [{ city: "Mumbai", rule: "checkin_radius_m", value: 400 }],
  rule_names: ["checkin_radius_m", "reminder_hour"],
  prices: [
    {
      city: "Mumbai",
      item: "service",
      tier: "standard",
      amount_ex_gst: 400_000,
      gst_percent: 18,
      valid_from: "2027-10-01",
      in_force: false,
    },
  ],
  today: "2027-09-21",
} satisfies OpsReply<"/api/cities">;

async function open(page: Page, extra: Answers = {}): Promise<void> {
  await answer(page, { "GET /api/cities": json(BOOK), ...extra });
  await page.goto("/cities");
  await expect(page.getByRole("heading", { level: 1, name: copy.title })).toBeVisible();
}

const cityRow = (page: Page, name: string) =>
  page.getByRole("region", { name: copy.list.panel }).getByRole("row").filter({ hasText: name });

test("lists each city with its state, zone and status, and meets WCAG 2.2 AA", async ({ page }) => {
  await open(page);
  await expect(cityRow(page, "Gurgaon")).toContainText("Haryana (HR)");
  await expect(cityRow(page, "Gurgaon")).toContainText(copy.list.served);
  await expect(cityRow(page, "Mumbai")).toContainText(copy.list.noZone);
  expect(await axeViolations(page)).toEqual([]);
});

test("adds a city once checked, and sends it as typed", async ({ page }) => {
  const added = { ...MUMBAI, name: "Pune", sort: 70 };
  await open(page, { "POST /api/cities": json({ city: added }, 201) });
  const form = page.getByRole("group", { name: copy.form.addTitle });
  await form.getByLabel(copy.form.name).fill("Pune");
  await form.getByLabel(copy.form.stateCode).fill("mh");
  await form.getByLabel(copy.form.state).fill("Maharashtra");
  await form.getByRole("button", { name: review.next }).click();
  await expect(form).toContainText(copy.form.adding("Pune", "Maharashtra"));
  const sent = page.waitForRequest((request) => request.url().endsWith("/api/cities") && request.method() === "POST");
  await form.getByRole("button", { name: review.send }).click();
  expect((await sent).postDataJSON()).toEqual({
    name: "Pune",
    state_code: "MH",
    state: "Maharashtra",
    zone: null,
    served: false,
    active: true,
  });
  await expect(page.getByText(copy.form.added)).toBeVisible();
});

test("says a rename moves every row naming the city before it is sent", async ({ page }) => {
  await open(page, { "PATCH /api/cities/{name}": json({ city: { ...GURGAON, name: "Gurugram" } }) });
  await page.getByRole("button", { name: copy.list.changeLabel("Gurgaon") }).click();
  const form = page.getByRole("group", { name: copy.form.changeTitle("Gurgaon") });
  await form.getByLabel(copy.form.name).fill("Gurugram");
  await form.getByRole("button", { name: review.next }).click();
  await expect(form).toContainText(copy.form.line(copy.form.name, "Gurgaon", "Gurugram"));
  await expect(form).toContainText(copy.form.renames("Gurgaon", "Gurugram"));
});

test("shows a city's own rule beside the national one, and gives it back to the national rule", async ({ page }) => {
  await open(page, { "DELETE /api/cities/{name}/rules/{rule}": empty() });
  const rules = page.getByRole("region", { name: copy.rules.panel });
  await rules.getByLabel(copy.rules.city).selectOption("Mumbai");
  await expect(rules).toContainText(copy.rules.own("400 metres"));
  await rules.getByRole("button", { name: copy.rules.back }).click();
  await expect(rules).toContainText(copy.rules.backQuestion(copy.rules.names.checkin_radius_m, "Mumbai"));
  await rules.getByRole("button", { name: review.send }).click();
  await expect(rules.getByText(copy.rules.saved)).toBeVisible();
});

test("withdraws a city's price still to come, asked first", async ({ page }) => {
  await open(page, { "DELETE /api/cities/{name}/prices/{item}/{tier}/{valid_from}": empty() });
  const prices = page.getByRole("region", { name: copy.prices.panel });
  await prices.getByRole("button", { name: copy.prices.withdrawLabel(copy.prices.items.service, "Mumbai") }).click();
  await expect(prices).toContainText(copy.prices.withdrawQuestion(copy.prices.items.service, "Mumbai", "2027-10-01"));
  await prices.getByRole("button", { name: review.send }).click();
  await expect(prices.getByText(copy.prices.withdrawn)).toBeVisible();
});

test("refuses a GSTIN another state has, in the form's own words", async ({ page }) => {
  await open(page, {
    "POST /api/gst-registrations": json({ error: { code: "taken", request_id: "test" } }, 409),
  });
  const form = page.getByRole("group", { name: copy.registrations.add });
  await form.getByLabel(copy.registrations.stateCode).fill("KA");
  await form.getByLabel(copy.registrations.gstin).fill("29AAACM1234A1Z3");
  await form.getByRole("button", { name: review.next }).click();
  await form.getByRole("button", { name: review.send }).click();
  await expect(form.getByRole("alert")).toContainText(copy.registrations.errors.taken);
});
