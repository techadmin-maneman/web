// The next visit, offered in the app and booked by the client (docs/decisions/0086-the-next-visit-is-offered.md):
// Home's prompt in its order, the booking sheet opened with the day and window offered chosen, a fitted
// client's choice of a service or a replacement, and the page on what a replacement involves, which replaces the
// WhatsApp hand-off. Against the local mm-api, with the clients of e2e/app/next-visit.ts, who only read: nothing
// is held for them here.

import type { Page } from "@playwright/test";
import { listMonth, shortDate, weekdayDate } from "../../packages/web-kit/dates.ts";
import { indiaDate } from "../../src/lib/india-time.ts";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { firstFitDay, nextVisitClients } from "./next-visit.ts";
import { logIn } from "./signed-in.ts";
import * as appCopy from "../../apps/app/src/content.ts";
import { PORTS } from "../../scripts/lib/local-stack.ts";

async function accessible(page: Page): Promise<void> {
  expect(await axeViolations(page)).toEqual([]);
}

/** India's day `days` after `date`, both YYYY-MM-DD; before it where `days` is below nought. */
const daysAfter = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** The service the windows are for, as the local mm-api's standard one. */
const SERVICE = { tier: "standard", name: "Service visit", minutes: 90 };

/** India's day tomorrow. */
const tomorrow = () => daysAfter(indiaDate(new Date()), 1);

/**
 * The sheet's days, a fortnight from the day asked for and never before tomorrow, as the API gives them, with every
 * window open, so the day and window offered are free whatever the other tests hold on them. It is answered in the
 * API's place, since only the browser resolves app.localhost; the API's own days are test/worker/booking/next-visit.test.ts's.
 * Returns what the sheet asked for.
 */
async function everyWindowOpen(page: Page): Promise<URL[]> {
  const asked: URL[] = [];
  await page.route(
    (url) => url.pathname === "/api/availability",
    (route) => {
      const url = new URL(route.request().url());
      asked.push(url);
      const from = url.searchParams.get("from");
      const start = from === null || from < tomorrow() ? tomorrow() : from;
      const price = { amount_ex_gst: 200000, amount: 200000, gst_percent: 0 };
      const days = Array.from({ length: 14 }, (_, index) => ({
        date: daysAfter(start, index),
        price,
        windows: [
          { window: "morning", start: "09:00", end: "12:00", open: true, change_charged: false },
          { window: "afternoon", start: "12:00", end: "16:00", open: true, change_charged: false },
          { window: "evening", start: "16:00", end: "20:00", open: true, change_charged: false },
        ],
      }));
      const last = daysAfter(tomorrow(), 44);
      const type = url.searchParams.get("type");
      return route.fulfill({
        json: { type, service: SERVICE, price, change_notice_hours: 24, last, days },
      });
    },
  );
  return asked;
}

test("Home offers the next service on the day it falls due, and the sheet opens with that day and window", async ({
  page,
}) => {
  const { due } = nextVisitClients();
  const asked = await everyWindowOpen(page);
  await logIn(page, due.mobile);
  await expect(page.getByRole("heading", { level: 1, name: appCopy.home.next.label })).toBeVisible();
  // Nothing is booked, so the prompt is the next service's, not the address or the invoice.
  await expect(
    page.getByText(`Your next service visit is due on ${shortDate(due.date)}, in the morning.`),
  ).toBeVisible();
  // One way to book on Home: the prompt's. This client has no piece, so no replacement is offered beside it.
  await expect(page.getByRole("button", { name: appCopy.home.prompt.bookNext })).toBeVisible();
  await expect(page.getByRole("button", { name: appCopy.home.next.book })).toHaveCount(0);
  await expect(page.getByRole("button", { name: appCopy.home.next.orReplacement })).toHaveCount(0);
  await accessible(page);

  await page.getByRole("button", { name: appCopy.home.prompt.bookNext }).click();
  const dates = page.getByRole("dialog", { name: appCopy.booking.date.title });
  await expect(dates.getByRole("radio", { checked: true })).toHaveAccessibleName(weekdayDate(due.date));
  // The strip starts a week before the day offered, where it can.
  expect(asked[0]?.searchParams.get("type")).toBe("service");
  expect(asked[0]?.searchParams.get("from")).toBe(daysAfter(due.date, -7));
  await accessible(page);
  await dates.getByRole("button", { name: appCopy.booking.window.continueFree }).click();
  const windows = page.getByRole("dialog", { name: appCopy.booking.window.title });
  await expect(windows.getByRole("radio", { checked: true })).toBeVisible();
  await expect(windows.locator("label").filter({ has: page.getByRole("radio", { checked: true }) })).toContainText(
    appCopy.WINDOW_NAMES.morning,
  );
  await expect(windows.getByRole("button", { name: appCopy.booking.window.continue })).toBeEnabled();
  await windows.getByRole("button", { name: appCopy.booking.close }).click();
  await expect(windows).toHaveCount(0);
});

test("Home offers the replacement beside the next service once the API says it may be booked", async ({ page }) => {
  const { due } = nextVisitClients();
  const asked = await everyWindowOpen(page);
  await logIn(page, due.mobile);
  await expect(page.getByRole("button", { name: appCopy.home.prompt.bookNext })).toBeVisible();
  // This client has no piece, so the API's answer is altered on its way.
  const me = await page.evaluate(async () => (await fetch("/api/me")).json() as Promise<{ prompt: object }>);
  await page.route("**/api/me", (route) =>
    route.fulfill({ json: { ...me, prompt: { ...me.prompt, replacement_bookable: true } } }),
  );
  await page.reload();
  await page.getByRole("button", { name: appCopy.home.next.orReplacement }).click();
  await expect(page.getByRole("dialog", { name: appCopy.booking.date.title })).toBeVisible();
  expect(asked.at(-1)?.searchParams.get("type")).toBe("replacement");
});

test("Visits lets a fitted client book a service or a replacement, each in its own sheet", async ({ page }) => {
  const { due } = nextVisitClients();
  const asked = await everyWindowOpen(page);
  await logIn(page, due.mobile);
  await page.getByRole("navigation").getByRole("link", { name: appCopy.visits.title }).click();
  await expect(page.getByRole("heading", { level: 1, name: appCopy.visits.title })).toBeVisible();
  await page.getByRole("button", { name: appCopy.home.next.orReplacement }).click();
  await expect(page.getByRole("dialog", { name: appCopy.booking.date.title })).toBeVisible();
  expect(asked.at(-1)?.searchParams.get("type")).toBe("replacement");
  await page.getByRole("dialog").getByRole("button", { name: appCopy.booking.close }).click();

  await page.getByRole("button", { name: appCopy.home.next.book }).click();
  const dates = page.getByRole("dialog", { name: appCopy.booking.date.title });
  await expect(dates.getByRole("radio", { checked: true })).toHaveAccessibleName(weekdayDate(due.date));
  expect(asked.at(-1)?.searchParams.get("type")).toBe("service");
});

test("Home offers the replacement where the piece falls due first, and a page says what it involves", async ({
  page,
}) => {
  const { replacement } = nextVisitClients();
  const asked = await everyWindowOpen(page);
  await logIn(page, replacement.mobile);
  // Offered on the piece's own day, said as its month, and in no window: the last visit was an evening's, which a
  // replacement cannot take.
  const month = listMonth(replacement.date.slice(0, 7), new Date().getFullYear());
  await expect(page.getByText(`Your replacement is due in ${month}.`)).toBeVisible();
  // One way to book on Home: the prompt's, with the replacement in the service's place.
  await expect(page.getByRole("button", { name: appCopy.home.prompt.bookNext })).toBeVisible();
  await expect(page.getByRole("button", { name: appCopy.home.next.bookReplacement })).toHaveCount(0);
  await expect(page.getByRole("button", { name: appCopy.home.next.orService })).toHaveCount(0);

  // No WhatsApp: the app's own page.
  const involves = page.getByRole("link", { name: appCopy.home.prompt.involves });
  await expect(involves).toHaveAttribute("href", "/replacement");
  await involves.click();
  await expect(page.getByRole("heading", { level: 1, name: appCopy.replacement.title })).toBeVisible();
  await expect(page.getByText("Your technician removes your current hair system")).toBeVisible();
  await expect(page).toHaveTitle(/^Replacement · Mane Man$/);
  await accessible(page);

  await page.getByRole("button", { name: appCopy.home.prompt.bookReplacement }).click();
  const dates = page.getByRole("dialog", { name: appCopy.booking.date.title });
  await expect(dates.getByRole("radio", { checked: true })).toHaveAccessibleName(weekdayDate(replacement.date));
  expect(asked.at(-1)?.searchParams.get("type")).toBe("replacement");
  await dates.getByRole("button", { name: appCopy.booking.date.continue }).click();
  // No window is offered: the client chooses one.
  await expect(
    page.getByRole("dialog", { name: appCopy.booking.window.title }).getByRole("radio", { checked: true }),
  ).toHaveCount(0);
  await page.getByRole("dialog").getByRole("button", { name: appCopy.booking.close }).click();

  await page.getByRole("link", { name: appCopy.replacement.back }).click();
  await expect(page.getByRole("heading", { level: 1, name: appCopy.home.next.label })).toBeVisible();
});

// A client holding free service visits was offered only the paid replacement on Home.
test("Home offers a free service visit beside a replacement due first, to a client holding some", async ({ page }) => {
  const { replacement } = nextVisitClients();
  await everyWindowOpen(page);
  await page.route("**/api/me", async (route) => {
    const answer = await route.fetch({
      url: `http://127.0.0.1:${String(PORTS.app)}/api/me`,
      headers: { ...route.request().headers(), host: `app.localhost:${String(PORTS.app)}` },
    });
    if (!answer.ok()) return route.fulfill({ response: answer });
    const me = (await answer.json()) as Record<string, unknown>;
    const credits = { visits: 2, earliest_expiry: null, expiring_visits: 2 };
    await route.fulfill({ response: answer, json: { ...me, credits } });
  });
  await logIn(page, replacement.mobile);
  await expect(page.getByRole("button", { name: appCopy.home.next.useCredit })).toBeVisible();
});

test("Home recaps the consultation, and offers the first fit as the hair system recommended, in its window", async ({
  page,
}) => {
  const { firstFit } = nextVisitClients();
  const asked = await everyWindowOpen(page);
  await logIn(page, firstFit.mobile);
  await expect(page.getByRole("heading", { level: 1, name: appCopy.home.consultation.label })).toBeVisible();
  await expect(page.getByText(`${shortDate(firstFit.consulted)} · Imran`)).toBeVisible();
  await expect(page.getByText("Imran recommends Mane Man Essential.")).toBeVisible();
  // The first fit is Home's card, and never a prompt beneath it.
  await expect(page.getByText(/^Your next .* is due on/)).toHaveCount(0);
  await accessible(page);

  await page.getByRole("button", { name: appCopy.home.next.bookFirstFit }).click();
  const dates = page.getByRole("dialog", { name: appCopy.booking.date.title });
  await expect(dates.getByRole("radio", { checked: true })).toHaveAccessibleName(weekdayDate(firstFitDay()));
  expect(asked[0]?.searchParams.get("type")).toBe("first_fit");
  expect(asked[0]?.searchParams.get("tier")).toBe("essential");
  await dates.getByRole("button", { name: appCopy.booking.window.continueFree }).click();
  const windows = page.getByRole("dialog", { name: appCopy.booking.window.title });
  await expect(windows.locator("label").filter({ has: page.getByRole("radio", { checked: true }) })).toContainText(
    appCopy.WINDOW_NAMES.afternoon,
  );
});
