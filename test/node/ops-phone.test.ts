// A mobile number as the ops console shows it (apps/ops/src/lib/phone.ts): in
// the two groups of five it is read out in, never as the thirteen characters it
// is stored as (OPS-21 of the audit, 24 September 2026).

import { describe, expect, it } from "vitest";
import { phoneWords } from "../../apps/ops/src/lib/phone.ts";

describe("a mobile number on the console", () => {
  it("groups an Indian mobile as it is read out", () => {
    expect(phoneWords("+919557267803")).toBe("+91 95572 67803");
  });

  it("leaves any other number as it is stored, rather than guess at its groups", () => {
    expect(phoneWords("+447700900123")).toBe("+447700900123");
    expect(phoneWords("9557267803")).toBe("9557267803");
  });
});
