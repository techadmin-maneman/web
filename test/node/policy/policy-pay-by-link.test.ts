import { describe, expect, it } from "vitest";
import { linkOpenUntil } from "../../../src/policy/pay-by-link.ts";

const NOW = new Date("2026-09-21T06:30:00.000Z"); // 12 noon on Monday 21 September in India

describe("how long a payment link keeps the visit's slot", () => {
  it("keeps it a day when the visit is further off", () => {
    const visit = new Date("2026-09-24T03:30:00.000Z");
    expect(linkOpenUntil(NOW, visit)).toEqual(new Date("2026-09-22T06:30:00.000Z"));
  });

  it("closes two hours before a visit that comes sooner, so its technician knows of it in time", () => {
    const visit = new Date("2026-09-22T03:30:00.000Z"); // 9 am tomorrow in India
    expect(linkOpenUntil(NOW, visit)).toEqual(new Date("2026-09-22T01:30:00.000Z"));
  });

  it("refuses a visit too close for Razorpay's shortest link, a quarter of an hour", () => {
    expect(linkOpenUntil(NOW, new Date("2026-09-21T08:40:00.000Z"))).toBeNull();
    expect(linkOpenUntil(NOW, new Date("2026-09-21T08:45:00.000Z"))).toEqual(new Date("2026-09-21T06:45:00.000Z"));
  });
});
