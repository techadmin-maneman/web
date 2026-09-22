// F4's launch checks: the JavaScript budget on the home page, what search
// engines and shared links read, and the security headers each page is served
// with (docs/feature-inventory.md, "Launch").

import { gzipSync } from "node:zlib";
import { expect, fakeTurnstile, test } from "./support.ts";

const JS_BUDGET_BYTES = 60 * 1024;

test("the home page loads under 60 KB of JavaScript, gzipped, and none of the try-on's", async ({ page }) => {
  const scripts: { url: string; bytes: number }[] = [];
  page.on("response", async (response) => {
    if (response.request().resourceType() !== "script") return;
    scripts.push({ url: response.url(), bytes: gzipSync(await response.body()).length });
  });
  await page.goto("/");
  // Scroll through, so every island that waits to be seen loads too.
  for (let y = 0; y < (await page.evaluate(() => document.body.scrollHeight)); y += 600) {
    await page.mouse.wheel(0, 600);
  }
  await page.waitForLoadState("networkidle");
  const total = scripts.reduce((sum, script) => sum + script.bytes, 0);
  expect(total, scripts.map((script) => `${script.url} ${String(script.bytes)}`).join("\n")).toBeLessThan(
    JS_BUDGET_BYTES,
  );
  expect(scripts.filter((script) => /TryOn|Booking|tryon|photo/.test(script.url))).toEqual([]);
});

const ROUTES = [
  { path: "/", title: "Mane Man — hair, fitted at your home across Delhi NCR" },
  { path: "/try", title: "See yourself with hair — Mane Man" },
  { path: "/book", title: "Book a free consultation — Mane Man" },
  { path: "/privacy", title: "Privacy — Mane Man" },
  { path: "/terms", title: "Terms — Mane Man" },
];

for (const { path, title } of ROUTES) {
  test(`${path}: a title, a description, a canonical link and a shared-link card`, async ({ page }) => {
    await fakeTurnstile(page);
    await page.goto(path);
    await expect(page).toHaveTitle(title);
    const canonical = `https://maneman.in${path}`;
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", canonical);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /^.{40,}$/);
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", canonical);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", "https://maneman.in/og.png");
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
  });
}

test("the home page describes the business and its FAQ as structured data", async ({ page }) => {
  await page.goto("/");
  const data = await page
    .locator('script[type="application/ld+json"]')
    .evaluateAll((scripts) => scripts.map((script) => JSON.parse(script.textContent) as Record<string, unknown>));
  const business = data.find((item) => item["@type"] === "LocalBusiness");
  expect(business).toMatchObject({ name: "Mane Man", url: "https://maneman.in/", telephone: "+919007973247" });
  const faq = data.find((item) => item["@type"] === "FAQPage") as { mainEntity: { name: string }[] } | undefined;
  const questions = await page.locator("[data-section=faq] summary > span").allTextContents();
  expect(faq?.mainEntity.map((question) => question.name)).toEqual(questions.map((question) => question.trim()));
});

test("the 404 page is not indexed and has no canonical link", async ({ page }) => {
  await page.goto("/no-such-page");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
});

test("the sitemap lists the pages, and robots.txt keeps this build out of search", async ({ request }) => {
  const sitemap = await (await request.get("/sitemap.xml")).text();
  for (const path of ["/", "/try", "/book", "/privacy", "/terms"]) {
    expect(sitemap).toContain(`<loc>https://maneman.in${path}</loc>`);
  }
  expect(await (await request.get("/robots.txt")).text()).toBe("User-agent: *\nDisallow: /\n");
});

test("every page is served with the security headers, and only /try may use the camera", async ({ request }) => {
  for (const path of ["/", "/try", "/book", "/privacy"]) {
    const headers = (await request.get(path)).headers();
    expect(headers["content-security-policy"]).toMatch(/^default-src 'self'; script-src 'self' 'sha256-/);
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["strict-transport-security"]).toBe("max-age=31536000");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["permissions-policy"]).toMatch(path === "/try" ? /^camera=\(self\),/ : /^camera=\(\),/);
  }
});

test("an address carrying anything but campaign tags is tidied before any analytics tag reads it", async ({ page }) => {
  await page.goto("/?utm_source=google&mobile=9810000000&name=Test&gclid=abc");
  await expect.poll(() => new URL(page.url()).search).toBe("?utm_source=google&gclid=abc");
});
