// Settings: the business inputs ops set for themselves
// (docs/decisions/0061-ops-editable-inputs.md). Three panels, and the thing
// each one has to get right is the same: say the unit and the bounds before
// anything is typed, show a change that cannot quietly be taken back before it
// is made (docs/decisions/0071-what-ops-see-before-a-setting-changes.md), and
// say what went wrong, of the box it went wrong in, when a figure is refused.
//
// The refusals are the API's own shape: invalid_request, with the fields it
// names (src/http/errors.ts).

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { BLACKOUTS, fails, json } from "./fixtures.ts";
import { open, posted } from "./settings-fixtures.ts";

test.describe("the service area, Areas' Served tab", () => {
  const area = (page: Page, pincode: string) => page.getByRole("textbox", { name: `Area name for ${pincode}` });

  test("lists one city at a time, since 198 pincodes is not a page", async ({ page }) => {
    await open(page, "/areas/served");
    await expect(page.getByRole("button", { name: "Delhi · 1 of 2" })).toBeVisible();
    await expect(area(page, "110017")).toHaveValue("Saket");
    // Gurgaon's pincode is not drawn until its city is chosen.
    await expect(area(page, "122018")).toHaveCount(0);

    await page.getByRole("button", { name: "Gurgaon · 0 of 1" }).click();
    await expect(area(page, "122018")).toHaveValue("Sec65");
  });

  test("sends only the pincodes that changed", async ({ page }) => {
    await open(page, "/areas/served", {
      "POST /api/service-area": json({ changed: 1, served: 1, alerted: 0 }),
    });
    await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
    await page.getByLabel("Launch date for 110017").fill("2026-09-02");

    const sent = posted(page, "/api/service-area");
    await page.getByRole("button", { name: "Save" }).click();
    expect((await sent).postDataJSON()).toEqual({
      changes: [{ pincode: "110017", served: true, launch_on: "2026-09-02" }],
    });
    await expect(page.getByRole("status").filter({ hasText: "One pincode changed." })).toBeVisible();
  });

  // Launch messages read "we now come to Sec91", with no way to say it better.
  test("sends a better name for an area, and refuses one a spreadsheet would run", async ({ page }) => {
    await open(page, "/areas/served", {
      "POST /api/service-area": json({ changed: 1, served: 1, alerted: 0 }),
    });
    await page.getByRole("button", { name: "Gurgaon · 0 of 1" }).click();
    await area(page, "122018").fill("=Sector 65");
    await expect(page.getByRole("alert")).toContainText("122018: 2–40 characters");
    await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();

    await area(page, "122018").fill("Sector 65 ");
    const sent = posted(page, "/api/service-area");
    await page.getByRole("button", { name: "Save" }).click();
    expect((await sent).postDataJSON()).toEqual({
      changes: [{ pincode: "122018", served: false, launch_on: null, area: "Sector 65" }],
    });
  });

  test("fills a whole city in one press", async ({ page }) => {
    await open(page, "/areas/served");
    await page.getByRole("button", { name: "Serve all of Delhi" }).click();
    await expect(page.getByRole("button", { name: "Delhi · 2 of 2" })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Served 110024" })).toBeChecked();
  });

  // Serving a pincode here sent none of the launch alerts the waitlist's launch sends. It had a
  // launch panel of its own; it now opens the one Waiting uses.
  test("says who serving a pincode will message, and messages them only once ops agree", async ({ page }) => {
    await open(page, "/areas/served", {
      "POST /api/service-area": json({ changed: 1, served: 2, alerted: 3 }),
    });
    await page.getByRole("checkbox", { name: "Served 110024" }).check();
    await page.getByRole("button", { name: "Save" }).click();

    const check = page.getByRole("region", { name: "Mark 110024 live" });
    await expect(check).toBeFocused();
    await expect(check).toContainText("Messages 3 people");
    await expect(check).toContainText("110024, Lajpat Nagar: 3 opted in.");
    await expect(check).toContainText("2 didn't opt in and won't be messaged.");

    const sent = posted(page, "/api/service-area");
    await check.getByRole("button", { name: "Save and send to 3" }).click();
    expect((await sent).postDataJSON()).toEqual({
      changes: [{ pincode: "110024", served: true, launch_on: null }],
    });
    await expect(page.getByRole("status").filter({ hasText: "3 WhatsApp messages sending." })).toBeVisible();
  });

  test("says so when a change would leave nowhere served", async ({ page }) => {
    await open(page, "/areas/served", {
      "POST /api/service-area": fails(400, "no_service_area"),
    });
    await page.getByRole("checkbox", { name: "Served 110017" }).uncheck();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("alert")).toContainText("At least one pincode must stay served.");
  });

  const upload = (page: Page, csv: string) =>
    page.getByLabel("Edited CSV").setInputFiles({
      name: "service-area.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });

  // The table kept the old values after an upload, and the next Save put them back.
  test("puts a file's changes in the table, so the one Save sends the file's values", async ({ page }) => {
    await open(page, "/areas/served", {
      "POST /api/service-area": json({ changed: 1, served: 2, alerted: 0 }),
    });
    await upload(page, "pincode,served,launch_on\n110017,yes,2026-09-01\n110024,no,2026-11-01\n");
    const preview = page.getByRole("row").filter({ hasText: "110024" }).last();
    await expect(preview).toContainText("Not served");
    await expect(preview).toContainText("Not served, launch 2026-11-01");
    await page.getByRole("button", { name: "Apply to table" }).click();
    await expect(page.getByLabel("Launch date for 110024")).toHaveValue("2026-11-01");

    const sent = posted(page, "/api/service-area");
    await page.getByRole("button", { name: "Save" }).click();
    expect((await sent).postDataJSON()).toEqual({
      changes: [{ pincode: "110024", served: false, launch_on: "2026-11-01" }],
    });
    await expect(page.getByLabel("Launch date for 110024")).toHaveValue("2026-11-01");
    await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  // A pincode served from a later day was served at once.
  test("will not serve a pincode from a day still to come", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-10-04T06:00:00.000Z"));
    await open(page, "/areas/served");
    await page.getByRole("checkbox", { name: "Served 110024" }).check();
    await page.getByLabel("Launch date for 110024").fill("2026-10-20");
    await expect(page.getByRole("alert")).toContainText("110024: the launch date must be today or earlier");
    await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  // No screen could add a pincode the reference file does not hold.
  test("adds a pincode the file does not hold, unserved, in its city's list", async ({ page }) => {
    const added = {
      pincode: "400050",
      area: "Bandra West",
      city: "Mumbai",
      served: false,
      launch_on: null,
      waiting: 0,
      to_alert: 0,
    };
    await open(page, "/areas/served", { "POST /api/pincodes": json(added, 201) });
    const form = page.getByRole("group", { name: "Add a pincode" });
    await form.getByLabel("Pincode").fill("400050");
    await form.getByLabel("Area name").fill("Bandra West");
    await form.getByLabel("City").selectOption("Mumbai");
    const sent = posted(page, "/api/pincodes");
    await form.getByRole("button", { name: "Add" }).click();
    expect((await sent).postDataJSON()).toEqual({ pincode: "400050", area: "Bandra West", city: "Mumbai" });

    await expect(form.getByRole("status")).toHaveText("400050 added to Mumbai.");
    await expect(page.getByRole("button", { name: "Mumbai · 0 of 1" })).toHaveAttribute("aria-current", "true");
    await expect(area(page, "400050")).toHaveValue("Bandra West");
  });

  test("refuses a pincode the API could not hold before it is sent", async ({ page }) => {
    await open(page, "/areas/served");
    const form = page.getByRole("group", { name: "Add a pincode" });
    await form.getByLabel("Pincode").fill("012345");
    await expect(form.getByRole("alert")).toHaveText("Six digits, starting 1–8.");
    await expect(form.getByRole("button", { name: "Add" })).toBeDisabled();
  });

  // A file without its served column switched every pincode in it off.
  test("refuses a file that leaves out one of its three columns", async ({ page }) => {
    await open(page, "/areas/served");
    await upload(page, "pincode,launch_on\n110017,2026-09-01\n");
    await expect(page.getByRole("alert")).toContainText("Needs pincode, served and launch_on columns");
    await expect(page.getByRole("button", { name: "Apply to table" })).toHaveCount(0);
  });
});

// The days no visit is offered, which the runbook's SQL set before (docs/decisions/0088-every-policy-in-the-console.md).
test.describe("the blackout days", () => {
  test("lists the days run together, why, who added them, and what is still booked on them", async ({ page }) => {
    await open(page, "/settings/blackouts");
    const diwali = page.getByRole("listitem").filter({ hasText: "Fri 29 Oct to Sat 30 Oct · Diwali" });
    await expect(diwali).toContainText("Closed by ops@maneman.in on 20 Sep 2027");
    await expect(diwali).toContainText("3 visits are still booked. Move them on the dispatch board.");
    // The way to those visits opens the board on the run's first day.
    await expect(diwali.getByRole("link", { name: "Show on board: Fri 29 Oct to Sat 30 Oct" })).toHaveAttribute(
      "href",
      "/dispatch?from=2027-10-29",
    );
    const training = page.getByRole("listitem").filter({ hasText: "Mon 15 Nov · Staff training" });
    await expect(training).toContainText("Closed before this page existed.");
    await expect(training).not.toContainText("still booked");
    await expect(training.getByRole("link", { name: /Show on board/ })).toHaveCount(0);
  });

  test("blacks out the days from the first to the last, with the reason, and shows the list the API answers", async ({
    page,
  }) => {
    const christmas = {
      date: "2027-12-24",
      reason: "Christmas",
      set_by: "ops@maneman.in",
      set_at: "2027-09-21T06:00:00.000Z",
      booked: 0,
    };
    const added = { ...BLACKOUTS, blackouts: [...BLACKOUTS.blackouts, christmas] };
    await open(page, "/settings/blackouts", { "POST /api/blackouts": json(added) });
    const add = page.getByRole("button", { name: "Close these days" });
    await expect(add).toBeDisabled();
    await page.getByLabel("From", { exact: true }).fill("2027-12-24");
    await page.getByLabel("To", { exact: true }).fill("2027-12-24");
    await page.getByLabel("Reason").fill("  Christmas ");
    const request = posted(page, "/api/blackouts");
    await add.click();
    expect((await request).postDataJSON()).toEqual({ from: "2027-12-24", to: "2027-12-24", reason: "Christmas" });
    await expect(page.getByRole("status").filter({ hasText: "Closed." })).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "Fri 24 Dec · Christmas" })).toBeVisible();
    await expect(page.getByLabel("Reason")).toHaveValue("");
  });

  test("says why the API refused the days, of the box it refused", async ({ page }) => {
    await open(page, "/settings/blackouts", { "POST /api/blackouts": fails(400, "invalid_request", ["to"]) });
    await page.getByLabel("From", { exact: true }).fill("2027-10-01");
    await page.getByLabel("To", { exact: true }).fill("2027-12-01");
    await page.getByLabel("Reason").fill("Too long");
    await page.getByRole("button", { name: "Close these days" }).click();
    await expect(page.getByRole("alert")).toHaveText("The last day must follow the first, within a month.");
  });

  // Review of #145, item 7: a run named only its first day's setter.
  test("names who added each run, keeping apart days added by someone else", async ({ page }) => {
    const later = {
      date: "2027-10-31",
      reason: "Diwali",
      set_by: "owner@maneman.in",
      set_at: "2027-09-21T06:00:00.000Z",
      booked: 0,
    };
    const split = {
      ...BLACKOUTS,
      blackouts: [...BLACKOUTS.blackouts.slice(0, 2), later, ...BLACKOUTS.blackouts.slice(2)],
    };
    await open(page, "/settings/blackouts", { "GET /api/blackouts": json(split) });
    await expect(page.getByRole("listitem").filter({ hasText: "Fri 29 Oct to Sat 30 Oct · Diwali" })).toContainText(
      "Closed by ops@maneman.in on 20 Sep 2027",
    );
    await expect(page.getByRole("listitem").filter({ hasText: "Sun 31 Oct · Diwali" })).toContainText(
      "Closed by owner@maneman.in on 21 Sep 2027",
    );
  });

  test("offers a run of days again, the whole run in one press", async ({ page }) => {
    const left = { ...BLACKOUTS, blackouts: BLACKOUTS.blackouts.slice(2) };
    await open(page, "/settings/blackouts", { "POST /api/blackouts/remove": json(left) });
    const request = posted(page, "/api/blackouts/remove");
    await page.getByRole("button", { name: "Reopen Fri 29 Oct to Sat 30 Oct" }).click();
    expect((await request).postDataJSON()).toEqual({ from: "2027-10-29", to: "2027-10-30" });
    await expect(page.getByRole("listitem").filter({ hasText: "Diwali" })).toHaveCount(0);
    await expect(page.getByRole("listitem").filter({ hasText: "Staff training" })).toBeVisible();
  });
});
