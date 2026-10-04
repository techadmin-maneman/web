// What the client app says, in one register: no back-office word (slot, hold, session, piece), no stiff phrase
// ("just now", "Please try again", "You are offline"), and "Sign in" everywhere (the 2 Oct audit, CP-13, CP-14, CP-15
// and CP-48). The consent notices are left out: they are kept word for word as each consent was given.

import { describe, expect, it } from "vitest";
import * as app from "../../apps/app/src/content.ts";

/** Every string content.ts can put on screen: its strings, and what its functions write for sample values. */
function shown(value: unknown, out: string[]): string[] {
  if (typeof value === "string") out.push(value);
  else if (typeof value === "function") {
    const write = value as (...args: unknown[]) => unknown;
    for (const sample of ["x", 2]) {
      try {
        shown(write(...Array.from({ length: write.length }, () => sample)), out);
      } catch {
        // A function that needs a value of another kind writes nothing for this one.
      }
    }
  } else if (Array.isArray(value)) value.forEach((each) => shown(each, out));
  else if (typeof value === "object" && value !== null) Object.values(value).forEach((each) => shown(each, out));
  return out;
}

describe("the client app's copy", () => {
  const strings = shown(Object.values(app), []);

  it("reads every line of it", () => {
    expect(strings.length).toBeGreaterThan(500);
  });

  it.each([
    ["a slot, or a hold that runs out", /\bslots?\b|\bhold (expired|ran out|has run out)\b/i],
    ["a session", /\bsession\b/i],
    ["a piece, which is a hair system", /\bpieces?\b/i],
    ["“just now”", /\bjust now\b/i],
    ["“Please try again”", /Please try again/],
    ["“You are offline”", /You are offline/],
    ["“Log in” or “Log out”", /\bLog (in|out)\b/],
  ])("says no %s", (_, pattern) => {
    expect(strings.filter((each) => pattern.test(each))).toEqual([]);
  });
});
