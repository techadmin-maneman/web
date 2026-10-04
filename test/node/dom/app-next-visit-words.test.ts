// What Home's prompt says of the next visit it offers (apps/app/src/home/next-visit-words.ts): the day it falls due,
// or the day it was due once that has passed, and never the day offered as though it were the day due.

import { describe, expect, it } from "vitest";
import type { Me } from "../../../apps/app/src/api.ts";
import { nextVisitWords } from "../../../apps/app/src/home/next-visit-words.ts";

type NextVisitPrompt = Extract<NonNullable<Me["prompt"]>, { kind: "next_visit" }>;

const prompt = (fields: Partial<NextVisitPrompt>): NextVisitPrompt => ({
  kind: "next_visit",
  type: "service",
  tier: "standard",
  due_on: "2026-10-27",
  date: "2026-10-27",
  window: "morning",
  replacement_bookable: false,
  ...fields,
});

describe("Home's prompt for the next visit", () => {
  it("names the day a service falls due, and books it for then", () => {
    expect(nextVisitWords(prompt({}), "2026-10")).toEqual({
      line: "Your next service visit is due on Tue 27 Oct, in the morning.",
      book: "Book it for then",
    });
  });

  it("says the day a service was due once it has passed, and the day offered on the button", () => {
    expect(nextVisitWords(prompt({ due_on: "2026-09-24", date: "2026-10-03" }), "2026-10")).toEqual({
      line: "Your service visit was due on Thu 24 Sep.",
      book: "Book it for Sat 3 Oct",
    });
  });

  it("says the month an overdue replacement was due, never a day, and the day offered on the button", () => {
    const overdue = prompt({ type: "replacement", due_on: "2026-09-24", date: "2026-10-03", window: null });
    expect(nextVisitWords(overdue, "2026-10")).toEqual({
      line: "Your replacement was due in September.",
      book: "Book it for Sat 3 Oct",
    });
  });

  it("says the month a replacement falls due, and books it for its own day", () => {
    const coming = prompt({ type: "replacement", due_on: "2026-10-15", date: "2026-10-15", window: null });
    expect(nextVisitWords(coming, "2026-10")).toEqual({
      line: "Your replacement is due in October.",
      book: "Book it for then",
    });
  });
});
