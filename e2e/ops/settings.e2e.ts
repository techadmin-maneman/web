// Settings' policies: the business inputs ops set for themselves
// (docs/decisions/0061-ops-editable-inputs.md). Every page has to get the same
// things right: say each figure's unit, show a change that cannot quietly be
// taken back before it is made
// (docs/decisions/0071-what-ops-see-before-a-setting-changes.md), and say what
// went wrong, of the box it went wrong in, when a figure is refused.
//
// The refusals are the API's own shape: invalid_request, with the fields it
// names (src/http/errors.ts).

import type { Page, Route } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { fails, json, SETTINGS } from "./fixtures.ts";
import { open, posted } from "./settings-fixtures.ts";
import { expectOneBoxALine } from "./one-box-a-line.ts";
import { settings as settingsCopy } from "../../apps/ops/src/content/settings.ts";
import { cities, dispatch, referrals, settingsPageNames, shell } from "../../apps/ops/src/content.ts";
import { review } from "../../apps/ops/src/content/common.ts";

const PANELS = [
  "/settings/field",
  "/settings/booking",
  "/settings/services",
  "/settings/discount-codes",
  "/settings/areas",
  "/settings/closed-days",
] as const;

/** One subject's section of the rules, by its heading. */
const section = (page: Page, name: string) => page.getByRole("region", { name, exact: true });

/** The bar's Review, which rises once a section holds a change it can send. */
const reviewIn = (page: Page, name: string) => section(page, name).getByRole("button", { name: review.next });

type FixtureRule = (typeof SETTINGS.settings)[number];

function ruleNamed(name: string): FixtureRule {
  const rule = SETTINGS.settings.find((each) => each.name === name);
  if (rule === undefined) throw new Error(`The fixture has no rule ${name}`);
  return rule;
}

// The storage meter (docs/decisions/0093-the-storage-meter.md). It headed every page of Settings.
test("says what photos and referral cards hold, and the database, under The console and nowhere else", async ({
  page,
}) => {
  const storage = json({
    held_bytes: 1_240_000_000,
    share_bytes: 4e9,
    database_bytes: 212_000_000,
    database_limit_bytes: 10e9,
  });
  await open(page, "/settings/console", { "GET /api/storage": storage });
  const theConsole = page.getByRole("region", { name: settingsCopy.rules.groups.console, exact: true });
  await expect(theConsole.getByText("Photos and referral cards: 1.24 GB of 4 GB", { exact: true })).toBeVisible();
  await expect(theConsole.getByText("Database: 212 MB of 10 GB", { exact: true })).toBeVisible();

  await open(page, "/settings/closed-days", { "GET /api/storage": storage });
  await expect(page.getByText("Photos and referral cards")).toHaveCount(0);
});

test.describe("the rules", () => {
  test("shows each rule with its figure and unit, and nothing more", async ({ page }) => {
    await open(page, "/settings/field");
    const radius = page.getByRole("group", { name: cities.rules.names.checkin_radius_m });
    await expect(radius.getByLabel(cities.rules.names.checkin_radius_m)).toHaveValue("200");
    await expect(radius).toContainText(cities.rules.units.checkin_radius_m);
    await expect(radius).not.toContainText("50–1000");
  });

  // Ops were shown "src/policy/check-in.ts".
  test("shows not a word of the code", async ({ page }) => {
    await open(page, "/settings/field");
    await expect(page.getByRole("main")).not.toContainText("src/");
  });

  // An hour read "18 hour of the day, in India", and a token's setter its 40-character ID.
  test("shows an hour of the day as a clock, and a service token as one", async ({ page }) => {
    const reminders = {
      ...ruleNamed("checkin_radius_m"),
      name: "reminder_hour",
      title: "Reminder time",
      note: "When the WhatsApp reminders of tomorrow’s visit go.",
      unit: "hour of the day, in India",
      min: 8,
      max: 21,
      value: 18,
      default: 18,
      set_by: "5ef59a45a8ca607281f5b3ae02bf8103.access",
      set_at: "2027-09-20T06:00:00.000Z",
    };
    await open(page, "/settings/reminders", { "GET /api/settings": json({ settings: [reminders] }) });
    const rule = page.getByRole("main");
    await expect(rule.getByText("6 pm", { exact: true })).toBeVisible();
    await page.getByLabel(cities.rules.names.reminder_hour).fill("9");
    await expect(rule.getByText("9 am", { exact: true })).toBeVisible();
    await expect(rule).not.toContainText(".access");
  });

  test("names each box of a keyed rule as the rest of the console names it", async ({ page }) => {
    await open(page, "/settings/field");
    const wait = page.getByRole("group", { name: "No-show wait" });
    await expect(wait.getByLabel(settingsCopy.discountCodes.coverShort.first_fit, { exact: true })).toHaveValue("20");
    await expect(wait.getByLabel(dispatch.typeNames.service, { exact: true })).toHaveValue("15");
    await expect(wait).not.toContainText("first_fit");
  });

  test("shows the old figure beside the new before it sends it, and says it saved", async ({ page }) => {
    let sent = 0;
    await open(page, "/settings/field", {
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
    await page.getByLabel(cities.rules.names.checkin_radius_m).fill("150");
    await reviewIn(page, "Visits in the field").click();

    // ADR 0071's rule for a price, followed for a rule (docs/decisions/0086-the-next-visit-is-offered.md).
    const check = page.getByRole("group", { name: settingsCopy.rules.confirm.title });
    await expect(check).toBeFocused();
    await expect(check).toContainText("Check-in radius: 200 metres → 150 metres");
    expect(sent).toBe(0);

    const request = posted(page, "/api/settings/checkin_radius_m");
    await check.getByRole("button", { name: settingsCopy.discountCodes.send }).click();
    expect((await request).postDataJSON()).toEqual({ value: 150 });
    await expect(page.getByRole("status").filter({ hasText: settingsCopy.rules.saved })).toBeVisible();
  });

  test("goes back to the figures without sending when the change is not the one meant", async ({ page }) => {
    await open(page, "/settings/field");
    await page.getByLabel(cities.rules.names.checkin_radius_m).fill("150");
    await reviewIn(page, "Visits in the field").click();
    await page
      .getByRole("group", { name: settingsCopy.rules.confirm.title })
      .getByRole("button", { name: settingsCopy.rules.confirm.back })
      .click();
    await expect(page.getByRole("group", { name: settingsCopy.rules.confirm.title })).toHaveCount(0);
    await expect(page.getByLabel(cities.rules.names.checkin_radius_m)).toHaveValue("150");
  });

  test("will not send an empty box, which would read as nought, nor a figure that has not changed", async ({
    page,
  }) => {
    await open(page, "/settings/field");
    await expect(reviewIn(page, "Visits in the field")).toHaveCount(0);
    await page.getByLabel(cities.rules.names.checkin_radius_m).fill("");
    await expect(reviewIn(page, "Visits in the field")).toHaveCount(0);
    // A change elsewhere in the section is not sent while a box holds what its rule cannot take.
    await page
      .getByRole("group", { name: "No-show wait" })
      .getByLabel(settingsCopy.discountCodes.coverShort.first_fit, { exact: true })
      .fill("25");
    await expect(reviewIn(page, "Visits in the field")).toHaveCount(0);
  });

  // A figure past its bounds left Save grey with no reason.
  test("says beside the box why a figure past its bounds cannot be saved", async ({ page }) => {
    await open(page, "/settings/field");
    const radius = page.getByLabel(cities.rules.names.checkin_radius_m);
    await radius.fill("1440");
    await expect(radius).toHaveAttribute("aria-invalid", "true");
    await expect(radius).toHaveAccessibleDescription("Enter 50–1000 metres.");
    await expect(reviewIn(page, "Visits in the field")).toHaveCount(0);
    await radius.fill("150");
    await expect(radius).not.toHaveAttribute("aria-invalid", "true");
  });

  // The refusal named its field and the console dropped it, so every refusal read the same; then it named no range.
  test("names the box the API refused, and what it may hold", async ({ page }) => {
    await open(page, "/settings/field", {
      "POST /api/settings/no_show_wait_min": fails(400, "invalid_request", ["no_show_wait_min.first_fit"]),
    });
    const wait = page.getByRole("group", { name: "No-show wait" });
    await wait.getByLabel(settingsCopy.discountCodes.coverShort.first_fit, { exact: true }).fill("90");
    await reviewIn(page, "Visits in the field").click();
    await page
      .getByRole("group", { name: settingsCopy.rules.confirm.title })
      .getByRole("button", { name: settingsCopy.discountCodes.send })
      .click();
    await expect(section(page, "Visits in the field").getByRole("alert")).toHaveText(
      /^First fit: Enter \d+–\d+ minutes\.$/,
    );
  });

  // Each figure fits its own bounds, but services every 60 days cannot be booked 45 days ahead.
  test("says which box must reach which when the figures do not fit together", async ({ page }) => {
    await open(page, "/settings/booking", {
      "POST /api/settings/booking_days": fails(422, "figures_conflict", [
        "booking_days.horizon",
        "booking_days.service_cadence",
      ]),
    });
    const days = page.getByRole("group", { name: "Booking and next visits" });
    await days.getByLabel("Between service visits").fill("60");
    await reviewIn(page, "Booking and payment").click();
    await page
      .getByRole("group", { name: settingsCopy.rules.confirm.title })
      .getByRole("button", { name: settingsCopy.discountCodes.send })
      .click();
    await expect(section(page, "Booking and payment").getByRole("alert")).toHaveText(
      "“Bookable ahead” must be at least “Between service visits”.",
    );
  });

  // Seventeen rules on one page, each with its own Save, in no order.
  test("puts each subject's rules on a page of its own, a link away in Settings' menu", async ({ page }) => {
    await open(page, "/settings/field");
    const menu = page.getByRole("navigation", { name: shell.settings, exact: true });
    await expect(menu.getByRole("link", { name: settingsPageNames.field })).toHaveAttribute("aria-current", "page");
    const field = section(page, "Visits in the field");
    await expect(field.getByRole("group")).toHaveText([/^Check-in radius/, /^No-show wait/, /^Phone clock limits/]);
    await expect(page.getByRole("button", { name: review.next, exact: true })).toHaveCount(0);

    await menu.getByRole("link", { name: settingsPageNames.referrals }).click();
    await expect(page).toHaveURL(/\/settings\/referrals$/);
    await expect(section(page, "Referrals")).toBeVisible();
    await expect(page.getByLabel(cities.rules.names.checkin_radius_m)).toHaveCount(0);
    expect(await axeViolations(page)).toEqual([]);
  });

  test("sends a section’s changes with one Save, after showing every figure that moves", async ({ page }) => {
    const sent: string[] = [];
    const saved = (rule: FixtureRule) => (route: Route) => {
      sent.push(rule.name);
      const { value } = route.request().postDataJSON() as { value: unknown };
      return json({ ...rule, value, set_by: "ops@maneman.in", set_at: "2027-09-21T06:00:00.000Z" })(route);
    };
    await open(page, "/settings/field", {
      "POST /api/settings/checkin_radius_m": saved(ruleNamed("checkin_radius_m")),
      "POST /api/settings/no_show_wait_min": saved(ruleNamed("no_show_wait_min")),
    });
    await page.getByLabel(cities.rules.names.checkin_radius_m).fill("150");
    await page
      .getByRole("group", { name: "No-show wait" })
      .getByLabel(dispatch.typeNames.service, { exact: true })
      .fill("20");
    await reviewIn(page, "Visits in the field").click();

    const check = page.getByRole("group", { name: settingsCopy.rules.confirm.title });
    await expect(check.getByRole("listitem")).toHaveText([
      "Check-in radius: 200 metres → 150 metres",
      "No-show wait · Service visit: 15 minutes → 20 minutes",
    ]);
    expect(sent).toEqual([]);
    await check.getByRole("button", { name: settingsCopy.discountCodes.send }).click();
    await expect(page.getByRole("status").filter({ hasText: settingsCopy.rules.saved })).toBeVisible();
    expect(sent).toEqual(["checkin_radius_m", "no_show_wait_min"]);
    await expect(reviewIn(page, "Visits in the field")).toHaveCount(0);
  });

  test("says which rule was refused when one of a section’s changes is, and keeps the one that saved", async ({
    page,
  }) => {
    const radius = ruleNamed("checkin_radius_m");
    await open(page, "/settings/field", {
      "POST /api/settings/checkin_radius_m": json({
        ...radius,
        value: 150,
        set_by: "ops@maneman.in",
        set_at: "2027-09-21T06:00:00.000Z",
      }),
      "POST /api/settings/no_show_wait_min": fails(400, "invalid_request", ["no_show_wait_min.service"]),
    });
    await page.getByLabel(cities.rules.names.checkin_radius_m).fill("150");
    const wait = page.getByRole("group", { name: "No-show wait" });
    await wait.getByLabel(dispatch.typeNames.service, { exact: true }).fill("20");
    await reviewIn(page, "Visits in the field").click();
    await page
      .getByRole("group", { name: settingsCopy.rules.confirm.title })
      .getByRole("button", { name: settingsCopy.discountCodes.send })
      .click();

    await expect(section(page, "Visits in the field").getByRole("alert")).toHaveText([
      /^Service visit: Enter \d+–\d+ minutes\.$/,
    ]);
    await expect(page.getByLabel(cities.rules.names.checkin_radius_m)).toHaveValue("150");
  });

  test("links each late-fee rule to Services, and Services back to the rule", async ({ page }) => {
    await open(page, "/settings/moves");
    const charges = section(page, settingsCopy.rules.groups.moves);
    await expect(charges.getByRole("link", { name: settingsCopy.rules.lateFees })).toHaveAttribute(
      "href",
      "/settings/services",
    );

    await open(page, "/settings/services");
    await page.getByRole("button", { name: "Edit Late fee on a first fit", exact: true }).click();
    await page.getByRole("link", { name: settingsCopy.services.lateFeeRule }).click();
    await expect(page).toHaveURL(/\/settings\/moves#late_change_charge$/);
    const rule = page.locator("#late_change_charge");
    await expect(rule).toBeFocused();
    await expect(rule).toBeInViewport();
  });

  // One input for the next visit's days, each box with its own range (docs/decisions/0086-the-next-visit-is-offered.md).
  test("gives each of the next visit’s days its own box and range, and sends the one changed", async ({ page }) => {
    await open(page, "/settings/booking", {
      "POST /api/settings/booking_days": (route) => {
        const days = SETTINGS.settings.find((rule) => rule.name === "booking_days");
        const { value } = route.request().postDataJSON() as { value: unknown };
        return json({ ...days, value, set_by: "ops@maneman.in" })(route);
      },
    });
    const days = page.getByRole("group", { name: "Booking and next visits" });
    await expect(days.getByLabel("Between service visits")).toHaveValue("30");
    await expect(days.getByLabel("Consultation to first fit")).toHaveValue("0");
    await expect(days.getByLabel("Bookable ahead")).toHaveValue("45");
    await expect(days).not.toContainText("service_cadence");

    // A horizon shorter than the fortnight the strip shows is not offered.
    await days.getByLabel("Bookable ahead").fill("10");
    await expect(reviewIn(page, "Booking and payment")).toHaveCount(0);
    await days.getByLabel("Bookable ahead").fill("45");

    await days.getByLabel("Between service visits").fill("28");
    await reviewIn(page, "Booking and payment").click();
    const check = page.getByRole("group", { name: settingsCopy.rules.confirm.title });
    await expect(check.getByRole("listitem")).toHaveText([
      "Booking and next visits · Between service visits: 30 days → 28 days",
    ]);
    expect(await axeViolations(page)).toEqual([]);

    const request = posted(page, "/api/settings/booking_days");
    await check.getByRole("button", { name: settingsCopy.discountCodes.send }).click();
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
    await expect(page.getByRole("status").filter({ hasText: settingsCopy.rules.saved })).toBeVisible();
  });

  // Each side's visits, and how long they last
  // (docs/decisions/0107-referral-rewards-in-the-console.md).
  test("sets what a referral earns each side, nothing for one, after showing the change", async ({ page }) => {
    await open(page, "/settings/referrals", {
      "POST /api/settings/referral_reward": (route) => {
        const reward = SETTINGS.settings.find((rule) => rule.name === "referral_reward");
        const { value } = route.request().postDataJSON() as { value: unknown };
        return json({ ...reward, value, set_by: "ops@maneman.in" })(route);
      },
    });
    const reward = page.getByRole("group", { name: "Referral reward" });
    await expect(reward.getByLabel(referrals.table.columns.referrer)).toHaveValue("3");
    await expect(reward.getByLabel("Friend")).toHaveValue("3");
    await expect(reward.getByLabel("Free service visits valid for")).toHaveValue("365");

    await reward.getByLabel(referrals.table.columns.referrer).fill("2");
    await reward.getByLabel("Friend").fill("0");
    await reviewIn(page, "Referrals").click();
    const check = page.getByRole("group", { name: settingsCopy.rules.confirm.title });
    await expect(check.getByRole("listitem")).toHaveText([
      "Referral reward · Referrer: 3 service visits → 2 service visits",
      "Referral reward · Friend: 3 service visits → 0 service visits",
    ]);

    const request = posted(page, "/api/settings/referral_reward");
    await check.getByRole("button", { name: settingsCopy.discountCodes.send }).click();
    expect((await request).postDataJSON()).toEqual({
      value: { referrer_visits: 2, friend_visits: 0, valid_days: 365 },
    });
    await expect(page.getByRole("status").filter({ hasText: settingsCopy.rules.saved })).toBeVisible();
  });

  // Every figure a rule of the code held is ops' now (docs/decisions/0088-every-policy-in-the-console.md).
  test("says each box’s own unit where a rule’s figures count in two", async ({ page }) => {
    await open(page, "/settings/field");
    const clock = page.getByRole("group", { name: "Phone clock limits" });
    await expect(clock.getByLabel("Earliest check-in before the start")).toHaveValue("60");
    await expect(clock).toContainText("minutes");
    await expect(clock.getByLabel("Longest a phone may stay offline")).toHaveValue("24");
    await expect(clock).toContainText("hours");
  });

  test("offers each kind of visit only what it may cost, in the console’s words, and sends the one chosen", async ({
    page,
  }) => {
    await open(page, "/settings/moves", {
      "POST /api/settings/late_change_charge": (route) => {
        const charges = SETTINGS.settings.find((rule) => rule.name === "late_change_charge");
        const { value } = route.request().postDataJSON() as { value: unknown };
        return json({ ...charges, value, set_by: "ops@maneman.in", set_at: "2027-09-21T06:00:00.000Z" })(route);
      },
    });
    const charges = page.getByRole("group", { name: "Late move or cancel charge" });
    const service = charges.getByLabel(dispatch.typeNames.service, { exact: true });
    await expect(service).toHaveValue("visit");
    await expect(service.locator("option")).toHaveText(["Nothing", "The full visit"]);
    await expect(
      charges.getByLabel(settingsCopy.discountCodes.coverShort.first_fit, { exact: true }).locator("option"),
    ).toHaveText(["Nothing", settingsCopy.services.lateFee, "The full visit"]);

    await service.selectOption("nothing");
    await reviewIn(page, settingsCopy.rules.groups.moves).click();
    const check = page.getByRole("group", { name: settingsCopy.rules.confirm.title });
    await expect(check).toContainText("Late move or cancel charge · Service visit: The full visit → Nothing");
    const request = posted(page, "/api/settings/late_change_charge");
    await check.getByRole("button", { name: settingsCopy.discountCodes.send }).click();
    expect((await request).postDataJSON()).toEqual({
      value: { consultation: "nothing", first_fit: "late_fee", service: "nothing", replacement: "late_fee" },
    });
    await expect(page.getByRole("status").filter({ hasText: settingsCopy.rules.saved })).toBeVisible();
  });

  test("offers a base of its own on the open rule, and none where the keys are fixed", async ({ page }) => {
    await open(page, "/settings/reminders");
    const cycle = page.getByRole("group", { name: "Replacement cycle" });
    await expect(cycle.getByLabel(settingsCopy.rules.keyName)).toBeVisible();
    await open(page, "/settings/field");
    await expect(page.getByLabel(settingsCopy.rules.keyName)).toHaveCount(0);
  });
});

// The fields ran past the panel and cut "consultation" and the date's year.
test("keeps every panel inside its frame, a box to a line, at the width the console is drawn", async ({ page }) => {
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
    await expectOneBoxALine(page, path);
  }
});

test("meets WCAG 2.2 AA on every panel", async ({ page }) => {
  for (const path of PANELS) {
    await open(page, path);
    expect(await axeViolations(page), path).toEqual([]);
  }
});
