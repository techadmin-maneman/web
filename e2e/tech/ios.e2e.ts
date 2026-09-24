// The technician app on a WebKit engine, which the owner's ruling of
// 24 September 2026 made our business: technicians use any phone, including
// iPhones (docs/open-points.md, item 27).
//
// **This is not Safari on iOS, and nothing here proves what an iPhone does.**
// Playwright's WebKit is the same rendering and JavaScript engine behind a
// different browser: no Intelligent Tracking Prevention, no seven-day cap on
// script-writable storage, no Home Screen Web App, and its own answer to
// `navigator.storage.persist()`. What these tests prove is that the app's code
// paths run on the engine an iPhone uses and that nothing here is Chromium-only.
// What only a real iPhone can settle is the iPhone pass in
// docs/tech-field-test.md.
//
// The rest of the technician suite runs on Chromium (playwright.config.ts): a
// second engine over every screen would double the run for little, and the
// camera's fake device is Chromium's alone.

import { expect, test } from "../support.ts";
import { fakeTech, JOB_ID } from "./fixtures.ts";

/** A 401 with no session: what an installed iOS app's own cookie jar produces on its first call. */
const noSession = { status: 401, json: { error: { code: "session_required", request_id: "test" } } };

/** Apple's own flag for a web app opened from the home screen, which older iPhones have and nothing else does. */
async function fromTheHomeScreen(page: Parameters<typeof fakeTech>[0]): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
  });
}

test("serves the manifest that makes a home-screen copy a standalone app", async ({ page }) => {
  await page.goto("/");

  // `display: standalone` is what separates an installed app from a bookmark
  // that opens in Safari, and only the installed one keeps its store.
  const manifest = await page.evaluate(async () => {
    const answer = await fetch("/manifest.webmanifest");
    return (await answer.json()) as { display?: string; start_url?: string; scope?: string };
  });
  expect(manifest).toMatchObject({ display: "standalone", start_url: "/", scope: "/" });
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
});

test("opens the route from Navigate, which the geo: link it replaced never did", async ({ page, context }) => {
  await fakeTech(page);
  // Nothing leaves the machine: the map is answered with a blank page.
  await context.route("https://www.google.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<title>map</title>" }),
  );
  await page.goto(`/jobs/${JOB_ID}`);

  const opening = context.waitForEvent("page");
  await page.getByRole("link", { name: "Navigate" }).click();
  const map = await opening;
  expect(map.url()).toBe("https://www.google.com/maps/dir/?api=1&destination=28.39%2C77.07");

  // And the app is still there behind it, which is what the technician comes back to.
  await expect(page.getByRole("link", { name: "Navigate" })).toBeVisible();
});

test("tells a technician why the app on his home screen is signed out", async ({ page }) => {
  await fromTheHomeScreen(page);
  await page.route("**/api/tech/me", (route) => route.fulfill(noSession));
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "Technician sign in" })).toBeVisible();
  await expect(page.getByText(/This is the app on your home screen/)).toBeVisible();
});

test("opens on an engine that offers no StorageManager at all", async ({ page }) => {
  // Older WebKit has none, and a browser that cannot be asked has made no promise either.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "storage", { value: undefined, configurable: true });
  });
  await fakeTech(page);
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "3 jobs today" })).toBeVisible();
});

test("wipes everything the phone holds when the technician signs out", async ({ page }) => {
  await fakeTech(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "3 jobs today" })).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Technician sign in" })).toBeVisible();
  const after = await page.evaluate(() => indexedDB.databases().then((each) => each.map((one) => one.name)));
  expect(after).not.toContain("mm-tech");
});
