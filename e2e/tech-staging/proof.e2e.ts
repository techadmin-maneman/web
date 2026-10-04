// The technician app on `tech-staging.maneman.in`, driven against the deployed
// mm-api over real HTTPS and through real Cloudflare Access. Nothing is faked:
// no page.route(), no stubbed fetch, no local Worker. What every check returned
// is printed, because this file's output is what the record in
// docs/verification.md is written from.
//
// The checks run in the order a technician works in, and each leaves the job
// where the next one needs it, so the file is serial on one worker
// (playwright.staging.config.ts).
//
// What a desktop cannot reach is in docs/tech-field-test.md: a real camera, real
// GPS error, a real dead spot, the phone locked, and a day's battery.

import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { INSIDE, OUTSIDE, query, stagingFixture } from "./seed.ts";

const fixture = stagingFixture();
const TECH = "https://tech-staging.maneman.in";
const OPS = "https://ops-staging.maneman.in";

/**
 * A write made outside a page has to name its origin: the deployed API refuses
 * any write whose Origin is not the host's own (src/http/origin.ts). The
 * browser sets it; a call from the test runner has to.
 */
const sameOrigin = (host: string, headers: Record<string, string> = {}) => ({ ...headers, Origin: host });

interface Card {
  unlocked: boolean;
  unlocks_at: string;
  sector: string | null;
  address: { lat: number | null; lng: number | null } | null;
  client: { name: string } | null;
}
interface Day {
  date: string;
  jobs: { id: string; sector: string | null; badge: string; unlocked: boolean }[];
}
interface Me {
  name: string;
  initials: string;
  device: { device_id: string };
}
interface CheckIn {
  passed: boolean;
  distance_m: number | null;
  radius_m: number;
  wait_ends_at: string | null;
}
interface Accepted {
  event_id: string;
  replayed: boolean;
  fsm_write_state: string;
}
interface Verify {
  verified: boolean;
  attempts_left?: number;
}

/** One line of the record, in the terminal, as the proof goes. Never a number, a code or a token. */
function record(check: string, answer: unknown): void {
  console.log(`[proof] ${check}: ${typeof answer === "string" ? answer : JSON.stringify(answer)}`);
}

/** An answer's body, typed by the caller: Playwright hands JSON back as `any`. */
const bodyOf = async <T>(response: { json(): Promise<unknown> }): Promise<T> => (await response.json()) as T;

/** The session the seed opened, as the cookie the API's own verify would have set. */
async function signIn(context: BrowserContext): Promise<void> {
  await context.addCookies([
    {
      name: "mm_tech",
      value: fixture.sessionToken,
      domain: "tech-staging.maneman.in",
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ]);
}

/** Waits for the service worker to be installed and in charge of the page. */
async function inCharge(page: Page): Promise<void> {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 60_000 });
}

/** The caches the deployed service worker holds, by name, with the paths in each. */
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

/** How many events of one kind this job has landed. */
async function landed(kind: string): Promise<number> {
  const rows = await query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM job_events WHERE appointment_id = '${fixture.today.id}' AND kind = '${kind}';`,
  );
  return rows[0]?.n ?? 0;
}

test.describe.configure({ mode: "serial" });

test("the code request carries the phone's own ID, and a wrong code is not an error", async ({ page }) => {
  // A write from outside a page of this host is refused before anything else.
  const crossOrigin = await page.request.post("/api/tech/auth/otp", {
    data: { mobile: fixture.technicianMobile, device_id: fixture.deviceId },
  });
  record("otp with no Origin", `${String(crossOrigin.status())} ${await crossOrigin.text()}`);
  expect(crossOrigin.status()).toBe(403);

  // The bug #84 fixed, against the deployed API and not the fake: the API wants
  // device_id on the code request as well as on the verify.
  const without = await page.request.post("/api/tech/auth/otp", {
    headers: sameOrigin(TECH),
    data: { mobile: fixture.technicianMobile },
  });
  record("otp without device_id", `${String(without.status())} ${await without.text()}`);
  expect(without.status()).toBe(400);

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Technician sign in" })).toBeVisible();

  // A number FSM does not list. Nothing is sent at all: with no technician there
  // is no number to send to (src/routes/tech-auth.ts).
  const unlisted = page.waitForRequest((request) => request.url().endsWith("/api/tech/auth/otp"));
  await page.getByLabel("Mobile number").fill(fixture.unknownMobile);
  await page.getByRole("button", { name: "Send the code" }).click();
  const unlistedBody = (await unlisted).postDataJSON() as { device_id?: string };
  record("otp for an unlisted number", { device_id_sent: unlistedBody.device_id !== undefined });
  expect(unlistedBody.device_id ?? "").toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  await expect(page.getByText("A six-digit code is on its way.")).toBeVisible();

  // That request may read FSM's list again, which never names the seeded technician. He is written by hand, so
  // the sync leaves him active (migration 0046). Before, it could switch him off, and an inactive technician's
  // session, the one the seed wrote, ends on its next call (ADR 0065).
  const seeded = await query<{ active: number }>(
    `SELECT active FROM technicians WHERE id = '${fixture.technicianId}';`,
  );
  record("the seeded technician after the unlisted number", seeded[0] ?? "not found");
  expect(seeded[0]?.active).toBe(1);

  // Now the technician FSM does list. A login code answers whoever asks for it and is no longer held to staging's
  // messaging allowlist (ADR 0097) — except this technician's own record, named "Staging test technician", which
  // is one of our own scripts' and so stays fenced regardless (isStagingTestRecord, src/policy/staging-test-records.ts).
  // Nothing is sent, exactly as before that ruling.
  await page.reload();
  const sending = page.waitForResponse((response) => response.url().endsWith("/api/tech/auth/otp"));
  await page.getByLabel("Mobile number").fill(fixture.technicianMobile);
  await page.getByRole("button", { name: "Send the code" }).click();
  const challenge = await sending;
  record("otp for the seeded technician", `${String(challenge.status())} ${await challenge.text()}`);
  expect(challenge.status()).toBe(202);

  const verifying = page.waitForResponse((response) => response.url().endsWith("/api/tech/auth/verify"));
  await page.getByLabel("Code").fill("000000");
  await page.getByRole("button", { name: "Sign in" }).click();
  const wrong = await verifying;
  const wrongBody = await bodyOf<Verify>(wrong);
  record("a wrong code", `${String(wrong.status())} ${JSON.stringify(wrongBody)}`);
  expect(wrong.status()).toBe(200);
  expect(wrongBody).toEqual({ verified: false, attempts_left: 4 });
  await expect(page.getByRole("alert")).toHaveText("That code did not match. 4 tries left.");

  // The verify carried the phone's own ID too, which is the other half of #84's fix.
  const request = wrong.request().postDataJSON() as { device_id?: string };
  expect(request.device_id ?? "").toMatch(/^[A-Za-z0-9_-]{8,64}$/);
});

test("the session survives a reload, and /tech/me names the technician and the phone", async ({ page, context }) => {
  await signIn(context);
  const asking = page.waitForResponse((response) => response.url().endsWith("/api/tech/me"));
  await page.goto("/");
  const me = await bodyOf<Me>(await asking);
  record("GET /tech/me", me);
  expect(me.name).toBe(fixture.technicianName);
  expect(me.initials).toBe("ST");
  expect(me.device.device_id).toBe(fixture.deviceId);

  await expect(page.getByRole("heading", { name: "1 job today" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "1 job today" })).toBeVisible();
  await expect(page.getByRole("button", { name: "ST Sign out" })).toBeVisible();
});

test("the day's list, and the card that unlocks the day before", async ({ page, context }) => {
  await signIn(context);
  const day = await bodyOf<Day>(await page.request.get(`/api/tech/jobs?date=${fixture.today.date}`));
  record("GET /tech/jobs today", day);
  expect(day.jobs).toHaveLength(1);
  expect(day.jobs[0]?.sector).toBe(fixture.sector);
  expect(day.jobs[0]?.badge).toBe("prepaid");

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "1 job today" })).toBeVisible();
  await expect(page.getByText(`First at 10 am · ${fixture.sector}`)).toBeVisible();

  // Tomorrow's job unlocks at 6 pm today, with the day-before WhatsApp, so
  // before then its card is withheld like any other and after it carries the
  // address. Which of the two this run proves depends on the hour it is run at.
  const tomorrow = await bodyOf<Card>(await page.request.get(`/api/tech/jobs/${fixture.tomorrow.id}`));
  const open = Date.now() >= Date.parse(tomorrow.unlocks_at);
  record("tomorrow's card", {
    unlocks_at: tomorrow.unlocks_at,
    unlocked: tomorrow.unlocked,
    has_address: tomorrow.address !== null,
  });
  expect(tomorrow.unlocked).toBe(open);
  if (open) expect(tomorrow.address?.lat ?? 0).toBeCloseTo(fixture.address.lat, 4);
  else expect(tomorrow.address).toBeNull();

  // Three days out: the API withholds the address and the client, not the screen.
  const later = await bodyOf<Card>(await page.request.get(`/api/tech/jobs/${fixture.later.id}`));
  record("the later card", { unlocked: later.unlocked, address: later.address, client: later.client });
  expect(later.unlocked).toBe(false);
  expect(later.address).toBeNull();
  expect(later.client).toBeNull();
  expect(later.sector).toBe(fixture.sector);

  await page.goto(`/jobs/${fixture.later.id}`);
  await expect(page.getByText(/^Opens at .+ on /)).toBeVisible();

  await page.goto(`/jobs/${fixture.today.id}`);
  await expect(page.getByRole("heading", { level: 1, name: fixture.clientName })).toBeVisible();
  await expect(page.getByText("Tower C, 14th floor", { exact: false })).toBeVisible();
});

test("check-in: outside the fence it fails with the distance, inside it passes", async ({ page, context }) => {
  await signIn(context);
  await context.setGeolocation(OUTSIDE);
  await page.goto(`/jobs/${fixture.today.id}`);

  const far = page.waitForResponse((response) => response.url().endsWith("/checkin"));
  await page.getByRole("button", { name: "I have arrived" }).click();
  const farBody = await bodyOf<CheckIn>(await far);
  record("check-in from outside", farBody);
  expect(farBody.passed).toBe(false);
  expect(farBody.radius_m).toBe(200);
  expect(farBody.distance_m ?? 0).toBeGreaterThan(200);
  await expect(page.getByText("Check-in failed")).toBeVisible();

  await context.setGeolocation(INSIDE);
  const near = page.waitForResponse((response) => response.url().endsWith("/checkin"));
  await page.getByRole("button", { name: "Try again" }).click();
  const nearBody = await bodyOf<CheckIn>(await near);
  record("check-in from inside", nearBody);
  expect(nearBody.passed).toBe(true);
  expect(nearBody.distance_m ?? 9999).toBeLessThanOrEqual(200);
  expect(nearBody.wait_ends_at).not.toBeNull();
  await expect(page.getByText("2 · Waiting")).toBeVisible();

  // Both attempts are on the record, with the radius in force: what open point 56 is tuned from.
  const rows = await query<{ distance_m: number; radius_m: number; passed: number }>(
    `SELECT distance_m, radius_m, passed FROM checkins WHERE appointment_id = '${fixture.today.id}' ORDER BY at;`,
  );
  record("the checkins rows", rows);
  expect(rows.map((row) => row.passed)).toEqual([0, 1]);
});

test("a step taken with no signal reaches the API when signal returns, and only once", async ({ page, context }) => {
  await signIn(context);
  await context.setGeolocation(INSIDE);
  await page.goto(`/jobs/${fixture.today.id}`);
  await expect(page.getByRole("button", { name: "Start job" })).toBeVisible();

  // A real network cut, not a fake: the browser itself has no route out.
  await context.setOffline(true);
  await page.getByRole("button", { name: "Start job" }).click();
  await expect(page).toHaveURL(new RegExp(`/jobs/${fixture.today.id}/before-photos$`));
  record("start events while the phone was offline", await landed("start"));
  expect(await landed("start")).toBe(0);

  await context.setOffline(false);
  await expect.poll(() => landed("start"), { timeout: 90_000, intervals: [3000] }).toBe(1);
  record("start events once signal returned", 1);

  // The idempotency the whole outbox rests on: the same X-Client-Event-Id again lands nothing new.
  const rows = await query<{ event_id: string }>(
    `SELECT event_id FROM job_events WHERE appointment_id = '${fixture.today.id}' AND kind = 'start';`,
  );
  const again = await page.request.post(`/api/tech/jobs/${fixture.today.id}/start`, {
    headers: sameOrigin(TECH, { "X-Client-Event-Id": rows[0]?.event_id ?? "" }),
  });
  const accepted = await bodyOf<Accepted>(again);
  record("the same event id sent again", `${String(again.status())} ${JSON.stringify(accepted)}`);
  expect(again.status()).toBe(202);
  expect(accepted.replayed).toBe(true);
  expect(await landed("start")).toBe(1);
});

test("the before set: a link for each angle, the PUT, then the set", async ({ page, context }) => {
  await signIn(context);
  const links: number[] = [];
  const puts: number[] = [];
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname;
    if (path.endsWith("/photos/upload-url")) links.push(response.status());
    if (response.request().method() === "PUT" && path.startsWith("/api/tech/photos/")) puts.push(response.status());
  });

  await page.goto(`/jobs/${fixture.today.id}/before-photos`);
  const capture = page.getByRole("button", { name: "Capture" });
  await expect(capture).toBeEnabled({ timeout: 60_000 });
  for (let angle = 1; angle <= 5; angle += 1) {
    await capture.click();
    await expect(page.getByText(`${String(angle)} of 5`)).toBeVisible();
  }

  const setLanding = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith(`/${fixture.today.id}/photos`),
  );
  await page.getByRole("button", { name: "Done" }).click();
  const set = await bodyOf<Accepted>(await setLanding);
  record("POST /photos", set);

  record("upload-url answers", links);
  record("PUT answers", puts);
  expect(links).toEqual([201, 201, 201, 201, 201]);
  // Each photograph, answered with its take, then its thumbnail (docs/decisions/0093-the-storage-meter.md).
  expect(puts).toEqual([200, 204, 200, 204, 200, 204, 200, 204, 200, 204]);

  const stored = await query<{ angle: string; bytes: number; r2_key: string; content_type: string }>(
    `SELECT p.angle, p.bytes, p.r2_key, p.content_type FROM photos p JOIN photo_sets s ON s.id = p.photo_set_id
     WHERE s.appointment_id = '${fixture.today.id}' AND s.phase = 'before' ORDER BY p.angle;`,
  );
  record("the photographs staging stored", stored);
  expect(stored.map((photo) => photo.angle).sort()).toEqual(["front", "hair", "left", "right", "top"]);
  for (const photo of stored) expect(photo.r2_key).toContain(`visits/${fixture.today.id}/before-`);
  expect(await landed("before_photos")).toBe(1);
});

test("the deployed service worker keeps the day and refuses everything else", async ({ page, context }) => {
  await signIn(context);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "1 job today" })).toBeVisible();
  await inCharge(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: "1 job today" })).toBeVisible();

  // Everything the worker must refuse, asked for from the page it controls.
  await page.goto(`/jobs/${fixture.today.id}`);
  await expect(page.getByRole("heading", { level: 1, name: fixture.clientName })).toBeVisible();
  await page.evaluate(async (jobId) => {
    await fetch("/api/tech/me");
    await fetch(`/api/tech/pieces/lookup?code=MM-STD-4417-B&job=${jobId}`);
    await fetch("/api/tech/photos/not-a-real-link");
  }, fixture.today.id);

  const held = await cachedPaths(page);
  record("the caches the deployed worker holds", held);
  expect(held["mm-tech-day"]).toEqual([`/api/tech/jobs?date=${fixture.today.date}`]);
  const everything = Object.values(held).flat();
  expect(everything.filter((path) => path.startsWith("/api/tech/jobs/"))).toEqual([]);
  expect(everything.filter((path) => path.startsWith("/api/tech/me"))).toEqual([]);
  expect(everything.filter((path) => path.startsWith("/api/tech/pieces"))).toEqual([]);
  expect(everything.filter((path) => path.startsWith("/api/tech/photos"))).toEqual([]);

  // The basement: no signal at all, the app closed and opened again.
  await context.setOffline(true);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "1 job today" })).toBeVisible();
  await expect(page.getByText("No signal · working offline")).toBeVisible();
  await context.setOffline(false);
});

test("a revoked phone learns so on its next call, and drops what it held", async ({ page, context }) => {
  await signIn(context);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "1 job today" })).toBeVisible();
  await inCharge(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: "1 job today" })).toBeVisible();
  expect(Object.keys(await cachedPaths(page))).toContain("mm-tech-day");

  const revoked = await page.request.post(
    `${OPS}/api/technicians/${fixture.technicianId}/devices/${fixture.deviceId}/revoke`,
    { headers: sameOrigin(OPS) },
  );
  record("ops revoke", `${String(revoked.status())} ${await revoked.text()}`);
  expect(revoked.status()).toBe(200);

  const next = page.waitForResponse((response) => response.url().endsWith("/api/tech/me"));
  await page.goto("/");
  const answer = await next;
  record("the phone's next /tech/me", `${String(answer.status())} ${await answer.text()}`);
  expect(answer.status()).toBe(401);

  await expect(page.getByRole("heading", { level: 1, name: "Technician sign in" })).toBeVisible();
  await expect(page.getByText("This phone is no longer signed in. Ask ops, then sign in again.")).toBeVisible();
  expect(Object.keys(await cachedPaths(page))).not.toContain("mm-tech-day");

  const device = await query<{ revoked_at: string | null; wiped_at: string | null }>(
    `SELECT revoked_at, wiped_at FROM technician_devices WHERE technician_id = '${fixture.technicianId}';`,
  );
  record("the device row after the revoke", device);
  expect(device[0]?.revoked_at).not.toBeNull();
  expect(device[0]?.wiped_at).not.toBeNull();
});
