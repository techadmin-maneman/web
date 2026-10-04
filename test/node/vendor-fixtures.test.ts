// The vendors' real answers the adapter tests load (test/fixtures/vendors), recorded from the org by
// scripts/zoho-contract-probe.ts --record: what a test reads stays as the vendor sent it, and nothing of a person's
// is committed.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES_DIR, PLACEHOLDER, scrubbed } from "../../scripts/lib/vendor-fixtures.ts";

/** Every text in a value, however deep. */
function textsIn(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(textsIn);
  if (typeof value === "object" && value !== null) return Object.values(value).flatMap(textsIn);
  return [];
}

/** The made-up number the fixtures recorded by scripts/books-proof.ts carry. */
const MADE_UP_MOBILE = "+919000000001";
/** A text that is an Indian mobile number, or holds one written with +91. */
function looksLikeAMobile(text: string): boolean {
  return /^\+?(91)?[6-9]\d{9}$/.test(text.replace(/[\s-]/g, "")) || /\+91[\s-]?[6-9]\d{4}[\s-]?\d{5}/.test(text);
}

describe("a vendor's answer, scrubbed", () => {
  const payment = {
    payment_id: "4242595000000250002",
    customer_id: "4242595000000232370",
    customer_name: "Asha Verma",
    reference_number: "MM-2026-0016",
    date: "2026-10-02",
    created_time: "2026-10-02T11:11:06+0530",
    amount: 30000,
    is_paid_via_check: false,
    description: "Razorpay payment for Asha",
    product_description: "",
    contact_persons: [{ first_name: "Asha", mobile: "+919810000001", email: "asha@example.com" }],
    billing_address: { address: "Flat 4, Palm Court", city: "Gurgaon", zip: "122002" },
    custom_fields_list: null,
  };

  it("replaces names, numbers, e-mails, addresses and descriptions", () => {
    expect(scrubbed(payment)).toMatchObject({
      customer_name: PLACEHOLDER,
      description: PLACEHOLDER,
      contact_persons: [{ first_name: PLACEHOLDER, mobile: PLACEHOLDER, email: PLACEHOLDER }],
      billing_address: { address: PLACEHOLDER, city: PLACEHOLDER, zip: PLACEHOLDER },
    });
  });

  it("keeps IDs, our references, dates, amounts, flags and empty or missing values as sent", () => {
    expect(scrubbed(payment)).toMatchObject({
      payment_id: "4242595000000250002",
      customer_id: "4242595000000232370",
      reference_number: "MM-2026-0016",
      date: "2026-10-02",
      created_time: "2026-10-02T11:11:06+0530",
      amount: 30000,
      is_paid_via_check: false,
      product_description: "",
      custom_fields_list: null,
    });
  });

  it("keeps Zoho's codes and statuses, and a CRM record's ID", () => {
    const search = { data: [{ id: "1431113000000550001", D1_Person_ID: "a4d182ab", Last_Name: "Verma" }] };
    expect(scrubbed({ code: 0, message: "success", status: "draft" })).toEqual({
      code: 0,
      message: "success",
      status: "draft",
    });
    expect(scrubbed(search)).toEqual({
      data: [{ id: "1431113000000550001", D1_Person_ID: "a4d182ab", Last_Name: PLACEHOLDER }],
    });
  });

  it("replaces a number or an e-mail even under a key whose text it keeps", () => {
    expect(scrubbed({ reference_number: "+91 98100 00001", status: "asha@example.com" })).toEqual({
      reference_number: PLACEHOLDER,
      status: PLACEHOLDER,
    });
  });
});

describe("the vendors' answers committed", () => {
  const files = readdirSync(FIXTURES_DIR, { recursive: true, encoding: "utf8" }).filter((file) =>
    file.endsWith(".json"),
  );

  it("are there to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s holds no one's e-mail or number but the made-up one", (file) => {
    const texts = textsIn(JSON.parse(readFileSync(join(FIXTURES_DIR, file), "utf8")));
    expect(texts.filter((text) => text.includes("@"))).toEqual([]);
    const mobiles = texts.filter((text) => looksLikeAMobile(text) && text !== MADE_UP_MOBILE);
    expect(mobiles).toEqual([]);
  });
});
