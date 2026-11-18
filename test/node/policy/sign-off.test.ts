// Which visits closed done need the client's sign-off first (src/policy/sign-off.ts;
// docs/decisions/0254-client-signs-off-the-fit.md).

import { describe, expect, it } from "vitest";
import { closesFit, needsSignOff } from "../../../src/policy/sign-off.ts";

describe("a fit's sign-off", () => {
  it("is needed by a first fit and a replacement, and by no other kind of visit", () => {
    expect(needsSignOff("first_fit", null)).toBe(true);
    expect(needsSignOff("replacement", null)).toBe(true);
    expect(needsSignOff("service", null)).toBe(false);
    expect(needsSignOff("consultation", null)).toBe(false);
  });

  it("is needed by a consultation and fit in one visit only where the client was fitted that day", () => {
    expect(needsSignOff("first_fit", { fitsToday: true })).toBe(true);
    expect(needsSignOff("consultation", { fitsToday: true })).toBe(true);
    expect(needsSignOff("first_fit", { fitsToday: false })).toBe(false);
  });

  it("lets the fit close once signed or declined, and not before", () => {
    expect(closesFit("signed")).toBe(true);
    expect(closesFit("declined")).toBe(true);
    expect(closesFit("asked")).toBe(false);
    expect(closesFit("flagged")).toBe(false);
    expect(closesFit(null)).toBe(false);
  });
});
