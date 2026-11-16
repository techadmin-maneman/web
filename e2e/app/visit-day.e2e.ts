// The visit day on Home (apps/app/src/home/LiveCard.tsx) and the client's sign-off of a fit in their own app
// (apps/app/src/home/SignOffPanel.tsx; docs/decisions/0254-client-signs-off-the-fit.md). No route can move a visit
// through its day from outside, so the fitted client's next visit is answered as on its day, at each stage; each
// answer is held to the API's contract (e2e/support.ts).

import type { Page } from "@playwright/test";
import { addDays, indiaClock, indiaDate } from "../../packages/web-kit/dates.ts";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { fittedClient } from "./fitted.ts";
import { logIn } from "./signed-in.ts";
import * as appCopy from "../../apps/app/src/content.ts";

type Visit = Record<string, unknown> & { id: string };

/** Home, with the next visit answered as `change` makes it, on today. */
async function onTheDay(page: Page, change: (visit: Visit) => Visit): Promise<Visit> {
  await logIn(page, fittedClient().mobile);
  await expect(page.getByRole("heading", { level: 2, name: appCopy.home.next.label })).toBeVisible();
  const me = await page.evaluate(async () => (await fetch("/api/me")).json() as Promise<{ next_visit: Visit }>);
  const visit = change({ ...me.next_visit, date: indiaDate(new Date().toISOString()) });
  await page.route("**/api/me", (route) => route.fulfill({ json: { ...me, next_visit: visit } }));
  await page.reload();
  return visit;
}

const live = appCopy.live;

/** Home answered again with `visit` as the next one, as the API would read it now. */
async function answerAgain(page: Page, visit: Visit): Promise<void> {
  await page.unroute("**/api/me");
  const me = await page.evaluate(async () => (await fetch("/api/me")).json() as Promise<Record<string, unknown>>);
  await page.route("**/api/me", (route) => route.fulfill({ json: { ...me, next_visit: visit } }));
}

const MINUTE_MS = 60_000;

test("puts a technician running late after the arrival window, never at a time already gone", async ({ page }) => {
  const said = new Date(Date.now() - 5 * MINUTE_MS).toISOString();
  await onTheDay(page, (visit) => ({
    ...visit,
    arrives_by: new Date(Date.now() - 60 * MINUTE_MS).toISOString(),
    latest_update: { kind: "running_late", minutes: 15, at: said },
  }));
  await expect(page.getByText(live.runningLate("Imran"))).toBeVisible();
  const around = indiaClock(new Date(Date.parse(said) + 15 * MINUTE_MS).toISOString());
  await expect(page.getByText(live.arrivingAround(around))).toBeVisible();
});

test("says a visit is being closed, or was missed, and never that it is done", async ({ page }) => {
  const visit = await onTheDay(page, (each) => ({
    ...each,
    status: "in_progress",
    stage: "closing",
    latest_update: null,
  }));
  await expect(page.getByText(live.closing, { exact: true })).toBeVisible();
  await expect(page.getByText(live.done, { exact: true })).toHaveCount(0);

  await answerAgain(page, { ...visit, not_home: true });
  await page.reload();
  await expect(page.getByText(live.notHome, { exact: true })).toBeVisible();
  await expect(page.getByText(live.notHomeLine)).toBeVisible();

  // Missed yesterday and not yet closed: its own day heads the card, never "Today".
  const yesterday = addDays(indiaDate(new Date().toISOString()), -1);
  await answerAgain(page, { ...visit, date: yesterday, status: "scheduled", stage: "missed" });
  await page.reload();
  await expect(page.getByText(live.missed)).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: live.today })).toHaveCount(0);
  expect(await axeViolations(page)).toEqual([]);
});

test("Home follows the visit through its day: on the way, under way, then done", async ({ page }) => {
  await onTheDay(page, (visit) => ({
    ...visit,
    latest_update: { kind: "on_the_way", minutes: 12, at: new Date().toISOString() },
  }));
  await expect(page.getByRole("heading", { level: 2, name: live.today })).toBeVisible();
  await expect(page.getByText(live.onTheWay("Imran"))).toBeVisible();
  await expect(page.getByText(/^Arriving around /)).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  const me = await page.evaluate(async () => (await fetch("/api/me")).json() as Promise<{ next_visit: Visit }>);
  const underWay = {
    ...me.next_visit,
    status: "in_progress",
    stage: "in_progress",
    latest_update: null,
    step: { index: 2, of: 4, name: "service" },
  };
  await page.route("**/api/me", (route) => route.fulfill({ json: { ...me, next_visit: underWay } }));
  await page.reload();
  await expect(page.getByText(live.inProgress)).toBeVisible();
  await expect(page.getByText(live.step(2, 4, live.steps.service))).toBeVisible();

  const done = { ...underWay, stage: "done", step: null };
  await page.route("**/api/me", (route) => route.fulfill({ json: { ...me, next_visit: done } }));
  await page.reload();
  await expect(page.getByText(live.done, { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: live.seePhotos })).toHaveAttribute("href", `/visits/${underWay.id}`);
});

const ASKED = {
  state: "asked",
  checks: null,
  flag_text: null,
  declined_reason: null,
  asked_at: new Date().toISOString(),
  asks: 1,
  signed_at: null,
  guarantee_days: null,
};

/** The fit's sign-off asked for, and what the client sends back, answered as the API records it. */
async function askedToSignOff(page: Page): Promise<() => unknown> {
  const visit = await onTheDay(page, (each) => ({
    ...each,
    type: "replacement",
    status: "in_progress",
    stage: "in_progress",
    latest_update: null,
    step: { index: 5, of: 5, name: "sign_off" },
    sign_off: ASKED,
  }));
  let sent: unknown = null;
  await page.route(`**/api/visits/${visit.id}/sign-off`, async (route) => {
    sent = route.request().postDataJSON();
    await route.fulfill({ json: { ...ASKED, state: "signed", checks: { hairline: true, blend: true, secure: true } } });
  });
  return () => sent;
}

test("asks the client to sign off the fit in their own app, once every check is ticked", async ({ page }) => {
  const sent = await askedToSignOff(page);
  const copy = live.signOff;
  await expect(page.getByRole("heading", { level: 3, name: copy.check("Imran") })).toBeVisible();
  const happy = page.getByRole("button", { name: copy.happy });
  await expect(happy).toBeDisabled();
  for (const check of Object.values(copy.checks)) await page.getByRole("button", { name: check }).click();
  expect(await axeViolations(page)).toEqual([]);
  await happy.click();
  await expect.poll(sent).toEqual({ result: "signed", checks: { hairline: true, blend: true, secure: true } });
});

test("sends what isn't right to the technician, in the client's words", async ({ page }) => {
  const sent = await askedToSignOff(page);
  const copy = live.signOff;
  await page.getByRole("button", { name: copy.checks.hairline }).click();
  await page.getByRole("button", { name: copy.notRight }).click();
  await page.getByRole("textbox", { name: copy.whatsWrong }).fill("The left edge lifts.");
  await page.getByRole("button", { name: copy.send("Imran") }).click();
  await expect.poll(sent).toEqual({
    result: "flagged",
    checks: { hairline: true, blend: false, secure: false },
    flag_text: "The left edge lifts.",
  });
});

test("asks for the sign-off of a consultation and fit in one visit on Home too", async ({ page }) => {
  await onTheDay(page, (each) => ({
    ...each,
    type: "first_fit",
    one_visit: { amount: 2_700_000, from: false, code: null },
    status: "in_progress",
    stage: "in_progress",
    latest_update: null,
    step: { index: 5, of: 5, name: "sign_off" },
    sign_off: ASKED,
  }));
  await expect(page.getByRole("heading", { level: 3, name: live.signOff.check("Imran") })).toBeVisible();
});

test("asked again after what isn't right was put right, starts the sign-off from nothing ticked", async ({ page }) => {
  // Home reads itself again every 30 seconds while the visit is live; the clock moves it on.
  await page.clock.install();
  await askedToSignOff(page);
  const copy = live.signOff;
  const me = await page.evaluate(async () => (await fetch("/api/me")).json() as Promise<{ next_visit: Visit }>);
  const asked = me.next_visit;
  await page.getByRole("button", { name: copy.checks.hairline }).click();
  await page.getByRole("button", { name: copy.notRight }).click();
  await page.getByRole("textbox", { name: copy.whatsWrong }).fill("The left edge lifts.");
  await answerAgain(page, { ...asked, sign_off: { ...ASKED, state: "flagged", flag_text: "The left edge lifts." } });
  await page.getByRole("button", { name: copy.send("Imran") }).click();
  await expect(page.getByRole("heading", { level: 3, name: copy.sent("Imran") })).toBeVisible();

  await answerAgain(page, { ...asked, sign_off: { ...ASKED, asks: 2 } });
  await page.clock.fastForward(31_000);
  await expect(page.getByRole("heading", { level: 3, name: copy.check("Imran") })).toBeVisible();
  await expect(page.getByRole("textbox", { name: copy.whatsWrong })).toHaveCount(0);
  await expect(page.getByRole("button", { name: copy.checks.hairline })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: copy.happy })).toBeDisabled();
});
