// The try-on end to end against the real local API, whose renderer is the
// AILabTools stub (playwright.config.ts): a drawn photograph goes up, is
// rendered, and the gate is submitted while the render is still running.

import { expect, fakeTurnstile, randomMobile, test, throughToGenerate, visit } from "./support.ts";

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

test("the number is optional: the render shows with no gate, and no lead is made", async ({ page }) => {
  test.setTimeout(120_000);
  await fakeTurnstile(page);
  await page.clock.install();
  await visit(page, "/try");
  await throughToGenerate(page);
  await page.clock.runFor(20_000);
  const claims: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/tryon/claim")) claims.push(request.url());
  });
  await page.getByRole("button", { name: "Show me the result" }).click();
  await expect(page.getByRole("img", { name: "Simulated result" })).toBeVisible({ timeout: 90_000 });
  expect(claims).toEqual([]);
});

test("the browser that has had its look is shown it again, not a second render", async ({ page }) => {
  test.setTimeout(120_000);
  await fakeTurnstile(page);
  await page.clock.install();
  await visit(page, "/try");
  const generated = page.waitForResponse("**/api/tryon/generate");
  await throughToGenerate(page);
  expect((await generated).status()).toBe(202);

  // The render set the mm_look cookie, so the page asks on arrival and shows the first look before a photograph is
  // chosen (CLI-29). The API's refusal of a second photograph is test/worker/tryon-api.test.ts's.
  const uploads: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/tryon/upload-url")) uploads.push(request.url());
  });
  const asked = page.waitForResponse("**/api/tryon/look");
  await visit(page, "/try");
  expect((await asked).status()).toBe(200);
  await expect(page.getByRole("heading", { name: "The look you had." })).toBeVisible();
  await expect(page.getByRole("img", { name: "Simulated result" })).toBeVisible({ timeout: 90_000 });
  expect(uploads).toEqual([]);
});
