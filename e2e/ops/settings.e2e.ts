// Settings: the business inputs ops set for themselves
// (docs/decisions/0061-ops-editable-inputs.md). Three panels, and the thing
// each one has to get right is the same: say the unit and the bounds before
// anything is typed, show a change that cannot quietly be taken back before it
// is made (docs/decisions/0071-what-ops-see-before-a-setting-changes.md), and
// say what went wrong, of the box it went wrong in, when a figure is refused.
//
// The refusals are the API's own shape: invalid_request, with the fields it
// names (src/http/errors.ts).

import type { Page, Route } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { fails, json, SETTINGS } from "./fixtures.ts";
import { open, posted } from "./settings-fixtures.ts";

const PANELS = ["/settings", "/prices", "/discount-codes", "/areas/served", "/settings/blackouts"];

/** One subject's section of the rules, by its heading. */
const section = (page: Page, name: string) => page.getByRole("region", { name, exact: true });

type FixtureRule = (typeof SETTINGS.settings)[number];

function ruleNamed(name: string): FixtureRule {
  const rule = SETTINGS.settings.find((each) => each.name === name);
  if (rule === undefined) throw new Error(`The fixture has no rule ${name}`);
  return rule;
}

// The storage meter (docs/decisions/0093-the-storage-meter.md). It headed every tab of Settings.
test("says what photos and referral cards hold, and the database, under The console and nowhere else", async ({
  page,
}) => {
  const storage = json({
    held_bytes: 1_240_000_000,
    share_bytes: 4e9,
    ceiling_bytes: 20e9,
    database_bytes: 212_000_000,
    database_limit_bytes: 10e9,
  });
  await open(page, "/settings", { "GET /api/storage": storage });
  const theConsole = page.getByRole("region", { name: "The console", exact: true });
  await expect(theConsole.getByText("Photos and referral cards: 1.24 GB of 4 GB", { exact: true })).toBeVisible();
  await expect(theConsole.getByText("Database: 212 MB of 10 GB", { exact: true })).toBeVisible();

  await open(page, "/settings/blackouts", { "GET /api/storage": storage });
  await expect(page.getByRole("heading", { name: "Closed days" })).toBeVisible();
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

  // Ops were shown "src/policy/check-in.ts".
  test("says who set a rule, and says when nobody has, without a word of the code", async ({ page }) => {
    await open(page);
    await expect(page.getByText("Set by ops@maneman.in on 20 Sep 2027")).toBeVisible();
    await expect(page.getByText("Nobody has set this, so the standard figure stands.").first()).toBeVisible();
    await expect(page.getByRole("main")).not.toContainText("src/");
  });

  // An hour read "18 hour of the day, in India", and a token's setter its 40-character ID.
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

  // A figure past its bounds left Save grey with no reason.
  test("says beside the box why a figure past its bounds cannot be saved", async ({ page }) => {
    await open(page);
    const radius = page.getByLabel("Check-in radius");
    await radius.fill("1440");
    await expect(radius).toHaveAttribute("aria-invalid", "true");
    await expect(radius).toHaveAccessibleDescription("Enter a whole figure from 50 to 1000 metres.");
    await expect(section(page, "Visits in the field").getByRole("button", { name: "Save" })).toBeDisabled();
    await radius.fill("150");
    await expect(radius).not.toHaveAttribute("aria-invalid", "true");
  });

  // The refusal named its field and the console dropped it, so every refusal read the same.
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

  // Each figure fits its own bounds, but services every 60 days cannot be booked 45 days ahead.
  test("says which box must reach which when the figures do not fit together", async ({ page }) => {
    await open(page, "/settings", {
      "POST /api/settings/booking_days": fails(422, "figures_conflict", [
        "booking_days.horizon",
        "booking_days.service_cadence",
      ]),
    });
    const days = page.getByRole("group", { name: "Booking and the next visit" });
    await days.getByLabel("Between service visits").fill("60");
    await section(page, "Booking and payment").getByRole("button", { name: "Save" }).click();
    await page.getByRole("group", { name: "Check the change" }).getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("listitem").filter({ has: days }).getByRole("alert")).toHaveText(
      "“How far ahead a visit may be booked” must be at least “Between service visits”, or a client is offered a day they cannot book. It was not saved.",
    );
  });

  // Seventeen rules on one page, each with its own Save, in no order.
  test("groups the rules by subject, each section a link away", async ({ page }) => {
    await open(page);
    const jump = page.getByRole("navigation", { name: "Policies by subject" });
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
    expect(await axeViolations(page)).toEqual([]);
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
    expect(await axeViolations(page)).toEqual([]);

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

  // Each side's visits, and how long they last
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

// The fields ran past the panel and cut "consultation" and the date's year.
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
    expect(await axeViolations(page), path).toEqual([]);
  }
});
