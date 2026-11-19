// A consultation a script books on staging through the site's form, POST /api/consultation, as the house's test
// people do: "Staging test" or "Load test", with a made-up number and a made-up address. It carries Cloudflare's
// dummy Turnstile token, which only staging accepts (scripts/staging/staging-lead.ts, scripts/staging/load-test-leads.ts).
// The number is proved first with its WhatsApp code, as every booking's is: a test record's is staging's known
// STAGING_TEST_RECORD_CODE, and is never sent to a number off staging's allowlist.

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

/**
 * The furthest day the form offers in India, 13 days on: the last of its fortnight whether it starts today, where ops
 * let a consultation be booked for today, or tomorrow. The furthest from any real visit.
 */
export function lastBookableDay(now: Date = new Date()): string {
  return addDays(indiaDate(now), BOOKING_DAYS - 1);
}

/** Proves the booking's number with the code staging knows for a test record; the code's ID, which the booking sends. */
export async function proveTestNumber(
  base: string,
  headers: Readonly<Record<string, string>>,
  booking: Pick<TestBooking, "name" | "mobile">,
  testRecordCode: string,
): Promise<string> {
  const post = (path: string, body: unknown) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      redirect: "manual",
    });
  const sent = await post("/api/number-code", {
    mobile: booking.mobile,
    name: booking.name,
    turnstile_token: TURNSTILE_TEST_TOKEN,
  });
  const { code_id: codeId } = (await sent.json().catch(() => ({}))) as { code_id?: string };
  if (sent.status !== 202 || codeId === undefined) throw new Error(`no code for the number: ${String(sent.status)}`);
  const entered = await post("/api/number-code/verify", { code_id: codeId, code: testRecordCode });
  const { verified } = (await entered.json().catch(() => ({}))) as { verified?: boolean };
  if (verified !== true) throw new Error(`the code did not prove the number: ${String(entered.status)}`);
  return codeId;
}

/** What the site's form sends for this booking, with the code that proved its number. */
export function consultationBody(booking: TestBooking, numberCodeId: string) {
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
    number_code_id: numberCodeId,
    consent: true,
    terms: true,
  };
}
