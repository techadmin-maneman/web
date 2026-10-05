// The service worker (apps/tech/sw/sw.ts): a technician in a basement closes
// the app, reopens it, and still sees the day and the queue.
//
// The other technician tests block service workers, because one would answer
// the requests page.route() means to fake. This file lets it run, and fakes the
// API on the browser context instead, because a worker's own calls reach
// browserContext.route() and not page.route().

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { fakeTech, JOB_ID, todayInIndia } from "./fixtures.ts";

test.use({ serviceWorkers: "allow" });

/** The caches the service worker holds, by name, with the paths in each. */
const cachedPaths = (page: Page) =>
  page.evaluate(async () => {
    const kept: Record<string, string[]> = {};
    for (const name of await window.caches.keys()) {
      const cache = await window.caches.open(name);
      kept[name] = (await cache.keys()).map((request) => {
        const url = new URL(request.url);
        return url.pathname + url.search;
      });
    }
    return kept;
  });

/** Waits for the worker to be installed and in charge of the page. */
async function installed(page: Page): Promise<void> {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 30_000 });
}

test("opens with no connection at all, from the shell and today's jobs it cached", async ({ page, context }) => {
  const fake = await fakeTech(page, false, context);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "3 jobs today" })).toBeVisible();

  // The worker installs on the first load and takes charge on the next one.
  await installed(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: "3 jobs today" })).toBeVisible();

  const held = await cachedPaths(page);
  const shell = Object.entries(held).find(([name]) => name.startsWith("mm-tech-shell-"));
  expect(shell?.[1]).toContain("/");
  expect(shell?.[1]?.some((path) => path.startsWith("/assets/"))).toBe(true);
  // Fonts the app never draws with are not the phone's to keep (apps/tech/sw-build.ts).
  expect(shell?.[1]?.filter((path) => /latin-ext|rupee/.test(path))).toEqual([]);
  expect(held["mm-tech-day"]).toEqual([`/api/tech/jobs?date=${todayInIndia()}`]);

  // The basement: no signal, and the app closed and reopened.
  fake.online = false;
  await context.setOffline(true);
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "3 jobs today" })).toBeVisible();
  await expect(page.getByText("No signal · working offline")).toBeVisible();

  expect(await axeViolations(page)).toEqual([]);
});

test("opens on a signal that never answers, from the shell and what the phone holds, without waiting on it", async ({
  page,
  context,
}) => {
  await fakeTech(page, false, context);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "3 jobs today" })).toBeVisible();
  await installed(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: "3 jobs today" })).toBeVisible();

  // "Lie-fi": the phone has a network, and nothing on it ever answers.
  await context.route("**/*", () => new Promise<void>(() => undefined));
  await page.goto("/", { timeout: 5_000 });

  await expect(page.getByRole("heading", { name: "3 jobs today" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("No signal · working offline")).toBeVisible();
});

test("keeps only today's list in its day cache, and lets an earlier day's go", async ({ page, context }) => {
  await fakeTech(page, false, context);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "3 jobs today" })).toBeVisible();
  await installed(page);

  // Yesterday's list, as yesterday's worker would have left it.
  await page.evaluate(async () => {
    const cache = await window.caches.open("mm-tech-day");
    await cache.put("/api/tech/jobs?date=2020-01-01", new Response('{"date":"2020-01-01","jobs":[]}'));
  });

  await page.reload();
  await expect(page.getByRole("heading", { name: "3 jobs today" })).toBeVisible();
  await expect
    .poll(async () => (await cachedPaths(page))["mm-tech-day"])
    .toEqual([`/api/tech/jobs?date=${todayInIndia()}`]);
});

test("caches no client's card, nobody signed in, and no photograph", async ({ page, context }) => {
  await fakeTech(page, false, context);
  await page.goto(`/jobs/${JOB_ID}`);
  await expect(page.getByRole("heading", { level: 1, name: "Rohit M." })).toBeVisible();
  await installed(page);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Rohit M." })).toBeVisible();

  const everything = Object.values(await cachedPaths(page)).flat();
  expect(everything.filter((path) => path.startsWith(`/api/tech/jobs/${JOB_ID}`))).toEqual([]);
  expect(everything.filter((path) => path.startsWith("/api/tech/me"))).toEqual([]);
  expect(everything.filter((path) => path.startsWith("/api/tech/photos"))).toEqual([]);
  expect(everything.filter((path) => path.startsWith("/api/tech/pieces"))).toEqual([]);
});

test("the day the phone cached goes when the technician signs out", async ({ page, context }) => {
  await fakeTech(page, false, context);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "3 jobs today" })).toBeVisible();
  await installed(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: "3 jobs today" })).toBeVisible();
  expect(Object.keys(await cachedPaths(page))).toContain("mm-tech-day");

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Technician sign in" })).toBeVisible();
  expect(Object.keys(await cachedPaths(page))).not.toContain("mm-tech-day");
});
