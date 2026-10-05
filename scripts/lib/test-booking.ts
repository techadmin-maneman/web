// A consultation a script books on staging through the site's form, POST /api/consultation, as the house's test
// people do: "Staging test" or "Load test", with a made-up number and a made-up address. It carries Cloudflare's
// dummy Turnstile token, which only staging accepts (scripts/staging/staging-lead.ts, scripts/staging/load-test-leads.ts).

import { BOOKING_DAYS, type BookingWindow } from "../../src/config/scheduling.ts";
import { addDays, indiaDate } from "../../src/lib/india-time.ts";
import { TURNSTILE_TEST_TOKEN } from "../../src/providers/turnstile.ts";

export interface TestBooking {
  readonly name: "Staging test" | "Load test";
  /** Ten digits. */
  readonly mobile: string;
  /** A pincode we serve, and its city. */
  readonly pincode: string;
  readonly city: string;
  readonly date: string;
  readonly window: BookingWindow;
}

/** A number nobody answers: 9, then nine random digits. */
export function testMobile(): string {
  return `9${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
}

/** The last day the form offers, tomorrow and 13 days on in India: the furthest from any real visit. */
export function lastBookableDay(now: Date = new Date()): string {
  return addDays(indiaDate(now), BOOKING_DAYS);
}

/** What the site's form sends for this booking. */
export function consultationBody(booking: TestBooking) {
  return {
    name: booking.name,
    mobile: booking.mobile,
    pincode: booking.pincode,
    loss_extent: "crown",
    turnstile_token: TURNSTILE_TEST_TOKEN,
    date: booking.date,
    window: booking.window,
    address: {
      flat: "Flat 1",
      floor: null,
      tower: null,
      line1: "A test booking",
      line2: null,
      landmark: null,
      locality: "Made by a script",
      city: booking.city,
      pincode: booking.pincode,
      access_notes: "Nobody lives here: this booking tests the site's form.",
    },
    consent: true,
  };
}
