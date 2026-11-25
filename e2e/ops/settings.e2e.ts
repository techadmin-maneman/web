// Settings' policies: the business inputs ops set for themselves
// (docs/decisions/0061-ops-editable-inputs.md). Every page has to get the same
// things right: say each figure's unit, change a figure where it reads and send
// it only on Enter or Save (docs/decisions/0212-editing-in-place.md), and say
// what went wrong, of the box it went wrong in, when a figure is refused.
//
// The refusals are the API's own shape: invalid_request, with the fields it
// names (src/http/errors.ts).

import type { Locator, Page, Route } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { fails, json, SETTINGS } from "./fixtures.ts";
import { open, posted } from "./settings-fixtures.ts";
import { expectNoBoxInATable } from "./no-box-in-a-table.ts";
import { settings as settingsCopy } from "../../apps/ops/src/content/settings.ts";
import {
  cities,
  dispatch,
  referrals,
  settingsGroupNames,
  settingsPageNames,
  shell,
} from "../../apps/ops/src/content.ts";
import { EDITING } from "../../apps/ops/src/content/common.ts";

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

/** A setting's Change, which opens its box in a dialog of its own: "Change Check-in radius". */
const change = (scope: Locator, label: string) =>
  scope.getByRole("button", { name: `${EDITING.change} ${label}`, exact: true });

/** A setting's value as its row reads it, beside its Change. */
const shown = (scope: Locator, label: string) => change(scope, label).locator("..");

/** A setting's box, in the dialog its Change opened. */
const boxIn = (page: Page, label: string) =>
  page.getByRole("dialog", { name: label }).getByLabel(label, { exact: true });

/** Someone who may read Settings and change nothing. */
const VIEW_ONLY = json({
  signed_in_as: "viewer@maneman.in",
  sign_out: "/cdn-cgi/access/logout",
  cities: [],
  every_city: true,
  staff: {
    enforced: true,
    listed: true,
    grants: [],
    may_call: ["GET /api/health", "GET /api/whoami", "GET /api/settings"],
  },
});

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
  await expect(theConsole.getByText("Photos and referral cards: 1.2 GB of 4 GB", { exact: true })).toBeVisible();
  await expect(theConsole.getByText("Database: 212 MB of 10 GB", { exact: true })).toBeVisible();

  await open(page, "/settings/closed-days", { "GET /api/storage": storage });
  await expect(page.getByText("Photos and referral cards")).toHaveCount(0);
});

test.describe("the rules", () => {
  test("shows each rule's figure as words with its unit, and no box until it is changed", async ({ page }) => {
    await open(page, "/settings/field");
    const radius = page.getByRole("group", { name: cities.rules.names.checkin_radius_m });
    await expect(shown(radius, cities.rules.names.checkin_radius_m)).toContainText("200 metres");
    await expect(radius.getByRole("spinbutton")).toHaveCount(0);
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
    await expect(rule).not.toContainText(".access");
  });

  test("names each box of a keyed rule as the rest of the console names it", async ({ page }) => {
    await open(page, "/settings/field");
    const wait = page.getByRole("group", { name: "No-show wait" });
    await expect(shown(wait, settingsCopy.discountCodes.coverShort.first_fit)).toContainText("20 minutes");
    await expect(shown(wait, dispatch.typeNames.service)).toContainText("15 minutes");
    await expect(wait).not.toContainText("first_fit");
  });

  // docs/decisions/0212-editing-in-place.md: one click to start, Enter to keep it, "Saved" beside it.
  test("opens a figure in place on a click, keeps it on Enter, and says it saved beside it", async ({ page }) => {
    await open(page, "/settings/field", {
      "POST /api/settings/checkin_radius_m": json({
        ...ruleNamed("checkin_radius_m"),
        value: 150,
        set_by: "ops@maneman.in",
        set_at: "2027-09-21T06:00:00.000Z",
      }),
    });
    const radius = page.getByRole("group", { name: cities.rules.names.checkin_radius_m });
    await change(radius, cities.rules.names.checkin_radius_m).click();
    const box = boxIn(page, cities.rules.names.checkin_radius_m);
    await expect(box).toBeFocused();
    await expect(box).toHaveValue("200");

    const request = posted(page, "/api/settings/checkin_radius_m");
    await box.fill("150");
    await box.press("Enter");
    expect((await request).postDataJSON()).toEqual({ value: 150 });
    await expect(radius.getByRole("status")).toHaveText(EDITING.saved);
    await expect(shown(radius, cities.rules.names.checkin_radius_m)).toContainText(
      `150 ${cities.rules.units.checkin_radius_m}`,
    );
    await expect(change(radius, cities.rules.names.checkin_radius_m)).toBeFocused();
  });

  /** The check-in radius set by hand to 150, and what each send of it answers: the default for null, else as set. */
  async function setByHand(page: Page): Promise<unknown[]> {
    const standard = ruleNamed("checkin_radius_m");
    const byHand = { ...standard, value: 150, set_by: "ops@maneman.in", set_at: "2027-09-21T06:00:00.000Z" };
    const sent: unknown[] = [];
    const settings = SETTINGS.settings.map((each) => (each.name === "checkin_radius_m" ? byHand : each));
    await open(page, "/settings/field", {
      "GET /api/settings": json({ ...SETTINGS, settings }),
      "POST /api/settings/checkin_radius_m": async (route: Route) => {
        const body = route.request().postDataJSON() as { value: unknown };
        sent.push(body.value);
        await json(body.value === null ? standard : byHand)(route);
      },
    });
    return sent;
  }

  test("puts a rule back to its default when its default is typed", async ({ page }) => {
    const sent = await setByHand(page);
    const radius = page.getByRole("group", { name: cities.rules.names.checkin_radius_m });
    await expect(change(radius, cities.rules.names.checkin_radius_m)).toBeVisible();
    await change(radius, cities.rules.names.checkin_radius_m).click();
    const box = boxIn(page, cities.rules.names.checkin_radius_m);
    await box.fill("200");
    await box.press("Enter");
    await expect.poll(() => sent).toEqual([null]);
  });

  test("says a rule was reset, and undoes it in one press", async ({ page }) => {
    const sent = await setByHand(page);
    const radius = page.getByRole("group", { name: cities.rules.names.checkin_radius_m });
    await radius
      .getByRole("button", { name: settingsCopy.rules.resetLabel(cities.rules.names.checkin_radius_m) })
      .click();
    await expect(radius.getByText(settingsCopy.rules.wasReset)).toBeVisible();
    await radius.getByRole("button", { name: settingsCopy.rules.undo }).click();
    await expect.poll(() => sent).toEqual([null, 150]);
  });

  test("puts the figure back on Escape, and sends nothing", async ({ page }) => {
    let sent = 0;
    await open(page, "/settings/field", {
      "POST /api/settings/checkin_radius_m": (route) => {
        sent += 1;
        return json(ruleNamed("checkin_radius_m"))(route);
      },
    });
    const radius = page.getByRole("group", { name: cities.rules.names.checkin_radius_m });
    await change(radius, cities.rules.names.checkin_radius_m).click();
    await boxIn(page, cities.rules.names.checkin_radius_m).fill("150");
    await page.keyboard.press("Escape");
    await expect(shown(radius, cities.rules.names.checkin_radius_m)).toContainText("200 metres");
    await expect(change(radius, cities.rules.names.checkin_radius_m)).toBeFocused();
    expect(sent).toBe(0);
  });

  // A figure past its bounds left Save grey with no reason; an empty box would read as nought.
  test("says under the box why a figure past its bounds, or none, cannot be saved, and sends nothing", async ({
    page,
  }) => {
    let sent = 0;
    await open(page, "/settings/field", {
      "POST /api/settings/checkin_radius_m": (route) => {
        sent += 1;
        return json(ruleNamed("checkin_radius_m"))(route);
      },
    });
    const radius = page.getByRole("group", { name: cities.rules.names.checkin_radius_m });
    await change(radius, cities.rules.names.checkin_radius_m).click();
    const box = boxIn(page, cities.rules.names.checkin_radius_m);
    for (const typed of ["1440", ""]) {
      await box.fill(typed);
      await radius.getByRole("button", { name: EDITING.save }).click();
      await expect(box).toHaveAttribute("aria-invalid", "true");
      await expect(box).toHaveAccessibleDescription("Enter 50–1,000 metres.");
    }
    expect(sent).toBe(0);
  });

  // The refusal named its field and the console dropped it, so every refusal read the same; then it named no range.
  test("names the box the API refused, and what it may hold", async ({ page }) => {
    await open(page, "/settings/field", {
      "POST /api/settings/no_show_wait_min": fails(400, "invalid_request", ["no_show_wait_min.first_fit"]),
    });
    const wait = page.getByRole("group", { name: "No-show wait" });
    await change(wait, settingsCopy.discountCodes.coverShort.first_fit).click();
    await boxIn(page, settingsCopy.discountCodes.coverShort.first_fit).fill("90");
    await wait.getByRole("button", { name: EDITING.save }).click();
    await expect(wait.getByRole("alert")).toHaveText(/^First fit: Enter \d+–\d+ minutes\.$/);
  });

  // A package's service visits due every 60 days cannot be booked 45 days ahead.
  test("says which box must reach which when the figures do not fit together", async ({ page }) => {
    await open(page, "/settings/booking", {
      "POST /api/settings/booking_days": fails(422, "figures_conflict", [
        "booking_days.horizon",
        "packages.service_every_days",
      ]),
    });
    const days = page.getByRole("group", { name: "Booking and next visits" });
    await change(days, "Bookable ahead").click();
    await boxIn(page, "Bookable ahead").fill("20");
    await days.getByRole("button", { name: EDITING.save }).click();
    await expect(days.getByRole("alert")).toHaveText("“Bookable ahead” must be at least “A package’s service visits”.");
  });

  // A rule held against another on another page says so in a sentence of its own.
  test("says what two rules must keep to when a figure would break the other", async ({ page }) => {
    await open(page, "/settings/field", {
      "POST /api/settings/checkin_radius_m": fails(422, "figures_conflict", [
        "checkin_radius_m",
        "checkin_radius_approximate_m",
      ]),
    });
    const radius = page.getByRole("group", { name: cities.rules.names.checkin_radius_m });
    await change(radius, cities.rules.names.checkin_radius_m).click();
    const box = boxIn(page, cities.rules.names.checkin_radius_m);
    await box.fill("900");
    await box.press("Enter");
    await expect(page.getByRole("alert").filter({ hasText: /rough pin/ })).toHaveText(
      settingsCopy.rules.crossConflicts["checkin_radius_m|checkin_radius_approximate_m"] ?? "",
    );
  });

  // Seventeen rules on one page, each with its own Save, in no order.
  test("puts each subject's rules on a page of its own, a tab away in its group", async ({ page }) => {
    await open(page, "/settings/field");
    const tabs = page.getByRole("navigation", { name: settingsGroupNames.visits, exact: true });
    await expect(tabs.getByRole("link", { name: settingsPageNames.field })).toHaveAttribute("aria-current", "page");
    // The rules of one figure together under the subject; a rule of several, in a panel of its own beneath.
    const field = section(page, "Visits in the field");
    await expect(field.getByRole("group")).toHaveText([/^Check-in radius/]);
    for (const rule of [/^No-show wait/, /^Phone clock limits/]) {
      await expect(page.getByRole("region", { name: rule }).getByRole("group", { name: rule })).toBeVisible();
    }
    await expect(page.getByRole("button", { name: EDITING.save, exact: true })).toHaveCount(0);

    // Settings' groups are beneath it in the navigation, each opening on its first page.
    await page
      .getByRole("list", { name: shell.settings, exact: true })
      .getByRole("link", { name: settingsGroupNames.growth })
      .click();
    await expect(page).toHaveURL(/\/settings\/referrals$/);
    await page
      .getByRole("navigation", { name: settingsGroupNames.growth, exact: true })
      .getByRole("link", { name: settingsPageNames.referrals })
      .click();
    await expect(page).toHaveURL(/\/settings\/referrals$/);
    await expect(section(page, "Referral reward")).toBeVisible();
    await expect(page.getByRole("group", { name: cities.rules.names.checkin_radius_m })).toHaveCount(0);
    expect(await axeViolations(page)).toEqual([]);
  });

  // With the navigation folded its groups are not drawn beneath Settings: they stand as tabs, as on a phone.
  test("offers Settings' groups as tabs once the navigation is folded, and only then on a desk", async ({ page }) => {
    await open(page, "/settings/booking");
    const groups = page.getByRole("main").getByRole("navigation", { name: settingsCopy.groups, exact: true });
    await expect(groups).toHaveCount(0);
    await page.getByRole("button", { name: shell.fold }).click();
    await groups.getByRole("link", { name: settingsGroupNames.growth }).click();
    await expect(page).toHaveURL(/\/settings\/referrals$/);
    expect(await axeViolations(page)).toEqual([]);
  });

  // Twenty-nine pages in a menu longer than the screen, and a rule found only by knowing its page.
  test("finds a page by its name and a rule by its title or note, above the page", async ({ page }) => {
    await open(page, "/settings/booking");
    const find = page.getByRole("searchbox", { name: settingsCopy.find });
    const found = page.getByRole("region", { name: settingsCopy.matches });
    const radius = SETTINGS.settings[0];
    if (radius === undefined) throw new Error("the fixture has a rule");
    await find.fill(radius.note.split(" ").slice(0, 3).join(" "));
    await expect(found.getByRole("link", { name: new RegExp(`^${radius.title}`) })).toHaveAttribute(
      "href",
      `/settings/field#${radius.name}`,
    );

    await find.fill(settingsPageNames["pay-grades"]);
    await expect(found.getByRole("link")).toHaveCount(1);
    await expect(found.getByRole("link")).toContainText(settingsPageNames["pay-grades"]);

    await find.fill("zzz");
    await expect(found.getByText(settingsCopy.noneFound)).toBeVisible();
    await found.getByRole("button", { name: settingsCopy.clear }).click();
    await expect(found).toHaveCount(0);
    await expect(find).toHaveValue("");
  });

  test("links each late-fee rule to where it is priced, and the late fees back to the rule", async ({ page }) => {
    await open(page, "/settings/moves");
    // Each charge is a rule of several figures, in a panel of its own.
    const charges = page.locator("#late_change_charge");
    await expect(charges.getByRole("link", { name: settingsCopy.rules.lateFees })).toHaveAttribute(
      "href",
      "/settings/services",
    );

    await open(page, "/settings/services");
    await page.getByRole("link", { name: settingsCopy.services.lateFeeRule }).click();
    await expect(page).toHaveURL(/\/settings\/moves#late_change_charge$/);
    const rule = page.locator("#late_change_charge");
    await expect(rule).toBeFocused();
    await expect(rule).toBeInViewport();
  });

  // One input for the next visit's days, each box with its own range (docs/decisions/0086-the-next-visit-is-offered.md).
  test("gives each of the next visit’s days its own row and range, and sends the one changed", async ({ page }) => {
    await open(page, "/settings/booking", {
      "POST /api/settings/booking_days": (route) => {
        const days = SETTINGS.settings.find((rule) => rule.name === "booking_days");
        const { value } = route.request().postDataJSON() as { value: unknown };
        return json({ ...days, value, set_by: "ops@maneman.in" })(route);
      },
    });
    const days = page.getByRole("group", { name: "Booking and next visits" });
    await expect(shown(days, "Consultation to first fit")).toContainText("0 days");
    await expect(shown(days, "Bookable ahead")).toContainText("45 days");
    await expect(days).not.toContainText("first_fit_lead");

    await change(days, "Reminder before a service is due").click();
    const box = boxIn(page, "Reminder before a service is due");
    await box.fill("5");
    const request = posted(page, "/api/settings/booking_days");
    await box.press("Enter");
    expect((await request).postDataJSON()).toEqual({
      value: {
        first_fit_lead: 0,
        reminder_before_due: 5,
        at_risk_after_due: 7,
        first_fit_to_book: 7,
        horizon: 45,
        invoice_prompt: 14,
        replacement_order_lead: 30,
      },
    });
    await expect(days.getByRole("status")).toHaveText(EDITING.saved);
    expect(await axeViolations(page)).toEqual([]);
  });

  // Each side's visits, and how long they last (docs/decisions/0107-referral-rewards-in-the-console.md).
  test("sets what a referral earns each side, nothing for one, a side at a time", async ({ page }) => {
    await open(page, "/settings/referrals", {
      "POST /api/settings/referral_reward": (route) => {
        const reward = SETTINGS.settings.find((rule) => rule.name === "referral_reward");
        const { value } = route.request().postDataJSON() as { value: unknown };
        return json({ ...reward, value, set_by: "ops@maneman.in" })(route);
      },
    });
    const reward = page.getByRole("group", { name: "Referral reward" });
    await expect(shown(reward, referrals.table.columns.referrer)).toContainText("3");
    await expect(shown(reward, "Free service visits valid for")).toContainText("365");

    await change(reward, "Friend").click();
    await boxIn(page, "Friend").fill("0");
    const request = posted(page, "/api/settings/referral_reward");
    await reward.getByRole("button", { name: EDITING.save }).click();
    expect((await request).postDataJSON()).toEqual({
      value: { referrer_visits: 3, friend_visits: 0, valid_days: 365 },
    });
    await expect(reward.getByRole("status")).toHaveText(EDITING.saved);
  });

  // Every figure a rule of the code held is ops' now (docs/decisions/0088-every-policy-in-the-console.md).
  test("says each box’s own unit where a rule’s figures count in two", async ({ page }) => {
    await open(page, "/settings/field");
    const clock = page.getByRole("group", { name: "Phone clock limits" });
    await expect(shown(clock, "Earliest check-in before the start")).toContainText("60 minutes");
    await expect(shown(clock, "Longest a phone may stay offline")).toContainText("24 hours");
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
    await expect(shown(charges, dispatch.typeNames.service)).toContainText("The full visit");
    await change(charges, dispatch.typeNames.service).click();
    const service = boxIn(page, dispatch.typeNames.service);
    await expect(service.locator("option")).toHaveText(["Nothing", "The full visit"]);
    await service.selectOption("nothing");
    const request = posted(page, "/api/settings/late_change_charge");
    await charges.getByRole("button", { name: EDITING.save }).click();
    expect((await request).postDataJSON()).toEqual({
      value: { consultation: "nothing", first_fit: "late_fee", service: "nothing", replacement: "late_fee" },
    });
    await expect(charges.getByRole("status")).toHaveText(EDITING.saved);
  });

  test("shows a person who may only look each value as it reads, with nothing to press", async ({ page }) => {
    await open(page, "/settings/field", { "GET /api/whoami": VIEW_ONLY });
    const radius = page.getByRole("group", { name: cities.rules.names.checkin_radius_m });
    await expect(radius).toContainText("200 metres");
    await expect(radius.getByRole("button")).toHaveCount(0);
  });
});

// The fields ran past the panel and cut "consultation" and the date's year.
test("keeps every panel inside its frame, no box in a table, at the width the console is drawn", async ({ page }) => {
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
    await expectNoBoxInATable(page, path);
  }
});

test("meets WCAG 2.2 AA on every panel", async ({ page }) => {
  for (const path of PANELS) {
    await open(page, path);
    expect(await axeViolations(page), path).toEqual([]);
  }
});
