// Settings' Areas and Closed days: where visits are offered, and the days they are not
// (docs/decisions/0061-ops-editable-inputs.md). Each shows a change that cannot
// quietly be taken back before it is made
// (docs/decisions/0071-what-ops-see-before-a-setting-changes.md), and says what
// went wrong, of the box it went wrong in, when a figure is refused.
//
// The refusals are the API's own shape: invalid_request, with the fields it
// names (src/http/errors.ts).

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { BLACKOUTS, fails, json } from "./fixtures.ts";
import { open, posted } from "./settings-fixtures.ts";
import * as opsCopy from "../../apps/ops/src/content.ts";
import { settings as settingsCopy } from "../../apps/ops/src/content/settings.ts";
import { pressTwice } from "./twice.ts";

test.describe("the service area", () => {
  const served = opsCopy.areas.served;
  const row = (page: Page, pincode: string) =>
    page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: pincode, exact: true }) });

  /** Opens a pincode's drawer from its row, changes what is asked, and saves it. */
  async function change(
    page: Page,
    pincode: string,
    to: { area?: string; served?: boolean; launchOn?: string },
  ): Promise<void> {
    await page.getByRole("button", { name: served.editLabel(pincode) }).click();
    const drawer = page.getByRole("dialog");
    if (to.area !== undefined) await drawer.getByLabel(served.columns[1]).fill(to.area);
    if (to.served !== undefined) await drawer.getByLabel(served.columns[2]).setChecked(to.served);
    if (to.launchOn !== undefined) await drawer.getByLabel(served.columns[3]).fill(to.launchOn);
    await drawer.getByRole("button", { name: served.save }).click();
  }

  test("lists one city at a time, since 198 pincodes is not a page", async ({ page }) => {
    await open(page, "/settings/areas");
    await expect(page.getByRole("button", { name: "Delhi · 1 of 2" })).toBeVisible();
    await expect(row(page, "110017")).toContainText("Saket");
    // Gurgaon's pincode is not drawn until its city is chosen.
    await expect(row(page, "122018")).toHaveCount(0);

    await page.getByRole("button", { name: "Gurgaon · 0 of 1" }).click();
    await expect(row(page, "122018")).toContainText("Sec65");
  });

  test("narrows a city’s pincodes to those served or not, or by a search", async ({ page }) => {
    await open(page, "/settings/areas");
    const rows = page.getByRole("table").getByRole("row");
    const narrow = page.getByRole("search", { name: opsCopy.areas.served.narrow });
    await narrow.getByLabel(opsCopy.areas.tabs.served).selectOption("No");
    await expect(rows).toHaveCount(2);
    await expect(row(page, "110024")).toBeVisible();
    await narrow.getByLabel(opsCopy.areas.tabs.served).selectOption("");
    await narrow.getByLabel(opsCopy.tables.search).fill("saket");
    await expect(rows).toHaveCount(2);
    await expect(row(page, "110017")).toBeVisible();
  });

  // A row was changed in its drawer, then saved by a Save under the table that said "No changes." until then.
  test("saves a pincode from its drawer, sending only what changed", async ({ page }) => {
    await open(page, "/settings/areas", {
      "POST /api/service-area": json({ changed: 1, served: 1, alerted: 0 }),
    });
    await expect(page.getByText(opsCopy.review.nothing)).toHaveCount(0);
    const sent = posted(page, "/api/service-area");
    await change(page, "110017", { launchOn: "2026-09-02" });
    expect((await sent).postDataJSON()).toEqual({
      changes: [{ pincode: "110017", served: true, launch_on: "2026-09-02" }],
    });
    await expect(page.getByRole("status").filter({ hasText: "One pincode changed." })).toBeVisible();
    await expect(row(page, "110017")).toContainText("2 Sep");
  });

  // Launch messages read "we now come to Sec91", with no way to say it better.
  test("sends a better name for an area, and refuses one a spreadsheet would run", async ({ page }) => {
    await open(page, "/settings/areas", {
      "POST /api/service-area": json({ changed: 1, served: 1, alerted: 0 }),
    });
    await page.getByRole("button", { name: "Gurgaon · 0 of 1" }).click();
    await change(page, "122018", { area: "=Sector 65" });
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByRole("alert")).toContainText("122018: 2–40 characters");

    await drawer.getByLabel(served.columns[1]).fill("Sector 65 ");
    const sent = posted(page, "/api/service-area");
    await drawer.getByRole("button", { name: served.save }).click();
    expect((await sent).postDataJSON()).toEqual({
      changes: [{ pincode: "122018", served: false, launch_on: null, area: "Sector 65" }],
    });
    await expect(drawer).toBeHidden();
  });

  // "Serve all of Bengaluru" and "Stop serving Bengaluru" were the page's first buttons, and acted at a press.
  test("serves or stops the pincodes chosen, once asked", async ({ page }) => {
    await open(page, "/settings/areas", {
      "POST /api/service-area": json({ changed: 1, served: 0, alerted: 0 }),
    });
    await expect(page.getByRole("button", { name: served.chosen.stop })).toHaveCount(0);
    await page.getByRole("checkbox", { name: served.chosen.one("110017") }).check();
    await expect(page.getByText(served.chosen.count(1))).toBeVisible();
    await page.getByRole("button", { name: served.chosen.stop }).click();

    const check = page.getByRole("group", { name: served.chosen.stopCheck(1, "Delhi") });
    await expect(check).toBeFocused();
    const sent = posted(page, "/api/service-area");
    await check.getByRole("button", { name: opsCopy.review.send }).click();
    expect((await sent).postDataJSON()).toEqual({
      changes: [{ pincode: "110017", served: false, launch_on: "2026-09-01" }],
    });
    await expect(page.getByRole("button", { name: "Delhi · 0 of 2" })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: served.chosen.one("110017") })).not.toBeChecked();
  });

  test("chooses every pincode shown at once, and asks before serving any that would message people", async ({
    page,
  }) => {
    await open(page, "/settings/areas");
    await page.getByRole("checkbox", { name: served.chosen.all }).check();
    await expect(page.getByText(served.chosen.count(2))).toBeVisible();
    await page.getByRole("button", { name: served.chosen.serve, exact: true }).click();
    await expect(page.getByRole("region", { name: "Mark 110024 live" })).toBeFocused();
  });

  // Serving a pincode here sent none of the launch alerts the waitlist's launch sends. It had a
  // launch panel of its own; it now opens the one Waiting uses.
  test("says who serving a pincode will message, and messages them only once ops agree", async ({ page }) => {
    await open(page, "/settings/areas", {
      "POST /api/service-area": json({ changed: 1, served: 2, alerted: 3 }),
    });
    await change(page, "110024", { served: true });

    const check = page.getByRole("region", { name: "Mark 110024 live" });
    await expect(check).toBeFocused();
    await expect(check).toContainText("Messages 3 people");
    await expect(check).toContainText("110024, Lajpat Nagar: 3 opted in.");
    await expect(check).toContainText("2 didn’t opt in and won’t be messaged.");

    const sent = posted(page, "/api/service-area");
    await check.getByRole("button", { name: "Save and send to 3" }).click();
    expect((await sent).postDataJSON()).toEqual({
      changes: [{ pincode: "110024", served: true, launch_on: null }],
    });
    await expect(page.getByRole("status").filter({ hasText: "3 WhatsApp messages sending." })).toBeVisible();
  });

  test("says so when a change would leave nowhere served", async ({ page }) => {
    await open(page, "/settings/areas", {
      "POST /api/service-area": fails(400, "no_service_area"),
    });
    await change(page, "110017", { served: false });
    await expect(page.getByRole("alert")).toContainText(opsCopy.areas.served.errors.no_service_area);
    await expect(row(page, "110017")).toContainText(served.yes);
  });

  const upload = (page: Page, csv: string) =>
    page.getByLabel(opsCopy.areas.served.upload.label).setInputFiles({
      name: "service-area.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });

  // The table kept the old values after an upload, and the next Save put them back.
  test("shows a file’s changes, then saves the file’s values", async ({ page }) => {
    await open(page, "/settings/areas", {
      "POST /api/service-area": json({ changed: 1, served: 2, alerted: 0 }),
    });
    await upload(page, "pincode,served,launch_on\n110017,yes,2026-09-01\n110024,no,2026-11-01\n");
    const preview = page.getByRole("row").filter({ hasText: "110024" }).last();
    await expect(preview).toContainText(opsCopy.cities.list.notServed);
    await expect(preview).toContainText("Not served, launch 2026-11-01");

    const sent = posted(page, "/api/service-area");
    await page.getByRole("button", { name: opsCopy.areas.served.upload.apply }).click();
    expect((await sent).postDataJSON()).toEqual({
      changes: [{ pincode: "110024", served: false, launch_on: "2026-11-01" }],
    });
    await expect(row(page, "110024")).toContainText("1 Nov");
    await expect(page.getByRole("button", { name: opsCopy.areas.served.upload.apply })).toHaveCount(0);
  });

  // A pincode served from a later day was served at once.
  test("will not serve a pincode from a day still to come", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-10-04T06:00:00.000Z"));
    await open(page, "/settings/areas");
    await change(page, "110024", { served: true, launchOn: "2026-10-20" });
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
      "110024: the launch date must be today or earlier",
    );
  });

  // No screen could add a pincode the reference file does not hold.
  test("adds a pincode the file does not hold, unserved, in its city’s list", async ({ page }) => {
    const added = {
      pincode: "400050",
      area: "Bandra West",
      city: "Mumbai",
      served: false,
      launch_on: null,
      waiting: 0,
      to_alert: 0,
    };
    await open(page, "/settings/areas", { "POST /api/pincodes": json(added, 201) });
    const form = page.getByRole("group", { name: opsCopy.areas.add.title });
    await form.getByLabel(opsCopy.areas.add.pincode).fill("400050");
    await form.getByLabel(opsCopy.areas.add.area).fill("Bandra West");
    await form.getByLabel(opsCopy.areas.add.city).selectOption("Mumbai");
    const sent = posted(page, "/api/pincodes");
    let adds = 0;
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().endsWith("/api/pincodes")) adds += 1;
    });
    // However fast Add is pressed twice, the pincode is sent once.
    await pressTwice(form.getByRole("button", { name: opsCopy.areas.add.add }));
    expect((await sent).postDataJSON()).toEqual({ pincode: "400050", area: "Bandra West", city: "Mumbai" });

    await expect(page.getByRole("status").filter({ hasText: "400050 added to Mumbai." })).toHaveText(
      "400050 added to Mumbai.",
    );
    expect(adds).toBe(1);
    await expect(page.getByRole("button", { name: "Mumbai · 0 of 1" })).toHaveAttribute("aria-current", "true");
    await expect(row(page, "400050")).toContainText("Bandra West");
  });

  test("refuses a pincode the API could not hold before it is sent", async ({ page }) => {
    await open(page, "/settings/areas");
    const form = page.getByRole("group", { name: opsCopy.areas.add.title });
    await form.getByLabel(opsCopy.areas.add.pincode).fill("012345");
    await expect(form.getByRole("alert")).toHaveText(opsCopy.areas.add.badPincode);
    // The refusal is the box's own: a screen reader hears it with the box.
    await expect(form.getByLabel(opsCopy.areas.add.pincode)).toHaveAccessibleDescription(opsCopy.areas.add.badPincode);
    await expect(form.getByLabel(opsCopy.areas.add.pincode)).toHaveAttribute("aria-invalid", "true");
    await expect(form.getByRole("button", { name: opsCopy.areas.add.add })).toBeDisabled();
  });

  // A file without its served column switched every pincode in it off.
  test("refuses a file that leaves out one of its three columns", async ({ page }) => {
    await open(page, "/settings/areas");
    await upload(page, "pincode,launch_on\n110017,2026-09-01\n");
    await expect(page.getByRole("alert")).toContainText("Not the file from Download CSV");
    await expect(page.getByRole("button", { name: opsCopy.areas.served.upload.apply })).toHaveCount(0);
  });
});

// The days no visit is offered, which the runbook's SQL set before (docs/decisions/0088-every-policy-in-the-console.md).
test.describe("the blackout days", () => {
  /** The form that closes days, opened from the page's head. */
  async function closeDays(page: Page) {
    await page.getByRole("button", { name: settingsCopy.blackouts.formTitle }).click();
    return page.getByRole("dialog", { name: settingsCopy.blackouts.formTitle });
  }

  test("lists the days run together, why, who added them, and what is still booked on them", async ({ page }) => {
    await open(page, "/settings/closed-days");
    const diwali = page.getByRole("listitem").filter({ hasText: "Fri 29 Oct to Sat 30 Oct · Every city · Diwali" });
    await expect(diwali).toContainText("Closed by ops@maneman.in on 20 Sep 2027");
    await expect(diwali).toContainText("3 visits are still booked. Move them on the dispatch board.");
    // The way to those visits opens the board on the run's first day.
    await expect(diwali.getByRole("link", { name: "See Fri 29 Oct to Sat 30 Oct on the board" })).toHaveAttribute(
      "href",
      "/dispatch?from=2027-10-29",
    );
    const training = page.getByRole("listitem").filter({ hasText: "Mon 15 Nov · Every city · Staff training" });
    await expect(training).toContainText(settingsCopy.blackouts.unrecorded);
    await expect(training).not.toContainText("still booked");
    await expect(training.getByRole("link", { name: /on the board/ })).toHaveCount(0);
  });

  test("blacks out the days from the first to the last, with the reason, and shows the list the API answers", async ({
    page,
  }) => {
    const christmas = {
      date: "2027-12-24",
      city: null,
      reason: "Christmas",
      set_by: "ops@maneman.in",
      set_at: "2027-09-21T06:00:00.000Z",
      booked: 0,
    };
    const added = { ...BLACKOUTS, blackouts: [...BLACKOUTS.blackouts, christmas] };
    await open(page, "/settings/closed-days", { "POST /api/blackouts": json(added) });
    const form = await closeDays(page);
    await form.getByLabel(settingsCopy.blackouts.from, { exact: true }).fill("2027-12-24");
    await form.getByLabel(settingsCopy.blackouts.to, { exact: true }).fill("2027-12-24");
    await form.getByLabel(settingsCopy.blackouts.reason).fill("  Christmas ");
    const request = posted(page, "/api/blackouts");
    await form.getByRole("button", { name: settingsCopy.blackouts.add, exact: true }).click();
    expect((await request).postDataJSON()).toEqual({ from: "2027-12-24", to: "2027-12-24", reason: "Christmas" });
    await expect(form).toHaveCount(0);
    await expect(page.getByRole("listitem").filter({ hasText: "Fri 24 Dec · Every city · Christmas" })).toBeVisible();
  });

  test("closes the days in one city alone, and names it", async ({ page }) => {
    const holi = {
      date: "2028-03-10",
      city: "Gurgaon",
      reason: "Holi",
      set_by: "ops@maneman.in",
      set_at: "2027-09-21T06:00:00.000Z",
      booked: 0,
    };
    await open(page, "/settings/closed-days", {
      "POST /api/blackouts": json({ ...BLACKOUTS, blackouts: [...BLACKOUTS.blackouts, holi] }),
    });
    const form = await closeDays(page);
    await form.getByLabel(settingsCopy.blackouts.from, { exact: true }).fill("2028-03-10");
    await form.getByLabel(settingsCopy.blackouts.to, { exact: true }).fill("2028-03-10");
    await form.getByLabel(opsCopy.areas.add.city).selectOption("Gurgaon");
    await form.getByLabel(settingsCopy.blackouts.reason).fill("Holi");
    const request = posted(page, "/api/blackouts");
    await form.getByRole("button", { name: settingsCopy.blackouts.add, exact: true }).click();
    expect((await request).postDataJSON()).toEqual({
      from: "2028-03-10",
      to: "2028-03-10",
      city: "Gurgaon",
      reason: "Holi",
    });
    await expect(page.getByRole("listitem").filter({ hasText: "Fri 10 Mar · Gurgaon · Holi" })).toBeVisible();
  });

  test("counts the visits the days would strand beneath the boxes, before they are closed", async ({ page }) => {
    await open(page, "/settings/closed-days", { "GET /api/blackouts/booked": json({ booked: 2 }) });
    const form = await closeDays(page);
    await form.getByLabel(settingsCopy.blackouts.from, { exact: true }).fill("2027-10-29");
    await expect(form.getByText(settingsCopy.blackouts.stranded(2))).toHaveCount(0);
    await form.getByLabel(settingsCopy.blackouts.to, { exact: true }).fill("2027-10-30");
    await expect(form.getByText(settingsCopy.blackouts.stranded(2))).toBeVisible();
  });

  test("says why the API refused the days, of the box it refused", async ({ page }) => {
    await open(page, "/settings/closed-days", { "POST /api/blackouts": fails(400, "invalid_request", ["to"]) });
    const form = await closeDays(page);
    await form.getByLabel(settingsCopy.blackouts.from, { exact: true }).fill("2027-10-01");
    await form.getByLabel(settingsCopy.blackouts.to, { exact: true }).fill("2027-12-01");
    await form.getByLabel(settingsCopy.blackouts.reason).fill("Too long");
    await form.getByRole("button", { name: settingsCopy.blackouts.add, exact: true }).click();
    await expect(form.getByRole("alert")).toHaveText(settingsCopy.blackouts.errors.to);
  });

  // Review of #145, item 7: a run named only its first day's setter.
  test("names who added each run, keeping apart days added by someone else", async ({ page }) => {
    const later = {
      date: "2027-10-31",
      city: null,
      reason: "Diwali",
      set_by: "owner@maneman.in",
      set_at: "2027-09-21T06:00:00.000Z",
      booked: 0,
    };
    const split = {
      ...BLACKOUTS,
      blackouts: [...BLACKOUTS.blackouts.slice(0, 2), later, ...BLACKOUTS.blackouts.slice(2)],
    };
    await open(page, "/settings/closed-days", { "GET /api/blackouts": json(split) });
    await expect(
      page.getByRole("listitem").filter({ hasText: "Fri 29 Oct to Sat 30 Oct · Every city · Diwali" }),
    ).toContainText("Closed by ops@maneman.in on 20 Sep 2027");
    await expect(page.getByRole("listitem").filter({ hasText: "Sun 31 Oct · Every city · Diwali" })).toContainText(
      "Closed by owner@maneman.in on 21 Sep 2027",
    );
  });

  test("offers a run of days again, the whole run once asked", async ({ page }) => {
    const left = { ...BLACKOUTS, blackouts: BLACKOUTS.blackouts.slice(2) };
    await open(page, "/settings/closed-days", { "POST /api/blackouts/remove": json(left) });
    const request = posted(page, "/api/blackouts/remove");
    await page.getByRole("button", { name: "Reopen Fri 29 Oct to Sat 30 Oct" }).click();
    await expect(page.getByText("Reopen Fri 29 Oct to Sat 30 Oct?")).toBeVisible();
    await page.getByRole("button", { name: settingsCopy.blackouts.reopening.confirm, exact: true }).click();
    expect((await request).postDataJSON()).toEqual({ from: "2027-10-29", to: "2027-10-30" });
    await expect(page.getByRole("listitem").filter({ hasText: "Diwali" })).toHaveCount(0);
    await expect(page.getByRole("listitem").filter({ hasText: "Staff training" })).toBeVisible();
  });
});
