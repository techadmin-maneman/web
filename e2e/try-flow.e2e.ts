// The try-on on a mocked API: what the page sends, in what order, and what it
// shows for each answer. try-api.e2e.ts runs the same flow on the local API.
// The look goes to WhatsApp only (ADR 0104): the number is given at the gate
// before the look is made, and the page never asks for the look itself.

import type { Page, Request } from "@playwright/test";
import sharp from "sharp";
import {
  analyticsEvents,
  drawnHeadPhoto,
  DUMMY_TOKEN,
  expect,
  expectNoPersonalData,
  fakeTurnstile,
  sendFromGate,
  test,
  throughToGate,
  visit,
} from "./support.ts";

const JOB = "11111111-1111-4111-8111-111111111111";
const LEAD = "22222222-2222-4222-8222-222222222222";
const MOBILE = "9810000000";

type Call = "availability" | "look" | "uploadUrl" | "upload" | "copy" | "claim" | "generate" | "status" | "result";
interface Answer {
  readonly status: number;
  readonly json?: unknown;
  /** The request never reaches the API, as on a dropped connection. */
  readonly abort?: boolean;
}

function callOf(request: Request): Call | null {
  const path = new URL(request.url()).pathname;
  if (path === "/api/tryon/availability") return "availability";
  if (path === "/api/tryon/look") return "look";
  if (path === "/api/tryon/upload-url") return "uploadUrl";
  if (path.startsWith("/api/tryon/upload/") && path.endsWith("/copy")) return "copy";
  if (path.startsWith("/api/tryon/upload/")) return "upload";
  if (path === "/api/tryon/claim") return "claim";
  if (path === "/api/tryon/generate") return "generate";
  if (path.startsWith("/api/tryon/status/")) return "status";
  // The look itself, which the page must never ask for.
  if (path.startsWith("/api/tryon/result/") || path.startsWith("/api/result/")) return "result";
  return null;
}

/**
 * Answers the try-on's calls: a successful run unless `answers` says otherwise.
 * A list is answered in turn, its last answer repeating. Returns every request.
 */
async function mockApi(page: Page, answers: Partial<Record<Call, Answer | Answer[]>> = {}): Promise<Request[]> {
  const later = new Date(Date.now() + 5 * 60_000).toISOString();
  const defaults: Record<Call, Answer | Answer[]> = {
    availability: { status: 200, json: { available: true } },
    look: { status: 204 },
    uploadUrl: {
      status: 201,
      json: { job_id: JOB, upload_url: `/api/tryon/upload/${JOB}?token=signed`, expires_at: later },
    },
    upload: { status: 204 },
    copy: { status: 204 },
    claim: { status: 201, json: { lead_id: LEAD } },
    generate: { status: 202, json: { job_id: JOB, state: "queued" } },
    status: [
      { status: 200, json: { job_id: JOB, state: "rendering" } },
      { status: 200, json: { job_id: JOB, state: "ready" } },
    ],
    result: { status: 404, json: { error: { code: "not_found", request_id: "test" } } },
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
    if (answer.abort === true) await route.abort();
    else if (answer.json === undefined) await route.fulfill({ status: answer.status });
    else await route.fulfill({ status: answer.status, json: answer.json });
  });
  return seen;
}

const refusal = (status: number, code: string): Answer => ({
  status,
  json: { error: { code, request_id: "test" } },
});

const named = (seen: Request[], call: Call) => seen.filter((request) => callOf(request) === call);
const screenIs = (page: Page, screen: string) =>
  expect(page.locator("[data-screen]")).toHaveAttribute("data-screen", screen);

test.beforeEach(async ({ page }) => {
  await fakeTurnstile(page);
  await page.clock.install();
});

test("the whole try-on: uploaded during the choices, the number given before the look is made", async ({ page }) => {
  const seen = await mockApi(page);
  await visit(page, "/try");
  await throughToGate(page);

  // The photograph went up before the gate, with the notice and a Turnstile token. The notice says the look goes to
  // WhatsApp only, and keeps a client's try-on, so its small copy followed (ADR 0084, ADR 0104).
  await expect.poll(() => named(seen, "upload").length).toBe(1);
  expect(named(seen, "uploadUrl")[0]?.postDataJSON()).toEqual({
    photo_consent: true,
    notice_version: "photo-v3",
    turnstile_token: DUMMY_TOKEN,
  });
  expect(await named(seen, "upload")[0]?.headerValue("content-type")).toBe("image/jpeg");
  await expect.poll(() => named(seen, "copy").length).toBe(1);
  const [copy] = named(seen, "copy");
  expect(new URL(copy?.url() ?? "").pathname + new URL(copy?.url() ?? "").search).toBe(
    `/api/tryon/upload/${JOB}/copy?token=signed`,
  );
  // Nothing is made before the gate has the number.
  expect(named(seen, "generate")).toHaveLength(0);

  await sendFromGate(page, MOBILE);
  await screenIs(page, "sent");
  await expect(page.getByRole("heading", { name: "Your new look is on its way." })).toBeVisible();
  await expect(page.getByText("It'll reach WhatsApp on +91 98100 00000", { exact: false })).toBeVisible();

  const [claim] = named(seen, "claim");
  expect(claim?.postDataJSON()).toEqual({
    job_id: JOB,
    name: "Test Visitor",
    mobile: "9810000000",
    stage: "crown",
    notice_version: "gate-v3",
    attribution: { landing_path: "/try" },
  });
  expect(await claim?.headerValue("idempotency-key")).toMatch(/^[0-9a-f-]{36}$/);
  // The look is asked for only once the claim is saved.
  const gateCalls = seen.map((request) => callOf(request)).filter((call) => call === "claim" || call === "generate");
  expect(gateCalls).toEqual(["claim", "generate"]);
  // The stage is the claim's, so the look is made for the stage the lead records.
  expect(named(seen, "generate")[0]?.postDataJSON()).toEqual({
    job_id: JOB,
    preset: "light-natural-short",
    hair_color: "brown",
  });

  // The page watches the render until it is ready, and never asks for the look.
  await page.clock.runFor(10_000);
  expect(named(seen, "result")).toHaveLength(0);
  await expect(page.locator("[data-screen] img")).toHaveCount(0);

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

test("a render that fails once the look is on its way shows the render's error, and another may be tried", async ({
  page,
}) => {
  await mockApi(page, {
    status: { status: 200, json: { job_id: JOB, state: "failed", failure_code: "render_failed" } },
  });
  await visit(page, "/try");
  await throughToGate(page);
  await sendFromGate(page, MOBILE);
  await screenIs(page, "sent");
  await page.clock.runFor(3_000);
  await expect(page.getByRole("heading", { name: "The simulation did not work this time." })).toBeVisible();
  await page.getByRole("button", { name: "Choose another" }).click();
  await screenIs(page, "upload");
});

test("a face the renderer cannot read, found once the look is on its way, blames the photograph", async ({ page }) => {
  await mockApi(page, {
    status: { status: 200, json: { job_id: JOB, state: "failed", failure_code: "photo_unreadable" } },
  });
  await visit(page, "/try");
  await throughToGate(page);
  await sendFromGate(page, MOBILE);
  await page.clock.runFor(3_000);
  await expect(page.getByRole("heading", { name: "We cannot use this photograph." })).toBeVisible();
  const failed = (await analyticsEvents(page)).find(([name]) => name === "try_on_failed");
  expect(failed?.[1]).toEqual({ failure_code: "photo_unreadable" });
});

const OWN_LOOK: Answer = { status: 200, json: { job_id: JOB, state: "ready" } };

// CLI-29: the visitor used to choose a photograph and agree to its use before being told they had had their look.
test("a visitor who has had their look is told on arrival that it was sent, and shown no look", async ({ page }) => {
  const seen = await mockApi(page, { look: OWN_LOOK });
  await visit(page, "/try");
  await expect(page.getByRole("heading", { name: "Your look has already been sent." })).toBeVisible();
  await expect(page.locator("[data-screen] img")).toHaveCount(0);
  expect(named(seen, "uploadUrl")).toHaveLength(0);
  expect(named(seen, "result")).toHaveLength(0);
  expect((await analyticsEvents(page)).map(([name]) => name)).toEqual([]);
});

// The look made after the page opened, in another tab: the upload is refused, and the visitor told it was sent.
test("a visitor whose upload is refused for having had their look is told it was sent", async ({ page }) => {
  await mockApi(page, { uploadUrl: refusal(403, "look_limit_reached") });
  await visit(page, "/try");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(await drawnHeadPhoto());
  await page.getByText("I understand, and I agree to my photograph being used this way.").click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Your look has already been sent." })).toBeVisible();
  expect((await analyticsEvents(page)).map(([name]) => name)).not.toContain("try_on_failed");
});

// The owner's ruling of 1 October 2026: one look per number every thirty days, held at the gate.
test("a number that had its look in the last thirty days is told at the gate that it was sent", async ({ page }) => {
  const seen = await mockApi(page, { claim: refusal(403, "look_limit_reached") });
  await visit(page, "/try");
  await throughToGate(page);
  await sendFromGate(page, MOBILE);
  await expect(page.getByRole("heading", { name: "Your look has already been sent." })).toBeVisible();
  expect(named(seen, "generate")).toHaveLength(0);
});

// ADR 0104: the look goes to WhatsApp only, so while WhatsApp cannot send it the try-on does not run.
test("while WhatsApp cannot send a look, the visitor is told on arrival, and nothing is uploaded", async ({ page }) => {
  const seen = await mockApi(page, { availability: { status: 200, json: { available: false } } });
  await visit(page, "/try");
  await expect(page.getByRole("heading", { name: "The try-on is paused." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose another" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Book a visit instead" })).toHaveAttribute("href", "/book");
  expect(named(seen, "uploadUrl")).toHaveLength(0);
});

// A refused upload shows as soon as it happens, while the visitor is still choosing.
for (const [name, answers, heading] of [
  ["a full day's uploads", { uploadUrl: refusal(503, "busy") }, "The simulation is busy just now."],
  ["a failed Turnstile check", { uploadUrl: refusal(403, "turnstile_failed") }, "The simulation is busy just now."],
  ["a refused file", { upload: refusal(422, "photo_invalid_file") }, "We cannot use this photograph."],
  [
    "WhatsApp switched off since the page opened",
    { uploadUrl: refusal(503, "whatsapp_unavailable") },
    "The try-on is paused.",
  ],
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
  ["today's render ceiling", { generate: refusal(503, "busy") }, "The simulation is busy just now."],
  ["WhatsApp switched off at the gate", { claim: refusal(503, "whatsapp_unavailable") }, "The try-on is paused."],
] as const) {
  test(`the gate: ${name} shows "${heading}"`, async ({ page }) => {
    await mockApi(page, answers);
    await visit(page, "/try");
    await throughToGate(page);
    await sendFromGate(page, MOBILE);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    const failed = (await analyticsEvents(page)).find(([name]) => name === "try_on_failed");
    expect(failed?.[1]).toEqual({ failure_code: expect.any(String) as unknown });
  });
}

test("the gate says when a number is out of tries for today, and makes none", async ({ page }) => {
  const seen = await mockApi(page, { claim: refusal(429, "rate_limited") });
  await visit(page, "/try");
  await throughToGate(page);
  await sendFromGate(page, MOBILE);
  await expect(page.getByText("This number is out of tries for today. Try again tomorrow.")).toBeVisible();
  await screenIs(page, "gate");
  expect(named(seen, "generate")).toHaveLength(0);
});

test("the gate says when the try-on is already another number's", async ({ page }) => {
  await mockApi(page, {
    claim: refusal(409, "job_not_claimable"),
    status: { status: 200, json: { job_id: JOB, state: "queued" } },
  });
  await visit(page, "/try");
  await throughToGate(page);
  await sendFromGate(page, MOBILE);
  await expect(page.getByText("This look is already on its way to another number.")).toBeVisible();
  await screenIs(page, "gate");
});

// FEO-21: pressing again after the answer was lost is the same claim, so it carries the same key.
test("the gate pressed again after a lost answer sends the same request key", async ({ page }) => {
  const seen = await mockApi(page, {
    claim: [refusal(500, "internal_error"), { status: 201, json: { lead_id: LEAD } }],
  });
  await visit(page, "/try");
  await throughToGate(page);
  await sendFromGate(page, MOBILE);
  await expect(page.getByText("That didn't go through. Try again in a minute.")).toBeVisible();
  await page.getByRole("button", { name: "Send my look" }).click();
  await screenIs(page, "sent");
  const keys = await Promise.all(named(seen, "claim").map((claim) => claim.headerValue("idempotency-key")));
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
});

// The claim is saved and the render's answer lost: pressing again replays the claim and asks for the render again.
test("a render request lost after the claim is asked again, with the same claim", async ({ page }) => {
  const seen = await mockApi(page, {
    generate: [
      { status: 0, abort: true },
      { status: 202, json: { job_id: JOB, state: "queued" } },
    ],
  });
  await visit(page, "/try");
  await throughToGate(page);
  await sendFromGate(page, MOBILE);
  await expect(page.getByText("That didn't go through. Try again in a minute.")).toBeVisible();
  await page.getByRole("button", { name: "Send my look" }).click();
  await screenIs(page, "sent");
  const keys = await Promise.all(named(seen, "claim").map((claim) => claim.headerValue("idempotency-key")));
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
  expect(named(seen, "generate")).toHaveLength(2);
  // The claim answered again is the same lead: one conversion.
  const claims = (await analyticsEvents(page)).filter(([name]) => name === "try_on_claimed");
  expect(claims).toHaveLength(1);
});

// Nothing is made before the gate, so going back from it may change the look.
test("Back from the gate offers every look again, and nothing has been made", async ({ page }) => {
  const seen = await mockApi(page);
  await visit(page, "/try");
  await throughToGate(page);
  await page.getByRole("button", { name: "Back", exact: true }).click();

  await screenIs(page, "looks");
  await expect(page.getByRole("radio", { name: /^Light density Natural/ })).toBeChecked();
  await page.getByText("Full density").first().click();
  await expect(page.getByRole("radio", { name: /^Full density Natural/ })).toBeChecked();
  await page.getByRole("button", { name: "Continue" }).click();
  await screenIs(page, "gate");
  expect(named(seen, "generate")).toHaveLength(0);
});

// FEO-19: the agreement is to one photograph's use; a second photograph is asked for afresh.
test("a new photograph asks for the agreement again", async ({ page }) => {
  await mockApi(page);
  await visit(page, "/try");
  const reach = (screen: string) => page.locator(`[data-screen="${screen}"]`).waitFor();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(await drawnHeadPhoto());
  await reach("consent");
  await page.getByText("I understand, and I agree to my photograph being used this way.").click();
  await expect(page.getByRole("checkbox")).toBeChecked();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await reach("upload");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(await drawnHeadPhoto([90, 70, 50]));
  await reach("consent");
  await expect(page.getByRole("checkbox")).not.toBeChecked();
});

// REQ-S4-05: the photograph is fitted within 4090 px, kept under 5 MB and stripped of its EXIF, the location
// included, before it leaves the browser.
test("a large photograph with a location in it is uploaded smaller and without it", async ({ page }) => {
  // Re-encoding a photograph this size in the browser is slow on the CI runner.
  test.setTimeout(120_000);
  const seen = await mockApi(page);
  // Wider than 4090 px, and noise, so the JPEG is heavy enough that the page may have to shrink it below 5 MB too.
  const noise = { type: "gaussian", mean: 128, sigma: 60 } as const;
  const large = await sharp({
    create: { width: 4400, height: 2200, channels: 3, background: "#808080", noise },
  })
    .jpeg({ quality: 98 })
    .withExif({
      IFD0: { Make: "TestCamera" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "28/1 28/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "77/1 1/1 0/1" },
    })
    .toBuffer();
  expect((await sharp(large).metadata()).exif).toBeDefined();

  await visit(page, "/try");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({ name: "big.jpg", mimeType: "image/jpeg", buffer: large });
  await page.locator('[data-screen="consent"]').waitFor({ timeout: 30_000 });
  await page.getByText("I understand, and I agree to my photograph being used this way.").click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect.poll(() => named(seen, "upload").length, { timeout: 90_000 }).toBe(1);

  const sent = named(seen, "upload")[0]?.postDataBuffer() ?? Buffer.alloc(0);
  const meta = await sharp(sent).metadata();
  expect(meta.format).toBe("jpeg");
  expect(Math.max(meta.width, meta.height)).toBeLessThanOrEqual(4090);
  expect(sent.length).toBeLessThanOrEqual(5 * 1024 * 1024);
  expect(meta.exif).toBeUndefined();
  expect(sent.includes("TestCamera")).toBe(false);

  // Its small copy, which a client keeps as their before photo: a JPEG the API keeps, with no EXIF either (ADR 0084).
  await expect.poll(() => named(seen, "copy").length, { timeout: 90_000 }).toBe(1);
  const copy = named(seen, "copy")[0]?.postDataBuffer() ?? Buffer.alloc(0);
  const copyMeta = await sharp(copy).metadata();
  expect(copyMeta.format).toBe("jpeg");
  expect(Math.max(copyMeta.width, copyMeta.height)).toBeLessThanOrEqual(1600);
  expect(copy.length).toBeLessThanOrEqual(250 * 1024);
  expect(copyMeta.exif).toBeUndefined();
});
