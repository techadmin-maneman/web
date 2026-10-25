// Admin › Cities (docs/decisions/0198-cities-as-data.md): our cities with their states, a city added, and its record,
// where each value and each rule it sets for itself changes where it reads (docs/decisions/0212-editing-in-place.md);
// a city's price withdrawn, and a state's GST registration. Every name and number is made up.

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { answer, empty, json, type Answers, type OpsReply } from "./fixtures.ts";
import { cities as copy } from "../../apps/ops/src/content/cities.ts";
import { EDITING } from "../../apps/ops/src/content/common.ts";

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
  await page.goto("/settings/cities");
  await expect(page.getByRole("heading", { level: 1, name: copy.title })).toBeVisible();
}

const cityRow = (page: Page, name: string) =>
  page.getByRole("region", { name: copy.list.panel }).getByRole("row").filter({ hasText: name });

async function recordOf(page: Page, name: string) {
  await page.getByRole("button", { name: copy.list.open(name) }).click();
  return page.getByRole("dialog", { name });
}

const patched = (page: Page, path: string) =>
  page.waitForRequest((request) => request.url().endsWith(path) && request.method() === "PATCH");

test("lists each city with its state, zone and status, and meets WCAG 2.2 AA", async ({ page }) => {
  await open(page);
  await expect(cityRow(page, "Gurgaon")).toContainText("Haryana (HR)");
  await expect(cityRow(page, "Gurgaon")).toContainText(copy.list.served);
  await expect(cityRow(page, "Mumbai")).toContainText(copy.list.noZone);
  expect(await axeViolations(page)).toEqual([]);
});

test("adds a city, sending it as typed", async ({ page }) => {
  const added = { ...MUMBAI, name: "Pune", sort: 70 };
  await open(page, { "POST /api/cities": json({ city: added }, 201) });
  await page.getByRole("button", { name: copy.list.add, exact: true }).click();
  const form = page.getByRole("group", { name: copy.form.addTitle, exact: true });
  await form.getByLabel(copy.form.name).fill("Pune");
  await form.getByLabel(copy.form.stateCode).fill("mh");
  await form.getByLabel(copy.form.state, { exact: true }).fill("Maharashtra");
  const sent = page.waitForRequest((request) => request.url().endsWith("/api/cities") && request.method() === "POST");
  await form.getByRole("button", { name: copy.form.add, exact: true }).click();
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

test("changes a city's value where it reads, says what a new name moves, and sends the rest as they stand", async ({
  page,
}) => {
  await open(page, { "PATCH /api/cities/{name}": json({ city: { ...GURGAON, served: false } }) });
  const record = await recordOf(page, "Gurgaon");
  await expect(record).toContainText(copy.form.renames("Gurgaon"));
  await record.getByRole("button", { name: `${EDITING.change} ${copy.form.served}` }).click();
  await record.getByRole("combobox", { name: copy.form.served }).selectOption(copy.form.no);
  const sent = patched(page, "/api/cities/Gurgaon");
  await record.getByRole("button", { name: EDITING.save }).click();
  expect((await sent).postDataJSON()).toEqual({
    name: "Gurgaon",
    state_code: "HR",
    state: "Haryana",
    zone: "NCR",
    served: false,
    active: true,
  });
});

test("shows a city’s own rule beside the national one, and gives it back to the national rule once emptied", async ({
  page,
}) => {
  await open(page, { "DELETE /api/cities/{name}/rules/{rule}": empty() });
  const record = await recordOf(page, "Mumbai");
  const radius = record.getByRole("button", { name: `${EDITING.change} ${copy.rules.names.checkin_radius_m}` });
  await expect(radius).toContainText("400 metres");
  await expect(
    record.getByRole("button", { name: `${EDITING.change} ${copy.rules.names.reminder_hour}` }),
  ).toContainText(copy.rules.national);

  await radius.click();
  const box = record.getByRole("textbox", { name: copy.rules.names.checkin_radius_m });
  await box.fill("");
  const sent = page.waitForRequest((request) => request.method() === "DELETE");
  await box.press("Enter");
  expect((await sent).url()).toContain("/api/cities/Mumbai/rules/checkin_radius_m");
});

test("withdraws a city’s price still to come, asked first", async ({ page }) => {
  await open(page, { "DELETE /api/cities/{name}/prices/{item}/{tier}/{valid_from}": empty() });
  const prices = page.getByRole("region", { name: copy.prices.panel });
  await prices
    .getByRole("button", { name: copy.prices.withdrawing.label(copy.prices.items.service, "Mumbai") })
    .click();
  await expect(prices).toContainText(
    copy.prices.withdrawing.warning(copy.prices.items.service, "Mumbai", "2027-10-01"),
  );
  await prices.getByRole("button", { name: copy.prices.withdrawing.confirm, exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: copy.prices.withdrawn })).toBeVisible();
});

test("refuses a GSTIN another state has, in the form’s own words", async ({ page }) => {
  await open(page, {
    "POST /api/gst-registrations": json({ error: { code: "taken", request_id: "test" } }, 409),
  });
  await page.getByRole("button", { name: copy.registrations.add }).click();
  const form = page.getByRole("group", { name: copy.registrations.add });
  await form.getByLabel(copy.registrations.stateCode).fill("KA");
  await form.getByLabel(copy.registrations.gstin).fill("29AAACM1234A1Z3");
  await form.getByRole("button", { name: copy.form.add, exact: true }).click();
  await expect(form.getByRole("alert")).toContainText(copy.registrations.errors.taken);
});
