// The ops console's frame (docs/decisions/0026-hosts-and-surfaces.md): served
// as the mm-ops Worker serves it, under its own policy, on the ops surface's
// host. Cloudflare Access guards that host in staging and production; locally
// the stub provider lets everyone through as ops@localhost (ADR 0031).

import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { answer, json, TASKS, TASKS_READ_ON } from "./fixtures.ts";
import * as opsCopy from "../../apps/ops/src/content.ts";

/** Who is signed in when Access stands in front, with the routes their calls go ahead on. */
const signedIn = (who: string, listed: boolean, mayCall: readonly string[]) =>
  json({
    signed_in_as: who,
    sign_out: "/cdn-cgi/access/logout",
    staff: { enforced: true, listed, grants: [], may_call: mayCall },
  });

const ONLY_SIGNED_IN = ["GET /api/health", "GET /api/whoami"];

const navigation = (page: Page) => page.getByRole("navigation", { name: opsCopy.shell.title });

async function expectNames(links: Locator, names: readonly string[]): Promise<void> {
  await expect(links).toHaveCount(names.length);
  for (const [index, name] of names.entries()) {
    await expect(links.nth(index)).toHaveAccessibleName(name);
  }
}

// Twelve flat sections, no counts, and the day's inbox sixth.
test("opens on Tasks, with the sections under their departments, those of one job as one, and what waits in each", async ({
  page,
}) => {
  await page.clock.setFixedTime(TASKS_READ_ON);
  await answer(page, { "GET /api/tasks": json(TASKS) });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Tasks" })).toBeVisible();
  await expect(page).toHaveURL(/\/tasks$/);

  const department = (name: string) => navigation(page).getByRole("list", { name }).getByRole("link");
  await expectNames(department("Operations"), [
    "Tasks, 8 waiting, some overdue",
    "Dispatch",
    "Technicians",
    "Inventory",
  ]);
  await expectNames(department("Customer Care"), ["Clients", "Care", "Data requests, 2 waiting, some overdue"]);
  await expectNames(department("Finance"), [
    "Charges, 2 waiting, some overdue",
    "Prices",
    "Discount codes",
    "Technician pay",
    "Partner commission",
  ]);
  await expectNames(department("Growth"), ["Referrals, 2 waiting, some overdue", "Areas", "Spend", "Words"]);
  await expectNames(department("Admin"), ["Settings", "Staff", "Targets", "Activity"]);
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
  await expect(page).toHaveURL(/\/payments$/);
  await expect(page.getByRole("heading", { level: 1, name: "Charges" })).toBeVisible();
  await expect(navigation(page).getByRole("list")).toHaveCount(1);
  await expectNames(navigation(page).getByRole("list", { name: "Finance" }).getByRole("link"), ["Charges", "Prices"]);

  await page.goto("/areas");
  await expect(page.getByRole("heading", { level: 1, name: "Areas" })).toBeVisible();
  await expect(page.getByText(opsCopy.shell.closed)).toBeVisible();
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
    await expect(
      navigation(page).getByRole("list", { name: "Growth" }).getByRole("link", { name: "Areas" }),
    ).toHaveAttribute("aria-current", "page");
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
  await expect(page.getByRole("link", { name: opsCopy.shell.skip })).toBeFocused();
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

test("says who is signed in, as the design draws them at the header's right", async ({ page }) => {
  await page.goto("/");
  const header = page.getByRole("banner");
  await expect(header).toContainText("Signed in as ops@localhost");
  // No Access stands in front of a laptop, so there is no session to leave.
  await expect(header.getByRole("link", { name: opsCopy.shell.account.signOut })).toHaveCount(0);
});

test("signs out through Access, where Access stands in front", async ({ page }) => {
  await answer(page, { "GET /api/whoami": signedIn("aditya.kumar@maneman.in", true, ONLY_SIGNED_IN) });
  await page.goto("/");
  const header = page.getByRole("banner");
  await expect(header).toContainText("Signed in as aditya.kumar@maneman.in");
  await expect(header).toContainText("AK");
  await expect(header.getByRole("link", { name: opsCopy.shell.account.signOut })).toHaveAttribute(
    "href",
    "/cdn-cgi/access/logout",
  );
});

test("tells a person the enforced Staff list does not name that the console is closed to them", async ({ page }) => {
  await answer(page, { "GET /api/whoami": signedIn("new.joiner@maneman.in", false, ONLY_SIGNED_IN) });
  await page.goto("/areas");
  await expect(page.getByRole("status").filter({ hasText: "You're not on the Staff list" })).toBeVisible();
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
  const lapsed = page.getByRole("alert").filter({ hasText: "Your session has expired" });
  await expect(lapsed).toBeVisible();
  await expect(lapsed.getByRole("button", { name: opsCopy.shell.reload })).toBeVisible();
  await expect(page.getByText("You are offline")).toHaveCount(0);
});

// A Ctrl-click was swallowed, so a section could not be opened in a tab of its own.
test("leaves a click that asks for a new tab to the browser", async ({ page, context }) => {
  await page.goto("/");
  // Settled on /tasks first: Tasks shows at / before whoami answers, and the page is drawn again once / becomes
  // /tasks, so a click before then can land on a link that is being replaced.
  await expect(page.getByRole("heading", { level: 1, name: "Tasks" })).toBeVisible();
  await expect(page).toHaveURL(/\/tasks$/);
  // A click that lands as the sidebar is drawn again opens nothing, so it is pressed again until a tab opens.
  let tab: Page | undefined;
  await expect(async () => {
    const opened = context.waitForEvent("page", { timeout: 5_000 });
    await page.getByRole("link", { name: "Areas" }).click({ modifiers: ["ControlOrMeta"] });
    tab = await opened;
  }).toPass();
  // The tab opens on about:blank before it loads the link. Its address is what the browser was asked for; waiting for
  // its whole page to load as well timed out on a busy runner with the address already right.
  await tab?.waitForURL(/\/areas$/, { waitUntil: "commit" });
  await expect(page.getByRole("heading", { level: 1, name: "Tasks" })).toBeVisible();
  await expect(page).toHaveURL(/\/tasks$/);
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
    expect(await axeViolations(page), path).toEqual([]);
  }
});

// Inventory's nine sections were nine entries of Operations; the job is one entry now, its sections a page's tabs.
test("heads each section of a group with the group's sections as tabs, and marks the one open", async ({ page }) => {
  await answer(page, { "GET /api/tasks": json(TASKS) });
  await page.goto("/counts");
  const tabs = page.getByRole("main").getByRole("navigation", { name: opsCopy.shell.groups.inventory });
  await expect(tabs.getByRole("link", { name: "Counts" })).toHaveAttribute("aria-current", "page");
  await expect(tabs.getByRole("link", { name: "Items" })).toBeVisible();
  await expect(navigation(page).getByRole("link", { name: "Inventory" })).toHaveAttribute("aria-current", "page");
});

test("goes to a page by its name from anywhere, with Ctrl K", async ({ page }) => {
  await answer(page, { "GET /api/tasks": json(TASKS) });
  await page.goto("/tasks");
  await expect(page.getByRole("heading", { level: 1, name: "Tasks" })).toBeVisible();
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: opsCopy.shell.palette.title });
  await palette.getByLabel(opsCopy.shell.palette.label).fill("disp");
  await palette.getByRole("link", { name: "Dispatch" }).click();
  await expect(page).toHaveURL(/\/dispatch$/);
  await expect(palette).toBeHidden();
});
