// The technician app's shell (docs/decisions/0026-hosts-and-surfaces.md):
// served as the mm-tech Worker serves it, under its own policy, on the
// technician surface's host, at the width its boards are drawn at.

import { LOCAL_LOGIN_CODE } from "../../scripts/lib/local-stack.ts";
import { expect, outsideContract, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { fakeTech, heldOnPhone, storeOnPhone } from "./fixtures.ts";

test("opens on the sign-in, as the Prototype draws it", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Mane Man technician");
  await expect(page.getByRole("heading", { level: 1, name: "Technician sign in" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Mobile number" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Code" })).toBeVisible();
});

test("serves its policy: its own origin, the camera and geolocation to itself, and noindex", async ({ page }) => {
  const response = await page.goto("/");
  const headers = response?.headers() ?? {};
  expect(headers["content-security-policy"]).toContain("default-src 'none'");
  expect(headers["content-security-policy"]).toContain("connect-src 'self'");
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["permissions-policy"]).toContain("camera=(self)");
  expect(headers["permissions-policy"]).toContain("geolocation=(self)");
  expect(headers["permissions-policy"]).toContain("payment=()");
  expect(headers["permissions-policy"]).toContain("microphone=()");
  expect(headers["x-robots-tag"]).toBe("noindex, nofollow");
});

test("answers any page path with the app, as a single-page app", async ({ page }) => {
  await fakeTech(page);
  const response = await page.goto("/waiting");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("keeps the design's column on a wide screen, centred", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const box = await page.locator("#root").boundingBox();
  expect(box?.width).toBe(390);
  expect(Math.round((box?.x ?? 0) * 2 + (box?.width ?? 0))).toBe(1440);
});

test("the sign-in meets WCAG 2.2 AA", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
});

test("says why an app opened from the home screen is signed out, and nothing of the kind in a tab", async ({
  page,
}) => {
  // An installed iOS web app has its own cookie jar, so the API sees no session
  // on a phone the technician signed in on an hour ago (ADR 0053).
  await page.route("**/api/tech/me", (route) =>
    route.fulfill({ status: 401, json: { error: { code: "session_required", request_id: "test" } } }),
  );
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Technician sign in" })).toBeVisible();
  await expect(page.getByText(/The home-screen app signs in on its own/)).toHaveCount(0);

  await page.addInitScript(() => {
    Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
  });
  await page.reload();
  await expect(page.getByText(/The home-screen app signs in on its own/)).toBeVisible();

  expect(await axeViolations(page)).toEqual([]);
});

test("signs the phone out and forgets everything it held", async ({ page }) => {
  await fakeTech(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "3 jobs today" })).toBeVisible();

  const before = await page.evaluate(() => indexedDB.databases().then((each) => each.map((one) => one.name)));
  expect(before).toContain("mm-tech");

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Technician sign in" })).toBeVisible();
  const after = await page.evaluate(() => indexedDB.databases().then((each) => each.map((one) => one.name)));
  expect(after).not.toContain("mm-tech");
});

test("wipes the phone and signs out when the session has ended, as a revoked device's has", async ({ page }) => {
  await fakeTech(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "3 jobs today" })).toBeVisible();

  // Ops revoke the device: the next contact with the backend is a 401.
  await page.route("**/api/tech/me", (route) =>
    route.fulfill({
      status: 401,
      json: { error: { code: "device_revoked", request_id: "test" } },
    }),
  );
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Technician sign in" })).toBeVisible();
  const after = await page.evaluate(() => indexedDB.databases().then((each) => each.map((one) => one.name)));
  expect(after).not.toContain("mm-tech");
});

test("a phone revoked while the app is open is wiped at its next call, and shows nothing it held", async ({ page }) => {
  const fake = await fakeTech(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "3 jobs today" })).toBeVisible();
  await expect(page.getByText("Rohit M.").first()).toBeVisible();

  // Ops revoke the phone. Nothing reloads it: the next card the technician opens asks the API.
  fake.revoked = true;
  await page.getByText("Rohit M.").first().click();

  await expect(page.getByRole("heading", { level: 1, name: "Technician sign in" })).toBeVisible();
  await expect(page.getByText("This phone is no longer signed in. Ask ops, then sign in again.")).toBeVisible();
  await expect(page.getByText("Rohit M.")).toHaveCount(0);
  await expect(page.getByText("Gate code 4417 · visitor bay B")).toHaveCount(0);
  await expect(page.getByText("No signal · working offline")).toHaveCount(0);
  expect(await storeOnPhone(page)).toBe(false);
});

test("once a code is sent, the number can be changed, and a new code asked for after half a minute", async ({
  page,
}) => {
  await page.clock.install();
  const fake = await fakeTech(page);
  fake.signedIn = false;
  await page.goto("/");

  const number = page.getByRole("textbox", { name: "Mobile number" });
  await number.fill("9811000000");
  await page.getByRole("button", { name: "Send the code" }).click();
  await expect(page.getByText("A six-digit code is on its way.")).toBeVisible();
  await expect(number).toBeDisabled();

  // Not at once: WhatsApp has half a minute to deliver the first.
  await expect(page.getByRole("button", { name: /^New code in \d+ s$/ })).toBeDisabled();
  await page.clock.runFor(30_000);
  await page.getByRole("button", { name: "Send a new code" }).click();
  await expect.poll(() => fake.codesSent).toEqual(["9811000000", "9811000000"]);

  // A number typed wrong is not a dead end: back to it, and the code goes to the right one.
  await page.getByRole("button", { name: "Change number" }).click();
  await expect(number).toBeEnabled();
  await expect(number).toBeFocused();
  await number.fill("9811000001");
  await page.getByRole("button", { name: "Send the code" }).click();
  await expect.poll(() => fake.codesSent.at(-1)).toBe("9811000001");
});

// The field kept the first ten digits typed, so a number pasted with +91 in front lost its last two
// (docs/archive/owner-answers-2026-09-27.md).
test("a number pasted with +91 or 0 in front becomes its own ten digits, and the code goes to them", async ({
  page,
}) => {
  const fake = await fakeTech(page);
  fake.signedIn = false;
  await page.goto("/");

  const number = page.getByRole("textbox", { name: "Mobile number" });
  for (const pasted of ["+91 98110 00000", "091 98110 00000", "9198110 00000", "098110 00000"]) {
    await number.fill(pasted);
    await expect(number).toHaveValue("9811000000");
  }
  await page.getByRole("button", { name: "Send the code" }).click();
  await expect(page.getByText("A six-digit code is on its way.")).toBeVisible();
  expect(fake.codesSent).toEqual(["9811000000"]);
});

test("a number one digit short, or not a mobile, says why Send stays off once the field is left", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.signedIn = false;
  await page.goto("/");

  const number = page.getByRole("textbox", { name: "Mobile number" });
  const send = page.getByRole("button", { name: "Send the code" });
  for (const typed of ["981100000", "5123456789"]) {
    await number.fill(typed);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await number.blur();
    await expect(page.getByRole("alert")).toHaveText("Enter your ten-digit mobile number.");
    await expect(send).toBeDisabled();
  }
  await number.fill("9811000000");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(send).toBeEnabled();
});

test("a code the API has closed takes the sign-in back to sending one, not to a dead end", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.signedIn = false;
  fake.codeClosed = true;
  await page.goto("/");

  await page.getByRole("textbox", { name: "Mobile number" }).fill("9811000000");
  await page.getByRole("button", { name: "Send the code" }).click();
  await expect(page.getByRole("button", { name: "Change number" })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  await page.getByRole("textbox", { name: "Code" }).fill(LOCAL_LOGIN_CODE);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("alert")).toHaveText("That code no longer works. Send the code again.");
  await expect(page.getByRole("textbox", { name: "Mobile number" })).toBeEnabled();

  fake.codeClosed = false;
  await page.getByRole("button", { name: "Send the code" }).click();
  await page.getByRole("textbox", { name: "Code" }).fill(LOCAL_LOGIN_CODE);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "3 jobs today" })).toBeVisible();
});

test("a screen that fails to draw says so and offers a reload, and the reload loses nothing", async ({ page }) => {
  const fake = await fakeTech(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "3 jobs today" })).toBeVisible();

  // A step the API refused, still on the phone for the technician to read.
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("mm-tech");
      request.onsuccess = () => {
        resolve(request.result);
      };
    });
    await new Promise<void>((resolve) => {
      const transaction = db.transaction("outbox", "readwrite");
      transaction.objectStore("outbox").add({
        id: "01000000-0000-7000-8000-000000000009",
        job_id: "a0000000-0000-4000-8000-000000000001",
        kind: "checklist",
        path: "/tech/jobs/a0000000-0000-4000-8000-000000000001/checklist",
        body: {},
        queued_at: Date.now(),
        state: "refused",
        note: "invalid_request",
        fields: [],
      });
      transaction.oncomplete = () => {
        resolve();
      };
    });
    db.close();
  });

  // A release sends the day in a shape the screen cannot draw.
  outsideContract("GET /api/tech/jobs 200");
  fake.malformed = true;
  await page.reload();
  await expect(page.getByText("This screen didn’t open. Nothing you recorded is lost.")).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  fake.malformed = false;
  await page.getByRole("button", { name: "Reload" }).click();
  await expect(page.getByRole("heading", { name: "3 jobs today" })).toBeVisible();
  expect(await heldOnPhone(page)).toMatchObject({ outbox: 1 });
});
