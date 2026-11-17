// /book's words of how long a visit takes (ADR 0265): each is the console's, through visitLength, never typed into a
// line; and the one visit's note says it is paid through a Razorpay link (ADR 0269), never by UPI or in cash.

import { describe, expect, it } from "vitest";
import { referral } from "../../../site/src/content/referral.ts";
import { capitalised, visitLength } from "../../../site/src/content/service.ts";
import { booking } from "../../../site/src/content/site.ts";

/** A length as a line would type it: "60 minutes", "2.5 hours", "an hour". */
const LENGTH = /\b\d+(\.\d+)?\s*(minutes?|mins?|hours?)\b|\b(an|one|two|three) hours?\b/i;

/** Every string in a part of the content, however deep. */
const strings = (value: unknown): string[] => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (typeof value === "object" && value !== null) return Object.values(value).flatMap(strings);
  return [];
};

/** A line with the console's lengths taken out, so a length left in it was typed. */
const typedIn = (line: string): string =>
  Object.values(visitLength).reduce(
    (rest, length) => rest.replaceAll(length, "").replaceAll(capitalised(length), ""),
    line,
  );

describe("/book's lengths", () => {
  it("are the console's: the phone's short intro and the plan's choices say visitLength", () => {
    expect(booking.introShort).toContain(capitalised(visitLength.consultation));
    expect(referral.consultation.plan.options.map((option) => option.label)).toEqual([
      expect.stringContaining(visitLength.consultation),
      expect.stringContaining(visitLength.firstFit),
    ]);
  });

  it("are never typed into a line of the page, its form or How it works", () => {
    const lines = [booking, referral.consultation, referral.howItWorks].flatMap(strings);
    expect(lines.filter((line) => LENGTH.test(typedIn(line)))).toEqual([]);
  });
});

describe("the one visit's note", () => {
  it("says it is paid through a Razorpay link once fitted, never by UPI or in cash", () => {
    const { note, oneVisitNote } = referral.consultation.plan;
    expect(oneVisitNote).toBe(
      "Paid through a Razorpay link once you’re fitted. Decide against it and you pay nothing.",
    );
    expect(`${note} ${oneVisitNote}`).not.toMatch(/\bUPI\b|\bcash\b/i);
  });
});
