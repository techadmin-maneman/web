// The ops console's frame (docs/decisions/0026-hosts-and-surfaces.md): served
// as the mm-ops Worker serves it, under its own policy, on the ops surface's
// host. Cloudflare Access guards that host in staging and production; locally
// the stub provider lets everyone through as ops@localhost (ADR 0031).

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "../support.ts";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

test("opens on the dispatch board, with the console's sections beside it", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Mane Man operations");
  await expect(page.getByRole("heading", { level: 1, name: "Dispatch" })).toBeVisible();
  const sections = page.getByRole("navigation", { name: "Operations" });
  // The design's eight, less Tasks and Settings, which no route answers, and with
  // No-shows where it writes Payments (docs/open-points.md, items 57 and 58).
  await expect(sections.getByRole("link")).toHaveText([
    "Dispatch",
    "Clients",
    "No-shows",
    "Referrals",
    "Waitlist",
    "Technicians",
  ]);
  await expect(sections.getByRole("link", { name: "Dispatch" })).toHaveAttribute("aria-current", "page");
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
