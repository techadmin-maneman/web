// The way to the door, on any phone (docs/decisions/0054-address-capture.md).
// The rule is one line: a Google Maps URL, the pin when there is one and the
// typed address when there is not, and never a scheme an iPhone ignores.

import { describe, expect, it } from "vitest";
import { whatsappChat } from "../../packages/web-kit/whatsapp.ts";
import { callLink, wayTo } from "../../apps/tech/src/lib/navigate.ts";
import { addressLine } from "../../packages/web-kit/address.ts";

const WITH_PIN = {
  line1: "Tower C, 14th floor",
  line2: null,
  building: null,
  tower: null,
  floor: null,
  flat: null,
  landmark: null,
  locality: "Sector 65",
  city: "Gurgaon",
  pincode: "122018",
  lat: 28.39,
  lng: 77.07,
};

const TYPED = { ...WITH_PIN, lat: null, lng: null };

describe("addressLine", () => {
  it("joins the parts the API keeps an address in", () => {
    expect(addressLine(WITH_PIN)).toBe("Tower C, 14th floor, Sector 65, Gurgaon 122018");
  });

  it("leaves out a part the client did not fill in", () => {
    expect(addressLine({ ...WITH_PIN, line2: "   " })).toBe("Tower C, 14th floor, Sector 65, Gurgaon 122018");
  });
});

describe("wayTo", () => {
  it("takes the pin when the address has one, because that is the door", () => {
    expect(wayTo(WITH_PIN)).toBe("https://www.google.com/maps/dir/?api=1&destination=28.39%2C77.07");
  });

  it("falls back to the typed address when there is no pin", () => {
    expect(wayTo(TYPED)).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=Tower%20C%2C%2014th%20floor%2C%20Sector%2065%2C%20Gurgaon%20122018",
    );
  });

  it("is an https link on both platforms, and never the geo: scheme iOS ignores", () => {
    for (const address of [WITH_PIN, TYPED]) {
      expect(wayTo(address).startsWith("https://")).toBe(true);
      expect(wayTo(address)).not.toContain("geo:");
      // "api=1 is required" (ADR 0054), and the URL is capped at 2,048 characters.
      expect(wayTo(address)).toContain("api=1");
      expect(wayTo(address).length).toBeLessThan(2048);
    }
  });
});

describe("the whole address the client saved", () => {
  const CHOSEN = {
    ...WITH_PIN,
    line1: "Emerald Heights",
    building: "Emerald Heights",
    tower: "C",
    floor: "14th floor",
    flat: "1402",
    landmark: "Opposite the water tank",
  };

  it("is written narrowest first, as the client app writes it, with the building once", () => {
    expect(addressLine(CHOSEN)).toBe("1402, 14th floor, C, Emerald Heights, Sector 65, Gurgaon 122018");
  });

  it("asks a map for the building and the area when there is no pin, never the flat", () => {
    expect(wayTo({ ...CHOSEN, lat: null, lng: null })).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=Emerald%20Heights%2C%20Sector%2065%2C%20Gurgaon%20122018",
    );
  });
});

describe("the way to the client", () => {
  it("calls the number on the card, and opens WhatsApp on it without the plus", () => {
    expect(callLink("+919810000000")).toBe("tel:+919810000000");
    expect(whatsappChat("+919810000000")).toBe("https://wa.me/919810000000");
  });
});
