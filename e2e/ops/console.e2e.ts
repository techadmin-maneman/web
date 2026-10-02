// The ops console's frame (docs/decisions/0026-hosts-and-surfaces.md): served
// as the mm-ops Worker serves it, under its own policy, on the ops surface's
// host. Cloudflare Access guards that host in staging and production; locally
// the stub provider lets everyone through as ops@localhost (ADR 0031).

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "../support.ts";
import { answer, json } from "./fixtures.ts";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

test("opens on the dispatch board, with the console's sections beside it", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Dispatch" })).toBeVisible();
  const sections = page.getByRole("navigation", { name: "Operations" });
  // The design's eight, with No-shows where it writes Payments
  // (docs/open-points.md, item 60). Settings is the eighth, built from ADR 0061.
  // The three before it are drawn on no board at all (docs/fidelity-method.md),
  // nor is Stock, beside the technicians whose kits it counts
  // (docs/decisions/0087-consumables-and-stock.md).
  await expect(sections.getByRole("link")).toHaveText([
    "Dispatch",
    "Clients",
    "No-shows",
    "Referrals",
    "Waitlist",
    "Tasks",
    "Technicians",
    "Stock",
    "Grievances",
    "Deletion requests",
    "Number changes",
    "Settings",
  ]);
  await expect(sections.getByRole("link", { name: "Dispatch" })).toHaveAttribute("aria-current", "page");
});

// OPS-20 of the audit, 24 September 2026: every page was titled "Mane Man operations" (WCAG 2.4.2).
test("titles each page by what it is", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Dispatch · Mane Man operations");
  await page.getByRole("link", { name: "Waitlist" }).click();
  await expect(page).toHaveTitle("Waitlist · Mane Man operations");
  await page.goto("/settings/prices");
  await expect(page).toHaveTitle("Services and prices · Settings · Mane Man operations");
});

test("says who is signed in, as board A1 draws them at the header's right", async ({ page }) => {
  await page.goto("/");
  const header = page.getByRole("banner");
  await expect(header).toContainText("Signed in as ops@localhost");
  // No Access stands in front of a laptop, so there is no session to leave.
  await expect(header.getByRole("link", { name: "Sign out" })).toHaveCount(0);
});

test("signs out through Access, where Access stands in front", async ({ page }) => {
  await answer(page, {
    "GET /api/whoami": json({
      signed_in_as: "aditya.kumar@maneman.in",
      sign_out: "/cdn-cgi/access/logout",
      staff: { enforced: true, listed: true, grants: [] },
    }),
  });
  await page.goto("/");
  const header = page.getByRole("banner");
  await expect(header).toContainText("Signed in as aditya.kumar@maneman.in");
  await expect(header).toContainText("AK");
  await expect(header.getByRole("link", { name: "Sign out" })).toHaveAttribute("href", "/cdn-cgi/access/logout");
});

test("tells a person the enforced Staff list does not name that the console is closed to them", async ({ page }) => {
  await answer(page, {
    "GET /api/whoami": json({
      signed_in_as: "new.joiner@maneman.in",
      sign_out: "/cdn-cgi/access/logout",
      staff: { enforced: true, listed: false, grants: [] },
    }),
  });
  await page.goto("/waitlist");
  await expect(page.getByRole("status").filter({ hasText: "You are not on the Staff list" })).toBeVisible();
});

// OPS-18 and VIS-20: the title sat on the header's baseline, high in its 56 px.
test("centres the section's name in the header", async ({ page }) => {
  await page.goto("/waitlist");
  const header = await page.getByRole("banner").boundingBox();
  const title = await page.getByRole("heading", { level: 1 }).boundingBox();
  if (header === null || title === null) throw new Error("the header is not drawn");
  const middle = (box: { y: number; height: number }) => box.y + box.height / 2;
  expect(Math.abs(middle(title) - middle(header))).toBeLessThanOrEqual(2);
});

// FEO-12: a spent Access session sent every call to Access's login page, and the console said "You are offline".
test("says the sign-in has run out when Access turns a call away, and offers the reload that signs in", async ({
  page,
}) => {
  await page.route("**/api/waitlist", (route) =>
    route.fulfill({ status: 302, headers: { Location: "https://maneman.cloudflareaccess.com/cdn-cgi/access/login" } }),
  );
  await page.goto("/waitlist");
  const lapsed = page.getByRole("alert").filter({ hasText: "Your sign-in to the console has run out" });
  await expect(lapsed).toBeVisible();
  await expect(lapsed.getByRole("button", { name: "Reload" })).toBeVisible();
  await expect(page.getByText("You are offline")).toHaveCount(0);
});

// FEO-31: a Ctrl-click was swallowed, so a section could not be opened in a tab of its own.
test("leaves a click that asks for a new tab to the browser", async ({ page, context }) => {
  await page.goto("/");
  const opened = context.waitForEvent("page");
  await page.getByRole("link", { name: "Waitlist" }).click({ modifiers: ["ControlOrMeta"] });
  const tab = await opened;
  await tab.waitForLoadState();
  expect(new URL(tab.url()).pathname).toBe("/waitlist");
  await expect(page.getByRole("heading", { level: 1, name: "Dispatch" })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/");
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
  const response = await page.goto("/waitlist");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "Waitlist" })).toBeVisible();
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
  await page.getByRole("link", { name: "Waitlist" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Waitlist" })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/waitlist");
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Dispatch" })).toBeVisible();
});

test("meets WCAG 2.2 AA on its sections", async ({ page }) => {
  for (const path of ["/", "/referrals", "/waitlist"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(
      results.violations.map((violation) => violation.id),
      path,
    ).toEqual([]);
  }
});
