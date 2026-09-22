// The client app as a PWA (docs/decisions/0043-client-app.md): installable from
// its manifest, and able to open offline on the last Home the service worker
// kept (board B3). No other API answer is kept, and logging out forgets Home.

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { signIn } from "./signed-in.ts";

test.use({ serviceWorkers: "allow" });

const OFFLINE = "No connection. Showing your last update.";

/** Waits for the service worker to take the page, then reloads, so Home comes through it and is kept. */
async function keepHome(page: Page): Promise<void> {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Your consultation" })).toBeVisible();
}

/** The path of every response the service worker keeps. */
function keptPaths(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const paths: string[] = [];
    for (const name of await caches.keys()) {
      for (const request of await (await caches.open(name)).keys()) paths.push(new URL(request.url).pathname);
    }
    return paths;
  });
}

test("is installable, from a manifest drawn from the brand kit", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  const manifest = await page.evaluate(async () => {
    const response = await fetch("/manifest.webmanifest");
    return { type: response.headers.get("content-type"), body: (await response.json()) as Record<string, unknown> };
  });
  expect(manifest.type).toContain("application/manifest+json");
  expect(manifest.body).toMatchObject({
    name: "Mane Man",
    start_url: "/",
    display: "standalone",
    background_color: "#16233a",
    theme_color: "#16233a",
  });

  const icons = ["/icon-192.png", "/icon-512.png", "/icon-maskable-512.png", "/apple-touch-icon.png"];
  const types = await page.evaluate(
    (paths) => Promise.all(paths.map(async (path) => (await fetch(path)).headers.get("content-type"))),
    icons,
  );
  expect(types).toEqual(icons.map(() => "image/png"));

  const chrome = await page.context().newCDPSession(page);
  const { installabilityErrors } = await chrome.send("Page.getInstallabilityErrors");
  expect(installabilityErrors).toEqual([]);
});

test("opens offline on the last Home, with board B3's banner, and Reschedule waits", async ({ page, request }) => {
  await signIn(page, request);
  await keepHome(page);

  await page.context().setOffline(true);
  await page.reload();
  await expect(page.getByRole("status").filter({ hasText: OFFLINE })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your consultation" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reschedule" })).toBeDisabled();
  await expect(page.getByRole("link", { name: "Add a note" })).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);

  await page.context().setOffline(false);
  await expect(page.getByText(OFFLINE)).toBeHidden();
  await expect(page.getByRole("link", { name: "Reschedule" })).toBeVisible();
});

test("says the visit is still booked when the API fails and the phone kept Home", async ({ page, request }) => {
  await signIn(page, request);
  await keepHome(page);
  // The context's route reaches the service worker's own requests too.
  await page
    .context()
    .route("**/api/me", (route) =>
      route.fulfill({ status: 503, json: { error: { code: "unavailable", message: "Down for a moment." } } }),
    );
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "We could not load your visit." })).toBeVisible();
  await expect(page.getByText("Your visit is still booked.")).toBeVisible();
});

test("shows the banner when the connection drops while the app is open", async ({ page, request }) => {
  await signIn(page, request);
  await page.context().setOffline(true);
  await expect(page.getByRole("status").filter({ hasText: OFFLINE })).toBeVisible();
  await page.context().setOffline(false);
  await expect(page.getByText(OFFLINE)).toBeHidden();
});

test("keeps no API answer but Home, and forgets Home at logout", async ({ page, request }) => {
  await signIn(page, request);
  await keepHome(page);
  await page.getByRole("link", { name: "Your profile" }).click();
  await expect(page.getByRole("heading", { name: "Where we come" })).toBeVisible();
  expect((await keptPaths(page)).filter((path) => path.startsWith("/api/"))).toEqual(["/api/me"]);

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Your mobile number" })).toBeVisible();
  expect((await keptPaths(page)).filter((path) => path.startsWith("/api/"))).toEqual([]);

  // The app itself still opens offline, but with no Home kept it can only say so.
  await page.context().setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "We could not load your visit." })).toBeVisible();
});
