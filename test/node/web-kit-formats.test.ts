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
import { rupees, rupeeSign } from "../../packages/web-kit/money.ts";

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

  // VIS-24: the public site writes a price with its own sign, as its design does, and the apps with "Rs.", as the
  // Phase 2 boards do; the figure is grouped and rounded the same way under both.
  it.each([
    [3000000, "₹30,000"],
    [10000000, "₹1,00,000"],
    [235932, "₹2,359.32"],
  ])("writes %i paise as the public site does: %s", (paise, written) => {
    expect(rupeeSign(paise)).toBe(written);
  });

  it("is the one way any front end writes rupees", () => {
    const formatting = ["apps", "site/src", "packages/ui"]
      .flatMap(sourcesUnder)
      .filter((path) => readFileSync(path, "utf8").includes("new Intl.NumberFormat("));
    expect(formatting).toEqual([]);
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
