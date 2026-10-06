// Which of the org's records staging wrote, the order a reviewed list of them is deleted in, and the links staging's
// database keeps to them (scripts/lib/staging-records.ts). Every ID is made up.

import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  BOOKS_CONTACT,
  BOOKS_INVOICE,
  BOOKS_PAYMENT,
  booksPage,
  booksRecord,
  crmDeleteOutcome,
  crmHoldsNoSuchRecord,
  crmPage,
  crmScopeMissing,
  DELETE_ORDER,
  isStagingMarked,
  KNOWN_IDS_SQL,
  leftAlone,
  looksLikeATest,
  REVIEWED_LIST,
  toDelete,
  unlinkStatements,
  unlisted,
  type StagingRecord,
} from "../../../scripts/lib/staging-records.ts";
import { migratedDatabase } from "../d1-over-sqlite.ts";

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
    record("crm/Leads", "lead"),
    record("books/contacts", "b-contact"),
    record("crm/Contacts", "c-contact"),
    record("books/invoices", "invoice"),
    record("books/customerpayments", "payment"),
    record("books/refunds", "refund"),
  ];

  it("is deleted with whatever points at a record before it, the CRM's after Books' customers", () => {
    expect(toDelete(reviewed, reviewed).map((each) => each.id)).toEqual([
      "refund",
      "payment",
      "invoice",
      "b-contact",
      "c-contact",
      "lead",
    ]);
    expect(DELETE_ORDER.indexOf("crm/Leads")).toBe(DELETE_ORDER.length - 1);
  });

  it("deletes only what the org still holds as staging's, and nothing the reviewer took out", () => {
    const foundNow = [
      record("books/invoices", "invoice"),
      record("crm/Leads", "lead"),
      record("books/invoices", "kept"),
    ];
    expect(toDelete(reviewed, foundNow).map((each) => each.id)).toEqual(["invoice", "lead"]);
    expect(leftAlone(reviewed, foundNow).map((each) => each.id)).toEqual([
      "b-contact",
      "c-contact",
      "payment",
      "refund",
    ]);
  });

  it("matches a record by where it is as well as its ID", () => {
    expect(toDelete([record("books/contacts", "same")], [record("books/invoices", "same")])).toEqual([]);
  });
});

/** Staging's database with an erased client, a client still here, and what each holds in Books and the CRM. */
function stagingDatabase(): DatabaseSync {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO people (id, created_at, mobile_e164, name, books_customer_id, zoho_lead_id, erased_at) VALUES
      ('erased', '2026-10-01T00:00:00Z', 'erased:erased', 'Erased', 'customer-erased', 'lead-erased',
        '2026-10-02T00:00:00Z'),
      ('here', '2026-10-01T00:00:00Z', '+919800000001', 'Staging test Asha', 'customer-here', 'lead-here', NULL),
      ('new', '2026-10-01T00:00:00Z', '+919800000002', 'Staging test Ravi', NULL, NULL, NULL);
    INSERT INTO appointments (id, fsm_id, person_id, status, synced_at, fsm_invoice_id, invoice_issued_at) VALUES
      ('visit-issued', 'ours:visit-issued', 'here', 'completed', '2026-10-02T00:00:00Z', 'invoice-1',
        '2026-10-02T00:00:00Z'),
      ('visit-draft', 'ours:visit-draft', 'erased', 'completed', '2026-10-02T00:00:00Z', 'invoice-2', NULL),
      ('visit-new', 'ours:visit-new', 'new', 'scheduled', '2026-10-02T00:00:00Z', NULL, NULL);
    INSERT INTO payments (id, person_id, razorpay_payment_id, amount, currency, status, created_at, updated_at,
        captured_at, books_payment_id, books_applied_at) VALUES
      ('applied', 'here', 'pay_1', 2900000, 'INR', 'captured', '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z',
        '2026-10-01T00:00:00Z', 'payment-1', '2026-10-02T00:00:00Z'),
      ('refunded', 'erased', 'pay_2', 100000, 'INR', 'refunded', '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z',
        '2026-10-01T00:00:00Z', 'payment-2', NULL);
  `);
  return db;
}

describe("the IDs staging's database keeps", () => {
  it("are every client's Books customer and CRM lead, erased clients' too, and each payment's and invoice's", () => {
    const known = stagingDatabase().prepare(KNOWN_IDS_SQL).all();

    expect(known).toEqual(
      expect.arrayContaining([
        { kind: "books/contacts", id: "customer-erased" },
        { kind: "books/contacts", id: "customer-here" },
        { kind: "books/customerpayments", id: "payment-1" },
        { kind: "books/customerpayments", id: "payment-2" },
        { kind: "books/invoices", id: "invoice-1" },
        { kind: "books/invoices", id: "invoice-2" },
        { kind: "crm/Leads", id: "lead-erased" },
        { kind: "crm/Leads", id: "lead-here" },
      ]),
    );
    expect(known).toHaveLength(8);
  });

  it("are read one by one only where the marks did not find their record", () => {
    const known = [
      { kind: "books/contacts", id: "customer-here" },
      { kind: "books/contacts", id: "customer-erased" },
      { kind: "crm/Leads", id: "customer-here" },
    ] as const;
    const found: StagingRecord[] = [{ kind: "books/contacts", id: "customer-here", name: "Staging test Asha" }];

    expect(unlisted(known, found)).toEqual([
      { kind: "books/contacts", id: "customer-erased" },
      { kind: "crm/Leads", id: "customer-here" },
    ]);
  });
});

describe("clearing the links to records now gone", () => {
  const links = (db: DatabaseSync) => ({
    people: db.prepare("SELECT id, books_customer_id, zoho_lead_id FROM people ORDER BY id").all(),
    visits: db.prepare("SELECT id, fsm_invoice_id FROM appointments ORDER BY id").all(),
    payments: db.prepare("SELECT id, books_payment_id FROM payments ORDER BY id").all(),
  });

  it("lets go of a client's customer and lead and a visit's invoice, and of nothing still held", () => {
    const db = stagingDatabase();

    for (const statement of unlinkStatements([
      { kind: "books/contacts", id: "customer-erased" },
      { kind: "crm/Leads", id: "lead-erased" },
      { kind: "books/invoices", id: "invoice-2" },
      { kind: "books/invoices", id: "invoice-2" },
    ])) {
      db.exec(statement);
    }

    expect(links(db)).toEqual({
      people: [
        { id: "erased", books_customer_id: null, zoho_lead_id: null },
        { id: "here", books_customer_id: "customer-here", zoho_lead_id: "lead-here" },
        { id: "new", books_customer_id: null, zoho_lead_id: null },
      ],
      visits: [
        { id: "visit-draft", fsm_invoice_id: null },
        { id: "visit-issued", fsm_invoice_id: "invoice-1" },
        { id: "visit-new", fsm_invoice_id: null },
      ],
      payments: [
        { id: "applied", books_payment_id: "payment-1" },
        { id: "refunded", books_payment_id: "payment-2" },
      ],
    });
  });

  it("keeps a payment's and a refund's IDs, so the Books pass never records staging's old payments again", () => {
    expect(
      unlinkStatements([
        { kind: "books/customerpayments", id: "payment-2" },
        { kind: "books/refunds", id: "refund-1" },
      ]),
    ).toEqual([]);
  });

  it("quotes what it is given", () => {
    expect(unlinkStatements([{ kind: "crm/Leads", id: "lead'1" }])).toEqual([
      "UPDATE people SET zoho_lead_id = NULL WHERE zoho_lead_id IN ('lead''1');",
    ]);
  });
});

describe("the CRM's answers", () => {
  it("say a record deleted, merged away or never there is gone", () => {
    expect(crmHoldsNoSuchRecord(204, null)).toBe(true);
    expect(crmHoldsNoSuchRecord(400, { code: "INVALID_DATA", status: "error" })).toBe(true);
    expect(crmHoldsNoSuchRecord(200, { data: [{ code: "ENTITY_ID_INVALID", status: "error" }] })).toBe(true);
    expect(crmHoldsNoSuchRecord(200, { data: [{ id: "lead-1", Full_Name: "Erased" }] })).toBe(false);
  });

  it("tell a token without the scope from any other refusal", () => {
    const mismatch = { code: "OAUTH_SCOPE_MISMATCH", message: "invalid oauth scope to access this URL" };
    expect(crmScopeMissing(mismatch)).toBe(true);
    expect(crmScopeMissing({ code: "INVALID_TOKEN" })).toBe(false);
  });

  it("say how a delete went", () => {
    const deleted = { data: [{ code: "SUCCESS", details: { id: "lead-1" }, status: "success" }] };
    expect(crmDeleteOutcome(200, deleted)).toBe("deleted");
    expect(crmDeleteOutcome(400, { data: [{ code: "INVALID_DATA", status: "error" }] })).toBe("already gone");
    expect(crmDeleteOutcome(401, { code: "OAUTH_SCOPE_MISMATCH" })).toBe(
      "refused: the scripts' CRM token may not delete it (runbook, step 8.7); delete it in the CRM",
    );
    expect(crmDeleteOutcome(500, { code: "INTERNAL_ERROR" })).toBe('refused: 500 {"code":"INTERNAL_ERROR"}');
  });
});

// The deleting script reads every answer through these: a record without its ID, or a list of another shape, stops the
// run before anything is listed or deleted.
describe("the org's lists", () => {
  it("read a Books page's records under their key, and whether another page follows", () => {
    const answer = {
      contacts: [{ contact_id: "c-1", contact_name: "Staging test" }, { contact_id: "c-2" }],
      page_context: { has_more_page: true },
    };
    expect(booksPage(answer, "contacts", BOOKS_CONTACT)).toEqual({
      rows: [
        { contact_id: "c-1", contact_name: "Staging test" },
        { contact_id: "c-2", contact_name: "" },
      ],
      more: true,
    });
    expect(booksPage({ contacts: [] }, "contacts", BOOKS_CONTACT)).toEqual({ rows: [], more: false });
  });

  it("refuse a record without its ID", () => {
    expect(() => booksPage({ contacts: [{ contact_name: "Staging test" }] }, "contacts", BOOKS_CONTACT)).toThrow();
    expect(() => booksPage({ customerpayments: [{ payment_id: "" }] }, "customerpayments", BOOKS_PAYMENT)).toThrow();
    expect(() => crmPage({ data: [{ Full_Name: "Staging test" }] })).toThrow();
  });

  it("read one Books record under its key", () => {
    const answer = { code: 0, invoice: { invoice_id: "i-1", invoice_number: "INV-1", customer_name: "Staging test" } };
    expect(booksRecord(answer, "invoice", BOOKS_INVOICE)).toMatchObject({ invoice_number: "INV-1" });
  });

  it("read the CRM's empty answer as no records, and its last page as the last", () => {
    expect(crmPage(null)).toEqual({ rows: [], more: false });
    const answer = { data: [{ id: "lead-1", Full_Name: null }], info: { more_records: false } };
    expect(crmPage(answer)).toEqual({ rows: [{ id: "lead-1", Full_Name: "" }], more: false });
  });

  it("read the reviewed list only as the listing run wrote it", () => {
    const record = { kind: "books/contacts", id: "c-1", name: "Staging test" };
    expect(REVIEWED_LIST.parse({ records: [record] }).records).toEqual([record]);
    expect(() => REVIEWED_LIST.parse({ records: [{ ...record, kind: "books/items" }] })).toThrow();
  });
});
