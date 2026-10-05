// The invoice a finished visit gets in Books without FSM: raised from our own figures, sent when it totals what was
// sold. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { NO_GST, type GstRegistration } from "../../../src/config/gst.ts";
import { createAlertOnce, createResolveAlert } from "../../../src/domain/alerts.ts";
import { CALLS_PER_VISIT, raiseBooksInvoices, type BooksInvoiceOptions } from "../../../src/domain/books-invoices.ts";
import { syncBooks } from "../../../src/domain/books-sync.ts";
import { createCallBudget, type CallBudget } from "../../../src/lib/call-budget.ts";
import { createLogger } from "../../../src/log.ts";
import { type BooksInvoice, type BooksProvider } from "../../../src/providers/books/index.ts";
import { createStubBooks, type StubBooks } from "../../../src/providers/books/stub.ts";
import { ZohoError } from "../../../src/providers/zoho-http.ts";
import { captureLogs, NOW } from "../helpers.ts";
import { RECHECK_AFTER_MS } from "../../../src/domain/vendor-pass.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const VISIT = "22222222-2222-4222-8222-222222222222";
const NEXT = "33333333-3333-4333-8333-333333333333";

/** Two hours after a visit on Wednesday 23 September, when staging's book has no GST. */
const AFTER = new Date("2026-09-23T08:00:00.000Z");
const later = (ms: number) => new Date(AFTER.getTime() + ms);

const REGISTERED: GstRegistration = { gstin: "06AAACM0000A1Z5", stateCode: "HR", sac: "999721" };

const CLIENT_LINK = `http://ops.localhost:4323/clients/${PERSON}/payments`;

/** What the pass told ops. */
let alerted: string[];
let logs: ReturnType<typeof captureLogs>;

function depsAt(books: BooksProvider, now: Date) {
  const alert = (message: string) => {
    alerted.push(message);
    return Promise.resolve();
  };
  const alertOnce = createAlertOnce({ db: env.DB, alert, now: () => now, environment: "local", log: createLogger() });
  const resolveAlert = createResolveAlert({ db: env.DB, now: () => now });
  return { books, alertOnce, resolveAlert };
}

function invoicePass(
  books: BooksProvider,
  now = AFTER,
  options: Partial<BooksInvoiceOptions> = {},
  budget: CallBudget = createCallBudget(Infinity),
) {
  const all = { labelAsTest: true, gst: NO_GST, ...options };
  return raiseBooksInvoices(env.DB, depsAt(books, now), all, now, createLogger(), budget);
}

interface VisitShape {
  readonly id?: string;
  readonly type?: string;
  readonly tier?: string;
  /** India's date of the visit, YYYY-MM-DD. */
  readonly day?: string;
  readonly status?: string;
  readonly city?: string | null;
  readonly oneVisit?: string | null;
  readonly invoiceId?: string | null;
}

/** A visit of Rohit's, 10 am to 11:30 in India, as our own record holds it: no FSM work order. */
async function visit(shape: VisitShape = {}) {
  const id = shape.id ?? VISIT;
  const day = shape.day ?? "2026-09-23";
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, tier, status, window_start, window_end, synced_at,
       service_city, one_visit, fsm_invoice_id)
     VALUES (?1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
  )
    .bind(
      id,
      PERSON,
      shape.type ?? "service",
      shape.tier ?? "standard",
      shape.status ?? "completed",
      `${day}T04:30:00.000Z`,
      `${day}T06:00:00.000Z`,
      NOW.toISOString(),
      shape.city === undefined ? "Gurgaon" : shape.city,
      shape.oneVisit ?? null,
      shape.invoiceId ?? null,
    )
    .run();
}

async function paid(amount: number, appointmentId = VISIT) {
  await env.DB.prepare(
    `INSERT INTO payments (id, person_id, appointment_id, razorpay_payment_id, amount, currency, status, kind,
       captured_at, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 'INR', 'captured', 'visit', ?6, ?6, ?6)`,
  )
    .bind(
      `payment-${appointmentId}`,
      PERSON,
      appointmentId,
      `pay_${appointmentId.slice(0, 8)}`,
      amount,
      NOW.toISOString(),
    )
    .run();
}

async function itemKept(kind: string, tier: string, itemId: string) {
  await env.DB.prepare("UPDATE services SET books_item_id = ?3 WHERE kind = ?1 AND tier = ?2")
    .bind(kind, tier, itemId)
    .run();
}

const row = (id = VISIT) =>
  env.DB.prepare("SELECT fsm_invoice_id, invoice_checked_at, invoice_issued_at FROM appointments WHERE id = ?1")
    .bind(id)
    .first<{ fsm_invoice_id: string | null; invoice_checked_at: string | null; invoice_issued_at: string | null }>();

/** Books, whose totals read `extra` paise above what our figures make: a GST setting, or a draft ops edited. */
function booksTotalling(stub: StubBooks) {
  const books = {
    extra: 0,
    stub,
    provider: {
      ...stub,
      createInvoice: async (invoice: Parameters<StubBooks["createInvoice"]>[0]) =>
        off(await stub.createInvoice(invoice)),
      invoice: async (id: string) => {
        const held = await stub.invoice(id);
        return held === null ? null : off(held);
      },
      findInvoice: async (reference: string) => {
        const held = await stub.findInvoice(reference);
        return held === null ? null : off(held);
      },
    } satisfies BooksProvider,
  };
  const off = (invoice: BooksInvoice): BooksInvoice => ({
    ...invoice,
    total: invoice.total + books.extra,
    balance: invoice.balance + books.extra,
  });
  return books;
}

beforeEach(async () => {
  alerted = [];
  logs = captureLogs();
  await env.DB.prepare(
    "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810000001', 'Rohit Malhotra')",
  )
    .bind(PERSON, NOW.toISOString())
    .run();
  await itemKept("service", "standard", "item-service");
  await itemKept("first_fit", "standard", "item-first-fit");
  await itemKept("replacement", "standard", "item-replacement");
});

describe("the invoice a finished visit gets", () => {
  it("raises a paid first fit's invoice on its item, sends it, and the Books pass sets the payment against it", async () => {
    await visit({ type: "first_fit" });
    await paid(3_000_000);
    const books = createStubBooks();

    expect(await invoicePass(books)).toEqual({ raised: 1, issued: 1 });
    expect(books.made.invoices).toEqual([
      {
        customerId: expect.stringMatching(/^stub-customer-/) as string,
        reference: VISIT,
        date: "2026-09-23",
        placeOfSupply: null,
        line: {
          itemId: "item-first-fit",
          name: "First fit",
          description: "Staging test: First fit, Wed 23 Sep",
          rate: 3_000_000,
          discount: 0,
        },
      },
    ]);
    const billed = await row();
    expect(billed?.fsm_invoice_id).toMatch(/^stub-invoice-/);
    expect(books.made.issued).toEqual([billed?.fsm_invoice_id]);
    expect(billed?.invoice_issued_at).toBe(AFTER.toISOString());

    const options = { refundAccountId: null, labelAsTest: true, gst: NO_GST } as const;
    const deps = depsAt(books, AFTER);
    await syncBooks(env.DB, deps, options, AFTER, createLogger(), createCallBudget(Infinity));
    expect(books.made.customers).toHaveLength(1);
    expect(books.made.applied).toEqual([
      {
        paymentId: expect.stringMatching(/^stub-payment-/) as string,
        invoiceId: billed?.fsm_invoice_id,
        amount: 3_000_000,
      },
    ]);
  });

  it("takes a discount code off the GST-inclusive price before tax, so the invoice shows price, discount and total", async () => {
    // Sunday 20 September, when the book had 5% GST: Rs. 2,000 before GST, Rs. 2,100 with it; 10% off before GST.
    await visit({ day: "2026-09-20" });
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO discount_codes (id, code, kind, value, covers_first_fit, covers_service, covers_replacement,
           once_per_client, created_by, created_at)
         VALUES ('code-1', 'TENPC', 'percent', 10, 0, 1, 0, 1, 'ops@localhost', ?1)`,
      ).bind(NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO discount_code_uses (id, code_id, person_id, appointment_id, given_by, given_by_id, created_at)
         VALUES ('use-1', 'code-1', ?1, ?2, 'ops', 'ops@localhost', ?3)`,
      ).bind(PERSON, VISIT, NOW.toISOString()),
    ]);
    const books = createStubBooks();

    expect(await invoicePass(books)).toEqual({ raised: 1, issued: 1 });
    expect(books.made.invoices[0]?.line).toMatchObject({ rate: 210_000, discount: 21_000 });
    expect(books.made.invoices[0]?.date).toBe("2026-09-20");
    const fixed = await env.DB.prepare("SELECT amount_off FROM discount_code_uses WHERE id = 'use-1'").first();
    expect(fixed).toEqual({ amount_off: 20_000 });
  });

  it("finds by its reference an invoice whose answer never came, and raises no second one", async () => {
    await visit();
    await paid(200_000);
    const books = createStubBooks();
    books.loseAnswer("createInvoice");

    expect(await invoicePass(books)).toEqual({ raised: 0, issued: 0 });
    expect(logs.lines()).toContainEqual(expect.objectContaining({ event: "invoice_failed", appointment_id: VISIT }));
    expect(await row()).toEqual({
      fsm_invoice_id: null,
      invoice_checked_at: AFTER.toISOString(),
      invoice_issued_at: null,
    });

    expect(await invoicePass(books, later(RECHECK_AFTER_MS / 2))).toEqual({ raised: 0, issued: 0 });
    expect(await invoicePass(books, later(RECHECK_AFTER_MS + 1000))).toEqual({ raised: 0, issued: 1 });
    expect(books.made.invoices).toHaveLength(1);
    expect((await row())?.fsm_invoice_id).toBe((await books.findInvoice(VISIT))?.id);
  });

  it("raises one invoice when two passes run at the same time", async () => {
    await visit();
    await paid(200_000);
    const books = createStubBooks();
    await Promise.all([invoicePass(books), invoicePass(books)]);
    expect(books.made.invoices).toHaveLength(1);
    expect(books.made.issued).toHaveLength(1);
  });

  it("invoices a one visit on the product the client chose, at the price their link paid", async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO services (kind, tier, name, minutes, sort, books_item_id, updated_by, updated_at)
         VALUES ('first_fit', 'mane_classic', 'Mane Classic', 120, 1, 'item-classic', 'ops@localhost', ?1)`,
      ).bind(NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO price_book (item, tier, amount_ex_gst, gst_percent, valid_from)
         VALUES ('first_fit', 'mane_classic', 2500000, 0, '2026-09-22')`,
      ),
    ]);
    await visit({ type: "first_fit", tier: "mane_classic", oneVisit: "fitted" });
    await paid(2_500_000);
    const books = createStubBooks();

    expect(await invoicePass(books)).toEqual({ raised: 1, issued: 1 });
    expect(books.made.invoices[0]?.line).toMatchObject({
      itemId: "item-classic",
      name: "Mane Classic",
      rate: 2_500_000,
    });
  });

  it("raises none for a consultation, nor for a one visit the client declined", async () => {
    await visit({ type: "consultation" });
    await visit({ id: NEXT, type: "first_fit", oneVisit: "declined" });
    const books = createStubBooks();
    expect(await invoicePass(books)).toEqual({ raised: 0, issued: 0 });
    expect(books.made.invoices).toEqual([]);
    expect(books.made.customers).toEqual([]);
  });

  it("leaves a visit not yet finished, and one ended unfinished", async () => {
    await visit({ status: "in_progress" });
    await visit({ id: NEXT, status: "terminated" });
    const books = createStubBooks();
    expect(await invoicePass(books)).toEqual({ raised: 0, issued: 0 });
  });

  it("names the visit's state as the place of supply once GST is on", async () => {
    await visit({ city: "Delhi" });
    await visit({ id: NEXT, city: null });
    const books = createStubBooks();
    await invoicePass(books, AFTER, { gst: REGISTERED });
    const places = books.made.invoices.map((invoice) => [invoice.reference, invoice.placeOfSupply]);
    expect(places).toEqual(
      expect.arrayContaining([
        [VISIT, "DL"],
        [NEXT, "HR"],
      ]),
    );
  });

  it("waits for its service's Books item, and raises it once the item is kept", async () => {
    await env.DB.prepare("UPDATE services SET books_item_id = NULL WHERE kind = 'service'").run();
    await visit();
    const books = createStubBooks();
    expect(await invoicePass(books)).toEqual({ raised: 0, issued: 0 });
    expect(logs.lines()).toContainEqual(
      expect.objectContaining({ event: "invoice_item_missing", appointment_id: VISIT }),
    );
    expect(alerted).toEqual([]);

    await itemKept("service", "standard", "item-service");
    expect(await invoicePass(books, later(RECHECK_AFTER_MS + 1000))).toEqual({ raised: 1, issued: 1 });
  });

  it("tells ops of a visit the price book does not price, and raises nothing", async () => {
    await visit({ tier: "retired_tier" });
    const books = createStubBooks();
    expect(await invoicePass(books)).toEqual({ raised: 0, issued: 0 });
    expect(alerted).toEqual([
      `Visit ${VISIT} has no price in the price book for its day, so no invoice was raised for it. Raise it in ` +
        `Books by hand. ${CLIENT_LINK}`,
    ]);
  });

  it("logs a refusal, tells ops once, and tries again an hour on", async () => {
    await visit();
    const books = createStubBooks();
    books.refuseNext("createInvoice", "4004");

    expect(await invoicePass(books)).toEqual({ raised: 0, issued: 0 });
    expect(logs.lines()).toContainEqual(expect.objectContaining({ event: "invoice_refused", code: "4004" }));
    expect(alerted).toEqual([
      `Books refused the invoice of visit ${VISIT}, saying "the stub Books refused createInvoice". It is tried ` +
        `again each hour, or raise it in Books by hand. ${CLIENT_LINK}`,
    ]);
    expect(await invoicePass(books, later(RECHECK_AFTER_MS + 1000))).toEqual({ raised: 1, issued: 1 });
    const open = await env.DB.prepare("SELECT COUNT(*) AS n FROM alerts WHERE resolved_at IS NULL").first();
    expect(open).toEqual({ n: 0 });
  });

  it("bills only the visits the cron run's outside calls pay for", async () => {
    await visit();
    await visit({ id: NEXT, day: "2026-09-22" });
    const books = createStubBooks();
    expect(await invoicePass(books, AFTER, {}, createCallBudget(CALLS_PER_VISIT))).toEqual({ raised: 1, issued: 1 });
    expect(await row(VISIT)).toMatchObject({ invoice_checked_at: null, fsm_invoice_id: null });
  });
});

describe("sending it", () => {
  it("holds a draft whose total is not what the client paid, tells ops once, and sends it once ops correct it", async () => {
    await visit({ type: "replacement" });
    await paid(1_500_000);
    const books = booksTotalling(createStubBooks());
    books.extra = 75_000;

    expect(await invoicePass(books.provider)).toEqual({ raised: 1, issued: 0 });
    const invoice = (await row())?.fsm_invoice_id ?? "";
    expect(alerted).toEqual([
      `Invoice INV-000001 (${invoice}) of visit ${VISIT} is held as a draft in Books: it totals Rs. 15,750, and the ` +
        "visit was sold for Rs. 15,000. Correct the draft in Books: once it totals what was sold, it is sent within " +
        `the hour. ${CLIENT_LINK}`,
    ]);

    // Still held an hour on, and ops are not told again.
    expect(await invoicePass(books.provider, later(RECHECK_AFTER_MS + 1000))).toEqual({ raised: 0, issued: 0 });
    expect(books.stub.made.issued).toEqual([]);
    expect(alerted).toHaveLength(1);

    // Ops correct the draft in Books; the next pass finds it ours, under our reference, and right.
    books.extra = 0;
    expect(await invoicePass(books.provider, later(2 * (RECHECK_AFTER_MS + 1000)))).toEqual({ raised: 0, issued: 1 });
    expect(books.stub.made.issued).toEqual([invoice]);
    expect(books.stub.made.invoices).toHaveLength(1);
  });

  it("never sends the invoice of a visit a referral credit paid for, until the CA rules how", async () => {
    await visit();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO credit_ledger (id, person_id, kind, visits, source_kind, source_id, expires_at, created_at)
         VALUES ('grant-1', ?1, 'grant', 3, 'referral', 'referral-1', '2027-09-20T00:00:00.000Z', ?2)`,
      ).bind(PERSON, NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO credit_ledger (id, person_id, kind, visits, grant_id, source_kind, source_id, created_at)
         VALUES ('redeem-1', ?1, 'redeem', -1, 'grant-1', 'appointment', ?2, ?3)`,
      ).bind(PERSON, VISIT, NOW.toISOString()),
    ]);
    const books = createStubBooks();

    expect(await invoicePass(books)).toEqual({ raised: 1, issued: 0 });
    expect(alerted[0]).toContain("was paid with a referral credit");
    expect(alerted[0]).toContain("waits for the accountant");
    await invoicePass(books, later(RECHECK_AFTER_MS + 1000));
    expect(books.made.issued).toEqual([]);
    expect(books.made.invoices).toHaveLength(1);
    expect(alerted).toHaveLength(1);
  });

  it("sends its own draft on a later pass when Books would not send it the first time", async () => {
    await visit();
    const stub = createStubBooks();
    let refusing = true;
    const books = {
      ...stub,
      issueInvoice: (id: string) =>
        refusing ? Promise.reject(new ZohoError(400, "4000", "no billing address")) : stub.issueInvoice(id),
    };

    expect(await invoicePass(books)).toEqual({ raised: 1, issued: 0 });
    expect(logs.lines()).toContainEqual(expect.objectContaining({ event: "invoice_not_issued" }));
    expect(alerted).toHaveLength(1);
    expect(alerted[0]).toContain("Books would not mark invoice");

    refusing = false;
    expect(await invoicePass(books, later(RECHECK_AFTER_MS + 1000))).toEqual({ raised: 0, issued: 1 });
    expect(stub.made.invoices).toHaveLength(1);
  });

  it("never sends a draft made by hand, tells ops of it an hour after the visit, and shows it once sent", async () => {
    await visit({ invoiceId: "stub-hand-made" });
    const books = createStubBooks();

    expect(await invoicePass(books, new Date("2026-09-23T06:30:00.000Z"))).toEqual({ raised: 0, issued: 0 });
    expect(alerted).toEqual([]);
    expect(await invoicePass(books)).toEqual({ raised: 0, issued: 0 });
    expect(books.made.issued).toEqual([]);
    expect(books.made.invoices).toEqual([]);
    expect(alerted).toEqual([
      `Invoice INV-hand-made (stub-hand-made) of visit ${VISIT} is still a draft in Books an hour after the visit, ` +
        "so the client cannot open it. It was not raised here: send it in Books, since nothing here sends a draft " +
        `made by hand. ${CLIENT_LINK}`,
    ]);

    await books.issueInvoice("stub-hand-made");
    const sentAt = later(RECHECK_AFTER_MS + 1000);
    expect(await invoicePass(books, sentAt)).toEqual({ raised: 0, issued: 1 });
    expect((await row())?.invoice_issued_at).toBe(sentAt.toISOString());
  });
});
