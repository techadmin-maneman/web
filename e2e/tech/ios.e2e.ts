// The technician app on a WebKit engine: technicians use any phone, iPhones
// among them.
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
import { fakeTech, JOB_ID, ONE_VISIT_CHECKLIST, pageScrolls } from "./fixtures.ts";

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
  // The body is read as text and parsed here, not by the browser: an app served
  // without a manifest answers 404 with a page, and asking the engine to parse
  // that reports the parse it could not do and never the file that is missing.
  const served = await page.evaluate(async () => {
    const answer = await fetch("/manifest.webmanifest");
    return { status: answer.status, body: await answer.text() };
  });
  expect(served.status, "no manifest is served").toBe(200);
  expect(JSON.parse(served.body)).toMatchObject({ display: "standalone", start_url: "/", scope: "/" });
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
  await expect(page.getByText(/The home-screen app signs in on its own/)).toBeVisible();
});

test("draws its screens without one refusal from its own security policy", async ({ page }) => {
  const refused: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy|Refused to/i.test(message.text())) refused.push(message.text());
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      console.error(`Refused to load: ${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  await fakeTech(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "3 jobs today" })).toBeVisible();
  await page.goto(`/jobs/${JOB_ID}`);
  await expect(page.getByRole("link", { name: "Navigate" })).toBeVisible();
  await page.goto(`/jobs/${JOB_ID}/checklist`);
  await expect(page.getByRole("heading", { level: 1, name: "Service checklist" })).toBeVisible();
  await page.goto("/waiting");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // The sign-in, as a phone whose session ended sees it.
  await page.route("**/api/tech/me", (route) => route.fulfill(noSession));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Technician sign in" })).toBeVisible();

  expect(refused).toEqual([]);
});

test("keeps a long checklist's action at the foot of the screen, with its head in view", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.type = "first_fit";
  fake.oneVisit = true;
  fake.checklist = ONE_VISIT_CHECKLIST;
  const halfAnHourAgo = new Date(Date.now() - 30 * 60_000).toISOString();
  fake.progress = {
    ...fake.progress,
    checked_in_at: halfAnHourAgo,
    started_at: halfAnHourAgo,
    steps_done: ["before_photos"],
  };
  await page.goto(`/jobs/${JOB_ID}/checklist`);

  await expect(page.getByRole("heading", { level: 1, name: "Consultation and fit checklist" })).toBeInViewport({
    ratio: 1,
  });
  await expect(page.getByRole("button", { name: "Finish the list to continue" })).toBeInViewport({ ratio: 1 });
  expect(await pageScrolls(page)).toBe(false);
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

  // What the engine held before, or the wipe below is a check on nothing.
  const before = await page.evaluate(() => indexedDB.databases().then((each) => each.map((one) => one.name)));
  expect(before).toContain("mm-tech");

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Technician sign in" })).toBeVisible();
  const after = await page.evaluate(() => indexedDB.databases().then((each) => each.map((one) => one.name)));
  expect(after).not.toContain("mm-tech");
});
