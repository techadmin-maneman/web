import { describe, expect, it } from "vitest";
import type { CrmLead, LeadSource } from "../../src/providers/crm.ts";
import {
  DELIVERY_ONLY,
  assertStatusAllowed,
  shouldAssign,
  shouldRunWorkflows,
  statusForNewRecord,
  statusForUpdate,
} from "../../src/providers/crm-rules.ts";

export function crmLead(overrides: Partial<CrmLead> = {}): CrmLead {
  return {
    personId: "person-1",
    leadId: "lead-1",
    name: "Arjun Mehta",
    mobileE164: "+919810000001",
    email: null,
    source: "form",
    city: "Gurgaon",
    firstChoiceWindow: "weekday_am",
    lossExtent: "crown",
    proposedVisitDate: "2026-09-23",
    contactable: true,
    tryOn: false,
    utmSource: null,
    utmCampaign: null,
    inviteCode: null,
    askedWindow: null,
    plan: null,
    discountCode: null,
    ...overrides,
  };
}

const SOURCES: LeadSource[] = ["form", "waitlist", "tryon"];

describe("CRM status rules", () => {
  it("gives a new booking New, a new waitlist Waitlist", () => {
    expect(statusForNewRecord(crmLead())).toBe("New");
    expect(statusForNewRecord(crmLead({ source: "waitlist", proposedVisitDate: null }))).toBe("Waitlist");
  });

  it("assigns only new bookings, and runs workflows only for contactable people", () => {
    expect(shouldAssign(crmLead())).toBe(true);
    expect(shouldAssign(crmLead({ source: "waitlist" }))).toBe(false);
    expect(shouldRunWorkflows(crmLead({ source: "waitlist" }))).toBe(true);
  });

  it("resets the status on a new booking, and leaves it alone for a waitlist sign-up or a try-on", () => {
    expect(statusForUpdate(crmLead())).toBe("New");
    expect(statusForUpdate(crmLead({ source: "waitlist" }))).toBeNull();
    expect(statusForUpdate(crmLead({ source: "tryon" }))).toBeNull();
  });
});

describe("a person who is not contactable (a try-on only)", () => {
  it.each(SOURCES)("is never given a chase status, whatever the lead source (%s)", (source) => {
    const lead = crmLead({ source, contactable: false });
    expect(statusForNewRecord(lead)).toBe(DELIVERY_ONLY);
    expect(statusForUpdate(lead)).toBeNull();
    expect(shouldAssign(lead)).toBe(false);
    expect(shouldRunWorkflows(lead)).toBe(false);
  });

  it("cannot be given New or Waitlist even by a caller that tries", () => {
    const lead = crmLead({ source: "tryon", contactable: false });
    expect(() => {
      assertStatusAllowed(lead, "New");
    }).toThrow(/refusing to give lead lead-1 the chase status "New"/);
    expect(() => {
      assertStatusAllowed(lead, "Waitlist");
    }).toThrow(/chase status "Waitlist"/);
    expect(() => {
      assertStatusAllowed(lead, DELIVERY_ONLY);
    }).not.toThrow();
    expect(() => {
      assertStatusAllowed(lead, null);
    }).not.toThrow();
  });
});
