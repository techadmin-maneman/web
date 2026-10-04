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
import type { Page, Route } from "@playwright/test";
import { expect, test } from "../support.ts";
import {
  answer,
  BLACKOUTS,
  DISCOUNT_CODES,
  empty,
  fails,
  json,
  PRICE_ROWS,
  SERVICE_AREA,
  SERVICES,
  SETTINGS,
  type Answers,
} from "./fixtures.ts";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const ROUTES: Answers = {
  "GET /api/settings": json(SETTINGS),
  "GET /api/services": json(SERVICES),
  "GET /api/service-area": json(SERVICE_AREA),
  "GET /api/blackouts": json(BLACKOUTS),
  "GET /api/discount-codes": json(DISCOUNT_CODES),
};

const PANELS = ["/settings", "/prices", "/discount-codes", "/areas/served", "/settings/blackouts"];

/** The panels that were tabs of Settings and are now in sections of their own departments, by their headings. */
const OWN_SECTIONS: Readonly<Record<string, string>> = {
  "/prices": "Prices",
  "/discount-codes": "Discount codes",
  "/areas/served": "Areas",
};

async function open(page: Page, path = "/settings", extra: Answers = {}): Promise<void> {
  await answer(page, { ...ROUTES, ...extra });
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: OWN_SECTIONS[path] ?? "Settings" })).toBeVisible();
}

const posted = (page: Page, path: string) =>
  page.waitForRequest((request) => request.url().endsWith(path) && request.method() === "POST");

/** One subject's section of the rules, by its heading. */
const section = (page: Page, name: string) => page.getByRole("region", { name, exact: true });

type FixtureRule = (typeof SETTINGS.settings)[number];

function ruleNamed(name: string): FixtureRule {
  const rule = SETTINGS.settings.find((each) => each.name === name);
  if (rule === undefined) throw new Error(`The fixture has no rule ${name}`);
  return rule;
}

// The storage meter (docs/decisions/0093-the-storage-meter.md). OIA-12: it headed every tab of Settings.
test("says what photos and referral cards hold, and the database, under The console and nowhere else", async ({
  page,
}) => {
  const storage = json({
    held_bytes: 1_240_000_000,
    share_bytes: 4e9,
    ceiling_bytes: 20e9,
    database_bytes: 212_000_000,
    database_limit_bytes: 500e6,
  });
  await open(page, "/settings", { "GET /api/storage": storage });
  const theConsole = page.getByRole("region", { name: "The console", exact: true });
  await expect(theConsole.getByText("Photos and referral cards: 1.24 GB of 4 GB", { exact: true })).toBeVisible();
  await expect(theConsole.getByText("Database: 212 MB of 500 MB", { exact: true })).toBeVisible();

  await open(page, "/settings/blackouts", { "GET /api/storage": storage });
  await expect(page.getByRole("heading", { name: "Blackout days" })).toBeVisible();
  await expect(page.getByText("Photos and referral cards")).toHaveCount(0);
});

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

  // OIA-21 and CP-28: an hour read "18 hour of the day, in India", and a token's setter its 40-character ID.
  test("shows an hour of the day as a clock, and a service token as one", async ({ page }) => {
    const reminders = {
      ...ruleNamed("checkin_radius_m"),
      name: "reminder_hour",
      title: "When reminders go",
      note: "When the WhatsApp reminders of tomorrow's visit go.",
      unit: "hour of the day, in India",
      min: 8,
      max: 21,
      value: 18,
      default: 18,
      set_by: "5ef59a45a8ca607281f5b3ae02bf8103.access",
      set_at: "2027-09-20T06:00:00.000Z",
    };
    await open(page, "/settings", { "GET /api/settings": json({ settings: [reminders] }) });
    const rule = page.getByRole("main");
    await expect(rule.getByText("6 pm", { exact: true })).toBeVisible();
    await expect(rule.getByText("An hour from 8 am to 9 pm, typed on a 24-hour clock")).toBeVisible();
    await page.getByLabel("When reminders go").fill("9");
    await expect(rule.getByText("9 am", { exact: true })).toBeVisible();
    await expect(rule.getByText("Set by a service token on 20 Sep 2027")).toBeVisible();
    await expect(rule).not.toContainText(".access");
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
    await section(page, "Visits in the field").getByRole("button", { name: "Save" }).click();

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
    await section(page, "Visits in the field").getByRole("button", { name: "Save" }).click();
    await page.getByRole("group", { name: "Check the change" }).getByRole("button", { name: "Change it" }).click();
    await expect(page.getByRole("group", { name: "Check the change" })).toHaveCount(0);
    await expect(page.getByLabel("Check-in radius")).toHaveValue("150");
  });

  test("will not send an empty box, which would read as nought, nor a figure that has not changed", async ({
    page,
  }) => {
    await open(page);
    const save = section(page, "Visits in the field").getByRole("button", { name: "Save" });
    await expect(save).toBeDisabled();
    await page.getByLabel("Check-in radius").fill("");
    await expect(save).toBeDisabled();
    // A change elsewhere in the section is not sent while a box holds what its rule cannot take.
    await page.getByRole("group", { name: "No-show wait" }).getByLabel("First fit", { exact: true }).fill("25");
    await expect(save).toBeDisabled();
  });

  // FEO-06: the refusal named its field and the console dropped it, so every refusal read the same.
  test("names the box the API refused", async ({ page }) => {
    await open(page, "/settings", {
      "POST /api/settings/no_show_wait_min": fails(400, "invalid_request", ["no_show_wait_min.first_fit"]),
    });
    const wait = page.getByRole("group", { name: "No-show wait" });
    await wait.getByLabel("First fit", { exact: true }).fill("90");
    await section(page, "Visits in the field").getByRole("button", { name: "Save" }).click();
    await page.getByRole("group", { name: "Check the change" }).getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("listitem").filter({ has: wait }).getByRole("alert")).toHaveText(
      "First fit is outside what this rule allows, so it was not saved.",
    );
  });

  // OIA-12 of the audit, 2 October 2026: seventeen rules on one page, each with its own Save, in no order.
  test("groups the rules by subject, each section a link away", async ({ page }) => {
    await open(page);
    const jump = page.getByRole("navigation", { name: "Rules by subject" });
    await expect(jump.getByRole("link")).toHaveText([
      "Moves, cancels and no-shows",
      "Booking and payment",
      "Visits in the field",
      "Reminders and replacements",
      "Referrals",
      "The console",
    ]);
    const field = section(page, "Visits in the field");
    await expect(field.getByRole("group")).toHaveText([
      /^Check-in radius/,
      /^No-show wait/,
      /^How far a phone is trusted about time/,
    ]);
    await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(6);

    await jump.getByRole("link", { name: "Referrals" }).click();
    await expect(page).toHaveURL(/\/settings#referrals$/);
    await expect(section(page, "Referrals")).toBeInViewport();
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  test("sends a section's changes with one Save, after showing every figure that moves", async ({ page }) => {
    const sent: string[] = [];
    const saved = (rule: FixtureRule) => (route: Route) => {
      sent.push(rule.name);
      const { value } = route.request().postDataJSON() as { value: unknown };
      return json({ ...rule, value, set_by: "ops@maneman.in", set_at: "2027-09-21T06:00:00.000Z" })(route);
    };
    await open(page, "/settings", {
      "POST /api/settings/checkin_radius_m": saved(ruleNamed("checkin_radius_m")),
      "POST /api/settings/no_show_wait_min": saved(ruleNamed("no_show_wait_min")),
    });
    await page.getByLabel("Check-in radius").fill("150");
    await page.getByRole("group", { name: "No-show wait" }).getByLabel("Service visit", { exact: true }).fill("20");
    await section(page, "Visits in the field").getByRole("button", { name: "Save" }).click();

    const check = page.getByRole("group", { name: "Check the change" });
    await expect(check.getByRole("listitem")).toHaveText([
      "Check-in radius: 200 metres → 150 metres.",
      "No-show wait · Service visit: 15 minutes → 20 minutes.",
    ]);
    expect(sent).toEqual([]);
    await check.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
    expect(sent).toEqual(["checkin_radius_m", "no_show_wait_min"]);
    await expect(section(page, "Visits in the field").getByRole("button", { name: "Save" })).toBeDisabled();
  });

  test("says which rule was refused when one of a section's changes is, and keeps the one that saved", async ({
    page,
  }) => {
    const radius = ruleNamed("checkin_radius_m");
    await open(page, "/settings", {
      "POST /api/settings/checkin_radius_m": json({
        ...radius,
        value: 150,
        set_by: "ops@maneman.in",
        set_at: "2027-09-21T06:00:00.000Z",
      }),
      "POST /api/settings/no_show_wait_min": fails(400, "invalid_request", ["no_show_wait_min.service"]),
    });
    await page.getByLabel("Check-in radius").fill("150");
    const wait = page.getByRole("group", { name: "No-show wait" });
    await wait.getByLabel("Service visit", { exact: true }).fill("20");
    await section(page, "Visits in the field").getByRole("button", { name: "Save" }).click();
    await page.getByRole("group", { name: "Check the change" }).getByRole("button", { name: "Save" }).click();

    await expect(page.getByRole("listitem").filter({ has: wait }).getByRole("alert")).toHaveText(
      "Service visit is outside what this rule allows, so it was not saved.",
    );
    const radiusItem = page.getByRole("listitem").filter({ has: page.getByLabel("Check-in radius") });
    await expect(radiusItem).toContainText("Set by ops@maneman.in on 21 Sep 2027");
    await expect(radiusItem.getByRole("alert")).toHaveCount(0);
  });

  test("links each late-fee rule to Prices, and Prices back to the rule", async ({ page }) => {
    await open(page);
    const charges = page.getByRole("listitem").filter({ has: page.getByRole("group", { name: "What a late move" }) });
    await expect(charges.getByRole("link", { name: "Late fees are set in Prices" })).toHaveAttribute("href", "/prices");

    await open(page, "/prices");
    const fee = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("heading", { name: "Late fee on a first fit", exact: true }) });
    await fee.getByRole("link", { name: "Set when it applies" }).click();
    await expect(page).toHaveURL(/\/settings#late_change_charge$/);
    const rule = page.getByRole("listitem").filter({ has: page.getByRole("group", { name: "What a late move" }) });
    await expect(rule).toBeFocused();
    await expect(rule).toBeInViewport();
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
    const booking = section(page, "Booking and payment");
    await days.getByLabel("How far ahead a visit may be booked").fill("10");
    await expect(booking.getByRole("button", { name: "Save" })).toBeDisabled();
    await days.getByLabel("How far ahead a visit may be booked").fill("45");

    await days.getByLabel("Between service visits").fill("28");
    await booking.getByRole("button", { name: "Save" }).click();
    const check = page.getByRole("group", { name: "Check the change" });
    await expect(check.getByRole("listitem")).toHaveText([
      "Booking and the next visit · Between service visits: 30 days → 28 days.",
    ]);
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
        replacement_order_lead: 30,
      },
    });
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
  });

  // The owner's ruling of 1 October 2026: each side's visits, and how long they last
  // (docs/decisions/0107-referral-rewards-in-the-console.md).
  test("sets what a referral earns each side, nothing for one, after showing the change", async ({ page }) => {
    await open(page, "/settings", {
      "POST /api/settings/referral_reward": (route) => {
        const reward = SETTINGS.settings.find((rule) => rule.name === "referral_reward");
        const { value } = route.request().postDataJSON() as { value: unknown };
        return json({ ...reward, value, set_by: "ops@maneman.in" })(route);
      },
    });
    const reward = page.getByRole("group", { name: "What a referral earns" });
    await expect(reward.getByLabel("The client who sent the invite")).toHaveValue("3");
    await expect(reward.getByLabel("The friend they invited")).toHaveValue("3");
    await expect(reward.getByLabel("The free service visits last")).toHaveValue("365");
    await expect(reward).toContainText("0 to 12 service visits, a whole number");
    await expect(reward).toContainText("30 to 1095 days, a whole number");

    await reward.getByLabel("The client who sent the invite").fill("2");
    await reward.getByLabel("The friend they invited").fill("0");
    await section(page, "Referrals").getByRole("button", { name: "Save" }).click();
    const check = page.getByRole("group", { name: "Check the change" });
    await expect(check.getByRole("listitem")).toHaveText([
      "What a referral earns · The client who sent the invite: 3 service visits → 2 service visits.",
      "What a referral earns · The friend they invited: 3 service visits → 0 service visits.",
    ]);

    const request = posted(page, "/api/settings/referral_reward");
    await check.getByRole("button", { name: "Save" }).click();
    expect((await request).postDataJSON()).toEqual({
      value: { referrer_visits: 2, friend_visits: 0, valid_days: 365 },
    });
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
  });

  // Every figure a rule of the code held is ops' now (docs/decisions/0088-every-policy-in-the-console.md).
  test("says each box's own unit where a rule's figures count in two", async ({ page }) => {
    await open(page);
    const clock = page.getByRole("group", { name: "How far a phone is trusted about time" });
    await expect(clock.getByLabel("Earliest check-in, before the booked start")).toHaveValue("60");
    await expect(clock).toContainText("0 to 240 minutes, a whole number");
    await expect(clock.getByLabel("Longest a phone may stay offline")).toHaveValue("24");
    await expect(clock).toContainText("1 to 72 hours, a whole number");
  });

  test("offers each kind of visit only what it may cost, in the console's words, and sends the one chosen", async ({
    page,
  }) => {
    await open(page, "/settings", {
      "POST /api/settings/late_change_charge": (route) => {
        const charges = SETTINGS.settings.find((rule) => rule.name === "late_change_charge");
        const { value } = route.request().postDataJSON() as { value: unknown };
        return json({ ...charges, value, set_by: "ops@maneman.in", set_at: "2027-09-21T06:00:00.000Z" })(route);
      },
    });
    const charges = page.getByRole("group", { name: "What a late move or cancel costs" });
    const service = charges.getByLabel("Service visit", { exact: true });
    await expect(service).toHaveValue("visit");
    await expect(service.locator("option")).toHaveText(["Nothing", "The visit itself"]);
    await expect(charges.getByLabel("First fit", { exact: true }).locator("option")).toHaveText([
      "Nothing",
      "Its late fee",
      "The visit itself",
    ]);

    await service.selectOption("nothing");
    await section(page, "Moves, cancels and no-shows").getByRole("button", { name: "Save" }).click();
    const check = page.getByRole("group", { name: "Check the change" });
    await expect(check).toContainText("What a late move or cancel costs · Service visit: The visit itself → Nothing.");
    const request = posted(page, "/api/settings/late_change_charge");
    await check.getByRole("button", { name: "Save" }).click();
    expect((await request).postDataJSON()).toEqual({
      value: { consultation: "nothing", first_fit: "late_fee", service: "nothing", replacement: "late_fee" },
    });
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
  });

  test("offers a base of its own on the open rule, and none where the keys are fixed", async ({ page }) => {
    await open(page);
    await expect(
      page.getByRole("group", { name: "Replacement cycle" }).getByLabel("Base, exactly as the technician records it"),
    ).toBeVisible();
    await expect(
      page.getByRole("group", { name: "No-show wait" }).getByLabel("Base, exactly as the technician records it"),
    ).toHaveCount(0);
  });
});

// The services clients book, kind by kind, each with its prices (docs/decisions/0085-services-ops-can-edit.md). A
// price is still a row from its day, shown in force, to come and spent; a service is added, renamed, timed, retired,
// restored and moved, and every change shows what it was beside what it will be before it is sent.
test.describe("the services and their prices", () => {
  const block = (page: Page, name: string) =>
    page.getByRole("listitem").filter({ has: page.getByRole("heading", { name, exact: true }) });

  test("lists each kind's services with their length, and whether they are offered", async ({ page }) => {
    await open(page, "/prices");
    for (const kind of ["Consultation", "First fit", "Service visit", "Replacement"]) {
      await expect(page.getByRole("heading", { level: 3, name: kind, exact: true })).toBeVisible();
    }
    await expect(block(page, "Service visit")).toContainText("90 minutes · code standard · Offered");
    await expect(block(page, "Premium")).toContainText("240 minutes · code premium");
    await expect(block(page, "Lace replacement")).toContainText("Retired from 1 Sep 2027");
  });

  test("marks the price in force, and the one still to come, in words, and folds the spent ones away", async ({
    page,
  }) => {
    await open(page, "/prices");
    const visit = block(page, "Service visit");
    await expect(visit).toContainText("Now Rs. 2,000 + 18% GST, since 22 Sep 2026.");
    await expect(visit).toContainText("Rs. 2,500 + 18% GST from 1 Oct 2027");
    await expect(visit.getByRole("row").filter({ hasText: "Rs. 1,500" })).toBeHidden();
    await visit.getByText("1 earlier price").click();
    await expect(visit.getByRole("row").filter({ hasText: "Rs. 1,500" })).toContainText("1 Jan 2026");
  });

  // OPS-15: GST opened at nought and the amount blank, whatever the item, so an 18% item was saved GST-free.
  test("starts a new price from the price in force, its GST included", async ({ page }) => {
    await open(page, "/prices");
    await page.getByRole("button", { name: "Change the price of Service visit" }).click();
    await expect(page.getByLabel("Price before GST, in rupees")).toHaveValue("2000");
    await expect(page.getByLabel("GST", { exact: true })).toHaveValue("18");
  });

  // MON-34: a new price once started from today, and changed what clients had been quoted that day.
  test("starts a new price from tomorrow, and offers no earlier day", async ({ page }) => {
    await open(page, "/prices");
    await page.getByRole("button", { name: "Change the price of Service visit" }).click();
    const from = page.getByLabel("Applies from");
    await expect(from).toHaveValue("2027-09-22");
    await expect(from).toHaveAttribute("min", "2027-09-22");
  });

  test("shows the old price beside the new, and GST changing, before anything is sent", async ({ page }) => {
    let sent = 0;
    await open(page, "/prices", {
      "POST /api/prices": (route) => {
        sent += 1;
        return json({ prices: PRICE_ROWS })(route);
      },
    });
    await page.getByRole("button", { name: "Change the price of Service visit" }).click();
    await page.getByLabel("Price before GST, in rupees").fill("2500");
    await page.getByLabel("GST", { exact: true }).fill("0");
    await page.getByLabel("Applies from").fill("2027-11-01");
    await page.getByRole("button", { name: "Check the change" }).click();

    const check = page.getByRole("group", { name: "Check the change" });
    await expect(check).toBeFocused();
    await expect(check).toContainText("Service visit: Rs. 2,000 + 18% GST → Rs. 2,500 + 0% GST, from 1 Nov 2027.");
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
    await open(page, "/prices");
    await page.getByRole("button", { name: "Change the price of Service visit" }).click();
    await page.getByRole("button", { name: "Check the change" }).click();
    await page.getByRole("button", { name: "Change it" }).click();
    await expect(page.getByRole("group", { name: "Check the change" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Check the change" })).toBeEnabled();
  });

  test("says a price applies from tomorrow at the earliest when the API refuses the date", async ({ page }) => {
    await open(page, "/prices", {
      "POST /api/prices": fails(400, "invalid_request", ["valid_from"]),
    });
    await page.getByRole("button", { name: "Change the price of Service visit" }).click();
    await page.getByRole("button", { name: "Check the change" }).click();
    await page.getByRole("group", { name: "Check the change" }).getByRole("button", { name: "Set this price" }).click();
    await expect(page.getByRole("alert")).toContainText("applies from tomorrow at the earliest");
  });

  test("says why a price for a retired service is refused", async ({ page }) => {
    await open(page, "/prices", { "POST /api/prices": fails(400, "service_retired", ["valid_from"]) });
    await page.getByRole("button", { name: "Change the price of Premium" }).click();
    await page.getByRole("button", { name: "Check the change" }).click();
    await page.getByRole("button", { name: "Set this price" }).click();
    await expect(page.getByRole("alert")).toContainText("The service is retired by that day");
  });

  test("takes back a price still to come, once asked", async ({ page }) => {
    const left = PRICE_ROWS.filter((price) => price.valid_from !== "2027-10-01");
    await open(page, "/prices", { "POST /api/prices/withdraw": json({ prices: left }) });
    await page.getByRole("button", { name: "Take back the Service visit price from 1 Oct 2027" }).click();
    const asked = page.getByRole("group", { name: /Take back the price from 1 Oct 2027/ });
    await expect(asked).toBeFocused();

    const request = posted(page, "/api/prices/withdraw");
    await asked.getByRole("button", { name: "Take it back" }).click();
    expect((await request).postDataJSON()).toEqual({ item: "service", tier: "standard", valid_from: "2027-10-01" });
    await expect(block(page, "Service visit")).not.toContainText("Rs. 2,500");
    await expect(page.getByRole("status").filter({ hasText: "The price is taken back." })).toBeVisible();
  });

  test("corrects a price still to come in one go, from the day it had or another", async ({ page }) => {
    await open(page, "/prices", { "POST /api/prices/correct": json({ prices: PRICE_ROWS }) });
    await page.getByRole("button", { name: "Correct the Service visit price from 1 Oct 2027" }).click();
    await expect(page.getByLabel("Price before GST, in rupees")).toHaveValue("2500");
    await expect(page.getByLabel("Applies from")).toHaveValue("2027-10-01");
    await page.getByLabel("Applies from").fill("2027-10-05");
    await page.getByRole("button", { name: "Check the change" }).click();
    await expect(page.getByRole("group", { name: "Check the change" })).toContainText(
      "Service visit: Rs. 2,500 + 18% GST from 1 Oct 2027 → Rs. 2,500 + 18% GST from 5 Oct 2027.",
    );

    const request = posted(page, "/api/prices/correct");
    await page.getByRole("button", { name: "Set this price" }).click();
    expect((await request).postDataJSON()).toEqual({
      item: "service",
      tier: "standard",
      amount_ex_gst: 250_000,
      gst_percent: 18,
      valid_from: "2027-10-05",
      was_valid_from: "2027-10-01",
    });
  });

  test("offers no way to take back or correct the price in force or a spent one", async ({ page }) => {
    await open(page, "/prices");
    await expect(page.getByRole("button", { name: /^Take back/ })).toHaveCount(1);
    await expect(page.getByRole("button", { name: /^Correct/ })).toHaveCount(1);
  });

  test("adds a hair system to the first fit, its code made from its name and its length its kind's", async ({
    page,
  }) => {
    await open(page, "/prices", { "POST /api/services": json(SERVICES, 201) });
    await expect(page.getByText("Clients book a first fit only as one of these hair systems")).toBeVisible();
    await page.getByRole("button", { name: "Add a hair system" }).click();
    await page.getByLabel("Name", { exact: true }).fill("Thin skin");
    await expect(page.getByLabel("Code")).toHaveValue("thin_skin");
    await expect(page.getByLabel("Length, in minutes")).toHaveValue("180");
    await page.getByRole("button", { name: "Check the change" }).click();
    await expect(page.getByRole("group", { name: "Check the change" })).toContainText(
      "Add Thin skin to First fit: 180 minutes, code thin_skin. Clients see it once it has a price.",
    );

    const request = posted(page, "/api/services");
    await page.getByRole("button", { name: "Save it" }).click();
    expect((await request).postDataJSON()).toEqual({
      kind: "first_fit",
      name: "Thin skin",
      tier: "thin_skin",
      minutes: 180,
    });
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
  });

  test("renames a service and says its code, and so its prices, stay", async ({ page }) => {
    await open(page, "/prices", { "POST /api/services/first_fit/premium/name": json(SERVICES) });
    await page.getByRole("button", { name: "Rename Premium" }).click();
    await page.getByLabel("Name", { exact: true }).fill("Premium first fit");
    await page.getByRole("button", { name: "Check the change" }).click();
    await expect(page.getByRole("group", { name: "Check the change" })).toContainText(
      "Premium → Premium first fit. Its code stays premium",
    );
    const request = posted(page, "/api/services/first_fit/premium/name");
    await page.getByRole("button", { name: "Save it" }).click();
    expect((await request).postDataJSON()).toEqual({ name: "Premium first fit" });
  });

  test("gives a service the line clients read under its name, shown beside the one it replaces", async ({ page }) => {
    await open(page, "/prices", { "POST /api/services/first_fit/premium/description": json(SERVICES) });
    await expect(page.getByText("Clients read: “A finer lace front, for a closer look.”")).toBeVisible();
    await page.getByRole("button", { name: "Change the description of Premium" }).click();
    await expect(page.getByLabel("Description", { exact: true })).toHaveAttribute("maxlength", "160");
    await page.getByLabel("Description", { exact: true }).fill("Natural, even at the parting.");
    await page.getByRole("button", { name: "Check the change" }).click();
    await expect(page.getByRole("group", { name: "Check the change" })).toContainText(
      "Premium: “A finer lace front, for a closer look.” → “Natural, even at the parting.”",
    );
    const request = posted(page, "/api/services/first_fit/premium/description");
    await page.getByRole("button", { name: "Save it" }).click();
    expect((await request).postDataJSON()).toEqual({ description: "Natural, even at the parting." });
  });

  test("gives a service another length, inside what the day holds", async ({ page }) => {
    await open(page, "/prices", { "POST /api/services/first_fit/premium/length": json(SERVICES) });
    await page.getByRole("button", { name: "Change the length of Premium" }).click();
    await expect(page.getByLabel("Length, in minutes")).toHaveAttribute("max", "360");
    await page.getByLabel("Length, in minutes").fill("300");
    await page.getByRole("button", { name: "Check the change" }).click();
    await expect(page.getByRole("group", { name: "Check the change" })).toContainText("Premium: 240 → 300 minutes.");
    const request = posted(page, "/api/services/first_fit/premium/length");
    await page.getByRole("button", { name: "Save it" }).click();
    expect((await request).postDataJSON()).toEqual({ minutes: 300 });
  });

  test("retires a service from a day, and says why a kind's last one stays", async ({ page }) => {
    await open(page, "/prices", {
      "POST /api/services/replacement/standard/retire": fails(409, "last_of_kind"),
    });
    await page.getByRole("button", { name: "Retire Replacement" }).click();
    await page.getByLabel("Clients stop seeing it from").fill("2027-10-01");
    await page.getByRole("button", { name: "Check the change" }).click();
    await expect(page.getByRole("group", { name: "Check the change" })).toContainText(
      "Clients stop seeing Replacement from 1 Oct 2027. Visits already sold stay as they were sold.",
    );
    const request = posted(page, "/api/services/replacement/standard/retire");
    await page.getByRole("button", { name: "Save it" }).click();
    expect((await request).postDataJSON()).toEqual({ from: "2027-10-01" });
    await expect(page.getByRole("alert")).toContainText("each keep one service that is never retired");
  });

  test("offers a retired service again, once asked", async ({ page }) => {
    await open(page, "/prices", { "POST /api/services/replacement/lace/restore": json(SERVICES) });
    await page.getByRole("button", { name: "Restore Lace replacement" }).click();
    const asked = page.getByRole("group", { name: /Offer Lace replacement again/ });
    await expect(asked).toBeFocused();
    const request = posted(page, "/api/services/replacement/lace/restore");
    await asked.getByRole("button", { name: "Save it" }).click();
    await request;
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
  });

  test("moves a service up its kind, showing the new order before it is sent", async ({ page }) => {
    await open(page, "/prices", { "POST /api/services/first_fit/order": json(SERVICES) });
    await expect(page.getByRole("button", { name: "Move First fit up" })).toHaveCount(0);
    await page.getByRole("button", { name: "Move Premium up" }).click();
    const asked = page.getByRole("group", { name: "First fit: First fit, Premium → Premium, First fit." });
    await expect(asked).toBeFocused();
    const request = posted(page, "/api/services/first_fit/order");
    await asked.getByRole("button", { name: "Save it" }).click();
    expect((await request).postDataJSON()).toEqual({ tiers: ["premium", "standard"] });
  });

  test("prices a late fee beside its kind, one figure a kind", async ({ page }) => {
    await open(page, "/prices");
    const fee = block(page, "Late fee on a first fit");
    await expect(fee).toContainText("Now Rs. 4,000 + 0% GST, since 22 Sep 2026.");
    await fee.getByRole("button", { name: "Change the price of Late fee on a first fit" }).click();
    await expect(page.getByLabel("Price before GST, in rupees")).toHaveValue("4000");
  });
});

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
    await open(page, "/areas/served", {
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
    await open(page, "/areas/served");
    await page.getByRole("button", { name: "Serve all of Delhi" }).click();
    await expect(page.getByRole("button", { name: "Delhi · 2 of 2" })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Served 110024" })).toBeChecked();
  });

  // FEO-02: serving a pincode here sent none of the launch alerts the waitlist's launch sends. OIA-13: it had a
  // launch panel of its own; it now opens the one Waiting uses.
  test("says who serving a pincode will message, and messages them only once ops agree", async ({ page }) => {
    await open(page, "/areas/served", {
      "POST /api/service-area": json({ changed: 1, served: 2, alerted: 3 }),
    });
    await page.getByRole("checkbox", { name: "Served 110024" }).check();
    await page.getByRole("button", { name: "Save these pincodes" }).click();

    const check = page.getByRole("region", { name: "Mark 110024 live" });
    await expect(check).toBeFocused();
    await expect(check).toContainText("This messages 3 people");
    await expect(check).toContainText("110024, Lajpat Nagar: 3 waiting ask to be told.");
    await expect(check).toContainText("The 2 who did not opt in are not messaged.");

    const sent = posted(page, "/api/service-area");
    await check.getByRole("button", { name: "Save and send to 3" }).click();
    expect((await sent).postDataJSON()).toEqual({
      changes: [{ pincode: "110024", served: true, launch_on: null }],
    });
    await expect(page.getByRole("status").filter({ hasText: "3 people are being told on WhatsApp." })).toBeVisible();
  });

  test("says so when a change would leave nowhere served", async ({ page }) => {
    await open(page, "/areas/served", {
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
    await open(page, "/areas/served", {
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

  // BK-38 of the audit, 2 October 2026: a pincode served from a later day was served at once.
  test("will not serve a pincode from a day still to come", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-10-04T06:00:00.000Z"));
    await open(page, "/areas/served");
    await page.getByRole("checkbox", { name: "Served 110024" }).check();
    await page.getByLabel("Launch date for 110024").fill("2026-10-20");
    await expect(page.getByRole("alert")).toContainText("110024: a pincode goes live today or from a day already past");
    await expect(page.getByRole("button", { name: "Save these pincodes" })).toBeDisabled();
  });

  // BK-36 and OIA-13: no screen could add a pincode the reference file does not hold.
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
    await form.getByLabel("Area, as messages name it").fill("Bandra West");
    await form.getByLabel("City").selectOption("Mumbai");
    const sent = posted(page, "/api/pincodes");
    await form.getByRole("button", { name: "Add it" }).click();
    expect((await sent).postDataJSON()).toEqual({ pincode: "400050", area: "Bandra West", city: "Mumbai" });

    await expect(form.getByRole("status")).toHaveText(
      "400050 is in Mumbai now, not served yet. Tick Served and save to mark it live.",
    );
    await expect(page.getByRole("button", { name: "Mumbai · 0 of 1" })).toHaveAttribute("aria-current", "true");
    await expect(area(page, "400050")).toHaveValue("Bandra West");
  });

  test("refuses a pincode the API could not hold before it is sent", async ({ page }) => {
    await open(page, "/areas/served");
    const form = page.getByRole("group", { name: "Add a pincode" });
    await form.getByLabel("Pincode").fill("012345");
    await expect(form.getByRole("alert")).toHaveText("A pincode is six digits and starts with 1 to 8.");
    await expect(form.getByRole("button", { name: "Add it" })).toBeDisabled();
  });

  // FEO-03: a file without its served column switched every pincode in it off.
  test("refuses a file that leaves out one of its three columns", async ({ page }) => {
    await open(page, "/areas/served");
    await upload(page, "pincode,launch_on\n110017,2026-09-01\n");
    await expect(page.getByRole("alert")).toContainText("needs a pincode, a served and a launch_on column");
    await expect(page.getByRole("button", { name: "Put these in the table" })).toHaveCount(0);
  });
});

// The days no visit is offered, which the runbook's SQL set before (docs/decisions/0088-every-policy-in-the-console.md).
test.describe("the blackout days", () => {
  test("lists the days run together, why, who added them, and what is still booked on them", async ({ page }) => {
    await open(page, "/settings/blackouts");
    const diwali = page.getByRole("listitem").filter({ hasText: "Fri 29 Oct to Sat 30 Oct · Diwali" });
    await expect(diwali).toContainText("Added by ops@maneman.in on 20 Sep 2027");
    await expect(diwali).toContainText("3 visits are still booked on these days. Move them on the dispatch board.");
    // OIA-03, BK-21: the way to those visits opens the board on the run's first day.
    await expect(diwali.getByRole("link", { name: "Show on board: Fri 29 Oct to Sat 30 Oct" })).toHaveAttribute(
      "href",
      "/dispatch?from=2027-10-29",
    );
    const training = page.getByRole("listitem").filter({ hasText: "Mon 15 Nov · Staff training" });
    await expect(training).toContainText("Added before this screen, so who added it is not recorded.");
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
    const add = page.getByRole("button", { name: "Black out these days" });
    await expect(add).toBeDisabled();
    await page.getByLabel("First day").fill("2027-12-24");
    await page.getByLabel("Last day").fill("2027-12-24");
    await page.getByLabel("Why").fill("  Christmas ");
    const request = posted(page, "/api/blackouts");
    await add.click();
    expect((await request).postDataJSON()).toEqual({ from: "2027-12-24", to: "2027-12-24", reason: "Christmas" });
    await expect(page.getByRole("status").filter({ hasText: "Added." })).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "Fri 24 Dec · Christmas" })).toBeVisible();
    await expect(page.getByLabel("Why")).toHaveValue("");
  });

  test("says why the API refused the days, of the box it refused", async ({ page }) => {
    await open(page, "/settings/blackouts", { "POST /api/blackouts": fails(400, "invalid_request", ["to"]) });
    await page.getByLabel("First day").fill("2027-10-01");
    await page.getByLabel("Last day").fill("2027-12-01");
    await page.getByLabel("Why").fill("Too long");
    await page.getByRole("button", { name: "Black out these days" }).click();
    await expect(page.getByRole("alert")).toHaveText(
      "The last day cannot come before the first, and one go covers a month at most.",
    );
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
      "Added by ops@maneman.in on 20 Sep 2027",
    );
    await expect(page.getByRole("listitem").filter({ hasText: "Sun 31 Oct · Diwali" })).toContainText(
      "Added by owner@maneman.in on 21 Sep 2027",
    );
  });

  test("offers a run of days again, the whole run in one press", async ({ page }) => {
    const left = { ...BLACKOUTS, blackouts: BLACKOUTS.blackouts.slice(2) };
    await open(page, "/settings/blackouts", { "POST /api/blackouts/remove": json(left) });
    const request = posted(page, "/api/blackouts/remove");
    await page.getByRole("button", { name: "Offer Fri 29 Oct to Sat 30 Oct again" }).click();
    expect((await request).postDataJSON()).toEqual({ from: "2027-10-29", to: "2027-10-30" });
    await expect(page.getByRole("listitem").filter({ hasText: "Diwali" })).toHaveCount(0);
    await expect(page.getByRole("listitem").filter({ hasText: "Staff training" })).toBeVisible();
  });
});

// Discount codes (docs/decisions/0108-discount-codes.md), which no board draws.
test.describe("the discount codes", () => {
  const made = (codes: string[]) => json({ codes }, 201);

  test("lists each code with what it takes off, its limits, how far it is used and what it has given", async ({
    page,
  }) => {
    await open(page, "/discount-codes");
    const wedding = page.getByRole("listitem").filter({ hasText: "WEDDNG25" });
    await expect(wedding).toContainText("Takes off 25%, at most Rs. 5,000 before GST");
    await expect(wedding).toContainText("Ends Fri 31 Dec");
    await expect(wedding).toContainText("3 of 50 uses");
    await expect(wedding).toContainText("Rs. 12,000 given");
    await expect(wedding.getByRole("button", { name: "Switch off WEDDNG25" })).toBeVisible();
    const replacements = page.getByRole("listitem").filter({ hasText: "RPLC2K" });
    await expect(replacements).toContainText("Switched off by owner@maneman.in on 10 Sep 2027");
    await expect(replacements.getByRole("button")).toHaveCount(0);
  });

  test("makes a code ops typed only once they have read what it takes off", async ({ page }) => {
    await open(page, "/discount-codes", { "POST /api/discount-codes": made(["DIWALI"]) });
    const form = page.getByRole("form", { name: "Make codes" });
    const check = form.getByRole("button", { name: "Check" });
    await expect(check).toBeDisabled();
    await form.getByLabel("Code", { exact: true }).fill("diwali");
    await form.getByLabel("Per cent").fill("10");
    await form.getByLabel("At most, in rupees").fill("1500");
    await form.getByLabel("Service visits").check();
    await check.click();

    const panel = page.getByRole("group", { name: "Make these codes?" });
    await expect(panel).toContainText("The code DIWALI");
    await expect(panel).toContainText("Takes off 10%, at most Rs. 1,500 before GST");
    await expect(panel).toContainText("On Service visits");
    await expect(panel).toContainText("Any number of uses, once per client");
    const request = posted(page, "/api/discount-codes");
    await panel.getByRole("button", { name: "Make them" }).click();
    expect((await request).postDataJSON()).toEqual({
      code: "diwali",
      kind: "percent",
      value: 10,
      cap: 150_000,
      covers: ["service"],
      once_per_client: true,
    });
    await expect(page.getByRole("status").filter({ hasText: "Made: DIWALI" })).toBeVisible();
  });

  test("generates a batch of single-use codes, an amount off each", async ({ page }) => {
    await open(page, "/discount-codes", { "POST /api/discount-codes": made(["A2B3C4D5", "E6F7G8H9"]) });
    const form = page.getByRole("form", { name: "Make codes" });
    await form.getByLabel("The code").selectOption({ label: "Generate them" });
    await form.getByLabel("How many").fill("2");
    await form.getByLabel("Takes off").selectOption({ label: "An amount" });
    await form.getByLabel("Rupees").fill("1000");
    await form.getByLabel("First fit, and the consultation and fit in one visit").check();
    // A batch's codes are single-use: there is no total to set.
    await expect(form.getByLabel("Total uses")).toHaveCount(0);
    await form.getByRole("button", { name: "Check" }).click();
    const panel = page.getByRole("group", { name: "Make these codes?" });
    await expect(panel).toContainText("2 codes, generated, each used once");
    await expect(panel).toContainText("Takes off Rs. 1,000 before GST");
    const request = posted(page, "/api/discount-codes");
    await panel.getByRole("button", { name: "Make them" }).click();
    expect((await request).postDataJSON()).toEqual({
      count: 2,
      kind: "amount",
      value: 100_000,
      covers: ["first_fit"],
      max_uses: 1,
      once_per_client: true,
    });
    await expect(page.getByRole("status")).toHaveText("Made: A2B3C4D5, E6F7G8H9");
  });

  test("says why the API refused a code, of the box it refused", async ({ page }) => {
    await open(page, "/discount-codes", {
      "POST /api/discount-codes": fails(400, "invalid_request", ["code"]),
    });
    const form = page.getByRole("form", { name: "Make codes" });
    await form.getByLabel("Code", { exact: true }).fill("WELCOME");
    await form.getByLabel("Per cent").fill("10");
    await form.getByLabel("Service visits").check();
    await form.getByRole("button", { name: "Check" }).click();
    await page.getByRole("button", { name: "Make them" }).click();
    await expect(page.getByRole("alert")).toHaveText(
      "A code is 4 to 16 letters and figures, none of them I, L, O, 0 or 1.",
    );
  });

  test("switches a code off only once ops have read what it leaves on record", async ({ page }) => {
    const [wedding] = DISCOUNT_CODES.codes;
    if (wedding === undefined) throw new Error("the fixture has no code");
    const off = `POST /api/discount-codes/${wedding.id}/off` as const;
    await open(page, "/discount-codes", { [off]: empty() });
    await page.getByRole("button", { name: "Switch off WEDDNG25" }).click();
    const panel = page.getByRole("group", { name: "Switch off WEDDNG25?" });
    await expect(panel).toContainText("No booking takes it from now on. 3 bookings keep it, as sold.");
    const request = posted(page, `/api/discount-codes/${wedding.id}/off`);
    await panel.getByRole("button", { name: "Switch off" }).click();
    await request;
  });
});

// FEO-33 and VIS-21: the fields ran past the panel and cut "consultation" and the date's year.
test("keeps every panel inside its frame, at the width the console is drawn", async ({ page }) => {
  for (const path of PANELS) {
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

test("meets WCAG 2.2 AA on every panel", async ({ page }) => {
  for (const path of PANELS) {
    await open(page, path);
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(
      results.violations.map((violation) => violation.id),
      path,
    ).toEqual([]);
  }
});
