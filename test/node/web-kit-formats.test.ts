import { describe, expect, it } from "vitest";
import {
  fullDate,
  indiaClock,
  indiaDate,
  indiaInstant,
  listDate,
  listMonth,
  longDate,
  shortDate,
  shortMonth,
  weekdayDate,
} from "../../packages/web-kit/dates.ts";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { mobileDigits, typedDigits } from "../../packages/web-kit/mobile.ts";
import { rupees } from "../../packages/web-kit/money.ts";
import { WHATSAPP_NUMBER, whatsappChat, whatsappShare } from "../../packages/web-kit/whatsapp.ts";

describe("web-kit dates", () => {
  it.each([
    ["2026-09-24", "Thu 24 Sep"],
    ["2026-09-21", "Mon 21 Sep"],
    ["2027-01-02", "Sat 2 Jan"],
  ])("writes the calendar date %s as the design does: %s", (date, written) => {
    expect(shortDate(date)).toBe(written);
  });

  it.each([
    ["2026-11-14T08:00:00Z", "14 Nov 2026"],
    // Past 18:30 UTC it is already the next day in India.
    ["2026-11-13T18:45:00Z", "14 Nov 2026"],
    ["2026-12-31T19:00:00Z", "1 Jan 2027"],
  ])("writes the instant %s as India's date: %s", (instant, written) => {
    expect(longDate(instant)).toBe(written);
  });

  // A replacement is given as a month, never a day: the day is worked out again
  // on every sync and can move under whoever read it (ADR 0059).
  it("writes a month as the ops board heads one, and as the app speaks one", () => {
    expect(shortMonth("2028-03")).toBe("Mar 2028");
    expect(shortMonth("2027-11")).toBe("Nov 2027");
    expect(listMonth("2028-03", 2028)).toBe("March");
    expect(listMonth("2028-03", 2027)).toBe("March 2028");
  });

  it("writes a calendar date in full, and without this year's year in a list", () => {
    expect(fullDate("2027-08-22")).toBe("22 Aug 2027");
    expect(fullDate("2026-11-04")).toBe("4 Nov 2026");
    expect(listDate("2027-08-22", 2027)).toBe("22 Aug");
    expect(listDate("2026-11-14", 2027)).toBe("14 Nov 2026");
    expect(weekdayDate("2026-09-24")).toBe("Thursday 24 Sep");
  });

  it.each([
    ["2026-09-22T03:44:00Z", "2026-09-22", "9:14 am"],
    ["2026-09-22T04:30:00Z", "2026-09-22", "10 am"],
    ["2026-09-22T06:30:00Z", "2026-09-22", "12 pm"],
    ["2026-09-21T18:35:00Z", "2026-09-22", "12:05 am"],
  ])("reads the instant %s as India's date %s and clock %s", (instant, date, clock) => {
    expect(indiaDate(instant)).toBe(date);
    expect(indiaClock(instant)).toBe(clock);
  });

  it("turns India's date and clock into the instant they are, as a calendar file needs", () => {
    expect(indiaInstant("2026-09-24", "09:00").toISOString()).toBe("2026-09-24T03:30:00.000Z");
    expect(indiaInstant("2026-09-24", "03:00").toISOString()).toBe("2026-09-23T21:30:00.000Z");
  });

  // FEA-40: India's offset was written out seven times across the front ends.
  // A service worker is built on its own and imports nothing, so the technician app's keeps its own copy.
  it("is the one place the front ends add India's offset", () => {
    const offsets = ["apps", "site/src", "packages"]
      .flatMap((root) => sourcesUnder(root))
      .filter((path) => path !== "packages/web-kit/dates.ts" && !/^apps\/\w+\/sw\//.test(path))
      .filter((path) => /\b330\b/.test(readFileSync(path, "utf8")));
    expect(offsets).toEqual([]);
  });
});

describe("web-kit money", () => {
  it.each([
    [200000, "Rs. 2,000"],
    [3540000, "Rs. 35,400"],
    [10000000, "Rs. 1,00,000"],
    [235932, "Rs. 2,359.32"],
    [0, "Rs. 0"],
  ])("writes %i paise as the design does: %s", (paise, written) => {
    expect(rupees(paise)).toBe(written);
  });

  it("is the one way any front end writes rupees", () => {
    const formatting = ["apps", "site/src", "packages/ui"]
      .flatMap(sourcesUnder)
      .filter((path) => readFileSync(path, "utf8").includes("new Intl.NumberFormat("));
    expect(formatting).toEqual([]);
  });

  // The owner's ruling of 27 September 2026 (ADR 0025, item 51): the site and the landing write "Rs." as the apps do.
  it("leaves no front end, and no message, writing the rupee sign", () => {
    const TYPED_PRICE_CHECK = "site/src/lib/publish-gate.ts";
    const writingTheSign = ["apps", "site/src", "packages/ui", "src"]
      .flatMap(sourcesUnder)
      .filter((path) => path !== TYPED_PRICE_CHECK && readFileSync(path, "utf8").includes("₹"));
    expect(writingTheSign).toEqual([]);
  });
});

describe("web-kit mobile numbers", () => {
  // The technician app kept the first ten digits typed, so "+91 98110 00000" pasted into it became 91981 10000,
  // a number nobody holds; a pasted +91 is to be read (docs/owner-answers-2026-09-27.md). Both apps read it so.
  it.each([
    "+91 98110 00000",
    "+91-98110-00000",
    "919811000000",
    "9198110 00000",
    "098110 00000",
    "091 98110 00000",
    "0091 98110 00000",
    "98110 00000",
  ])("reads %s as its ten digits, whatever country code or trunk prefix is in front", (typed) => {
    expect(typedDigits(typed)).toBe("9811000000");
    expect(mobileDigits(typed)).toBe("9811000000");
  });

  it("keeps a number that itself begins 91 or 0 whole, and one still being typed as it is", () => {
    expect(mobileDigits("91981 10000")).toBe("9198110000");
    expect(mobileDigits("0 91981 10000")).toBe("9198110000");
    expect(typedDigits("+91 9811")).toBe("919811");
    expect(typedDigits("98110")).toBe("98110");
  });

  it("takes nothing that is not an Indian mobile number", () => {
    expect(mobileDigits("58110 00000")).toBeNull();
    expect(mobileDigits("98110 0000")).toBeNull();
    expect(mobileDigits("+44 7911 123456")).toBeNull();
    expect(mobileDigits("")).toBeNull();
  });
});

describe("web-kit WhatsApp links", () => {
  it("opens a chat with a number, however it is written, with words ready to send if there are any", () => {
    expect(whatsappChat("+91 98100 04417")).toBe("https://wa.me/919810004417");
    expect(whatsappChat(WHATSAPP_NUMBER, "Hello & bye")).toBe("https://wa.me/919007973247?text=Hello%20%26%20bye");
  });

  it("shares words with whoever the sender picks", () => {
    expect(whatsappShare("Look: https://maneman.in")).toBe("https://wa.me/?text=Look%3A%20https%3A%2F%2Fmaneman.in");
  });

  // FEA-40, FEO-29: the number was written three times and a link built seven ways.
  it("is the one place the front ends write the number or build a link", () => {
    const own = ["apps", "site/src", "packages/ui"]
      .flatMap((root) => sourcesUnder(root))
      .filter((path) => /https:\/\/wa\.me|9007973247/.test(readFileSync(path, "utf8")));
    expect(own).toEqual([]);
  });
});

/** The front ends' source files under a directory, with forward slashes, leaving out builds and generated schemas. */
function sourcesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name).replace(/\\/g, "/");
    if (name === "node_modules" || name === "dist" || name.endsWith("api-schema.ts")) return [];
    if (statSync(path).isDirectory()) return sourcesUnder(path);
    return /\.(ts|tsx|astro)$/.test(name) ? [path] : [];
  });
}
