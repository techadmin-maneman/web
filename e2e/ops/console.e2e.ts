// The ops console's frame (docs/decisions/0026-hosts-and-surfaces.md): served
// as the mm-ops Worker serves it, under its own policy, on the ops surface's
// host. Cloudflare Access guards that host in staging and production; locally
// the stub provider lets everyone through as ops@localhost (ADR 0031).

import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { answer, json, TASKS, TASKS_READ_ON } from "./fixtures.ts";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** Who is signed in when Access stands in front, with the routes their calls go ahead on. */
const signedIn = (who: string, listed: boolean, mayCall: readonly string[]) =>
  json({
    signed_in_as: who,
    sign_out: "/cdn-cgi/access/logout",
    staff: { enforced: true, listed, grants: [], may_call: mayCall },
  });

const ONLY_SIGNED_IN = ["GET /api/health", "GET /api/whoami"];

const navigation = (page: Page) => page.getByRole("navigation", { name: "Console" });

async function expectNames(links: Locator, names: readonly string[]): Promise<void> {
  await expect(links).toHaveCount(names.length);
  for (const [index, name] of names.entries()) {
    await expect(links.nth(index)).toHaveAccessibleName(name);
  }
}

// Twelve flat sections, no counts, and the day's inbox sixth.
test("opens on Tasks, with the sections under their departments and what waits in each", async ({ page }) => {
  await page.clock.setFixedTime(TASKS_READ_ON);
  await answer(page, { "GET /api/tasks": json(TASKS) });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Tasks" })).toBeVisible();
  await expect(page).toHaveURL(/\/tasks$/);

  const department = (name: string) => navigation(page).getByRole("list", { name }).getByRole("link");
  await expectNames(department("Operations"), ["Tasks, 8 waiting, some overdue", "Dispatch", "Technicians", "Stock"]);
  await expectNames(department("Customer Care"), [
    "Clients",
    "Concerns",
    "Number changes, 1 waiting, some overdue",
    "Deletion requests, 1 waiting",
  ]);
  await expectNames(department("Finance"), ["Payments, 2 waiting, some overdue", "Prices", "Discount codes"]);
  await expectNames(department("Growth"), ["Referrals, 2 waiting, some overdue", "Areas"]);
  await expectNames(department("Admin"), ["Settings", "Staff"]);
  await expect(department("Operations").first()).toHaveAttribute("aria-current", "page");
});

test("shows a person only the sections their access opens, and opens on the first of them", async ({ page }) => {
  await answer(page, {
    "GET /api/whoami": signedIn("money@maneman.in", true, [
      ...ONLY_SIGNED_IN,
      "GET /api/no-shows",
      "GET /api/services",
    ]),
  });
  await page.goto("/");
  await expect(page).toHaveURL(/\/no-shows$/);
  await expect(page.getByRole("heading", { level: 1, name: "Payments" })).toBeVisible();
  await expect(navigation(page).getByRole("list")).toHaveCount(1);
  await expectNames(navigation(page).getByRole("list", { name: "Finance" }).getByRole("link"), ["Payments", "Prices"]);

  await page.goto("/areas");
  await expect(page.getByRole("heading", { level: 1, name: "Areas" })).toBeVisible();
  await expect(
    page.getByText("Your access does not reach this page. An Admin can add it on the Staff page."),
  ).toBeVisible();
});

// Launching an area had two homes, the waitlist and Settings › Service area.
test("opens the waitlist and the service area at their old addresses, as the tabs of Areas", async ({ page }) => {
  for (const [old, now] of [
    ["/settings/area", /\/areas\/served$/],
    ["/service-area", /\/areas\/served$/],
    ["/waitlist", /\/areas$/],
  ] as const) {
    await page.goto(old);
    await expect(page.getByRole("heading", { level: 1, name: "Areas" })).toBeVisible();
    await expect(page).toHaveURL(now);
    await expect(navigation(page).getByRole("list", { name: "Growth" }).getByRole("link").last()).toHaveAttribute(
      "aria-current",
      "page",
    );
  }
  const tabs = page.getByRole("navigation", { name: "Areas" });
  await expect(tabs.getByRole("link")).toHaveText(["Waiting", "Served"]);
  await expect(tabs.getByRole("link", { name: "Waiting" })).toHaveAttribute("aria-current", "page");
});

// Changing section dropped the focus to the page, and nothing led past the navigation.
test("moves the keyboard to a new page's heading, and offers a way past the navigation", async ({ page }) => {
  await page.goto("/areas");
  await expect(page.getByRole("heading", { level: 1, name: "Areas" })).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();

  await navigation(page).getByRole("link", { name: "Referrals" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Referrals" })).toBeFocused();
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Areas" })).toBeFocused();
});

// Every page was titled "Mane Man operations" (WCAG 2.4.2).
test("titles each page by what it is", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Tasks · Mane Man operations");
  await page.getByRole("link", { name: "Areas" }).click();
  await expect(page).toHaveTitle("Waiting · Areas · Mane Man operations");
  await page.goto("/settings/prices");
  await expect(page).toHaveTitle("Prices · Mane Man operations");
});

test("says who is signed in, as board A1 draws them at the header's right", async ({ page }) => {
  await page.goto("/");
  const header = page.getByRole("banner");
  await expect(header).toContainText("Signed in as ops@localhost");
  // No Access stands in front of a laptop, so there is no session to leave.
  await expect(header.getByRole("link", { name: "Sign out" })).toHaveCount(0);
});

test("signs out through Access, where Access stands in front", async ({ page }) => {
  await answer(page, { "GET /api/whoami": signedIn("aditya.kumar@maneman.in", true, ONLY_SIGNED_IN) });
  await page.goto("/");
  const header = page.getByRole("banner");
  await expect(header).toContainText("Signed in as aditya.kumar@maneman.in");
  await expect(header).toContainText("AK");
  await expect(header.getByRole("link", { name: "Sign out" })).toHaveAttribute("href", "/cdn-cgi/access/logout");
});

test("tells a person the enforced Staff list does not name that the console is closed to them", async ({ page }) => {
  await answer(page, { "GET /api/whoami": signedIn("new.joiner@maneman.in", false, ONLY_SIGNED_IN) });
  await page.goto("/areas");
  await expect(page.getByRole("status").filter({ hasText: "You are not on the Staff list" })).toBeVisible();
  await expect(navigation(page).getByRole("link")).toHaveCount(0);
  await expect(page.getByText("Your access does not reach this page.")).toHaveCount(0);
});

// The title sat on the header's baseline, high in its 56 px.
test("centres the section's name in the header", async ({ page }) => {
  await page.goto("/areas");
  const header = await page.getByRole("banner").boundingBox();
  const title = await page.getByRole("heading", { level: 1 }).boundingBox();
  if (header === null || title === null) throw new Error("the header is not drawn");
  const middle = (box: { y: number; height: number }) => box.y + box.height / 2;
  expect(Math.abs(middle(title) - middle(header))).toBeLessThanOrEqual(2);
});

// A spent Access session sent every call to Access's login page, and the console said "You are offline".
test("says the sign-in has run out when Access turns a call away, and offers the reload that signs in", async ({
  page,
}) => {
  await page.route("**/api/waitlist", (route) =>
    route.fulfill({ status: 302, headers: { Location: "https://maneman.cloudflareaccess.com/cdn-cgi/access/login" } }),
  );
  await page.goto("/areas");
  const lapsed = page.getByRole("alert").filter({ hasText: "Your sign-in to the console has run out" });
  await expect(lapsed).toBeVisible();
  await expect(lapsed.getByRole("button", { name: "Reload" })).toBeVisible();
  await expect(page.getByText("You are offline")).toHaveCount(0);
});

// A Ctrl-click was swallowed, so a section could not be opened in a tab of its own.
test("leaves a click that asks for a new tab to the browser", async ({ page, context }) => {
  await page.goto("/");
  // Settled on Tasks first: a click while / still sends the page there can land before the link answers it.
  await expect(page.getByRole("heading", { level: 1, name: "Tasks" })).toBeVisible();
  const opened = context.waitForEvent("page");
  await page.getByRole("link", { name: "Areas" }).click({ modifiers: ["ControlOrMeta"] });
  const tab = await opened;
  await tab.waitForLoadState();
  expect(new URL(tab.url()).pathname).toBe("/areas");
  await expect(page.getByRole("heading", { level: 1, name: "Tasks" })).toBeVisible();
  await expect(page).toHaveURL(/\/tasks$/);
});

test("serves its policy: its own origin only, no camera and no payment, and noindex", async ({ page }) => {
  const response = await page.goto("/");
  const headers = response?.headers() ?? {};
  expect(headers["content-security-policy"]).toContain("default-src 'none'");
  expect(headers["content-security-policy"]).toContain("connect-src 'self'");
  expect(headers["content-security-policy"]).toContain("frame-src 'none'");
  expect(headers["permissions-policy"]).toContain("camera=()");
  expect(headers["permissions-policy"]).toContain("payment=()");
  expect(headers["x-robots-tag"]).toBe("noindex, nofollow");
});

test("answers any page path with the console, as a single-page app", async ({ page }) => {
  const response = await page.goto("/areas");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "Areas" })).toBeVisible();
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

test("moves between sections without a reload, and back", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Areas" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Areas" })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/areas");
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Tasks" })).toBeVisible();
});

test("meets WCAG 2.2 AA on its sections", async ({ page }) => {
  for (const path of ["/", "/referrals", "/areas"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(
      results.violations.map((violation) => violation.id),
      path,
    ).toEqual([]);
  }
});
