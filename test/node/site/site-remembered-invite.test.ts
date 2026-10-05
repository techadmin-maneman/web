// The invite a browser remembers for /book (docs/decisions/0089-an-invite-is-not-lost.md).

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  codeIn,
  INVITE_REMEMBERED_DAYS,
  rememberedInvite,
  remembering,
} from "../../../site/src/lib/remembered-invite.ts";

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

describe("reading the remembered invite", () => {
  const stored = new Map<string, string>();
  const storage = {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  };

  afterEach(() => {
    stored.clear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("gives the code while it is fresh, and keeps it", () => {
    vi.useFakeTimers({ now: later(1) });
    vi.stubGlobal("localStorage", storage);
    stored.set("mm_invite", remembering("RM4K7P", OPENED));
    expect(rememberedInvite()).toBe("RM4K7P");
    expect(stored.has("mm_invite")).toBe(true);
  });

  // The privacy page says the browser keeps the code for thirty days, so one older is taken away when it is found.
  it.each([
    ["one older than 30 days", remembering("RM4K7P", OPENED)],
    ["one of another shape", JSON.stringify({ invite: "RM4K7P" })],
  ])("removes %s, and gives none", (_, value) => {
    vi.useFakeTimers({ now: later(31) });
    vi.stubGlobal("localStorage", storage);
    stored.set("mm_invite", value);
    expect(rememberedInvite()).toBeNull();
    expect(stored.has("mm_invite")).toBe(false);
  });

  it("gives none where the browser blocks storage", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(rememberedInvite()).toBeNull();
  });
});
