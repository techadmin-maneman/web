// The invite a browser remembers for /book (docs/decisions/0089-an-invite-is-not-lost.md).

import { describe, expect, it } from "vitest";
import { codeIn, INVITE_REMEMBERED_DAYS, remembering } from "../../site/src/lib/remembered-invite.ts";

const OPENED = new Date("2026-09-28T06:30:00Z");
const DAY = 86_400_000;
const later = (days: number) => new Date(OPENED.getTime() + days * DAY);

describe("a remembered invite", () => {
  it("is kept for 30 days from when it was opened, and no longer", () => {
    expect(INVITE_REMEMBERED_DAYS).toBe(30);
    const stored = remembering("rm4k7p", OPENED);
    expect(codeIn(stored, OPENED)).toBe("RM4K7P");
    expect(codeIn(stored, later(29.9))).toBe("RM4K7P");
    expect(codeIn(stored, later(30))).toBeNull();
  });

  it.each([
    ["nothing stored", null],
    ["something that is not JSON", "RM4K7P"],
    ["another shape", JSON.stringify({ invite: "RM4K7P" })],
    ["a code of the wrong shape", JSON.stringify({ code: "not a code!", saved_at: OPENED.toISOString() })],
    ["a date that is not one", JSON.stringify({ code: "RM4K7P", saved_at: "soon" })],
  ])("is no invite when the browser holds %s", (_, stored) => {
    expect(codeIn(stored, OPENED)).toBeNull();
  });
});
