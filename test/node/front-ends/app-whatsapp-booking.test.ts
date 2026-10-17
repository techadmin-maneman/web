// The message the app opens WhatsApp with while ops book a paid visit: the visit, its day and window, and who, once.

import { describe, expect, it } from "vitest";
import { booking, messages } from "../../../apps/app/src/content.ts";

// The text repeated the kind ("…my replacement hair system. Replacement, Friday 16 October") and left out the window and
// the client.
describe("the WhatsApp booking message", () => {
  it("names the visit once, its day and window, the client and the hair system", () => {
    const visit = { day: "Fri 16 Oct", window: "morning", name: "Arjun Mehta", what: "Mane Man Active" };
    expect(booking.asking(messages.bookReplacement, visit)).toBe(
      "I’d like to book my replacement: Fri 16 Oct, morning. Arjun Mehta, Mane Man Active.",
    );
  });

  it("leaves out what it does not know", () => {
    const visit = { day: null, window: null, name: "Arjun Mehta", what: null };
    expect(booking.asking(messages.book, visit)).toBe("I’d like to book my next visit. Arjun Mehta.");
  });
});
