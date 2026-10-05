// The hero film: the byte ranges the site's Worker gives it in (site/src/lib/byte-range.ts), and when it plays by
// itself (site/src/lib/hero-film.ts).

import { describe, expect, it } from "vitest";
import { rangeOf } from "../../../site/src/lib/byte-range.ts";
import { playsByItself } from "../../../site/src/lib/hero-film.ts";

describe("the range a Range header asks for", () => {
  const SIZE = 1000;

  it.each([
    ["bytes=0-1", { start: 0, end: 1 }],
    ["bytes=0-499", { start: 0, end: 499 }],
    ["bytes=500-", { start: 500, end: 999 }],
    ["bytes=500-5000", { start: 500, end: 999 }],
    ["bytes=-100", { start: 900, end: 999 }],
    ["bytes=-5000", { start: 0, end: 999 }],
    [" bytes=10-20 ", { start: 10, end: 20 }],
  ])("%s is that part", (header, range) => {
    expect(rangeOf(header, SIZE)).toEqual(range);
  });

  it.each(["bytes=1000-", "bytes=2000-3000", "bytes=-0"])("%s asks for nothing the file has", (header) => {
    expect(rangeOf(header, SIZE)).toBe("unsatisfiable");
  });

  it.each([null, "bytes=0-1,5-6", "items=0-1", "bytes=-", "bytes=20-10", "bytes=a-b"])(
    "%s is answered with the whole file",
    (header) => {
      expect(rangeOf(header, SIZE)).toBe("whole");
    },
  );
});

describe("when the hero film plays by itself", () => {
  it("plays where the browser says nothing of the connection, as Safari and Firefox do", () => {
    expect(playsByItself(false, undefined)).toBe(true);
    expect(playsByItself(false, {})).toBe(true);
  });

  it("plays on 4G", () => {
    expect(playsByItself(false, { saveData: false, effectiveType: "4g" })).toBe(true);
  });

  // Phones on prepaid data downloaded the film before the visitor chose anything.
  it.each(["slow-2g", "2g", "3g"])("waits for Play on %s", (effectiveType) => {
    expect(playsByItself(false, { effectiveType })).toBe(false);
  });

  it("waits for Play when the visitor asked for less data or reduced motion", () => {
    expect(playsByItself(false, { saveData: true, effectiveType: "4g" })).toBe(false);
    expect(playsByItself(true, undefined)).toBe(false);
  });
});
