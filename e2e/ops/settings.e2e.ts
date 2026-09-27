// Settings: the business inputs ops set for themselves
// (docs/decisions/0061-ops-editable-inputs.md). Three panels, and the thing
// each one has to get right is the same: say the unit and the bounds before
// anything is typed, show a change that cannot quietly be taken back before it
// is made (docs/decisions/0071-what-ops-see-before-a-setting-changes.md), and
// say what went wrong, of the box it went wrong in, when a figure is refused.
//
// The refusals are the API's own shape: invalid_request, with the fields it
// names (src/http/errors.ts).

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { answer, fails, json, PRICES, SERVICE_AREA, SETTINGS, type Answers } from "./fixtures.ts";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const ROUTES: Answers = {
  "GET /api/settings": json(SETTINGS),
  "GET /api/prices": json(PRICES),
  "GET /api/service-area": json(SERVICE_AREA),
};

async function open(page: Page, path = "/settings", extra: Answers = {}): Promise<void> {
  await answer(page, { ...ROUTES, ...extra });
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
}

const posted = (page: Page, path: string) =>
  page.waitForRequest((request) => request.url().endsWith(path) && request.method() === "POST");

test.describe("the rules", () => {
  test("shows each rule with its unit and what it may be, before anything is typed", async ({ page }) => {
    await open(page);
    const radius = page.getByRole("group", { name: "Check-in radius" });
    await expect(radius.getByLabel("Check-in radius")).toHaveValue("200");
    await expect(radius).toContainText("metres");
    await expect(radius).toContainText("50 to 1000 metres, a whole number");
  });

  // OPS-19 of the audit, 24 September 2026: ops were shown "src/policy/check-in.ts".
  test("says who set a rule, and says when nobody has, without a word of the code", async ({ page }) => {
    await open(page);
    await expect(page.getByText("Set by ops@maneman.in on 20 Sep 2027")).toBeVisible();
    await expect(page.getByText("Nobody has set this, so the standard figure stands.").first()).toBeVisible();
    await expect(page.getByRole("main")).not.toContainText("src/");
  });

  test("names each box of a keyed rule as the rest of the console names it", async ({ page }) => {
    await open(page);
    const wait = page.getByRole("group", { name: "No-show wait" });
    await expect(wait.getByLabel("First fit", { exact: true })).toHaveValue("20");
    await expect(wait.getByLabel("Service visit", { exact: true })).toHaveValue("15");
    await expect(wait).not.toContainText("first_fit");
  });

  test("shows the old figure beside the new before it sends it, and says it saved", async ({ page }) => {
    let sent = 0;
    await open(page, "/settings", {
      "POST /api/settings/checkin_radius_m": (route) => {
        sent += 1;
        return json({
          ...SETTINGS.settings[0],
          value: 150,
          set_by: "ops@maneman.in",
          set_at: "2027-09-21T06:00:00.000Z",
        })(route);
      },
    });
    await page.getByLabel("Check-in radius").fill("150");
    await page.getByRole("button", { name: "Save" }).first().click();

    // ADR 0071's rule for a price, followed for a rule (docs/decisions/0086-the-next-visit-is-offered.md).
    const check = page.getByRole("group", { name: "Check the change" });
    await expect(check).toBeFocused();
    await expect(check).toContainText("Check-in radius: 200 metres → 150 metres.");
    expect(sent).toBe(0);

    const request = posted(page, "/api/settings/checkin_radius_m");
    await check.getByRole("button", { name: "Save" }).click();
    expect((await request).postDataJSON()).toEqual({ value: 150 });
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
  });

  test("goes back to the figures without sending when the change is not the one meant", async ({ page }) => {
    await open(page);
    await page.getByLabel("Check-in radius").fill("150");
    await page.getByRole("button", { name: "Save" }).first().click();
    await page.getByRole("group", { name: "Check the change" }).getByRole("button", { name: "Change it" }).click();
    await expect(page.getByRole("group", { name: "Check the change" })).toHaveCount(0);
    await expect(page.getByLabel("Check-in radius")).toHaveValue("150");
  });

  test("will not send an empty box, which would read as nought, nor a figure that has not changed", async ({
    page,
  }) => {
    await open(page);
    const save = page
      .getByRole("listitem")
      .filter({ has: page.getByLabel("Check-in radius") })
      .getByRole("button", {
        name: "Save",
      });
    await expect(save).toBeDisabled();
    await page.getByLabel("Check-in radius").fill("");
    await expect(save).toBeDisabled();
  });

  // FEO-06: the refusal named its field and the console dropped it, so every refusal read the same.
  test("names the box the API refused", async ({ page }) => {
    await open(page, "/settings", {
      "POST /api/settings/no_show_wait_min": fails(400, "invalid_request", ["no_show_wait_min.first_fit"]),
    });
    const wait = page.getByRole("group", { name: "No-show wait" });
    await wait.getByLabel("First fit", { exact: true }).fill("90");
    await page.getByRole("listitem").filter({ has: wait }).getByRole("button", { name: "Save" }).click();
    await page.getByRole("group", { name: "Check the change" }).getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("alert")).toHaveText(
      "First fit is outside what this rule allows. Nothing was changed.",
    );
  });

  // One input for the next visit's days, each box with its own range (docs/decisions/0086-the-next-visit-is-offered.md).
  test("gives each of the next visit's days its own box and range, and sends the one changed", async ({ page }) => {
    await open(page, "/settings", {
      "POST /api/settings/booking_days": (route) => {
        const days = SETTINGS.settings.find((rule) => rule.name === "booking_days");
        const { value } = route.request().postDataJSON() as { value: unknown };
        return json({ ...days, value, set_by: "ops@maneman.in" })(route);
      },
    });
    const days = page.getByRole("group", { name: "Booking and the next visit" });
    await expect(days.getByLabel("Between service visits")).toHaveValue("30");
    await expect(days).toContainText("14 to 90 days, a whole number");
    await expect(days.getByLabel("From a consultation to the first fit")).toHaveValue("0");
    await expect(days).toContainText("0 to 30 days, a whole number");
    await expect(days.getByLabel("How far ahead a visit may be booked")).toHaveValue("45");
    await expect(days).not.toContainText("service_cadence");

    // A horizon shorter than the fortnight the strip shows is not offered.
    const rule = page.getByRole("listitem").filter({ has: days });
    await days.getByLabel("How far ahead a visit may be booked").fill("10");
    await expect(rule.getByRole("button", { name: "Save" })).toBeDisabled();
    await days.getByLabel("How far ahead a visit may be booked").fill("45");

    await days.getByLabel("Between service visits").fill("28");
    await rule.getByRole("button", { name: "Save" }).click();
    const check = page.getByRole("group", { name: "Check the change" });
    await expect(check.getByRole("listitem")).toHaveText(["Between service visits: 30 days → 28 days."]);
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);

    const request = posted(page, "/api/settings/booking_days");
    await check.getByRole("button", { name: "Save" }).click();
    expect((await request).postDataJSON()).toEqual({
      value: {
        first_fit_lead: 0,
        service_cadence: 28,
        reminder_before_due: 7,
        at_risk_after_due: 7,
        first_fit_to_book: 7,
        horizon: 45,
        invoice_prompt: 14,
      },
    });
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
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
});

test.describe("the price book", () => {
  test("marks the price in force, and the one still to come, in words", async ({ page }) => {
    await open(page, "/settings/prices");
    const inForce = page.getByRole("row").filter({ hasText: "Rs. 2,000" });
    await expect(inForce).toContainText("Service visit");
    await expect(inForce).toContainText("In force");
    const scheduled = page.getByRole("row").filter({ hasText: "Rs. 2,500" });
    await expect(scheduled).toContainText("To come");
    await expect(scheduled).toContainText("1 Oct 2027");
  });

  // OPS-15: GST opened at nought and the amount blank, whatever the item, so an 18% item was saved GST-free.
  test("starts the form from the price in force for the item and tier chosen, its GST included", async ({ page }) => {
    await open(page, "/settings/prices");
    await page.getByLabel("Item").selectOption({ label: "Service visit" });
    await expect(page.getByLabel("Price before GST, in rupees")).toHaveValue("2000");
    await expect(page.getByLabel("GST", { exact: true })).toHaveValue("18");
    await expect(page.getByText("Now Rs. 2,000 + 18% GST, since 22 Sep 2026.")).toBeVisible();
  });

  test("offers the tiers the book holds, and a new one by name", async ({ page }) => {
    await open(page, "/settings/prices");
    const tier = page.getByLabel("Tier", { exact: true });
    await expect(tier.getByRole("option")).toHaveText(["standard", "A new tier"]);
    await tier.selectOption({ label: "A new tier" });
    await expect(page.getByLabel("The new tier's name")).toBeVisible();
    await expect(page.getByText("Nothing is priced for this tier yet.")).toBeVisible();
  });

  test("shows the old price beside the new, and GST changing, before anything is sent", async ({ page }) => {
    let sent = 0;
    await open(page, "/settings/prices", {
      "POST /api/prices": (route) => {
        sent += 1;
        return json({ prices: PRICES.prices })(route);
      },
    });
    await page.getByLabel("Item").selectOption({ label: "Service visit" });
    await page.getByLabel("Price before GST, in rupees").fill("2500");
    await page.getByLabel("GST", { exact: true }).fill("0");
    await page.getByLabel("Applies from").fill("2027-11-01");
    await page.getByRole("button", { name: "Set this price" }).click();

    const check = page.getByRole("group", { name: "Check the change" });
    await expect(check).toBeFocused();
    await expect(check).toContainText(
      "Service visit, standard: Rs. 2,000 + 18% GST → Rs. 2,500 + 0% GST, from 1 Nov 2027.",
    );
    await expect(check).toContainText("GST changes from 18% to 0%.");
    expect(sent).toBe(0);

    const request = posted(page, "/api/prices");
    await check.getByRole("button", { name: "Set this price" }).click();
    expect((await request).postDataJSON()).toEqual({
      item: "service",
      tier: "standard",
      amount_ex_gst: 250_000,
      gst_percent: 0,
      valid_from: "2027-11-01",
    });
    await expect(page.getByRole("status").filter({ hasText: "The price is set." })).toBeVisible();
  });

  test("goes back to the form without sending when the change is not the one meant", async ({ page }) => {
    await open(page, "/settings/prices");
    await page.getByRole("button", { name: "Set this price" }).click();
    await page.getByRole("button", { name: "Change it" }).click();
    await expect(page.getByRole("group", { name: "Check the change" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Set this price" })).toBeEnabled();
  });

  test("says a price cannot be back-dated when the API refuses the date", async ({ page }) => {
    await open(page, "/settings/prices", {
      "POST /api/prices": fails(400, "invalid_request", ["valid_from"]),
    });
    await page.getByRole("button", { name: "Set this price" }).click();
    await page.getByRole("group", { name: "Check the change" }).getByRole("button", { name: "Set this price" }).click();
    await expect(page.getByRole("alert")).toContainText("applies from today or a day after it");
  });

  test("takes back a price still to come, once asked", async ({ page }) => {
    const left = PRICES.prices.filter((price) => price.valid_from !== "2027-10-01");
    await open(page, "/settings/prices", { "POST /api/prices/withdraw": json({ prices: left }) });
    await page.getByRole("button", { name: "Take back the Service visit price from 1 Oct 2027" }).click();
    const asked = page.getByRole("group", { name: /Take back the price from 1 Oct 2027/ });
    await expect(asked).toBeFocused();

    const request = posted(page, "/api/prices/withdraw");
    await asked.getByRole("button", { name: "Take it back" }).click();
    expect((await request).postDataJSON()).toEqual({ item: "service", tier: "standard", valid_from: "2027-10-01" });
    await expect(page.getByRole("row").filter({ hasText: "Rs. 2,500" })).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: "The price is taken back." })).toBeVisible();
  });

  test("offers no way to take back the price in force or a spent one", async ({ page }) => {
    await open(page, "/settings/prices");
    await expect(page.getByRole("button", { name: /^Take back/ })).toHaveCount(1);
  });
});

test.describe("the service area", () => {
  const area = (page: Page, pincode: string) => page.getByRole("textbox", { name: `Area name for ${pincode}` });

  test("lists one city at a time, since 198 pincodes is not a page", async ({ page }) => {
    await open(page, "/settings/area");
    await expect(page.getByRole("button", { name: "Delhi · 1 of 2" })).toBeVisible();
    await expect(area(page, "110017")).toHaveValue("Saket");
    // Gurgaon's pincode is not drawn until its city is chosen.
    await expect(area(page, "122018")).toHaveCount(0);

    await page.getByRole("button", { name: "Gurgaon · 0 of 1" }).click();
    await expect(area(page, "122018")).toHaveValue("Sec65");
  });

  test("sends only the pincodes that changed", async ({ page }) => {
    await open(page, "/settings/area", {
      "POST /api/service-area": json({ changed: 1, served: 1, alerted: 0 }),
    });
    await expect(page.getByRole("button", { name: "Save these pincodes" })).toBeDisabled();
    await page.getByLabel("Launch date for 110017").fill("2026-09-02");

    const sent = posted(page, "/api/service-area");
    await page.getByRole("button", { name: "Save these pincodes" }).click();
    expect((await sent).postDataJSON()).toEqual({
      changes: [{ pincode: "110017", served: true, launch_on: "2026-09-02" }],
    });
    await expect(page.getByRole("status").filter({ hasText: "One pincode changed." })).toBeVisible();
  });

  // OPS-13: launch messages read "we now come to Sec91", with no way to say it better.
  test("sends a better name for an area, and refuses one a spreadsheet would run", async ({ page }) => {
    await open(page, "/settings/area", {
      "POST /api/service-area": json({ changed: 1, served: 1, alerted: 0 }),
    });
    await page.getByRole("button", { name: "Gurgaon · 0 of 1" }).click();
    await area(page, "122018").fill("=Sector 65");
    await expect(page.getByRole("alert")).toContainText("122018: an area's name starts with a letter or a digit");
    await expect(page.getByRole("button", { name: "Save these pincodes" })).toBeDisabled();

    await area(page, "122018").fill("Sector 65 ");
    const sent = posted(page, "/api/service-area");
    await page.getByRole("button", { name: "Save these pincodes" }).click();
    expect((await sent).postDataJSON()).toEqual({
      changes: [{ pincode: "122018", served: false, launch_on: null, area: "Sector 65" }],
    });
  });

  test("fills a whole city in one press", async ({ page }) => {
    await open(page, "/settings/area");
    await page.getByRole("button", { name: "Serve all of Delhi" }).click();
    await expect(page.getByRole("button", { name: "Delhi · 2 of 2" })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Served 110024" })).toBeChecked();
  });

  // FEO-02: serving a pincode here sent none of the launch alerts the waitlist's launch sends.
  test("says who serving a pincode will message, and messages them only once ops agree", async ({ page }) => {
    await open(page, "/settings/area", {
      "POST /api/service-area": json({ changed: 1, served: 2, alerted: 3 }),
    });
    await page.getByRole("checkbox", { name: "Served 110024" }).check();
    await page.getByRole("button", { name: "Save these pincodes" }).click();

    const check = page.getByRole("group", { name: "This messages 3 people" });
    await expect(check).toBeFocused();
    await expect(check).toContainText("110024, Lajpat Nagar: 3 waiting ask to be told.");

    const sent = posted(page, "/api/service-area");
    await check.getByRole("button", { name: "Save and message 3" }).click();
    expect((await sent).postDataJSON()).toEqual({
      changes: [{ pincode: "110024", served: true, launch_on: null }],
    });
    await expect(page.getByRole("status").filter({ hasText: "3 people are being told on WhatsApp." })).toBeVisible();
  });

  test("says so when a change would leave nowhere served", async ({ page }) => {
    await open(page, "/settings/area", {
      "POST /api/service-area": fails(400, "no_service_area"),
    });
    await page.getByRole("checkbox", { name: "Served 110017" }).uncheck();
    await page.getByRole("button", { name: "Save these pincodes" }).click();
    await expect(page.getByRole("alert")).toContainText("leave no pincode served");
  });

  const upload = (page: Page, csv: string) =>
    page.getByLabel("The CSV you have edited").setInputFiles({
      name: "service-area.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });

  // FEO-01: the table kept the old values after an upload, and the next Save put them back.
  test("puts a file's changes in the table, so the one Save sends the file's values", async ({ page }) => {
    await open(page, "/settings/area", {
      "POST /api/service-area": json({ changed: 1, served: 2, alerted: 0 }),
    });
    await upload(page, "pincode,served,launch_on\n110017,yes,2026-09-01\n110024,no,2026-11-01\n");
    const preview = page.getByRole("row").filter({ hasText: "110024" }).last();
    await expect(preview).toContainText("Not served");
    await expect(preview).toContainText("Not served, launch 2026-11-01");
    await page.getByRole("button", { name: "Put these in the table" }).click();
    await expect(page.getByLabel("Launch date for 110024")).toHaveValue("2026-11-01");

    const sent = posted(page, "/api/service-area");
    await page.getByRole("button", { name: "Save these pincodes" }).click();
    expect((await sent).postDataJSON()).toEqual({
      changes: [{ pincode: "110024", served: false, launch_on: "2026-11-01" }],
    });
    await expect(page.getByLabel("Launch date for 110024")).toHaveValue("2026-11-01");
    await expect(page.getByRole("button", { name: "Save these pincodes" })).toBeDisabled();
  });

  // FEO-03: a file without its served column switched every pincode in it off.
  test("refuses a file that leaves out one of its three columns", async ({ page }) => {
    await open(page, "/settings/area");
    await upload(page, "pincode,launch_on\n110017,2026-09-01\n");
    await expect(page.getByRole("alert")).toContainText("needs a pincode, a served and a launch_on column");
    await expect(page.getByRole("button", { name: "Put these in the table" })).toHaveCount(0);
  });
});

// FEO-33 and VIS-21: the fields ran past the panel and cut "consultation" and the date's year.
test("keeps every panel inside its frame, at the width the console is drawn", async ({ page }) => {
  for (const path of ["/settings", "/settings/prices", "/settings/area"]) {
    await open(page, path);
    const overflow = await page.getByRole("main").evaluate((main) =>
      [...main.querySelectorAll("section, table, input, select")]
        .filter((element) => {
          const box = element.getBoundingClientRect();
          const panel = element.closest("section")?.getBoundingClientRect() ?? main.getBoundingClientRect();
          return box.right > panel.right + 1 || element.scrollWidth > element.clientWidth + 1;
        })
        .map((element) => element.id || element.tagName),
    );
    expect(overflow, path).toEqual([]);
  }
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
