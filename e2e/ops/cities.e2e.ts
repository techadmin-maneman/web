// Admin › Cities (docs/decisions/0198-cities-as-data.md): our cities with their states, a city added, and its record,
// where each value and each rule it sets for itself changes where it reads (docs/decisions/0212-editing-in-place.md);
// a city's price withdrawn, and a state's GST registration. Every name and number is made up.

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { answer, empty, json, type Answers, type OpsReply } from "./fixtures.ts";
import { cities as copy } from "../../apps/ops/src/content/cities.ts";
import { deleting, EDITING } from "../../apps/ops/src/content/common.ts";

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
  cities: [
    { ...GURGAON, technicians: 2, active_clients: 1240, deletable: false },
    { ...MUMBAI, technicians: 0, active_clients: 0, deletable: true },
  ],
  zones: ["NCR"],
  deletable_zones: [],
  registrations: [],
  rules: [{ city: "Mumbai", rule: "checkin_radius_m", value: 400 }],
  rule_names: ["checkin_radius_m", "reminder_hour"],
  national: { checkin_radius_m: 200, reminder_hour: 18 },
  prices: [
    {
      city: "Mumbai",
      item: "service",
      tier: "standard",
      amount_ex_gst: 400_000,
      amount: 472_000,
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

// Delhi, Faridabad and Ghaziabad read Served with no active technician working there.
test("counts each city's technicians, and warns of one served with none", async ({ page }) => {
  await open(page, {
    "GET /api/cities": json({
      ...BOOK,
      cities: [
        { ...GURGAON, technicians: 2, active_clients: 1240, deletable: false },
        { ...MUMBAI, name: "Delhi", served: true, technicians: 0, active_clients: 0, deletable: false },
      ],
    }),
  });
  await expect(cityRow(page, "Gurgaon")).toContainText("2");
  await expect(cityRow(page, "Gurgaon")).toContainText("1,240");
  await expect(cityRow(page, "Gurgaon")).not.toContainText(copy.list.noTechnician);
  await expect(cityRow(page, "Delhi")).toContainText(copy.list.noTechnician);
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
  await expect(radius).toHaveAccessibleDescription(/400 metres/);
  await expect(
    record.getByRole("button", { name: `${EDITING.change} ${copy.rules.names.reminder_hour}` }).locator(".."),
  ).toContainText(copy.rules.national("6 pm"));

  await radius.click();
  const box = record.getByRole("textbox", { name: copy.rules.names.checkin_radius_m });
  await box.fill("");
  const sent = page.waitForRequest((request) => request.method() === "DELETE");
  await box.press("Enter");
  expect((await sent).url()).toContain("/api/cities/Mumbai/rules/checkin_radius_m");
});

// A city's own figure may not break the national rule it keeps within; the record says which, in a sentence.
test("says a city’s reminder time can’t go out after the address unlocks", async ({ page }) => {
  await open(page, {
    "PATCH /api/cities/{name}/rules/{rule}": json(
      { error: { code: "figures_conflict", fields: ["reminder_hour", "address_unlock_hour"], request_id: "test" } },
      422,
    ),
  });
  const record = await recordOf(page, "Mumbai");
  await record.getByRole("button", { name: `${EDITING.change} ${copy.rules.names.reminder_hour}` }).click();
  const box = record.getByRole("textbox", { name: copy.rules.names.reminder_hour });
  await box.fill("21");
  await box.press("Enter");
  await expect(page.getByText(copy.rules.conflicts.reminder_hour, { exact: true })).toBeVisible();
});

test("withdraws a city’s price still to come, asked first", async ({ page }) => {
  await open(page, { "DELETE /api/cities/{name}/prices/{item}/{tier}/{valid_from}": empty() });
  const prices = page.getByRole("region", { name: copy.prices.panel });
  await prices
    .getByRole("button", { name: copy.prices.withdrawing.label(copy.prices.items.service, "Mumbai") })
    .click();
  await expect(prices).toContainText(
    copy.prices.withdrawing.warning(copy.prices.items.service, "Mumbai", "1 Oct 2027"),
  );
  await prices.getByRole("button", { name: copy.prices.withdrawing.confirm, exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: copy.prices.withdrawn })).toBeVisible();
});

// Only NCR came with the migrations, and a city could be put in no other zone.
test("lists each zone with its cities, and adds one as typed", async ({ page }) => {
  await open(page, { "POST /api/zones": json({ zones: ["NCR", "Deccan"] }, 201) });
  await expect(page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "NCR" }) })).toContainText(
    "Gurgaon",
  );
  await page.getByRole("button", { name: copy.zones.add }).click();
  const form = page.getByRole("group", { name: copy.zones.add });
  await form.getByLabel(copy.zones.name).fill(" Deccan ");
  const sent = page.waitForRequest((request) => request.url().endsWith("/api/zones") && request.method() === "POST");
  await form.getByRole("button", { name: copy.form.add, exact: true }).click();
  expect((await sent).postDataJSON()).toEqual({ name: "Deccan" });
  await expect(page.getByRole("status").filter({ hasText: copy.zones.added })).toBeVisible();
});

// A zone could be added, never renamed or deleted.
test("renames a zone from its record, and deletes one no city is in, but not one a city is in", async ({ page }) => {
  await open(page, {
    "GET /api/cities": json({ ...BOOK, zones: ["NCR", "Deccan"], deletable_zones: ["Deccan"] }),
    "PATCH /api/zones/{name}": json({ zones: ["NCR", "Western"] }),
    "DELETE /api/zones/{name}": empty(),
  });
  const zones = page.getByRole("region", { name: copy.zones.panel });
  await zones.getByRole("button", { name: "NCR", exact: true }).click();
  const ncr = page.getByRole("dialog", { name: "NCR" });
  await expect(ncr).toContainText(copy.zones.inUse);
  await expect(ncr.getByRole("button", { name: deleting.label("NCR") })).toHaveCount(0);
  expect(await axeViolations(page)).toEqual([]);
  await page.keyboard.press("Escape");

  await zones.getByRole("button", { name: "Deccan", exact: true }).click();
  const deccan = page.getByRole("dialog", { name: "Deccan" });
  await deccan.getByRole("button", { name: `${EDITING.change} ${copy.zones.name}` }).click();
  await deccan.getByRole("textbox", { name: copy.zones.name }).fill("Western");
  const renamed = page.waitForRequest((request) => request.method() === "PATCH");
  await deccan.getByRole("button", { name: EDITING.save }).click();
  expect((await renamed).url()).toContain("/api/zones/Deccan");
  expect((await renamed).postDataJSON()).toEqual({ name: "Western" });

  await page.keyboard.press("Escape");
  await zones.getByRole("button", { name: "Deccan", exact: true }).click();
  const again = page.getByRole("dialog", { name: "Deccan" });
  await again.getByRole("button", { name: deleting.label("Deccan") }).click();
  const deleted = page.waitForRequest(
    (request) => request.method() === "DELETE" && request.url().endsWith("/api/zones/Deccan"),
  );
  await again.getByRole("button", { name: deleting.confirm, exact: true }).click();
  await deleted;
  await expect(page.getByRole("status").filter({ hasText: copy.zones.deleted })).toBeVisible();
});

// A city added by mistake could only be hidden.
test("deletes a city nothing names from its record, and offers no delete on one in use", async ({ page }) => {
  let deleted = false;
  const left = { ...BOOK, cities: BOOK.cities.filter((city) => city.name !== "Mumbai") };
  await open(page, {
    "DELETE /api/cities/Mumbai": (route) => {
      deleted = true;
      return empty()(route);
    },
    "GET /api/cities": (route) => json(deleted ? left : BOOK)(route),
  });
  const gurgaon = await recordOf(page, "Gurgaon");
  await expect(gurgaon.getByRole("button", { name: deleting.label("Gurgaon") })).toHaveCount(0);
  await page.keyboard.press("Escape");

  const mumbai = await recordOf(page, "Mumbai");
  await mumbai.getByRole("button", { name: deleting.label("Mumbai") }).click();
  await mumbai.getByRole("button", { name: deleting.confirm, exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: copy.form.deleted })).toBeVisible();
  await expect(cityRow(page, "Mumbai")).toHaveCount(0);
});

test("refuses a zone another goes by, in the form’s own words", async ({ page }) => {
  await open(page, {
    "POST /api/zones": json({ error: { code: "taken", request_id: "test", fields: ["name"] } }, 409),
  });
  await page.getByRole("button", { name: copy.zones.add }).click();
  const form = page.getByRole("group", { name: copy.zones.add });
  await form.getByLabel(copy.zones.name).fill("ncr");
  await form.getByRole("button", { name: copy.form.add, exact: true }).click();
  await expect(form).toContainText(copy.zones.errors.taken);
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
