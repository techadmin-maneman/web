// The try-on end to end against the real local API, whose renderer is the
// AILabTools stub (playwright.config.ts): a drawn photograph goes up, is
// rendered, and the gate is submitted while the render is still running.

import { drawnHeadPhoto, expect, fakeTurnstile, randomMobile, test, throughToGenerate, visit } from "./support.ts";

// One at a time, as for bookings: each upload makes the API verify a Turnstile token.
test.describe.configure({ mode: "serial" });

test("a drawn photograph is rendered, and claimed before the render finishes", async ({ page }) => {
  test.setTimeout(120_000);
  await fakeTurnstile(page);
  await page.clock.install();
  await visit(page, "/try");

  const generated = page.waitForResponse("**/api/tryon/generate");
  await throughToGenerate(page);
  const job = (await (await generated).json()) as { job_id: string; state: string };
  expect(job.state).toBe("queued");

  // Skip v2's twenty seconds; the stub render takes longer than filling in the gate.
  await page.clock.runFor(20_000);
  await page.getByLabel("Name").fill("Test Visitor");
  await page.getByLabel("Mobile").fill(randomMobile());
  const claimed = page.waitForResponse("**/api/tryon/claim");
  await page.getByRole("button", { name: "Show me the result" }).click();
  expect((await claimed).status()).toBe(201);

  const status = await page.request.get(`/api/tryon/status/${job.job_id}`);
  expect(["queued", "rendering", "downloading"]).toContain(((await status.json()) as { state: string }).state);

  await expect(page.getByRole("img", { name: "Simulated result" })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("A copy is on its way to", { exact: false })).toBeVisible();
});

test("the browser that has had its look is refused a second photograph", async ({ page }) => {
  await fakeTurnstile(page);
  await page.clock.install();
  await visit(page, "/try");
  const generated = page.waitForResponse("**/api/tryon/generate");
  await throughToGenerate(page);
  expect((await generated).status()).toBe(202);

  // The render set the mm_look cookie; a second photograph is refused before it is uploaded.
  await visit(page, "/try");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(await drawnHeadPhoto());
  await page.getByText("I understand, and I agree to my photograph being used this way.").click();
  const refused = page.waitForResponse("**/api/tryon/upload-url");
  await page.getByRole("button", { name: "Continue" }).click();
  expect((await refused).status()).toBe(403);
  await expect(page.getByRole("heading", { name: "You have had your look." })).toBeVisible();
});
