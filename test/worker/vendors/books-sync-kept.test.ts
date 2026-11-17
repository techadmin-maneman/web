// A charge we keep, invoiced in Books by the Books pass (src/domain/books/books-kept.ts). Every name and number here
// is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createAlertOnce, createResolveAlert } from "../../../src/domain/platform/alerts.ts";
import { syncBooks, type BooksSyncSummary } from "../../../src/domain/books/books-sync.ts";
import type { BooksSyncOptions } from "../../../src/domain/books/books-pass.ts";
import { createCallBudget, type CallBudget } from "../../../src/lib/call-budget.ts";
import { createLogger } from "../../../src/log.ts";
import { type BooksInvoice, type BooksProvider } from "../../../src/providers/books/index.ts";
import { createStubBooks, type StubBooks } from "../../../src/providers/books/stub.ts";
import { NOW } from "../helpers.ts";
import { RECHECK_AFTER_MS } from "../../../src/domain/books/vendor-pass.ts";
import {
  PERSON,
  VISIT,
  PAYMENT,
  sent,
  booksWith,
  optionsFor,
  payment,
  SECOND,
  secondPayment,
  invoiced,
  paymentRow,
  later,
  openAlerts,
  bothLooking,
} from "./books-sync-fixtures.ts";

/** What the pass told ops. */
let told: string[];

function depsFor(books: BooksProvider, now: Date) {
  const alert = (message: string) => {
    told.push(message);
    return Promise.resolve();
  };
  const alertOnce = createAlertOnce({ db: env.DB, alert, now: () => now, environment: "local", log: createLogger() });
  const resolveAlert = createResolveAlert({ db: env.DB, now: () => now });
  return { books, alertOnce, resolveAlert };
}

/** One pass. The client's Books customer is `booksCustomerId`, the one an earlier pass kept on them; null for none yet. */
async function pass(
  books: BooksProvider,
  booksCustomerId: string | null,
  now = NOW,
  overrides: Partial<BooksSyncOptions> = {},
  budget: CallBudget = createCallBudget(Infinity),
): Promise<BooksSyncSummary> {
  if (booksCustomerId !== null) {
    await env.DB.prepare("UPDATE people SET books_customer_id = ?1 WHERE id = ?2 AND books_customer_id IS NULL")
      .bind(booksCustomerId, PERSON)
      .run();
  }
  return syncBooks({
    db: env.DB,
    deps: depsFor(books, now),
    options: optionsFor(overrides),
    now,
    log: createLogger(),
    budget,
  });
}

beforeEach(async () => {
  told = [];
  await env.DB.prepare(
    "UPDATE services SET books_item_id = 'item-fit' WHERE kind = 'first_fit' AND tier = 'standard'",
  ).run();
  await env.DB.prepare(
    "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810000001', 'Rohit Malhotra')",
  )
    .bind(PERSON, NOW.toISOString())
    .run();
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, status, window_start, window_end, synced_at, service_city)
     VALUES (?1, ?1, ?2, 'first_fit', 'scheduled', '2026-09-25T04:30:00.000Z', '2026-09-25T07:30:00.000Z', ?3,
       'Gurgaon')`,
  )
    .bind(VISIT, PERSON, NOW.toISOString())
    .run();
});

const keptInvoiceOf = (paymentId: string) =>
  env.DB.prepare("SELECT books_kept_invoice_id FROM payments WHERE id = ?1")
    .bind(paymentId)
    .first("books_kept_invoice_id");

describe("a charge we keep", () => {
  async function cancelled(kind: "cancelled" | "replaced", kept: number) {
    await env.DB.prepare("UPDATE appointments SET status = 'cancelled' WHERE id = ?1").bind(VISIT).run();
    await env.DB.prepare(
      `INSERT INTO visit_changes (id, appointment_id, person_id, kind, notice, was_start, refund_amount, kept_amount,
         payment_id, created_at)
       VALUES (?1, ?2, ?3, ?4, 'late', '2026-09-25T04:30:00.000Z', ?5, ?6, ?7, ?8)`,
    )
      .bind(crypto.randomUUID(), VISIT, PERSON, kind, 3000000 - kept, kept, PAYMENT, NOW.toISOString())
      .run();
  }

  /** The client was not home, and ops charged the no-show, keeping `kept`; it may be disputed until `until`. */
  async function chargedNoShow(kept: number, until = later(-1000).toISOString()) {
    const at = NOW.toISOString();
    await env.DB.batch([
      env.DB.prepare("UPDATE appointments SET status = 'terminated' WHERE id = ?1").bind(VISIT),
      env.DB.prepare(
        "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t1', 't1', 'Imran Qureshi', 'IQ', 1, ?1)",
      ).bind(at),
      env.DB.prepare(
        `INSERT INTO checkins (id, appointment_id, technician_id, at, radius_m, passed, created_at)
         VALUES ('checkin-1', ?1, 't1', ?2, 200, 1, ?2)`,
      ).bind(VISIT, at),
      env.DB.prepare(
        `INSERT INTO no_show_cases (id, checkin_id, appointment_id, wait_started_at, wait_ends_at, closed_at,
           decision, charge, kept_amount, refund_amount, created_at, dispute_until)
         VALUES ('case-1', 'checkin-1', ?1, ?2, ?2, ?2, 'charged', 'late_fee', ?3, ?4, ?2, ?5)`,
      ).bind(VISIT, at, kept, 3000000 - kept, until),
    ]);
  }

  /** The client disputed the charge; `ruling` null while ops have not ruled. */
  async function disputed(ruling: "refunded" | "upheld" | null) {
    const ruledAt = ruling === null ? null : NOW.toISOString();
    await env.DB.prepare(
      `INSERT INTO no_show_disputes (id, case_id, person_id, reason, created_at, ruling, ruled_by, ruled_at)
       VALUES ('dispute-1', 'case-1', ?1, 'Nobody rang the bell', ?2, ?3, ?4, ?5)`,
    )
      .bind(PERSON, NOW.toISOString(), ruling, ruling === null ? null : "ops@maneman.in", ruledAt)
      .run();
  }

  it("of a visit cancelled late is invoiced on the visit's item, sent, and its payment set against it, once", async () => {
    await payment();
    await cancelled("cancelled", 400000);
    const books = createStubBooks();

    expect(await pass(books, "books-customer-9")).toMatchObject({ recorded: 1, kept: 1 });
    expect(books.made.invoices).toEqual([
      {
        customerId: "books-customer-9",
        reference: PAYMENT,
        date: "2026-09-21",
        placeOfSupply: null,
        branchId: null,
        line: {
          itemId: "item-fit",
          name: "Late cancellation charge, First Fit",
          description: "Staging test",
          rate: 400000,
          discount: 0,
        },
      },
    ]);
    const paid = await paymentRow();
    expect(books.made.applied).toEqual([
      { paymentId: paid?.books_payment_id, invoiceId: books.made.issued[0], amount: 400000 },
    ]);
    expect(paid?.books_applied_at).toBe(NOW.toISOString());
    // Kept, so a refund can name it and staging's clean-up can find it.
    expect(await keptInvoiceOf(PAYMENT)).toBe(books.made.issued[0]);
    expect(told).toEqual([]);

    await pass(books, "books-customer-9", later(RECHECK_AFTER_MS * 2));
    expect(books.made.invoices).toHaveLength(1);
  });

  describe("refunded after it is invoiced", () => {
    /** The visit cancelled late, its kept part invoiced; then a refund of `amount`, the payment's refunds now `total`. */
    async function refunded(id: string, amount: number, total: number, books: StubBooks) {
      await payment();
      await cancelled("cancelled", 400000);
      await pass(books, "books-customer-9");
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO refunds (id, payment_id, razorpay_refund_id, amount, status, created_at, processed_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, 'processed', ?5, ?5, ?5)`,
        ).bind(id, PAYMENT, `rfnd_${id}`, amount, NOW.toISOString()),
        env.DB.prepare("UPDATE payments SET refunded_amount = ?1 WHERE id = ?2").bind(total, PAYMENT),
      ]);
    }

    it("of the part not kept is recorded from the payment, and a refusal of it says nothing of the invoice", async () => {
      const books = createStubBooks();
      await refunded("routine", 2600000, 2600000, books);
      books.refuseNext("recordRefund");

      await pass(books, "books-customer-9", later(RECHECK_AFTER_MS * 2));
      expect(told).toEqual([expect.stringContaining("Books refused refund routine (Razorpay rfnd_routine)")]);
      expect(told[0]).toContain("It is asked again every hour.");
      expect(told[0]).not.toContain("invoice");

      await pass(books, "books-customer-9", later(RECHECK_AFTER_MS * 4));
      expect(books.made.refunds).toEqual([expect.objectContaining({ amount: 2600000, reference: "rfnd_routine" })]);
    });

    it("reaching into what was kept, tells ops to free the payment from its invoice when Books refuses it", async () => {
      const books = createStubBooks();
      await refunded("kept", 400000, 3000000, books);
      books.refuseNext("recordRefund");

      await pass(books, "books-customer-9", later(RECHECK_AFTER_MS * 2));
      expect(told).toEqual([
        expect.stringContaining(
          `Its payment is set against invoice ${books.made.issued[0] ?? ""} for a charge kept, and this refund reaches ` +
            "into it: in Books, take the payment off that invoice, then credit or void the invoice. The refund is " +
            "then recorded from the payment within the hour.",
        ),
      ]);
    });
  });

  it("of a client erased since is told to ops, not invoiced", async () => {
    await payment();
    await cancelled("cancelled", 400000);
    await env.DB.prepare("UPDATE people SET erased_at = ?1 WHERE id = ?2").bind(NOW.toISOString(), PERSON).run();
    const books = createStubBooks();
    await pass(books, "books-customer-9");
    expect(books.made.invoices).toEqual([]);
    expect(told).toEqual([
      expect.stringContaining(
        "it has nothing to be set against (the client was erased before its invoice was raised).",
      ),
    ]);
  });

  it("names what a late change kept", async () => {
    await payment();
    await cancelled("replaced", 400000);
    const books = createStubBooks();
    await pass(books, "books-customer-9");
    expect(books.made.invoices[0]?.line.name).toBe("Late change charge, First Fit");
  });

  it("is not invoiced when the whole payment went back", async () => {
    await payment();
    await cancelled("cancelled", 0);
    const books = createStubBooks();
    await pass(books, "books-customer-9");
    expect(books.made.invoices).toEqual([]);
  });

  it("of a no-show ops charged is invoiced once its dispute window has closed with no dispute open", async () => {
    await payment();
    await chargedNoShow(400000, later(RECHECK_AFTER_MS * 4).toISOString());
    const books = createStubBooks();
    await pass(books, "books-customer-9");
    expect(books.made.invoices).toEqual([]);

    await disputed(null);
    await pass(books, "books-customer-9", later(RECHECK_AFTER_MS * 6));
    expect(books.made.invoices).toEqual([]);

    await env.DB.prepare("UPDATE no_show_disputes SET ruling = 'upheld', ruled_by = 'ops@maneman.in', ruled_at = ?1")
      .bind(NOW.toISOString())
      .run();
    await pass(books, "books-customer-9", later(RECHECK_AFTER_MS * 8));
    expect(books.made.invoices).toEqual([
      expect.objectContaining({
        line: expect.objectContaining({ name: "No-show charge, First Fit", rate: 400000 }) as unknown,
      }),
    ]);
  });

  it("of a no-show charge refunded on the client's dispute is not invoiced, though the refund has not landed", async () => {
    await payment();
    await chargedNoShow(400000);
    await disputed("refunded");
    const books = createStubBooks();
    await pass(books, "books-customer-9");
    expect(books.made.invoices).toEqual([]);
  });

  it("of a late fee is invoiced on its own, and never set against the visit's invoice", async () => {
    await payment();
    await secondPayment("late_fee");
    await invoiced("inv-41");
    const books = booksWith(sent({ balance: 6000000 }));

    await pass(books, "books-customer-9");
    expect(books.made.invoices).toEqual([
      expect.objectContaining({
        reference: SECOND,
        line: expect.objectContaining({ name: "Late move charge, First Fit", rate: 3000000 }) as unknown,
      }),
    ]);
    expect(books.made.applied).toEqual([
      expect.objectContaining({ invoiceId: "inv-41", amount: 3000000 }),
      expect.objectContaining({ invoiceId: books.made.issued[0], amount: 3000000 }),
    ]);
    expect(told).toEqual([]);
  });

  it("is raised once when its answer never came, found again by the payment's ID", async () => {
    await payment();
    await cancelled("cancelled", 400000);
    const books = createStubBooks();
    books.loseAnswer("createInvoice");

    await pass(books, "books-customer-9");
    expect(books.made.applied).toEqual([]);
    expect((await paymentRow())?.books_applied_at).toBeNull();

    await pass(books, "books-customer-9", later(RECHECK_AFTER_MS * 2));
    expect(books.made.invoices).toHaveLength(1);
    expect(books.made.applied).toEqual([expect.objectContaining({ amount: 400000 })]);
  });

  it("is raised once when two passes run at the same time", async () => {
    await payment();
    await cancelled("cancelled", 400000);
    const books = createStubBooks();
    // The first pass records the payment, and runs out of calls before the kept charge.
    await pass(books, "books-customer-9", NOW, {}, createCallBudget(3));
    const looking = bothLooking();
    const racing: StubBooks = {
      ...books,
      findInvoice: (reference) => looking.wait().then(() => books.findInvoice(reference)),
    };

    const after = later(RECHECK_AFTER_MS * 2);
    await Promise.all([pass(racing, "books-customer-9", after), pass(racing, "books-customer-9", after)]);
    expect(looking.times()).toBe(1);
    expect(books.made.invoices).toHaveLength(1);
  });

  it("waits while the visit's service has no Books item", async () => {
    await env.DB.prepare("UPDATE services SET books_item_id = NULL").run();
    await payment();
    await cancelled("cancelled", 400000);
    const books = createStubBooks();
    await pass(books, "books-customer-9");
    expect(books.made.invoices).toEqual([]);
    expect((await paymentRow())?.books_applied_at).toBeNull();
  });

  it("whose invoice was voided in Books is told to ops once, and closed once refunded in full", async () => {
    await payment();
    await cancelled("cancelled", 400000);
    const voided: BooksInvoice = sent({ id: "inv-void", status: "void", reference: PAYMENT });
    const books: StubBooks = { ...createStubBooks(), findInvoice: () => Promise.resolve(voided) };

    await pass(books, "books-customer-9");
    expect(told).toEqual([expect.stringContaining("it has nothing to be set against (its invoice inv-void is void).")]);
    expect(await openAlerts()).toEqual({ n: 1 });

    await env.DB.prepare("UPDATE payments SET refunded_amount = amount WHERE id = ?1").bind(PAYMENT).run();
    await pass(books, "books-customer-9", later(RECHECK_AFTER_MS * 2));
    expect(await openAlerts()).toEqual({ n: 0 });
    expect(told).toHaveLength(1);
  });
});
