// The next visit, offered in the app and booked by the client (docs/decisions/0086-the-next-visit-is-offered.md):
// Home's prompt in the owner's order, the booking sheet opened with the day and window offered chosen, a fitted
// client's choice of a service or a replacement, and the page on what a replacement involves, which replaces the
// WhatsApp hand-off. Against the local mm-api, with the clients of e2e/app/next-visit.ts, who only read: nothing
// is held for them here.

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { shortDate, weekdayDate } from "../../packages/web-kit/dates.ts";
import { expect, test } from "../support.ts";
import { nextVisitClients } from "./next-visit.ts";
import { logIn } from "./signed-in.ts";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function accessible(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
}

/** India's day `days` after `date`, both YYYY-MM-DD; before it where `days` is below nought. */
const daysAfter = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** India's day tomorrow. */
const tomorrow = () => daysAfter(new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10), 1);

/**
 * The sheet's days, a fortnight from the day asked for and never before tomorrow, as the API gives them, with every
 * window open, so the day and window offered are free whatever the other tests hold on them. It is answered in the
 * API's place, since only the browser resolves app.localhost; the API's own days are test/worker/next-visit.test.ts's.
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
          { window: "morning", start: "09:00", end: "12:00", with: "another" },
          { window: "afternoon", start: "12:00", end: "16:00", with: "another" },
          { window: "evening", start: "16:00", end: "20:00", with: "another" },
        ],
      }));
      return route.fulfill({ json: { type: url.searchParams.get("type"), price, regular: null, days } });
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
  await expect(page.getByRole("heading", { level: 1, name: "Your next visit" })).toBeVisible();
  // Nothing is booked, so the prompt is the next service's, not the address or the invoice.
  await expect(
    page.getByText(`Your next service visit is due on ${shortDate(due.date)}, in the morning.`),
  ).toBeVisible();
  // One way to book on Home: the prompt's. This client has no piece, so no replacement is offered beside it.
  await expect(page.getByRole("button", { name: "Book it for then" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Book your next visit" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Or book a replacement piece" })).toHaveCount(0);
  await accessible(page);

  await page.getByRole("button", { name: "Book it for then" }).click();
  const dates = page.getByRole("dialog", { name: "Pick a date" });
  await expect(dates.getByRole("radio", { checked: true })).toHaveAccessibleName(weekdayDate(due.date));
  // The strip starts a week before the day offered, where it can.
  expect(asked[0]?.searchParams.get("type")).toBe("service");
  expect(asked[0]?.searchParams.get("from")).toBe(daysAfter(due.date, -7));
  await accessible(page);
  await dates.getByRole("button", { name: "Continue" }).click();
  const windows = page.getByRole("dialog", { name: "Pick a window" });
  await expect(windows.getByRole("radio", { checked: true })).toBeVisible();
  await expect(windows.locator("label").filter({ has: page.getByRole("radio", { checked: true }) })).toContainText(
    "Morning",
  );
  await expect(windows.getByRole("button", { name: "Continue to payment" })).toBeEnabled();
  await windows.getByRole("button", { name: "Close" }).click();
  await expect(windows).toHaveCount(0);
});

test("Home offers the replacement beside the next service once the API says it may be booked", async ({ page }) => {
  const { due } = nextVisitClients();
  const asked = await everyWindowOpen(page);
  await logIn(page, due.mobile);
  await expect(page.getByRole("button", { name: "Book it for then" })).toBeVisible();
  // This client has no piece, so the API's answer is altered on its way.
  const me = await page.evaluate(async () => (await fetch("/api/me")).json() as Promise<{ prompt: object }>);
  await page.route("**/api/me", (route) =>
    route.fulfill({ json: { ...me, prompt: { ...me.prompt, replacement_bookable: true } } }),
  );
  await page.reload();
  await page.getByRole("button", { name: "Or book a replacement piece" }).click();
  await expect(page.getByRole("dialog", { name: "Pick a date" })).toBeVisible();
  expect(asked.at(-1)?.searchParams.get("type")).toBe("replacement");
});

test("Visits lets a fitted client book a service or a replacement, each in its own sheet", async ({ page }) => {
  const { due } = nextVisitClients();
  const asked = await everyWindowOpen(page);
  await logIn(page, due.mobile);
  await page.getByRole("navigation").getByRole("link", { name: "Visits" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Visits" })).toBeVisible();
  await page.getByRole("button", { name: "Or book a replacement piece" }).click();
  await expect(page.getByRole("dialog", { name: "Pick a date" })).toBeVisible();
  expect(asked.at(-1)?.searchParams.get("type")).toBe("replacement");
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "Book your next visit" }).click();
  const dates = page.getByRole("dialog", { name: "Pick a date" });
  await expect(dates.getByRole("radio", { checked: true })).toHaveAccessibleName(weekdayDate(due.date));
  expect(asked.at(-1)?.searchParams.get("type")).toBe("service");
});

test("Home offers the replacement where the piece falls due first, and a page says what it involves", async ({
  page,
}) => {
  const { replacement } = nextVisitClients();
  const asked = await everyWindowOpen(page);
  await logIn(page, replacement.mobile);
  // Offered on the service's day, and in no window: the last visit was an evening's, which a replacement cannot take.
  await expect(page.getByText(`Your next replacement piece is due on ${shortDate(replacement.date)}.`)).toBeVisible();
  // One way to book on Home: the prompt's, with the replacement in the service's place.
  await expect(page.getByRole("button", { name: "Book it for then" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Book your replacement piece" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Or book a service visit" })).toHaveCount(0);

  // No WhatsApp: the app's own page.
  const involves = page.getByRole("link", { name: "See what that involves" });
  await expect(involves).toHaveAttribute("href", "/replacement");
  await involves.click();
  await expect(page.getByRole("heading", { level: 1, name: "What a replacement involves" })).toBeVisible();
  await expect(page.getByText("A replacement takes off the piece you wear now")).toBeVisible();
  await expect(page).toHaveTitle(/^Replacement piece · Mane Man$/);
  await accessible(page);

  await page.getByRole("button", { name: "Book the replacement" }).click();
  const dates = page.getByRole("dialog", { name: "Pick a date" });
  await expect(dates.getByRole("radio", { checked: true })).toHaveAccessibleName(weekdayDate(replacement.date));
  expect(asked.at(-1)?.searchParams.get("type")).toBe("replacement");
  await dates.getByRole("button", { name: "Continue" }).click();
  // No window is offered: the client chooses one.
  await expect(page.getByRole("dialog", { name: "Pick a window" }).getByRole("radio", { checked: true })).toHaveCount(
    0,
  );
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();

  await page.getByRole("link", { name: "Back to Home" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Your next visit" })).toBeVisible();
});

test("Home offers the first fit once the consultation is done, in the window the site's request asked for", async ({
  page,
}) => {
  const { firstFit } = nextVisitClients();
  const asked = await everyWindowOpen(page);
  await logIn(page, firstFit.mobile);
  await expect(page.getByRole("heading", { level: 1, name: "Your next visit" })).toBeVisible();
  // The first fit is Home's card, and never a prompt beneath it.
  await expect(page.getByText(/^Your next .* is due on/)).toHaveCount(0);
  await accessible(page);

  await page.getByRole("button", { name: "Book your first fit" }).click();
  const dates = page.getByRole("dialog", { name: "Pick a date" });
  await expect(dates.getByRole("radio", { checked: true })).toHaveAccessibleName(weekdayDate(firstFit.date));
  expect(asked[0]?.searchParams.get("type")).toBe("first_fit");
  await dates.getByRole("button", { name: "Continue" }).click();
  const windows = page.getByRole("dialog", { name: "Pick a window" });
  await expect(windows.locator("label").filter({ has: page.getByRole("radio", { checked: true }) })).toContainText(
    "Afternoon",
  );
});
