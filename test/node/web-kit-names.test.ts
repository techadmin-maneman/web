import { describe, expect, it } from "vitest";
import { isPersonName, MOST_NAME_LENGTH } from "../../packages/web-kit/names.ts";

describe("isPersonName", () => {
  it.each(["Rohit Malhotra", "A. Kumar", "Rao Jr.", "D’Souza", "O'Brien", "Mary-Jane", "राहुल शर्मा", "  Asha  "])(
    "takes %s",
    (name) => {
      expect(isPersonName(name)).toBe(true);
    },
  );

  // Our WhatsApp messages greet people by this name, so it is never a link, a number or a sentence's symbols.
  it.each(["", "   ", "Win at example.com", "https://x.co", "Dr.Rao", "Asha 2", "9810000000", "-Asha", "Asha!"])(
    "refuses %j",
    (name) => {
      expect(isPersonName(name)).toBe(false);
    },
  );

  it("takes a name of up to the longest a form takes", () => {
    expect(isPersonName("a".repeat(MOST_NAME_LENGTH))).toBe(true);
    expect(isPersonName("a".repeat(MOST_NAME_LENGTH + 1))).toBe(false);
  });
});
