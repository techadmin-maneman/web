// Closed (docs/decisions/0246-closed-and-sent-back.md): the heading by result, a one visit's payment link texted again
// from it, and a visit left partly done asking ops for a time to finish.

import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { JOB_ID } from "./fixtures.ts";
import { fakeTech } from "./fake-tech.ts";
import { stepAction, startedThrough, writesTo } from "./steps-fixtures.ts";
import type { Page } from "@playwright/test";
import * as techCopy from "../../apps/tech/src/content.ts";

const { closeOut } = techCopy;

test("a one visit's unpaid link is texted again from the close", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.type = "consultation";
  fake.oneVisit = true;
  fake.clientChoice = { product: "natural" };
  fake.paymentLink = { url: "https://rzp.io/i/made", paid: false };
  startedThrough(fake, "before_photos", "profile", "piece", "checklist", "consumables", "after_photos", "outcome");
  fake.progress = { ...fake.progress, outcome: "done" };
  await page.goto(`/jobs/${JOB_ID}/done`);

  await expect(page.getByRole("heading", { level: 1, name: closeOut.titles.closed })).toBeVisible();
  const link = page.getByRole("region", { name: closeOut.payment.title });
  await expect(link).toContainText(closeOut.payment.notPaid);
  await link.getByRole("button", { name: closeOut.payment.resend }).click();
  await expect(link.getByRole("status")).toHaveText(closeOut.payment.said.resent);
  expect(writesTo(fake, "resend")).toHaveLength(1);
  expect(await axeViolations(page)).toEqual([]);
});

test("a visit left partly done asks ops for a time to finish it", async ({ page }) => {
  const fake = await fakeTech(page);
  startedThrough(fake, "before_photos", "checklist", "consumables", "after_photos", "outcome");
  fake.progress = { ...fake.progress, outcome: "partial" };
  await page.goto(`/jobs/${JOB_ID}/done`);

  const finish = page.getByRole("region", { name: closeOut.finish.title });
  await finish.getByRole("button", { name: closeOut.finish.asks.tomorrow_morning }).click();
  await expect(finish.getByRole("status")).toHaveText(closeOut.finish.sent);
  await expect(finish.getByRole("button", { name: closeOut.finish.asks.tomorrow_morning })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(writesTo(fake, "finish-ask").at(-1)?.body).toEqual({ ask: "tomorrow_morning" });
  expect(await axeViolations(page)).toEqual([]);
});

test("a visit closed done asks nothing of the kind", async ({ page }) => {
  const fake = await fakeTech(page);
  startedThrough(fake, "before_photos", "checklist", "consumables", "after_photos", "outcome");
  fake.progress = { ...fake.progress, outcome: "done" };
  await page.goto(`/jobs/${JOB_ID}/done`);

  await expect(page.getByRole("heading", { level: 1, name: closeOut.titles.closed })).toBeVisible();
  await expect(page.getByRole("region", { name: closeOut.finish.title })).toHaveCount(0);
  await expect(page.getByRole("region", { name: closeOut.payment.title })).toHaveCount(0);
});

test("Resend says when the link has been texted as often as today allows, and when there is no signal", async ({
  page,
  context,
}) => {
  const fake = await fakeTech(page);
  fake.type = "consultation";
  fake.oneVisit = true;
  fake.clientChoice = { product: "natural" };
  fake.paymentLink = { url: "https://rzp.io/i/made", paid: false };
  startedThrough(fake, "before_photos", "profile", "piece", "checklist", "consumables", "after_photos", "outcome");
  fake.progress = { ...fake.progress, outcome: "done" };
  await page.goto(`/jobs/${JOB_ID}/done`);
  const link = page.getByRole("region", { name: closeOut.payment.title });

  fake.resendRefused = "rate_limited";
  await link.getByRole("button", { name: closeOut.payment.resend }).click();
  await expect(link.getByRole("status")).toHaveText(closeOut.payment.failed.rate_limited);

  fake.online = false;
  await context.setOffline(true);
  await link.getByRole("button", { name: closeOut.payment.resend }).click();
  await expect(link.getByRole("status")).toHaveText(closeOut.payment.failed.offline);
});

test("a way to finish the work chosen with no signal is kept, and goes to ops once there is", async ({
  page,
  context,
}) => {
  const fake = await fakeTech(page);
  startedThrough(fake, "before_photos", "checklist", "consumables", "after_photos", "outcome");
  fake.progress = { ...fake.progress, outcome: "partial" };
  await page.goto(`/jobs/${JOB_ID}/done`);
  const finish = page.getByRole("region", { name: closeOut.finish.title });
  await expect(finish).toBeVisible();

  fake.online = false;
  await context.setOffline(true);
  await finish.getByRole("button", { name: closeOut.finish.asks.ops_call }).click();
  await expect(finish.getByRole("status")).toHaveText(closeOut.finish.saved);
  expect(writesTo(fake, "finish-ask")).toHaveLength(0);

  fake.online = true;
  await context.setOffline(false);
  await expect.poll(() => writesTo(fake, "finish-ask").at(-1)?.body, { timeout: 20_000 }).toEqual({ ask: "ops_call" });
});

// Fit today (ADR 0299): at a plain consultation closed as done, the client going ahead, where the kit holds their piece.
const FIT_ID = "44444444-4444-4444-8444-444444444441";
const OFFER = {
  product: "Mane Man Natural",
  stock_code: "hs_natural_8x10_1b",
  stock_name: "Mane Man Natural 8×10 1B",
  minutes: 120,
  pays_by: "link",
};

/** The consultation closed on the phone as a technician closes it: the client going ahead, nothing picked on Options. */
async function closedGoingAhead(page: Page, fake: Awaited<ReturnType<typeof fakeTech>>) {
  fake.type = "consultation";
  startedThrough(fake, "before_photos", "checklist", "consumables", "profile");
  await page.goto(`/jobs/${JOB_ID}/outcome`);
  await stepAction(page).click();
  await page.getByRole("radio", { name: techCopy.steps.outcome.yes, exact: true }).click();
  await stepAction(page).click();
  await expect(page.getByRole("heading", { level: 1, name: closeOut.titles.closed })).toBeVisible();
}

test("a consultation closed going ahead offers Fit today with the piece in the kit and what the client pays, and opens the fit", async ({
  page,
}) => {
  const fake = await fakeTech(page);
  const startsAt = new Date(Date.now() + 30 * 60_000).toISOString();
  const posted: string[] = [];
  // Registered after the fake, so it answers first.
  await page.route(`**/api/tech/jobs/${JOB_ID}/fit-today`, (route) => {
    if (route.request().method() === "POST") {
      posted.push(route.request().url());
      return route.fulfill({ status: 201, json: { visit_id: FIT_ID } });
    }
    return route.fulfill({ json: { offer: { ...OFFER, starts_at: startsAt }, refusal: null } });
  });
  await closedGoingAhead(page, fake);

  const fit = page.getByRole("region", { name: closeOut.fitToday.title });
  await expect(fit).toContainText(OFFER.stock_name);
  await expect(fit).toContainText(closeOut.fitToday.paysLink);
  // The Fit row above names the yes alone: the fit may be booked now, not left to ops.
  await expect(page.getByText(closeOut.goingAheadToday(null), { exact: true })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
  await fit.getByRole("button", { name: closeOut.fitToday.action }).click();
  await expect(page).toHaveURL(new RegExp(`/jobs/${FIT_ID}$`));
  expect(posted).toHaveLength(1);
});

test("a consultation closed going ahead offers nothing where Fit today is refused, and a refused booking takes the button", async ({
  page,
}) => {
  const fake = await fakeTech(page);
  let offered = false;
  await page.route(`**/api/tech/jobs/${JOB_ID}/fit-today`, (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({ status: 409, json: { error: { code: "taken", request_id: "req-fit-1" } } });
    }
    const starts = new Date(Date.now() + 30 * 60_000).toISOString();
    return route.fulfill({
      json: offered
        ? { offer: { ...OFFER, starts_at: starts }, refusal: null }
        : { offer: null, refusal: "not_in_kit" },
    });
  });
  await closedGoingAhead(page, fake);
  await expect(page.getByRole("region", { name: closeOut.fitToday.title })).toHaveCount(0);
  // With nothing offered, ops book the fit, as the row says.
  await expect(page.getByText(closeOut.goingAhead(null), { exact: true })).toBeVisible();

  offered = true;
  await page.reload();
  const fit = page.getByRole("region", { name: closeOut.fitToday.title });
  await fit.getByRole("button", { name: closeOut.fitToday.action }).click();
  await expect(fit.getByRole("alert")).toHaveText(closeOut.fitToday.failed.taken);
  // The ending takes the focus from the button it took away, so a reader hears it.
  await expect(fit.locator("[tabindex='-1']")).toBeFocused();
  // Refused for good: no button to try again with, no start to go by, and the row back to ops booking it.
  await expect(fit.getByRole("button", { name: closeOut.fitToday.action })).toHaveCount(0);
  await expect(fit).not.toContainText(OFFER.stock_name);
  await expect(page.getByText(closeOut.goingAhead(null), { exact: true })).toBeVisible();
});

test("a fit booked whose job is still on its way stays said, and the row says the fit is booked", async ({ page }) => {
  const fake = await fakeTech(page);
  let booked = false;
  await page.route(`**/api/tech/jobs/${JOB_ID}/fit-today`, (route) => {
    if (route.request().method() === "POST") {
      booked = true;
      return route.fulfill({ status: 201, json: { visit_id: null } });
    }
    const starts = new Date(Date.now() + 30 * 60_000).toISOString();
    // Once booked, the API offers it no more.
    return route.fulfill({
      json: booked ? { offer: null, refusal: "fit_booked" } : { offer: { ...OFFER, starts_at: starts }, refusal: null },
    });
  });
  await closedGoingAhead(page, fake);
  const fit = page.getByRole("region", { name: closeOut.fitToday.title });
  await fit.getByRole("button", { name: closeOut.fitToday.action }).click();
  await expect(fit.getByRole("status")).toHaveText(closeOut.fitToday.bookedSoon);
  // The write reads the offer again, which is gone: what was said stays.
  await page.waitForTimeout(800);
  await expect(fit.getByRole("status")).toHaveText(closeOut.fitToday.bookedSoon);
  await expect(page.getByText(closeOut.goingAheadBooked(null), { exact: true })).toBeVisible();
});

test("a fit already booked says so, and the row says the fit is booked", async ({ page }) => {
  const fake = await fakeTech(page);
  await page.route(`**/api/tech/jobs/${JOB_ID}/fit-today`, (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({ status: 409, json: { error: { code: "already_booked", request_id: "req-fit-2" } } });
    }
    const starts = new Date(Date.now() + 30 * 60_000).toISOString();
    return route.fulfill({ json: { offer: { ...OFFER, starts_at: starts }, refusal: null } });
  });
  await closedGoingAhead(page, fake);
  const fit = page.getByRole("region", { name: closeOut.fitToday.title });
  await fit.getByRole("button", { name: closeOut.fitToday.action }).click();
  await expect(fit.getByRole("status")).toHaveText(closeOut.fitToday.alreadyBooked);
  await expect(page.getByText(closeOut.goingAheadBooked(null), { exact: true })).toBeVisible();
});

test("the Fit row waits for the offer rather than say ops book a fit it may book now", async ({ page }) => {
  const fake = await fakeTech(page);
  // The offer answers a second and a half late, as on a slow line at the door.
  await page.route(`**/api/tech/jobs/${JOB_ID}/fit-today`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const starts = new Date(Date.now() + 30 * 60_000).toISOString();
    return route.fulfill({ json: { offer: { ...OFFER, starts_at: starts }, refusal: null } });
  });
  await closedGoingAhead(page, fake);
  // Looked at every fifth of a second while the offer is on its way: never ops to book.
  const opsToBook = page.getByText(closeOut.goingAhead(null), { exact: true });
  for (let look = 0; look < 6; look += 1) {
    expect(await opsToBook.count()).toBe(0);
    await page.waitForTimeout(200);
  }
  await expect(page.getByText(closeOut.goingAheadToday(null), { exact: true })).toBeVisible();
  await expect(page.getByText(closeOut.goingAhead(null), { exact: true })).toHaveCount(0);
});

test("the Fit row says the yes alone while the close is on its way, never ops to book", async ({ page }) => {
  const fake = await fakeTech(page);
  let landed = false;
  // The close reaches the API a second and a half late, as on a slow line; the offer is read from it.
  await page.route(`**/api/tech/jobs/${JOB_ID}/outcome`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.fallback();
    landed = true;
  });
  // And the offer answers a second after that.
  await page.route(`**/api/tech/jobs/${JOB_ID}/fit-today`, async (route) => {
    const starts = new Date(Date.now() + 30 * 60_000).toISOString();
    const answer = landed
      ? { offer: { ...OFFER, starts_at: starts }, refusal: null }
      : { offer: null, refusal: "not_offered" };
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.fulfill({ json: answer });
  });
  await closedGoingAhead(page, fake);
  const yes = page.getByText(closeOut.goingAheadToday(null), { exact: true });
  const opsToBook = page.getByText(closeOut.goingAhead(null), { exact: true });
  await expect(yes).toBeVisible();
  // The yes stays on screen, alone, through the close landing and the offer coming: not for one redraw is it gone,
  // or ops asked to book.
  await page.evaluate(
    ([alone, ops]) => {
      const missed: string[] = [];
      Object.assign(window, { missed });
      new MutationObserver(() => {
        const text = document.body.innerText;
        if (!text.includes(alone)) missed.push("yes gone");
        if (text.includes(ops)) missed.push("ops to book");
      }).observe(document.body, { childList: true, subtree: true, characterData: true });
    },
    [closeOut.goingAheadToday(null), closeOut.goingAhead(null)] as const,
  );
  await expect(page.getByRole("region", { name: closeOut.fitToday.title })).toBeVisible({ timeout: 5000 });
  expect(await page.evaluate(() => (window as unknown as { missed: string[] }).missed)).toEqual([]);
  expect(await opsToBook.count()).toBe(0);
  await expect(page.getByText(closeOut.goingAheadToday(null), { exact: true })).toBeVisible();
});

// As a close left the outbox, for one render nothing the screen read had it yet: the close-out said the job wasn't
// closed, then drew itself again.
test("never says the job isn't closed while its close lands", async ({ page }) => {
  const fake = await fakeTech(page);
  let landed = false;
  await page.route(`**/api/tech/jobs/${JOB_ID}/outcome`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.fallback();
    landed = true;
  });
  await closedGoingAhead(page, fake);
  // Every line the screen draws from the close on, however briefly.
  await page.evaluate((line) => {
    const seen: string[] = [];
    Object.assign(window, { seen });
    new MutationObserver(() => {
      if (document.body.innerText.includes(line)) seen.push(line);
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }, closeOut.notClosed);
  await expect.poll(() => landed, { timeout: 5000 }).toBe(true);
  // The phone reads again what it keeps once the close has left the outbox; a moment covers those reads.
  await page.waitForTimeout(1000);
  await expect(page.getByRole("heading", { level: 1, name: closeOut.titles.closed })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { seen: string[] }).seen)).toEqual([]);
});

// What a landing writes is kept in the days the phone holds: a day it no longer keeps gets nothing, and the read of
// what the phone heard comes back without the close. The close-out holds it all the same.
test("never says the job isn't closed while its close lands, though the phone no longer keeps its day", async ({
  page,
}) => {
  const fake = await fakeTech(page);
  let landed = false;
  await page.route(`**/api/tech/jobs/${JOB_ID}/outcome`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.fallback();
    landed = true;
  });
  await closedGoingAhead(page, fake);
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const opened = indexedDB.open("mm-tech");
        opened.onerror = () => {
          reject(new Error("the phone's store would not open"));
        };
        opened.onsuccess = () => {
          const clearing = opened.result.transaction("days", "readwrite").objectStore("days").clear();
          clearing.onsuccess = () => {
            opened.result.close();
            resolve();
          };
        };
      }),
  );
  await page.evaluate((line) => {
    const seen: string[] = [];
    Object.assign(window, { seen });
    new MutationObserver(() => {
      if (document.body.innerText.includes(line)) seen.push(line);
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }, closeOut.notClosed);
  await expect.poll(() => landed, { timeout: 5000 }).toBe(true);
  await page.waitForTimeout(1500);
  await expect(page.getByRole("heading", { level: 1, name: closeOut.titles.closed })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { seen: string[] }).seen)).toEqual([]);
});

// A job's card that would not load, on the close-out's paper: its reference was drawn in paper's own colour, all but
// unseen on white.
test("says the job's card didn't load with its reference readable, on paper", async ({ page }) => {
  await fakeTech(page);
  await page.route(`**/api/tech/jobs/${JOB_ID}`, (route) =>
    route.fulfill({ status: 500, json: { error: { code: "internal_error", request_id: "1a2b3c4d-5e6f" } } }),
  );
  await page.goto(`/jobs/${JOB_ID}/done`);
  await expect(page.getByText("1a2b3c4d")).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
});

// A close the API refuses stays on the phone, refused: the close-out says the job is not closed.
test("says the job isn't closed once its close is refused", async ({ page }) => {
  const fake = await fakeTech(page);
  await page.route(`**/api/tech/jobs/${JOB_ID}/outcome`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.fulfill({
      status: 400,
      json: { error: { code: "invalid_request", request_id: "r-1", fields: ["client_alert"] } },
    });
  });
  await closedGoingAhead(page, fake);
  await expect(page.getByText(closeOut.notClosed)).toBeVisible({ timeout: 5000 });
  // Drawn on the close-out's paper, in the paper's ink: readable, as every check of contrast holds it.
  expect(await axeViolations(page)).toEqual([]);
});

test("a one visit's fit booked for later says ops book it while its close is still on its way", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.type = "first_fit";
  fake.oneVisit = true;
  fake.clientChoice = { product: "natural", fit_later: true };
  startedThrough(fake, "before_photos", "piece", "checklist", "consumables", "profile", "after_photos");
  // The close held on a slow line throughout.
  await page.route(`**/api/tech/jobs/${JOB_ID}/outcome`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    await route.fallback().catch(() => undefined);
  });
  await page.goto(`/jobs/${JOB_ID}/outcome`);
  await page.getByRole("radio", { name: techCopy.steps.outcome.done, exact: true }).click();
  await stepAction(page).click();
  await expect(page.getByRole("heading", { level: 1, name: closeOut.titles.closed })).toBeVisible();
  await expect(page.getByText(closeOut.goingAhead("Mane Man Natural"), { exact: true })).toBeVisible({ timeout: 2000 });
});
