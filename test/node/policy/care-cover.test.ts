// Who answers for a Care person who is off (src/policy/care-cover.ts; docs/decisions/0134-care-cover.md).

import { describe, expect, it } from "vitest";
import { coversOf, isOff, weekdayOf } from "../../../src/policy/care-cover.ts";

describe("a day off", () => {
  it("is a weekly day off, or a day inside leave, ends included", () => {
    expect(weekdayOf("2026-10-11")).toBe(0);
    const off = { weekly: [0], leave: [{ from: "2026-10-20", to: "2026-10-22" }] };
    expect(isOff("2026-10-11", off)).toBe(true);
    expect(isOff("2026-10-12", off)).toBe(false);
    expect(isOff("2026-10-20", off)).toBe(true);
    expect(isOff("2026-10-22", off)).toBe(true);
    expect(isOff("2026-10-23", off)).toBe(false);
  });
});

describe("cover", () => {
  const team = [
    { email: "asha@maneman.test", clients: 10 },
    { email: "lead@maneman.test", clients: 4 },
    { email: "ravi@maneman.test", clients: 6 },
    { email: "zara@maneman.test", clients: 3 },
  ];

  it("goes to the member on with the fewest clients, each taking on who they cover before the next", () => {
    const covers = coversOf(team, new Set(["asha@maneman.test", "zara@maneman.test"]));
    expect(covers).toEqual(
      new Map([
        ["asha@maneman.test", "lead@maneman.test"],
        ["zara@maneman.test", "ravi@maneman.test"],
      ]),
    );
  });

  it("goes to nobody when the whole team is off", () => {
    expect(coversOf(team, new Set(team.map((member) => member.email)))).toEqual(new Map());
  });
});
