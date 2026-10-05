// What the technician's card and piece step say the client paid for (apps/tech/src/lib/paid-for.ts).
// A client paid for Mane Man Essential and the card said only "First fit", with nothing to warn him when the
// hair profile named another product.

import { describe, expect, it } from "vitest";
import type { HairProfile, Job } from "../../../apps/tech/src/api.ts";
import { paidFor, profileNamesAnother } from "../../../apps/tech/src/lib/paid-for.ts";

const ESSENTIAL = { tier: "essential", name: "Mane Man Essential" };

const profileNaming = (product: string | null, productName: string | null): HairProfile =>
  ({
    id: "h1",
    recorded_at: "2030-09-18T05:00:00.000Z",
    fit: { product, product_name: productName },
    history: null,
  }) as unknown as HairProfile;

const job = (over: Partial<Job>): Job => ({ type: "first_fit", service: ESSENTIAL, profile: null, ...over }) as Job;

describe("what the client paid for", () => {
  it("names the service the visit was sold as", () => {
    expect(paidFor(job({}))).toBe("Mane Man Essential");
    expect(paidFor(job({ type: "replacement", service: { tier: "natural", name: "Natural replacement" } }))).toBe(
      "Natural replacement",
    );
  });

  it("names nothing where the API names no service, or a card kept from before it did", () => {
    expect(paidFor(job({ service: null }))).toBeNull();
    expect(paidFor({ type: "first_fit" } as Job)).toBeNull();
  });
});

describe("the hair profile naming another product", () => {
  it("is named on a first fit whose profile names another product", () => {
    expect(profileNamesAnother(job({ profile: profileNaming("active", "Mane Man Active") }))).toBe("Mane Man Active");
  });

  it("is quiet when the two agree, or either names none", () => {
    expect(profileNamesAnother(job({ profile: profileNaming("essential", "Mane Man Essential") }))).toBeNull();
    expect(profileNamesAnother(job({ profile: profileNaming(null, null) }))).toBeNull();
    expect(profileNamesAnother(job({ profile: null }))).toBeNull();
    expect(profileNamesAnother(job({ service: null, profile: profileNaming("active", "Mane Man Active") }))).toBeNull();
  });

  it("is quiet on a replacement, whose services are not the profile's products", () => {
    const replacement = job({ type: "replacement", service: { tier: "standard_plus", name: "Replacement plus" } });
    expect(profileNamesAnother({ ...replacement, profile: profileNaming("active", "Mane Man Active") })).toBeNull();
  });
});
