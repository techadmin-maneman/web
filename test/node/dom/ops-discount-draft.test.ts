// A discount code as ops make it (apps/ops/src/settings/discount-draft.ts): the boxes' text becomes numbers and paise
// only when it is sent, a limit left empty is left out, and a batch is single-use whatever was typed.

import { describe, expect, it } from "vitest";
import { settings } from "../../../apps/ops/src/content.ts";
import { checkLines, codeError, EMPTY, isReady, requestOf } from "../../../apps/ops/src/settings/discount-draft.ts";

const copy = settings.discountCodes;

describe("a discount code being made", () => {
  it("sends a typed percentage with its cap in paise, and leaves out the limits left empty", () => {
    const draft = { ...EMPTY, code: " diwali10 ", value: "10", cap: "500", covers: ["service" as const] };
    expect(requestOf(draft)).toEqual({
      code: "diwali10",
      kind: "percent",
      value: 10,
      cap: 50_000,
      covers: ["service"],
      once_per_client: true,
    });
  });

  it("makes a generated batch single-use, whatever was typed for its uses, and drops a cap from an amount", () => {
    const draft = {
      ...EMPTY,
      how: "generated" as const,
      count: "25",
      kind: "amount" as const,
      value: "1000.5",
      cap: "200",
      maxUses: "9",
      expiresOn: "2027-01-31",
      covers: ["first_fit" as const],
    };
    expect(requestOf(draft)).toEqual({
      count: 25,
      kind: "amount",
      value: 100_050,
      covers: ["first_fit"],
      expires_on: "2027-01-31",
      max_uses: 1,
      once_per_client: true,
    });
    expect(checkLines(draft, requestOf(draft))[0]).toBe(copy.manyGenerated(25));
  });

  it("is ready only with a code that can be one, a value, and something it covers", () => {
    const named = { ...EMPTY, code: "DIWALI10", value: "10" };
    expect(isReady(named)).toBe(false);
    expect(isReady({ ...named, covers: ["service"] })).toBe(true);
    expect(codeError({ ...named, code: "no spaces" })).not.toBeNull();
    expect(isReady({ ...named, code: "no spaces", covers: ["service"] })).toBe(false);
  });
});
