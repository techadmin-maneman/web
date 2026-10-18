// The ops console's frame (docs/decisions/0026-hosts-and-surfaces.md, 0208-the-console-redesigned.md): served as the
// mm-ops Worker serves it, under its own policy, on the ops surface's host. Cloudflare Access guards that host in
// staging and production; locally the stub provider lets everyone through as ops@localhost (ADR 0031).

import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { answer, DISCOUNT_CODES, fails, json, SETTINGS, TASKS, TASKS_READ_ON } from "./fixtures.ts";
import * as opsCopy from "../../apps/ops/src/content.ts";
import { settings as settingsCopy } from "../../apps/ops/src/content/settings.ts";

/** Who is signed in when Access stands in front, with the routes their calls go ahead on. */
const signedIn = (who: string, listed: boolean, mayCall: readonly string[]) =>
  json({
    signed_in_as: who,
    sign_out: "/cdn-cgi/access/logout",
    staff: { enforced: true, listed, grants: [], may_call: mayCall },
  });

const ONLY_SIGNED_IN = ["GET /api/health", "GET /api/whoami"];

const navigation = (page: Page) => page.getByRole("navigation", { name: opsCopy.shell.title });
const heading = (page: Page, name: string) => page.getByRole("heading", { level: 1, name });

async function expectNames(links: Locator, names: readonly string[]): Promise<void> {
  await expect(links).toHaveCount(names.length);
  for (const [index, name] of names.entries()) {
    await expect(links.nth(index)).toHaveAccessibleName(name);
  }
}

test("opens on Today, the work an entry a job, Settings at the foot, and what waits in each", async ({ page }) => {
  await page.clock.setFixedTime(TASKS_READ_ON);
  await answer(page, { "GET /api/tasks": json(TASKS) });
  await page.goto("/");
  await expect(heading(page, opsCopy.shell.sections.today)).toBeVisible();
  await expect(page).toHaveURL(/\/today$/);
  const { nav, settings, waiting } = opsCopy.shell;
  await expectNames(navigation(page).getByRole("link"), [
    nav.today,
    waiting(nav.tasks, 8, true),
    nav.dispatch,
    nav.clients,
    nav.messages,
    nav.technicians,
    nav.inventory,
    waiting(nav.requests, 2, true),
    waiting(nav.money, 2, true),
    waiting(nav.growth, 2, true),
    nav.reports,
    settings,
  ]);
  await expect(navigation(page).getByRole("link", { name: nav.today })).toHaveAttribute("aria-current", "page");
});

test("shows a person only the pages their access opens, and opens on the first of them", async ({ page }) => {
  await answer(page, {
    "GET /api/whoami": signedIn("money@maneman.in", true, [
      ...ONLY_SIGNED_IN,
      "GET /api/no-shows",
      "GET /api/services",
    ]),
  });
  await page.goto("/");
  await expect(page).toHaveURL(/\/payments$/);
  await expect(heading(page, opsCopy.shell.sections.payments)).toBeVisible();
  await expectNames(navigation(page).getByRole("link"), ["Money", "Settings"]);

  await page.goto("/waitlist");
  await expect(heading(page, opsCopy.shell.sections.waitlist)).toBeVisible();
  await expect(page.getByText(opsCopy.shell.closed)).toBeVisible();
});

// Settings showed every tab to everyone; a page a person may not open is now not there at all.
test("lists in Settings only the pages a person may open, a group with none left out", async ({ page }) => {
  await answer(page, {
    "GET /api/whoami": signedIn("care@maneman.in", true, [...ONLY_SIGNED_IN, "GET /api/care-team"]),
    "GET /api/care-team": json({ team: [], me: null }),
  });
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/settings\/care-team$/);
  const menu = page.getByRole("navigation", { name: opsCopy.shell.settings });
  await expectNames(menu.getByRole("link"), ["Team"]);
  await expect(menu).not.toContainText(opsCopy.settingsGroupNames.business);
});

// A person who could only look at a rule saw it in a box they could not type in.
test("shows a person who may only look each rule's value, with no box", async ({ page }) => {
  await answer(page, {
    "GET /api/whoami": signedIn("viewer@maneman.in", true, [...ONLY_SIGNED_IN, "GET /api/settings"]),
    "GET /api/settings": json(SETTINGS),
  });
  await page.goto("/settings/field");
  const main = page.getByRole("main");
  await expect(main.getByText("200 metres").first()).toBeVisible();
  await expect(main.getByText(settingsCopy.rules.viewOnly, { exact: true })).toBeVisible();
  await expect(main.getByRole("spinbutton")).toHaveCount(0);
  await expect(main.getByRole("textbox")).toHaveCount(0);
  await expect(main.getByRole("button", { name: opsCopy.review.next })).toHaveCount(0);
});

// A person who could only look at the discount codes saw an empty column where the actions go.
test("gives a person who may only look at the discount codes no column of actions", async ({ page }) => {
  await answer(page, {
    "GET /api/whoami": signedIn("viewer@maneman.in", true, [...ONLY_SIGNED_IN, "GET /api/discount-codes"]),
    "GET /api/discount-codes": json(DISCOUNT_CODES),
  });
  await page.goto("/settings/discount-codes");
  const table = page.getByRole("main").getByRole("table").first();
  await expect(table.getByRole("row").first().getByRole("columnheader")).toHaveCount(9);
  await expect(table.locator("tbody").getByRole("button")).toHaveCount(0);
});

test("opens each page that moved at its new address", async ({ page }) => {
  for (const [old, now, title] of [
    ["/areas", /\/waitlist$/, opsCopy.shell.sections.waitlist],
    ["/service-area", /\/settings\/areas$/, opsCopy.settingsPageNames.areas],
    ["/prices", /\/settings\/services$/, opsCopy.settingsPageNames.services],
    ["/staff", /\/settings\/staff$/, opsCopy.settingsPageNames.staff],
  ] as const) {
    await page.goto(old);
    await expect(heading(page, title)).toBeVisible();
    await expect(page).toHaveURL(now);
  }
});

// Changing page dropped the focus to the page, and nothing led past the navigation.
test("moves the keyboard to a new page’s heading, and offers a way past the navigation", async ({ page }) => {
  await page.goto("/waitlist");
  await expect(heading(page, opsCopy.shell.sections.waitlist)).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: opsCopy.shell.skip })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();

  await navigation(page).getByRole("link", { name: opsCopy.shell.nav.reports }).click();
  await expect(heading(page, opsCopy.shell.sections["care-numbers"])).toBeFocused();
  await page.goBack();
  await expect(heading(page, opsCopy.shell.sections.waitlist)).toBeFocused();
});

// Every page was titled "Mane Man operations" (WCAG 2.4.2).
test("titles each page by what it is, and says where it sits", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Today · Mane Man operations");
  await page.goto("/counts");
  await expect(page).toHaveTitle("Counts · Mane Man operations");
  const crumbs = page.getByRole("banner").getByRole("navigation", { name: opsCopy.shell.crumbs });
  await expect(crumbs.getByRole("listitem")).toHaveText([opsCopy.shell.nav.inventory, opsCopy.shell.sections.counts]);
  await page.goto("/settings/prices");
  await expect(page).toHaveTitle("Consultation and fees · Settings · Mane Man operations");
});

test("says who is signed in, in the account's panel", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: opsCopy.shell.account.label }).click();
  const header = page.getByRole("banner");
  await expect(header).toContainText("ops@localhost");
  // No Access stands in front of a laptop, so there is no session to leave.
  await expect(header.getByRole("link", { name: opsCopy.shell.account.signOut })).toHaveCount(0);
});

test("signs out through Access, where Access stands in front", async ({ page }) => {
  await answer(page, { "GET /api/whoami": signedIn("aditya.kumar@maneman.in", true, ONLY_SIGNED_IN) });
  await page.goto("/");
  const account = page.getByRole("button", { name: opsCopy.shell.account.label });
  await expect(account).toHaveText("AK");
  await account.click();
  const header = page.getByRole("banner");
  await expect(header).toContainText("aditya.kumar@maneman.in");
  await expect(header.getByRole("link", { name: opsCopy.shell.account.signOut })).toHaveAttribute(
    "href",
    "/cdn-cgi/access/logout",
  );
});

test("keeps the theme chosen, and draws the console dark", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: opsCopy.shell.account.label }).click();
  await page.getByRole("button", { name: opsCopy.shell.account.themes.dark }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const ground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(ground).toBe("rgb(14, 23, 40)");
});

test("folds the navigation to its icons, and keeps it folded", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: opsCopy.shell.fold }).click();
  await expect(navigation(page)).toHaveAttribute("data-folded", "true");
  await page.reload();
  await expect(navigation(page)).toHaveAttribute("data-folded", "true");
  // Folded, each entry is still named for a screen reader.
  await expect(navigation(page).getByRole("link", { name: opsCopy.shell.nav.dispatch })).toBeVisible();
});

test("tells a person the enforced Staff list does not name that the console is closed to them", async ({ page }) => {
  await answer(page, { "GET /api/whoami": signedIn("new.joiner@maneman.in", false, ONLY_SIGNED_IN) });
  await page.goto("/waitlist");
  await expect(page.getByRole("status").filter({ hasText: "You’re not on the Staff list" })).toBeVisible();
  await expect(navigation(page).getByRole("link")).toHaveCount(0);
  await expect(page.getByText("Your access does not reach this page.")).toHaveCount(0);
});

// A spent Access session sent every call to Access's login page, and the console said "You are offline".
test("says the sign-in has run out when Access turns a call away, and offers the reload that signs in", async ({
  page,
}) => {
  await page.route("**/api/waitlist", (route) =>
    route.fulfill({ status: 302, headers: { Location: "https://maneman.cloudflareaccess.com/cdn-cgi/access/login" } }),
  );
  await page.goto("/waitlist");
  const lapsed = page.getByRole("alert").filter({ hasText: "Your session has expired" });
  await expect(lapsed).toBeVisible();
  await expect(lapsed.getByRole("button", { name: opsCopy.shell.reload })).toBeVisible();
  await expect(page.getByText("You are offline")).toHaveCount(0);
});

// A Ctrl-click was swallowed, so a page could not be opened in a tab of its own.
test("leaves a click that asks for a new tab to the browser", async ({ page, context }) => {
  await page.goto("/");
  // Settled on /today first: the console opens before whoami answers, and is drawn again once / becomes /today, so a
  // click before then can land on a link that is being replaced.
  await expect(heading(page, opsCopy.shell.sections.today)).toBeVisible();
  await expect(page).toHaveURL(/\/today$/);
  // A click that lands as the navigation is drawn again opens nothing, so it is pressed again until a tab opens.
  let tab: Page | undefined;
  await expect(async () => {
    const opened = context.waitForEvent("page", { timeout: 5_000 });
    await navigation(page)
      .getByRole("link", { name: opsCopy.shell.nav.growth })
      .click({ modifiers: ["ControlOrMeta"] });
    tab = await opened;
  }).toPass();
  // The tab opens on about:blank before it loads the link. Its address is what the browser was asked for; waiting for
  // its whole page to load as well timed out on a busy runner with the address already right.
  await tab?.waitForURL(/\/referrals$/, { waitUntil: "commit" });
  await expect(heading(page, opsCopy.shell.sections.today)).toBeVisible();
  await expect(page).toHaveURL(/\/today$/);
});

test("serves its policy: its own origin only, its own camera, no payment, and noindex", async ({ page }) => {
  const response = await page.goto("/");
  const headers = response?.headers() ?? {};
  expect(headers["content-security-policy"]).toContain("default-src 'none'");
  expect(headers["content-security-policy"]).toContain("connect-src 'self'");
  expect(headers["content-security-policy"]).toContain("frame-src 'none'");
  expect(headers["permissions-policy"]).toContain("camera=(self)");
  expect(headers["permissions-policy"]).toContain("payment=()");
  expect(headers["x-robots-tag"]).toBe("noindex, nofollow");
});

test("answers any page path with the console, as a single-page app", async ({ page }) => {
  const response = await page.goto("/waitlist");
  expect(response?.status()).toBe(200);
  await expect(heading(page, opsCopy.shell.sections.waitlist)).toBeVisible();
});

test("reaches mm-api as the ops surface, on its own host", async ({ page }) => {
  await page.goto("/");
  const statuses = await page.evaluate(async () => {
    const [health, board, me] = await Promise.all(
      ["/api/health", "/api/dispatch", "/api/me"].map((path) => fetch(path)),
    );
    return { health: health?.status, board: board?.status, me: me?.status };
  });
  // /api/me belongs to the client surface, so it does not exist on this host.
  expect(statuses).toEqual({ health: 200, board: 200, me: 404 });
});

// Each page drew its own frame, so every move drew the navigation again.
test("moves between pages without a reload, keeping its frame, and back", async ({ page }) => {
  await page.goto("/");
  await expect(heading(page, opsCopy.shell.sections.today)).toBeVisible();
  await navigation(page).evaluate((nav) => {
    nav.dataset.drawn = "once";
  });
  await navigation(page).getByRole("link", { name: opsCopy.shell.nav.growth }).click();
  await expect(heading(page, opsCopy.shell.sections.referrals)).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/referrals");
  await expect(navigation(page)).toHaveAttribute("data-drawn", "once");
  await page.goBack();
  await expect(heading(page, opsCopy.shell.sections.today)).toBeVisible();
});

// Each page is a test of its own, so one that fails is named.
for (const path of [
  "/",
  "/referrals",
  "/waitlist",
  "/technician-pay",
  "/partner-commission",
  "/spend",
  "/settings/targets",
  "/settings/words",
  "/settings/field",
  "/messages",
  "/care-numbers",
  "/activity",
]) {
  test(`meets WCAG 2.2 AA on ${path}`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // The frame's heading stands from the first paint: axe reads the page once its calls have answered.
    await page.waitForLoadState("networkidle");
    expect(await axeViolations(page)).toEqual([]);
  });
}

// The dark theme's own colours, read by axe as the light theme's are.
for (const path of ["/", "/waitlist", "/settings/field", "/activity"]) {
  test(`meets WCAG 2.2 AA on ${path} in the dark theme`, async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("mm-ops-theme", "dark");
    });
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(await axeViolations(page)).toEqual([]);
  });
}

// Inventory's eight pages were eight entries of the navigation; the job is one entry now, its pages a page's tabs.
test("heads each page of an entry with the entry's pages as tabs, and marks the one open", async ({ page }) => {
  await answer(page, { "GET /api/tasks": json(TASKS) });
  await page.goto("/counts");
  const tabs = page.getByRole("main").getByRole("navigation", { name: opsCopy.shell.nav.inventory });
  await expect(tabs.getByRole("link", { name: opsCopy.shell.sections.counts })).toHaveAttribute("aria-current", "page");
  await expect(tabs.getByRole("link", { name: opsCopy.shell.sections.items })).toBeVisible();
  await expect(navigation(page).getByRole("link", { name: opsCopy.shell.nav.inventory })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("goes to a page by its name from anywhere, with Ctrl K or Search", async ({ page }) => {
  // Where it goes is answered here, refused, so the page it opens reads nothing the other specs left behind.
  await answer(page, { "GET /api/tasks": json(TASKS), "GET /api/dispatch": fails(403, "access_required") });
  await page.goto("/tasks");
  await expect(heading(page, opsCopy.shell.sections.tasks)).toBeVisible();
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: opsCopy.shell.palette.title });
  // Typed straight away, as a person does: the box has the keyboard once the palette opens.
  await expect(palette.getByLabel(opsCopy.shell.palette.label)).toBeFocused();
  await page.keyboard.type("disp");
  await palette.getByRole("link", { name: opsCopy.dispatch.title }).click();
  await expect(page).toHaveURL(/\/dispatch$/);
  await expect(palette).toBeHidden();

  await page
    .getByRole("banner")
    .getByRole("button", { name: new RegExp(opsCopy.shell.search) })
    .click();
  await palette.getByLabel(opsCopy.shell.palette.label).fill("packages");
  await palette.getByRole("link", { name: opsCopy.shell.palette.setting(opsCopy.settingsPageNames.packages) }).click();
  await expect(page).toHaveURL(/\/settings\/packages$/);
});
