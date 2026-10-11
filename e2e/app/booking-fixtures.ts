// What the app's booking tests share (booking*.e2e.ts): a client's profile and what they have agreed to, a hold the
// API answers, the sheet opened and walked to its pay step, and the prices it shows.

import type { Page } from "@playwright/test";
import { PORTS } from "../../scripts/lib/local-stack.ts";
import { expect } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { bookerClient } from "./booker.ts";
import { continueToPayment } from "./picking.ts";
import { logIn } from "./signed-in.ts";

/** A first fit and its late fee once GST applies, as it will in production (on staging GST is nothing). */
export const FIRST_FIT = { amount_ex_gst: 3000000, amount: 3540000, gst_percent: 18 };

export const LATE_FEE = { amount_ex_gst: 400000, amount: 472000, gst_percent: 18 };

export const LATE_FEE_LINE =
  "Moving or cancelling inside 24 hours costs Rs. 4,720 (Rs. 4,000 + Rs. 720 GST). The rest moves with your visit, or comes back to you.";

/** The pay step's promise for a visit ahead of its notice, and for one already inside it, whose payment is kept. */
export const FREE_UNTIL = /^Free to move or cancel until .+\. After that, changes are charged\.$/;

export type Hold = Record<string, unknown>;

/**
 * Passes one of the local mm-api's answers through, changed by `change`; `ask` changes the question first, where the
 * local mm-api would refuse the page's own. Only the browser resolves app.localhost, so the answer is fetched from
 * the app's server by its address, on the app's own host.
 */
export async function passedThrough(
  page: Page,
  url: string | RegExp,
  change: (answer: never, asked: URL) => unknown,
  ask: (asked: URL) => URL = (asked) => asked,
) {
  await page.route(url, async (route) => {
    const asked = new URL(route.request().url());
    const sent = ask(new URL(asked));
    const answer = await route.fetch({
      url: `http://127.0.0.1:${String(PORTS.app)}${sent.pathname}${sent.search}`,
      headers: { ...route.request().headers(), host: `app.localhost:${String(PORTS.app)}` },
    });
    await route.fulfill({ response: answer, json: change((await answer.json()) as never, asked) });
  });
}

/** Opens the booking sheet from Visits. */
export async function openSheet(page: Page): Promise<void> {
  await logIn(page, bookerClient().mobile);
  await page.getByRole("navigation").getByRole("link", { name: "Visits" }).click();
  await page.getByRole("button", { name: "Book your next visit" }).click();
}

/** Logs in and picks the first free day, as far as the window step. */
export async function toWindows(page: Page): Promise<void> {
  await openSheet(page);
  const sheet = page.getByRole("dialog", { name: "Pick a date" });
  // The sheet asks the API for the services and the free days first; on 1 October 2026 a busy machine left it
  // "Loading" past the five seconds an expectation waits by default.
  await expect(sheet.getByText("Step 1 of 3")).toBeVisible({ timeout: 30_000 });
  await sheet.getByRole("radio").and(page.locator(":enabled")).first().click();
  await sheet.getByRole("button", { name: "Continue" }).click();
}

export async function toPayment(page: Page): Promise<void> {
  await toWindows(page);
  await continueToPayment(page);
}

export const PHOTOS = ["photos_own_record", "photos_referral_cards"];

export const PURPOSES = [...PHOTOS, "photos_marketing", "whatsapp_visits", "whatsapp_launches"];

export const ADDRESS = {
  line1: "House 4417, Tower C",
  line2: null,
  locality: "Sector 65",
  city: "Gurgaon",
  pincode: "122018",
  access_notes: null,
  building: null,
  flat: null,
  floor: null,
  tower: null,
  landmark: null,
  place_id: null,
};

export interface Standing {
  /** WhatsApp about their visits is on, so the sheet does not ask to remind them. */
  readonly reminders?: boolean;
  /** Photograph purposes never decided on; the others are given, as the booking client's are. */
  readonly undecided?: readonly string[];
  /** An address is saved; without one, the sheet asks for it first. */
  readonly address?: boolean;
}

/** The profile the sheet reads, for a client standing as `standing` says. */
export function profileOf({ reminders = false, undecided = [], address = true }: Standing) {
  const at = new Date().toISOString();
  const consents = PURPOSES.map((purpose) => {
    const given = purpose === "whatsapp_visits" ? reminders : PHOTOS.includes(purpose) && !undecided.includes(purpose);
    return { purpose, granted: given, since: given ? at : null };
  });
  const answer = { name: "Rohit Malhotra", mobile: "+91 98xxx x4417", consents };
  const rest = {
    address_given_to_ops: null,
    number_change: null,
    number_change_decided: null,
    deletion: null,
    deletion_rejected: null,
    grievances: [],
  };
  return { ...answer, address: address ? ADDRESS : null, ...rest };
}

/**
 * The client's profile as the sheet reads it. The booking client is shared by every test here, so each says what
 * it needs rather than depending on another's switch. Only the browser resolves app.localhost, so the profile is
 * answered whole rather than fetched and changed.
 */
export async function profileAs(page: Page, standing: Standing): Promise<void> {
  await page.route("**/api/profile", (route) => route.fulfill({ json: profileOf(standing) }));
}

/**
 * A hold for the day and window the sheet asked for, on `terms` of the test's choosing: a first fit, or one a
 * credit covers. It is answered in the API's place, so nothing is held; returns the hold as the page received it.
 */
export async function holdAs(page: Page, terms: Hold): Promise<() => Hold> {
  let last: Hold = {};
  await page.route("**/api/holds", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const asked = route.request().postDataJSON() as { type: string; date: string; window: string };
    const now = Date.now();
    last = {
      id: crypto.randomUUID(),
      type: asked.type,
      service: { tier: "standard", name: "Service visit", minutes: 90 },
      date: asked.date,
      window: asked.window,
      starts_at: `${asked.date}T06:30:00.000Z`,
      ends_at: `${asked.date}T10:30:00.000Z`,
      technician: { name: "Imran Qureshi", initials: "IQ" },
      price: { amount_ex_gst: 200000, amount: 200000, gst_percent: 0 },
      late_fee: null,
      free_until: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
      change_notice_hours: 24,
      late_change_charge: "visit",
      expires_at: new Date(now + 10 * 60 * 1000).toISOString(),
      pay_by: new Date(now + 12 * 60 * 1000).toISOString(),
      state: "held",
      paid: false,
      visit_id: null,
      moves_visit_id: null,
      credit: null,
      discount: null,
      ...terms,
    };
    return route.fulfill({ status: 201, json: last });
  });
  return () => last;
}

/** axe on the page as it stands, against WCAG 2.2 AA. */
export async function scanOf(page: Page): Promise<void> {
  expect(await axeViolations(page)).toEqual([]);
}
