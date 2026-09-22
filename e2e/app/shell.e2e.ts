// The client app's shell (docs/decisions/0043-client-app.md): served as the
// mm-app Worker serves it, under its own policy, on the client surface's host.

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "../support.ts";

test("opens on the mobile number, as board A1 draws it", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Mane Man");
  await expect(page.getByRole("heading", { level: 1, name: "Your mobile number" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Mobile number" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send code on WhatsApp" })).toBeVisible();
  await expect(page.getByText("A six-digit code, no password.")).toBeVisible();
});

test("serves its policy: its own origin only, WebOTP, and noindex", async ({ page }) => {
  const response = await page.goto("/");
  const headers = response?.headers() ?? {};
  expect(headers["content-security-policy"]).toContain("default-src 'none'");
  expect(headers["content-security-policy"]).toContain("connect-src 'self'");
  expect(headers["permissions-policy"]).toContain("otp-credentials=(self)");
  expect(headers["permissions-policy"]).toContain("camera=()");
  expect(headers["x-robots-tag"]).toBe("noindex, nofollow");
});

test("answers any page path with the app, as a single-page app", async ({ page }) => {
  const response = await page.goto("/profile");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("reaches mm-api as the client surface, on its own host", async ({ page }) => {
  await page.goto("/");
  const statuses = await page.evaluate(async () => {
    const [health, cities, me] = await Promise.all(
      ["/api/health", "/api/cities", "/api/me"].map((path) => fetch(path)),
    );
    return { health: health?.status, cities: cities?.status, me: me?.status };
  });
  expect(statuses).toEqual({ health: 200, cities: 404, me: 401 });
});

test("keeps the design's column on a wide screen, centred", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const box = await page.locator("#root").boundingBox();
  expect(box?.width).toBe(390);
  expect(Math.round((box?.x ?? 0) * 2 + (box?.width ?? 0))).toBe(1440);
});

test("meets WCAG 2.2 AA", async ({ page }) => {
  await page.goto("/");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
});
