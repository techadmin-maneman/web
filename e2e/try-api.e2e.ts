// The try-on end to end against the real local API, whose renderer is the
// AILabTools stub (playwright.config.ts): a drawn photograph goes up, the gate
// is given a number, and only then is the look made, to go to WhatsApp alone
// (ADR 0104). The page never asks for the look.

import type { Page } from "@playwright/test";
import { expect, fakeTurnstile, randomMobile, sendFromGate, test, throughToGate, visit } from "./support.ts";

// One at a time, as for bookings: each upload makes the API verify a Turnstile token.
test.describe.configure({ mode: "serial" });

/** Every request the page makes for a look, which it must never make. */
function lookRequests(page: Page): string[] {
  const asked: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/tryon/result") || path.startsWith("/api/result/")) asked.push(path);
  });
  return asked;
}

test("a drawn photograph's look is made once the gate has the number, and never shown", async ({ page }) => {
  test.setTimeout(120_000);
  await fakeTurnstile(page);
  await page.clock.install();
  const asked = lookRequests(page);
  await visit(page, "/try");
  await throughToGate(page);

  const claimed = page.waitForResponse("**/api/tryon/claim");
  const generated = page.waitForResponse("**/api/tryon/generate");
  await sendFromGate(page, randomMobile());
  expect((await claimed).status()).toBe(201);
  const job = (await (await generated).json()) as { job_id: string; state: string };
  expect(job.state).toBe("queued");
  await expect(page.getByRole("heading", { name: "Your new look is on its way." })).toBeVisible();

  // The stub renders it; the messaging queue sends it. The page shows none of it.
  await expect
    .poll(
      async () => {
        const status = await page.request.get(`/api/tryon/status/${job.job_id}`);
        return ((await status.json()) as { state: string }).state;
      },
      { timeout: 90_000 },
    )
    .toBe("ready");
  await expect(page.locator("[data-screen] img")).toHaveCount(0);
  expect(asked).toEqual([]);
});

test("the browser that has had its look is told it was sent, not asked for a photograph", async ({ page }) => {
  test.setTimeout(120_000);
  await fakeTurnstile(page);
  await page.clock.install();
  await visit(page, "/try");
  await throughToGate(page);
  const generated = page.waitForResponse("**/api/tryon/generate");
  await sendFromGate(page, randomMobile());
  expect((await generated).status()).toBe(202);

  // The render set the mm_look cookie, so the page asks on arrival and says the look was sent before a photograph is
  // chosen. The API's refusal of a second photograph is test/worker/tryon-api.test.ts's.
  const uploads: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/tryon/upload-url")) uploads.push(request.url());
  });
  const asked = page.waitForResponse("**/api/tryon/look");
  await visit(page, "/try");
  expect((await asked).status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Your look has already been sent." })).toBeVisible();
  expect(uploads).toEqual([]);
});
