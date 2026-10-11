// What a changed line must keep before the Words page saves it (src/policy/word-checks.ts).

import { describe, expect, it } from "vitest";
import { longestOf, wordRefusal } from "../../../src/policy/word-checks.ts";

describe("a changed line of the site", () => {
  it("keeps every hole the page fills, and no other", () => {
    expect(wordRefusal("Fitted at home in {city}.", "A hair system, fitted in {city}.", "site")).toBeNull();
    expect(wordRefusal("Fitted at home.", "A hair system, fitted in {city}.", "site")).toBe("holes");
    expect(wordRefusal("Fitted in {city} by {name}.", "Fitted in {city}.", "site")).toBe("holes");
  });

  it("types no price and no reward, which the price book and the console set", () => {
    expect(wordRefusal("From Rs. 30,000.", "From {firstFit}.", "site")).toBe("holes");
    expect(wordRefusal("{firstFit}, or Rs. 2,000 off.", "{firstFit}.", "site")).toBe("price");
    expect(wordRefusal("You get 3 service visits.", "Visits that land when you are fitted.", "site")).toBe("visits");
  });

  it("keeps a price the code's own wording gives, as the comparison's prices elsewhere", () => {
    expect(wordRefusal("Rs. 1,50,000 and up", "Rs. 1,00,000 to Rs. 3,00,000", "site")).toBeNull();
  });

  it("holds no placeholder text, is not empty, and keeps to a length the layout holds", () => {
    expect(wordRefusal("Placeholder copy", "Book a consultation", "site")).toBe("placeholder");
    expect(wordRefusal("   ", "Book a consultation", "site")).toBe("empty");
    const wording = "Book a consultation";
    expect(wordRefusal("x".repeat(longestOf(wording) + 1), wording, "site")).toBe("length");
    expect(longestOf(wording)).toBe(39);
  });
});

describe("a changed WhatsApp message", () => {
  const BOOKED = "Hi {{1}}, you're booked.\nYour {{2}} is {{3}}, {{4}}, with {{5}}.";

  it("may be reworded, its details kept", () => {
    expect(wordRefusal("Hi {{1}}, all set.\nYour {{2}}: {{3}}, {{4}}, with {{5}}.", BOOKED, "message")).toBeNull();
  });

  it("names no hair system, fitting or visit in its first line, which the lock screen shows", () => {
    const fitted = "Hi {{1}}, your fitting is booked.\nYour {{2}} is {{3}}, {{4}}, with {{5}}.";
    expect(wordRefusal(fitted, BOOKED, "message")).toBe("first_line");
    const moved = "Hi {{1}}, your {{2}} is booked.\nIt is {{3}}, {{4}}, with {{5}}.";
    expect(wordRefusal(moved, BOOKED, "message")).toBe("first_line");
  });

  it("does not end on a detail, as WhatsApp asks, unless the code's wording does", () => {
    expect(wordRefusal("Hi {{1}}, you're booked.\nWith {{5}}, {{3}}, {{4}}: your {{2}}", BOOKED, "message")).toBe(
      "ends_on_detail",
    );
    const link = "Hi {{1}}, your new look is ready.\nSee it: {{2}}";
    expect(wordRefusal("Hi {{1}}, it's ready.\nHave a look: {{2}}", link, "message")).toBeNull();
  });
});
