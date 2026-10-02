// Which technicians may take a new booking, by the number they sign in with (src/policy/technician-numbers.ts).

import { describe, expect, it } from "vitest";
import { numberProblems, RULES, type RosterEntry } from "../../src/policy/technician-numbers.ts";

const technician = (id: string, mobileE164: string | null): RosterEntry => ({ id, fsmId: `sr-${id}`, mobileE164 });

describe("a technician's number", () => {
  it(RULES[0], () => {
    const problems = numberProblems([technician("imran", "+919810000009"), technician("adwate", null)]);

    expect(problems).toEqual(new Map([["adwate", { kind: "unreadable" }]]));
  });

  it(RULES[1], () => {
    const problems = numberProblems([
      technician("first", "+919810000007"),
      technician("second", "+919810000007"),
      technician("third", "+919810000007"),
      technician("own", "+919810000008"),
    ]);

    expect(problems).toEqual(
      new Map([
        ["second", { kind: "shared", signsIn: "sr-first" }],
        ["third", { kind: "shared", signsIn: "sr-first" }],
      ]),
    );
  });

  it("keeps out no one where each holds a number of his own", () => {
    expect(numberProblems([technician("imran", "+919810000009"), technician("naveen", "+919810000007")])).toEqual(
      new Map(),
    );
    expect(numberProblems([])).toEqual(new Map());
  });

  it("never counts two with no number as sharing one", () => {
    const problems = numberProblems([technician("one", null), technician("two", null)]);

    expect(problems).toEqual(
      new Map([
        ["one", { kind: "unreadable" }],
        ["two", { kind: "unreadable" }],
      ]),
    );
  });
});
