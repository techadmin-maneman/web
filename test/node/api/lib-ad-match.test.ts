// What Meta and Google are given to match a conversion (ADR 0288): a number read however it was typed, then hashed in
// each platform's own form; a first name hashed as Meta asks; Meta's click cookie built from its click ID; and the
// WhatsApp reference read back from a message.

import { describe, expect, it } from "vitest";
import { refIn, refLine, REF_PATTERN } from "../../../src/config/ref-tokens.ts";
import {
  FBC_PATTERN,
  fbcOf,
  FBP_PATTERN,
  googlePhoneHash,
  metaFirstNameHash,
  metaPhoneHash,
} from "../../../src/lib/ad-match.ts";
import { toE164 } from "../../../src/lib/mobile.ts";

const META_9810000000 = "bcc88c97a6154a697d7457b22edd819efd1cd789d5ca1dbf67ae8cf4aadfa802";
const GOOGLE_9810000000 = "8a4f2aabb279c7781aa9ab142ae3f33d2f8e7241be647acc649c3e576bc356cd";

describe("a number", () => {
  it("is one E.164 number however it was typed", () => {
    for (const typed of ["9810000000", "98100 00000", "+91 98100-00000", "098100 00000", "91-9810000000"]) {
      expect(toE164(typed)).toBe("+919810000000");
    }
    expect(toE164("12345")).toBeNull();
    expect(toE164("5810000000")).toBeNull();
  });

  it("is hashed for Meta as its digits with the country code, and for Google as E.164 with the plus", async () => {
    expect(await metaPhoneHash("+919810000000")).toBe(META_9810000000);
    expect(await googlePhoneHash("+919810000000")).toBe(GOOGLE_9810000000);
    expect(await googlePhoneHash("919810000000")).toBe(GOOGLE_9810000000);
  });
});

describe("a first name for Meta", () => {
  it("is the first word, in small letters, without punctuation", async () => {
    const rohit = "4320472dca0d474b698d34e00ea152eae7c4fe91290b6745c78ed67b4b0551b4";
    expect(await metaFirstNameHash("Rohit Malhotra")).toBe(rohit);
    expect(await metaFirstNameHash("  ROHIT. ")).toBe(rohit);
  });

  it("keeps a letter's accent, and gives nothing where no letter is left", async () => {
    expect(await metaFirstNameHash("Ásha")).toBe("9bee09261c561dfecc653ea3cef98b7ff274eb08065d91916b28d5dc53d5fb4e");
    expect(await metaFirstNameHash("--")).toBeNull();
  });
});

describe("Meta's click cookie", () => {
  it("is built from the click ID and the moment the visitor landed, in Meta's own form", () => {
    const fbc = fbcOf("IwAR2abcDEF_123-x", new Date("2026-11-20T06:30:00.000Z"));
    expect(fbc).toBe("fb.1.1795156200000.IwAR2abcDEF_123-x");
    expect(FBC_PATTERN.test(fbc)).toBe(true);
  });

  it("is told from a browser cookie that is not one", () => {
    expect(FBC_PATTERN.test("fb.1.1795156200000")).toBe(false);
    expect(FBP_PATTERN.test("fb.1.1795156200000.1234567890")).toBe(true);
    expect(FBP_PATTERN.test("fb.1.x.1234567890")).toBe(false);
  });
});

describe("the WhatsApp reference", () => {
  it("is read back from the message, in either case, wherever the line is", () => {
    expect(refIn(`Hi, I'd like to know more. ${refLine("M7K2Q9XP")}`)).toBe("M7K2Q9XP");
    expect(refIn("hello ref m7k2q9xp thanks")).toBe("M7K2Q9XP");
    expect(refIn("Ref: M7K2Q9XP")).toBe("M7K2Q9XP");
  });

  it("is none where the message carries none, or a code with letters we never use", () => {
    expect(refIn("Hi, I'd like to know more.")).toBeNull();
    expect(refIn("Ref M0K1Q9XP")).toBeNull();
    expect(REF_PATTERN.test("M7K2Q9XP")).toBe(true);
    expect(REF_PATTERN.test("M7K2Q")).toBe(false);
  });
});
