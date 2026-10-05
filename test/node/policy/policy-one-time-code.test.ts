// The login code (src/policy/one-time-code.ts).

import { describe, expect, it } from "vitest";
import {
  attemptsLeft,
  CODE_TTL_MS,
  newLoginCode,
  ONE_TIME_CODE,
  smsOfferedAt,
  whatsappResendAt,
} from "../../../src/policy/one-time-code.ts";

const AT = new Date("2026-09-22T10:00:00Z");

describe("the one-time code", () => {
  it("makes six-digit codes, keeping leading zeros", () => {
    const codes = Array.from({ length: 2_000 }, newLoginCode);
    expect(codes.every((code) => /^\d{6}$/.test(code))).toBe(true);
    expect(codes.some((code) => code.startsWith("0"))).toBe(true); // leading zeros are kept
    expect(new Set(codes).size).toBeGreaterThan(1_990);
    expect(ONE_TIME_CODE.digits).toBe(6);
  });

  it("offers SMS 30 seconds after the code is sent", () => {
    expect(smsOfferedAt(AT)).toEqual(new Date("2026-09-22T10:00:30Z"));
  });

  it("voids a code after five wrong attempts", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(attemptsLeft)).toEqual([5, 4, 3, 2, 1, 0, 0]);
  });

  it("sends a WhatsApp code again only after 30 seconds", () => {
    expect(whatsappResendAt(AT)).toEqual(new Date("2026-09-22T10:00:30Z"));
  });

  it("works for ten minutes", () => {
    expect(CODE_TTL_MS).toBe(10 * 60 * 1000);
  });
});
