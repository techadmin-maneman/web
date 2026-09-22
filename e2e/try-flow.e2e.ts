// The try-on on a mocked API: what the page sends, in what order, and what it
// shows for each answer. try-api.e2e.ts runs the same flow on the local API.

import type { Page, Request } from "@playwright/test";
import sharp from "sharp";
import {
  analyticsEvents,
  drawnHeadPhoto,
  DUMMY_TOKEN,
  expect,
  expectNoPersonalData,
  fakeTurnstile,
  test,
  throughToGenerate,
  visit,
} from "./support.ts";

const JOB = "11111111-1111-4111-8111-111111111111";
const LEAD = "22222222-2222-4222-8222-222222222222";
const MOBILE = "9810000000";

type Call = "uploadUrl" | "upload" | "generate" | "status" | "claim" | "result" | "image";
interface Answer {
  readonly status: number;
  readonly json?: unknown;
  readonly image?: Buffer;
  /** Holds the request this long first, as a request stuck on the way would be. */
  readonly holdMs?: number;
}

function callOf(request: Request): Call | null {
  const path = new URL(request.url()).pathname;
  if (path === "/api/tryon/upload-url") return "uploadUrl";
  if (path.startsWith("/api/tryon/upload/")) return "upload";
  if (path === "/api/tryon/generate") return "generate";
  if (path.startsWith("/api/tryon/status/")) return "status";
  if (path === "/api/tryon/claim") return "claim";
  if (path.startsWith("/api/tryon/result/")) return "result";
  if (path.startsWith("/api/result/")) return "image";
  return null;
}

/**
 * Answers the try-on's calls: a successful run unless `answers` says otherwise.
 * A list is answered in turn, its last answer repeating. Returns every request.
 */
async function mockApi(page: Page, answers: Partial<Record<Call, Answer | Answer[]>> = {}): Promise<Request[]> {
  const later = new Date(Date.now() + 5 * 60_000).toISOString();
  const result = await sharp({ create: { width: 300, height: 400, channels: 3, background: "#6b5a4c" } })
    .png()
    .toBuffer();
  const defaults: Record<Call, Answer | Answer[]> = {
    uploadUrl: {
      status: 201,
      json: { job_id: JOB, upload_url: `/api/tryon/upload/${JOB}?token=signed`, expires_at: later },
    },
    upload: { status: 204 },
    generate: { status: 202, json: { job_id: JOB, state: "queued" } },
    status: { status: 200, json: { job_id: JOB, state: "rendering" } },
    claim: { status: 201, json: { lead_id: LEAD, whatsapp_copy: true } },
    result: [
      { status: 202, json: { state: "rendering" } },
      { status: 200, json: { url: "/api/result/signed", expires_at: later } },
    ],
    image: { status: 200, image: result },
  };
  const queues = new Map<Call, Answer[]>();
  for (const [call, answer] of Object.entries({ ...defaults, ...answers }) as [Call, Answer | Answer[]][]) {
    queues.set(call, Array.isArray(answer) ? [...answer] : [answer]);
  }

  const seen: Request[] = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const call = callOf(request);
    const queue = call === null ? undefined : queues.get(call);
    const answer = queue !== undefined && queue.length > 1 ? queue.shift() : queue?.[0];
    if (answer === undefined) {
      await route.fallback();
      return;
    }
    seen.push(request);
    if (answer.holdMs !== undefined) {
      await new Promise((done) => setTimeout(done, answer.holdMs));
      // The page has given up on it by now.
      await route.fulfill({ status: answer.status, json: answer.json }).catch(() => undefined);
      return;
    }
    if (answer.image !== undefined) {
      await route.fulfill({ status: answer.status, contentType: "image/png", body: answer.image });
    } else if (answer.json === undefined) {
      await route.fulfill({ status: answer.status });
    } else {
      await route.fulfill({ status: answer.status, json: answer.json });
    }
  });
  return seen;
}

const refusal = (status: number, code: string): Answer => ({
  status,
  json: { error: { code, request_id: "test" } },
});

const named = (seen: Request[], call: Call) => seen.filter((request) => callOf(request) === call);

test.beforeEach(async ({ page }) => {
  await fakeTurnstile(page);
  await page.clock.install();
});

test("the whole try-on: uploaded during the choices, the gate before the render ends", async ({ page }) => {
  const seen = await mockApi(page);
  await visit(page, "/try");
  await throughToGenerate(page);
  await expect.poll(() => named(seen, "generate").length).toBe(1);

  // The photograph went up before Generate was pressed, with the notice and a Turnstile token.
  const [uploadUrl] = named(seen, "uploadUrl");
  expect(uploadUrl?.postDataJSON()).toEqual({
    photo_consent: true,
    notice_version: "photo-v1",
    turnstile_token: DUMMY_TOKEN,
  });
  const [upload] = named(seen, "upload");
  expect(upload?.method()).toBe("PUT");
  expect(await upload?.headerValue("content-type")).toBe("image/jpeg");
  expect(named(seen, "generate")[0]?.postDataJSON()).toEqual({
    job_id: JOB,
    stage: "crown",
    preset: "light-natural-short",
    hair_color: "brown",
  });

  await page.clock.runFor(20_000);
  await expect(page.locator("[data-screen]")).toHaveAttribute("data-screen", "gate");
  await page.getByLabel("Name").fill("Test Visitor");
  await page.getByLabel("Mobile").fill(MOBILE);
  await page.getByRole("button", { name: "Show me the result" }).click();

  // Claimed while the render still runs: the result screen waits for it.
  await expect(page.locator("[data-screen]")).toHaveAttribute("data-screen", "result");
  await expect(page.getByText("Still working on it", { exact: true }).first()).toBeVisible();
  const [claim] = named(seen, "claim");
  expect(claim?.postDataJSON()).toEqual({
    job_id: JOB,
    name: "Test Visitor",
    mobile: "98100 00000",
    attribution: { landing_path: "/try" },
  });
  expect(await claim?.headerValue("idempotency-key")).toMatch(/^[0-9a-f-]{36}$/);

  await page.clock.runFor(3_000);
  await expect(page.getByRole("img", { name: "Simulated result" })).toBeVisible();
  await expect(page.getByText("A copy is on its way to +91 98100 00000. Deleted after thirty days.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Download" })).toHaveAttribute("aria-disabled", "false");

  // No name, number or image link in any address the page asked for, or in analytics.
  for (const request of seen) {
    expect(request.url()).not.toContain("Test");
    expect(request.url()).not.toContain("98100");
  }
  expect((await analyticsEvents(page)).map(([name]) => name)).toEqual([
    "try_on_started",
    "try_on_gate_shown",
    "try_on_claimed",
    "try_on_completed",
  ]);
  await expectNoPersonalData(page, ["Test Visitor", "98100", "9810000000"]);
});

test("a result request stuck on the way is dropped, and the next poll shows the result", async ({ page }) => {
  test.setTimeout(60_000);
  await mockApi(page, {
    result: [
      { status: 202, json: { state: "rendering" }, holdMs: 40_000 },
      { status: 200, json: { url: "/api/result/signed", expires_at: new Date(Date.now() + 300_000).toISOString() } },
    ],
  });
  await visit(page, "/try");
  await throughToGenerate(page);
  await page.clock.runFor(20_000);
  await page.getByLabel("Name").fill("Test Visitor");
  await page.getByLabel("Mobile").fill(MOBILE);
  await page.getByRole("button", { name: "Show me the result" }).click();
  await expect(page.getByRole("img", { name: "Simulated result" })).toBeVisible({ timeout: 20_000 });
});

test("no WhatsApp line when messaging is off", async ({ page }) => {
  await mockApi(page, { claim: { status: 201, json: { lead_id: LEAD, whatsapp_copy: false } } });
  await visit(page, "/try");
  await throughToGenerate(page);
  await page.clock.runFor(20_000);
  await page.getByLabel("Name").fill("Test Visitor");
  await page.getByLabel("Mobile").fill(MOBILE);
  await page.getByRole("button", { name: "Show me the result" }).click();
  await page.clock.runFor(3_000);
  await expect(page.getByRole("img", { name: "Simulated result" })).toBeVisible();
  await expect(page.getByText("A copy is on its way", { exact: false })).toHaveCount(0);
});

// A refused upload shows as soon as it happens, while the visitor is still choosing.
for (const [name, answers, heading] of [
  ["one look per visitor", { uploadUrl: refusal(403, "look_limit_reached") }, "You have had your look."],
  ["a full day's uploads", { uploadUrl: refusal(503, "busy") }, "The simulation is busy just now."],
  ["a failed Turnstile check", { uploadUrl: refusal(403, "turnstile_failed") }, "The simulation is busy just now."],
  ["a refused file", { upload: refusal(422, "photo_invalid_file") }, "We cannot use this photograph."],
] as const) {
  test(`the upload: ${name} shows "${heading}"`, async ({ page }) => {
    await mockApi(page, answers);
    await visit(page, "/try");
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles(await drawnHeadPhoto());
    await page.getByText("I understand, and I agree to my photograph being used this way.").click();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  });
}

for (const [name, answers, heading] of [
  ["the hourly render limit", { generate: refusal(429, "rate_limited") }, "The simulation is busy just now."],
  ["another look for the same photograph", { generate: refusal(403, "look_limit_reached") }, "You have had your look."],
  [
    "a failed render",
    { status: { status: 200, json: { job_id: JOB, state: "failed", failure_code: "render_failed" } } },
    "The simulation did not work this time.",
  ],
  [
    "a face the renderer cannot read",
    { status: { status: 200, json: { job_id: JOB, state: "failed", failure_code: "photo_unreadable" } } },
    "We cannot use this photograph.",
  ],
] as const) {
  test(`the render: ${name} shows "${heading}"`, async ({ page }) => {
    await mockApi(page, answers);
    await visit(page, "/try");
    await throughToGenerate(page);
    await page.clock.runFor(3_000);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    const failed = (await analyticsEvents(page)).find(([name]) => name === "try_on_failed");
    expect(failed?.[1]).toEqual({ failure_code: expect.any(String) as unknown });
  });
}

test("a render that fails after the gate shows the render's error", async ({ page }) => {
  await mockApi(page, { result: { status: 422, json: { state: "failed", failure_code: "render_failed" } } });
  await visit(page, "/try");
  await throughToGenerate(page);
  await page.clock.runFor(20_000);
  await page.getByLabel("Name").fill("Test Visitor");
  await page.getByLabel("Mobile").fill(MOBILE);
  await page.getByRole("button", { name: "Show me the result" }).click();
  await expect(page.getByRole("heading", { name: "The simulation did not work this time." })).toBeVisible();
});

test("the gate says when a number has had too many results today", async ({ page }) => {
  await mockApi(page, { claim: refusal(429, "rate_limited") });
  await visit(page, "/try");
  await throughToGenerate(page);
  await page.clock.runFor(20_000);
  await page.getByLabel("Name").fill("Test Visitor");
  await page.getByLabel("Mobile").fill(MOBILE);
  await page.getByRole("button", { name: "Show me the result" }).click();
  await expect(page.getByText("This number has had several results today. Please try again tomorrow.")).toBeVisible();
  await expect(page.locator("[data-screen]")).toHaveAttribute("data-screen", "gate");
});
