// The site's booking page's mocked answers and its steps, for ./book.e2e.ts, ./book-invites.e2e.ts and
// ./book-errors.e2e.ts.

import type { Page, Request } from "@playwright/test";
import { fillAddress } from "./booking-area.ts";
import * as siteCopy from "../site/src/content/site.ts";
import * as referralCopy from "../site/src/content/referral.ts";
import { expect, fakeTurnstile, mockNumberCode, visit } from "./support.ts";

export const SERVED = { pincode: "122018", served: true, area: "Sector 65", city: "Gurgaon" };
export const UNSERVED = { pincode: "400050", served: false, area: "Bandra", city: "Mumbai" };

export const BOOKED = {
  state: "booked",
  date: "2026-09-25",
  window: "morning",
  hours: { start: "09:00", end: "12:00" },
  area: SERVED.area,
  credits: false,
  invite: "unknown",
  one_visit: false,
  discount_code: null,
};

export const CODE = "RM4K7P";
export const INVITE = {
  state: "valid",
  referrer_first_name: "Rohit",
  partner: null,
  friend_visits: null,
  discount: null,
  card: { state: "house", version: 1 },
};

export type Answer = { status: number; body: unknown };

/** The form's question: which days and windows can be booked. */
export const OPEN_WINDOWS = /\/api\/availability\/public\?/;
/** The page's clock for the tests that answer it: the strip opens on Saturday 3 October, as the answers do. */
export const NOON_2_OCTOBER = new Date("2026-10-02T06:30:00Z");
export const ALL_OPEN = { morning: true, afternoon: true, evening: true };
/** Each window's hours, as ops set them by default. */
export const HOURS = {
  morning: { start: "09:00", end: "12:00" },
  afternoon: { start: "12:00", end: "16:00" },
  evening: { start: "16:00", end: "20:00" },
};
export const FULL = { morning: false, afternoon: false, evening: false };
export type Windows = typeof ALL_OPEN;

/** Fourteen days from Saturday 3 October 2026: the windows given for a day, else `otherwise`. */
export function openDays(given: Record<string, Windows> = {}, otherwise: Windows = ALL_OPEN) {
  return Array.from({ length: 14 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 9, 3 + index)).toISOString().slice(0, 10);
    return { date, windows: given[date] ?? otherwise, hours: HOURS };
  });
}

/** Answers the form's question with the days for the plan asked about; returns the questions asked. */
export async function answerOpen(page: Page, daysFor: (plan: string) => ReturnType<typeof openDays>): Promise<URL[]> {
  const asked: URL[] = [];
  await page.route(OPEN_WINDOWS, (route) => {
    const url = new URL(route.request().url());
    asked.push(url);
    const plan = url.searchParams.get("plan") ?? "";
    return route.fulfill({ json: { plan, days: daysFor(plan) } });
  });
  return asked;
}

/** Mocks the page's calls; returns the bookings and waitlist entries it sent. */
export async function mockApi(
  page: Page,
  answers: { consultation?: Answer; waitlist?: Answer } = {},
): Promise<Request[]> {
  const requests: Request[] = [];
  await fakeTurnstile(page);
  await mockNumberCode(page);
  // Unless a test gives the days open, the API cannot say, and the form draws every window open.
  await page.route(OPEN_WINDOWS, (route) =>
    route.fulfill({ status: 503, json: { error: { code: "unavailable", request_id: "r" } } }),
  );
  await page.route("**/api/pincodes/*", (route) => {
    const pincode = route.request().url().split("/").pop();
    return route.fulfill({ json: pincode === SERVED.pincode ? SERVED : UNSERVED });
  });
  await page.route("**/api/lead", (route) => route.fulfill({ status: 201, json: {} }));
  await page.route("**/api/consultation", (route) => {
    requests.push(route.request());
    const answer = answers.consultation ?? { status: 201, body: BOOKED };
    return route.fulfill({ status: answer.status, json: answer.body });
  });
  await page.route("**/api/waitlist", (route) => {
    requests.push(route.request());
    const answer = answers.waitlist ?? {
      status: 201,
      body: { area: UNSERVED.area, credits: false, invite: "unknown" },
    };
    return route.fulfill({ status: answer.status, json: answer.body });
  });
  return requests;
}

/** Opens a friend's invite, which this browser then remembers, before the page books. */
export async function openInvite(page: Page): Promise<void> {
  await page.route(`**/api/r/${CODE}`, (route) => route.fulfill({ json: INVITE }));
  await visit(page, `/r/${CODE}`);
  await expect(page.getByText("Rohit sent you this")).toBeVisible();
}

export const remembered = (page: Page) => page.evaluate(() => localStorage.getItem("mm_invite"));

/** Where the agreement on /book's first step, and on the consultation's, is ticked. */
export const CONSULTATION_CONSENT = referralCopy.referral.consultation.consent;

/** /book's first step: the name, the number and the agreement, kept before anything else (ADR 0116). */
export async function leaveDetails(page: Page, mobile = "9810000000"): Promise<void> {
  await page.getByLabel(siteCopy.tryOn.gate.name).fill("Test Visitor");
  await page.getByLabel(siteCopy.tryOn.gate.mobile).fill(mobile);
  await page.getByText(CONSULTATION_CONSENT).click();
  await page.getByRole("button", { name: siteCopy.booking.next }).click();
  await expect(page.getByLabel(referralCopy.referral.pincode.label)).toBeFocused();
}

/** A pincode checked. */
export async function checkPincode(page: Page, pincode: string): Promise<void> {
  await page.getByLabel(referralCopy.referral.pincode.label).fill(pincode);
  await page.getByRole("button", { name: referralCopy.referral.pincode.check }).click();
}

/** /book, at the pincode, its first step done. */
export async function openAtPincode(page: Page): Promise<void> {
  await visit(page, "/book");
  await leaveDetails(page);
}

/** /book, for the served pincode, at the visit. */
export async function openForm(page: Page): Promise<void> {
  await openAtPincode(page);
  await checkPincode(page, SERVED.pincode);
}

/** /book, for the pincode we do not serve, at the list. */
export async function openWaitlist(page: Page): Promise<void> {
  await openAtPincode(page);
  await checkPincode(page, UNSERVED.pincode);
}

/** On from the visit to the address. */
export async function toAddress(page: Page): Promise<void> {
  await page.getByRole("button", { name: siteCopy.booking.next }).click();
  await expect(page.getByText("Step 4 of 4 · Your address")).toBeFocused();
}

/** The address filled in and the booking sent. */
export async function fillAndBook(page: Page): Promise<void> {
  await fillAddress(page);
  await page.getByRole("button", { name: referralCopy.referral.consultation.submit }).click();
}

/** From the visit: on to the address, and booked. */
export async function continueAndBook(page: Page): Promise<void> {
  await toAddress(page);
  await fillAndBook(page);
}

export async function bookHere(page: Page): Promise<void> {
  await openForm(page);
  await continueAndBook(page);
}

/** The lead calls /book's first step makes, answered as the API answers every number. */
export async function leadCalls(page: Page): Promise<Request[]> {
  const calls: Request[] = [];
  await page.route("**/api/lead", (route) => {
    calls.push(route.request());
    return route.fulfill({ status: 201, json: {} });
  });
  return calls;
}

/** What /book says beside the invite this browser remembers, before it sends it. */
export const TOLD =
  "You have an invite. Whoever invited you is told when you are fitted. That is when the 3 visits land.";
