// Payments and refunds recorded in Books, where the pass makes each client's Books customer itself. Every name and
// number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { type GstRegistration } from "../../../src/config/gst.ts";
import { createAlertOnce, createResolveAlert } from "../../../src/domain/ops/alerts.ts";
import { markCustomerChanged } from "../../../src/domain/books/books-customers.ts";
import {
  CALLS_PER_CUSTOMER,
  CALLS_PER_RECORD,
  syncBooks,
  type BooksSyncSummary,
} from "../../../src/domain/books/books-sync.ts";
import type { BooksSyncOptions } from "../../../src/domain/books/books-pass.ts";
import { createCallBudget, type CallBudget } from "../../../src/lib/call-budget.ts";
import { createLogger } from "../../../src/log.ts";
import { type BooksProvider } from "../../../src/providers/books/index.ts";
import { createStubBooks } from "../../../src/providers/books/stub.ts";
import { captureLogs, NOW } from "../helpers.ts";
import { RECHECK_AFTER_MS } from "../../../src/domain/books/vendor-pass.ts";
import {
  PERSON,
  VISIT,
  TAKEN,
  optionsFor,
  CLIENT_PAGE,
  payment,
  SECOND,
  secondPayment,
  later,
  openAlerts,
  did,
} from "./books-sync-fixtures.ts";

/** GST on, as the CA will have it: registered in Haryana. */
const REGISTERED: GstRegistration = { gstin: "06AAACM0000A1Z5", stateCode: "HR", sac: "999721" };

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

describe("the pass makes each client's Books customer", () => {
  const customerRow = () =>
    env.DB.prepare("SELECT books_customer_id, books_checked_at FROM people WHERE id = ?1")
      .bind(PERSON)
      .first<{ books_customer_id: string | null; books_checked_at: string | null }>();

  async function savedAddress(city: string, pincode: string) {
    await env.DB.prepare(
      `INSERT INTO addresses (id, person_id, created_at, line1, line2, locality, city, pincode, flat)
       VALUES ('address-1', ?1, ?2, '14 Aravali Road', NULL, 'DLF Phase 1', ?3, ?4, 'B-702')`,
    )
      .bind(PERSON, NOW.toISOString(), city, pincode)
      .run();
  }

  it("makes a paying client's customer, by their person ID, and records their payment against it in one pass", async () => {
    await payment();
    await savedAddress("Gurgaon", "122002");
    const books = createStubBooks();

    expect(await pass(books, null)).toEqual(did({ customers: 1, recorded: 1 }));
    expect(books.made.customers).toEqual([
      {
        personId: PERSON,
        name: "Rohit Malhotra",
        mobile: "+919810000001",
        email: null,
        stateCode: null,
        address: {
          street1: "B-702, 14 Aravali Road",
          street2: "DLF Phase 1",
          city: "Gurgaon",
          state: "Haryana",
          pincode: "122002",
        },
      },
    ]);
    const kept = (await customerRow())?.books_customer_id;
    expect(kept).toMatch(/^stub-customer-/);
    expect(books.made.payments).toEqual([expect.objectContaining({ customerId: kept, reference: "MM-2026-0841" })]);
  });

  it("makes the customer once across two passes", async () => {
    await payment();
    await secondPayment();
    const books = createStubBooks();
    await pass(books, null, NOW, {}, createCallBudget(CALLS_PER_CUSTOMER + CALLS_PER_RECORD));
    await pass(books, null, later(RECHECK_AFTER_MS * 2));
    expect(books.made.customers).toHaveLength(1);
    expect(books.made.payments).toHaveLength(2);
  });

  it("makes the customer of a client whose finished visit is still to be invoiced", async () => {
    await env.DB.prepare("UPDATE appointments SET status = 'completed' WHERE id = ?1").bind(VISIT).run();
    const books = createStubBooks();
    expect(await pass(books, null)).toEqual(did({ customers: 1 }));
  });

  it("makes none for a client whose only finished visit is free: a consultation, or a one visit they declined", async () => {
    await env.DB.prepare("UPDATE appointments SET status = 'completed', type = 'consultation' WHERE id = ?1")
      .bind(VISIT)
      .run();
    const books = createStubBooks();
    expect(await pass(books, null)).toEqual(did({}));

    await env.DB.prepare("UPDATE appointments SET type = 'first_fit', one_visit = 'declined' WHERE id = ?1")
      .bind(VISIT)
      .run();
    expect(await pass(books, null, later(RECHECK_AFTER_MS * 2))).toEqual(did({}));
    expect(books.made.customers).toEqual([]);
  });

  it("makes none for a client with nothing to record", async () => {
    const books = createStubBooks();
    expect(await pass(books, null)).toEqual(did({}));
    expect(books.made.customers).toEqual([]);
  });

  it("never writes a client who has been erased, since their customer still holds their person ID", async () => {
    await payment();
    await env.DB.prepare("UPDATE people SET erased_at = ?1 WHERE id = ?2").bind(NOW.toISOString(), PERSON).run();
    const books = createStubBooks();
    expect(await pass(books, null)).toEqual(did({}));
    expect(books.made.customers).toEqual([]);
  });

  // Once GST is on, Books splits the tax by the client's state.
  it("names the client's state as their place of contact once GST is on, and the state registered in without a city", async () => {
    await payment();
    await savedAddress("Delhi", "110017");
    const books = createStubBooks();
    await pass(books, null, NOW, { gst: REGISTERED });
    expect(books.made.customers[0]).toMatchObject({ stateCode: "DL", address: { city: "Delhi", state: "Delhi" } });

    await env.DB.batch([
      env.DB.prepare("DELETE FROM addresses"),
      env.DB.prepare("UPDATE appointments SET service_city = NULL"),
      env.DB.prepare("UPDATE people SET books_customer_id = NULL"),
      env.DB.prepare("UPDATE payments SET books_payment_id = NULL, books_checked_at = NULL"),
    ]);
    await pass(books, null, later(RECHECK_AFTER_MS * 2), { gst: REGISTERED });
    expect(books.made.customers[1]).toMatchObject({ stateCode: "HR", address: null });
  });

  it("takes the city of the client's latest visit where they have saved no address", async () => {
    await payment();
    await env.DB.prepare("UPDATE appointments SET service_city = 'Noida' WHERE id = ?1").bind(VISIT).run();
    const books = createStubBooks();
    await pass(books, null, NOW, { gst: REGISTERED });
    expect(books.made.customers[0]).toMatchObject({ stateCode: "UP", address: null });
  });

  it("tells ops of a customer Books refuses, and asks again an hour on", async () => {
    await payment();
    const books = createStubBooks();
    books.refuseNext("upsertCustomer", "4071");
    const logs = captureLogs();

    expect(await pass(books, null)).toEqual(did({}));
    expect(logs.lines()).toContainEqual(
      expect.objectContaining({ event: "books_customer_refused", person_id: PERSON }),
    );
    expect(told).toEqual([
      `Books refused client ${PERSON}'s customer record, saying "the stub Books refused upsertCustomer". It is asked again every hour. ${CLIENT_PAGE}`,
    ]);
    expect(await customerRow()).toEqual({ books_customer_id: null, books_checked_at: NOW.toISOString() });

    await pass(books, null, later(RECHECK_AFTER_MS / 2));
    expect(books.made.customers).toEqual([]);
    expect(await pass(books, null, later(RECHECK_AFTER_MS + 1000))).toEqual(did({ customers: 1, recorded: 1 }));
    expect(await openAlerts()).toEqual({ n: 0 });
  });

  it("finds the same customer when Books made it and its answer never came", async () => {
    await payment();
    const books = createStubBooks();
    books.loseAnswer("upsertCustomer");
    await pass(books, null);
    expect((await customerRow())?.books_customer_id).toBeNull();

    await pass(books, null, later(RECHECK_AFTER_MS + 1000));
    const [first, second] = books.made.customers;
    expect(second).toEqual(first);
    const sameCustomer = await books.upsertCustomer({
      personId: PERSON,
      name: "Rohit Malhotra",
      mobile: "+919810000001",
      email: null,
      stateCode: null,
      address: null,
    });
    expect((await customerRow())?.books_customer_id).toBe(sameCustomer);
  });

  it("stops when the cron run's calls are spent, mid-pass", async () => {
    const OTHER = "77777777-7777-4777-8777-777777777777";
    await env.DB.prepare(
      `INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810000002', 'Kabir Anand')`,
    )
      .bind(OTHER, NOW.toISOString())
      .run();
    await payment();
    await env.DB.prepare(
      `INSERT INTO payments (id, reference, person_id, razorpay_payment_id, amount, currency, status, captured_at,
         created_at, updated_at)
       VALUES (?1, 'MM-2026-0843', ?2, 'pay_test43', 100000, 'INR', 'captured', ?3, ?3, ?3)`,
    )
      .bind(SECOND, OTHER, TAKEN)
      .run();
    const books = createStubBooks();
    const budget = createCallBudget(CALLS_PER_CUSTOMER);

    expect(await pass(books, null, NOW, {}, budget)).toEqual(did({ customers: 1 }));
    expect(books.made.customers).toHaveLength(1);
    expect(budget.ranOut()).toBe(true);
  });
});

describe("a client's new number or address reaches their Books customer", () => {
  beforeEach(async () => {
    await env.DB.prepare("UPDATE people SET books_customer_id = 'books-customer-9' WHERE id = ?1").bind(PERSON).run();
  });

  const changed = (at = NOW) => markCustomerChanged(env.DB, PERSON, at);

  const changedAt = async () =>
    (
      await env.DB.prepare("SELECT books_details_changed_at AS at FROM people WHERE id = ?1")
        .bind(PERSON)
        .first<{ at: string | null }>()
    )?.at;

  it("writes the client's details as they are now to their customer, once", async () => {
    await changed();
    await env.DB.prepare("UPDATE people SET mobile_e164 = '+919810000003' WHERE id = ?1").bind(PERSON).run();
    const books = createStubBooks();

    expect(await pass(books, null)).toEqual(did({ customersUpdated: 1 }));
    expect(books.made.customerUpdates).toEqual([
      {
        customerId: "books-customer-9",
        personId: PERSON,
        name: "Rohit Malhotra",
        mobile: "+919810000003",
        email: null,
        stateCode: null,
        address: null,
      },
    ]);
    expect(await changedAt()).toBeNull();

    expect(await pass(books, null, later(RECHECK_AFTER_MS * 2))).toEqual(did({}));
    expect(books.made.customerUpdates).toHaveLength(1);
  });

  it("writes a change made while Books was being written on the next pass", async () => {
    await changed();
    const stub = createStubBooks();
    const racing: BooksProvider = {
      ...stub,
      updateCustomer: async (customerId, customer) => {
        await changed(later(1000));
        await stub.updateCustomer(customerId, customer);
      },
    };

    await pass(racing, null);
    expect(await changedAt()).toBe(later(1000).toISOString());
    expect(await pass(stub, null, later(2000))).toEqual(did({ customersUpdated: 1 }));
    expect(await changedAt()).toBeNull();
  });

  it("never writes a client who has been erased, since the erasure blanks their customer", async () => {
    await changed();
    await env.DB.prepare("UPDATE people SET erased_at = ?1 WHERE id = ?2").bind(NOW.toISOString(), PERSON).run();
    const books = createStubBooks();
    expect(await pass(books, null)).toEqual(did({}));
    expect(books.made.customerUpdates).toEqual([]);
  });

  it("tells ops of an update Books refuses, and asks again an hour on", async () => {
    await changed();
    const books = createStubBooks();
    books.refuseNext("updateCustomer", "4071");
    const logs = captureLogs();

    expect(await pass(books, null)).toEqual(did({}));
    expect(logs.lines()).toContainEqual(
      expect.objectContaining({ event: "books_customer_update_refused", person_id: PERSON }),
    );
    expect(told).toEqual([
      `Books refused client ${PERSON}'s new number or address, saying "the stub Books refused updateCustomer". It is asked again every hour. ${CLIENT_PAGE}`,
    ]);
    expect(await changedAt()).toBe(NOW.toISOString());

    expect(await pass(books, null, later(RECHECK_AFTER_MS / 2))).toEqual(did({}));
    expect(await pass(books, null, later(RECHECK_AFTER_MS + 1000))).toEqual(did({ customersUpdated: 1 }));
    expect(books.made.customerUpdates).toHaveLength(1);
    expect(await openAlerts()).toEqual({ n: 0 });
  });

  it("writes nothing once the cron run's calls are spent", async () => {
    await changed();
    const books = createStubBooks();
    expect(await pass(books, null, NOW, {}, createCallBudget(CALLS_PER_CUSTOMER - 1))).toEqual(did({}));
    expect(books.made.customerUpdates).toEqual([]);
    expect(await changedAt()).toBe(NOW.toISOString());
  });
});
