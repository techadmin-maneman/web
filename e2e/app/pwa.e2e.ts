// The client app as a PWA (docs/decisions/0043-client-app.md): installable from
// its manifest, and able to open offline on the last Home the service worker
// kept. No other API answer is kept, and logging out forgets Home.

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { signIn } from "./signed-in.ts";
import * as appCopy from "../../apps/app/src/content.ts";

test.use({ serviceWorkers: "allow" });

const OFFLINE = appCopy.states.offline;

/** Waits for the service worker to take the page, then reloads, so Home comes through it and is kept. */
async function keepHome(page: Page): Promise<void> {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.reload();
  await expect(page.getByRole("heading", { name: appCopy.home.consultation.label })).toBeVisible();
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

test("opens offline on the last Home, with the offline banner, and Reschedule waits", async ({ page }) => {
  await signIn(page);
  await keepHome(page);

  await page.context().setOffline(true);
  await page.reload();
  await expect(page.getByRole("status").filter({ hasText: OFFLINE })).toBeVisible();
  await expect(page.getByRole("heading", { name: appCopy.home.consultation.label })).toBeVisible();
  await expect(page.getByRole("button", { name: appCopy.home.reschedule })).toBeDisabled();
  await expect(page.getByRole("link", { name: appCopy.home.note })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  await page.context().setOffline(false);
  await expect(page.getByText(OFFLINE)).toBeHidden();
  await expect(page.getByRole("link", { name: appCopy.home.reschedule })).toBeVisible();
});

test("opens in seconds on a signal that never answers, on the last Home", async ({ page }) => {
  await signIn(page);
  await keepHome(page);
  // A signal that shows a bar and never answers: every request that reaches the network waits for ever.
  await page.context().route("**/*", () => new Promise<void>(() => undefined));
  await page.reload({ timeout: 5_000 });
  await expect(page.getByRole("heading", { name: appCopy.home.consultation.label })).toBeVisible({ timeout: 6_000 });
  await expect(page.getByRole("status").filter({ hasText: OFFLINE })).toBeVisible();
});

test("says the visit is still booked when the API fails and the phone kept Home", async ({ page }) => {
  await signIn(page);
  await keepHome(page);
  // The context's route reaches the service worker's own requests too.
  await page
    .context()
    .route("**/api/me", (route) =>
      route.fulfill({ status: 503, json: { error: { code: "unavailable", request_id: "test" } } }),
    );
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: appCopy.states.error.title })).toBeVisible();
  await expect(page.getByText(appCopy.states.error.booked)).toBeVisible();
});

test("shows the banner when the connection drops while the app is open", async ({ page }) => {
  await signIn(page);
  await page.context().setOffline(true);
  await expect(page.getByRole("status").filter({ hasText: OFFLINE })).toBeVisible();
  await page.context().setOffline(false);
  await expect(page.getByText(OFFLINE)).toBeHidden();
});

test("offline on Visits, which the phone does not keep, says the visits load once back online, and loads them", async ({
  page,
}) => {
  await signIn(page);
  await page.context().setOffline(true);
  await expect(page.getByRole("status").filter({ hasText: OFFLINE })).toBeVisible();
  await page.getByRole("navigation").getByRole("link", { name: appCopy.titles.visits }).click();
  await expect(page.getByRole("status").filter({ hasText: appCopy.states.offlineOnly })).toBeVisible();
  await expect(page.getByText(OFFLINE)).toHaveCount(0);
  const waiting = page.getByText(appCopy.visits.offline);
  await expect(waiting).toBeVisible();
  await expect(page.getByText(appCopy.errors.load)).toHaveCount(0);

  await page.context().setOffline(false);
  await expect(page.getByText("Consultation · 9 am–12 noon")).toBeVisible();
  await expect(waiting).toBeHidden();
  await expect(page.getByText(appCopy.states.offlineOnly)).toBeHidden();
});

test("keeps no API answer but Home, and forgets Home at logout", async ({ page }) => {
  await signIn(page);
  await keepHome(page);
  await page.getByRole("link", { name: appCopy.titles.profile }).click();
  await expect(page.getByRole("heading", { name: appCopy.profile.where })).toBeVisible();
  expect((await keptPaths(page)).filter((path) => path.startsWith("/api/"))).toEqual(["/api/me"]);

  await page.getByRole("button", { name: appCopy.profile.logout }).click();
  await expect(page.getByRole("heading", { level: 1, name: appCopy.login.mobile.title })).toBeVisible();
  expect((await keptPaths(page)).filter((path) => path.startsWith("/api/"))).toEqual([]);

  // The app itself still opens offline. With no Home kept on a phone that logged out, it opens on the login,
  // not on the design's error, which is for a client who is still in.
  await page.context().setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: appCopy.login.mobile.title })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: appCopy.states.error.title })).toHaveCount(0);
});

test("offers a new build’s worker on Home, and loads the page on it at the tap", async ({ page }) => {
  await signIn(page);
  await keepHome(page);

  // The next release: a worker at another address for the same scope, which installs and waits as a new build does.
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js?next-build");
  });

  const update = page.getByRole("button", { name: appCopy.update.action });
  await expect(update).toBeVisible({ timeout: 15_000 });
  await update.click();
  await expect(page.getByRole("heading", { name: appCopy.home.consultation.label })).toBeVisible();
  // The page loaded again under the new build's worker.
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? ""))
    .toContain("next-build");
});
