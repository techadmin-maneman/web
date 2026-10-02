// Which of the org's records staging wrote, and the order a reviewed list of them is deleted in
// (scripts/lib/staging-records.ts; docs/open-points.md, items 19 and 155).

import { describe, expect, it } from "vitest";
import {
  DELETE_ORDER,
  isStagingMarked,
  leftAlone,
  looksLikeATest,
  toDelete,
  type StagingRecord,
} from "../../scripts/lib/staging-records.ts";

describe("staging's marks", () => {
  it("are the label before a summary or description, and the names our scripts give", () => {
    for (const marked of [
      "Staging test: Consultation for Staging test",
      "Staging test: Razorpay payment pay_1",
      "Load test: Consultation",
      "Staging test",
      "Staging test convert",
      "Load test",
    ]) {
      expect(isStagingMarked(marked), marked).toBe(true);
    }
  });

  it("are carried by nothing a person wrote, however like a test it looks", () => {
    for (const unmarked of ["Staging Test Client", "staging test", "Consultation for Rohit", "Testing", "", null]) {
      expect(isStagingMarked(unmarked), String(unmarked)).toBe(false);
    }
    expect(looksLikeATest("Staging Test Client")).toBe(true);
    expect(looksLikeATest("Staging test")).toBe(false);
    expect(looksLikeATest("Rohit Malhotra")).toBe(false);
  });
});

describe("a reviewed list", () => {
  const record = (kind: StagingRecord["kind"], id: string): StagingRecord => ({ kind, id, name: "Staging test" });
  const reviewed = [
    record("books/contacts", "b-contact"),
    record("fsm/Contacts", "f-contact"),
    record("fsm/Service_Appointments", "appointment"),
    record("books/customerpayments", "payment"),
    record("fsm/Work_Orders", "work-order"),
    record("books/refunds", "refund"),
  ];

  it("is deleted with whatever points at a record before it", () => {
    expect(toDelete(reviewed, reviewed).map((each) => each.id)).toEqual([
      "refund",
      "payment",
      "appointment",
      "work-order",
      "f-contact",
      "b-contact",
    ]);
    expect(DELETE_ORDER.indexOf("fsm/Contacts")).toBeGreaterThan(DELETE_ORDER.indexOf("fsm/Requests"));
  });

  it("deletes only what the org still holds and marks, and nothing the owner took out", () => {
    const foundNow = [
      record("fsm/Contacts", "f-contact"),
      record("fsm/Work_Orders", "work-order"),
      record("fsm/Contacts", "kept"),
    ];
    expect(toDelete(reviewed, foundNow).map((each) => each.id)).toEqual(["work-order", "f-contact"]);
    expect(leftAlone(reviewed, foundNow).map((each) => each.id)).toEqual([
      "b-contact",
      "appointment",
      "payment",
      "refund",
    ]);
  });

  it("matches a record by where it is as well as its ID", () => {
    expect(toDelete([record("books/contacts", "same")], [record("fsm/Contacts", "same")])).toEqual([]);
  });
});
