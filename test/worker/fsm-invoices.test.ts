// The invoice a finished job gets, and its issuing (ADRs 0055 and 0056). Every
// name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createAlertOnce, createResolveAlert } from "../../src/domain/alerts.ts";
import { CALLS_PER_VISIT, raiseInvoices, RECHECK_AFTER_MS } from "../../src/domain/fsm-invoices.ts";
import { outstandingTasks } from "../../src/domain/tasks.ts";
import { TASK_SLA_HOURS } from "../../src/policy/tasks.ts";
import { createCallBudget, type CallBudget } from "../../src/lib/call-budget.ts";
import { createLogger } from "../../src/log.ts";
import { createStubBooks, type BooksProvider, type StubBooks } from "../../src/providers/books.ts";
import {
  createStubFsm,
  EMPTY_FSM,
  type FsmProvider,
  type StubFsm,
  type StubFsmWorld,
} from "../../src/providers/fsm.ts";
import { ZohoError } from "../../src/providers/zoho-http.ts";
import { captureLogs, NOW } from "./helpers.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const VISIT = "22222222-2222-4222-8222-222222222222";

/** A service visit on 20 September, as the price book sold it: Rs. 2,000 with the 5% GST it had then. */
const SERVICE = 210_000;

const later = (ms: number) => new Date(NOW.getTime() + ms);

/** What the pass told ops, so a failure that leaves a job unbilled is never silent. */
let alerted: string[];
const alert = (message: string) => {
  alerted.push(message);
  return Promise.resolve();
};

const CLIENT_LINK = `http://ops.localhost:4323/clients/${PERSON}/payments`;

function invoicePass(
  fsm: FsmProvider,
  books: BooksProvider,
  now: Date,
  budget: CallBudget = createCallBudget(Infinity),
) {
  const alertOnce = createAlertOnce({ db: env.DB, alert, now: () => now, environment: "local", log: createLogger() });
  const resolveAlert = createResolveAlert({ db: env.DB, now: () => now });
  return raiseInvoices(env.DB, { fsm, books, alertOnce, resolveAlert }, now, createLogger(), budget);
}

const world = (overrides: Partial<StubFsmWorld>): StubFsmWorld => ({ ...EMPTY_FSM, ...overrides });

/** FSM with these work orders, each billing what the price book sold a service visit for. */
const billing = (...workOrders: string[]): StubFsm =>
  createStubFsm(world({ totals: Object.fromEntries(workOrders.map((workOrder) => [workOrder, SERVICE])) }));

function pass(fsm: StubFsm = billing("fsm-wo-1"), books: StubBooks = createStubBooks(), now = NOW) {
  return { fsm, books, done: invoicePass(fsm, books, now) };
}

/** A visit as the mirror writes it, with the status FSM gave the appointment. It ended the day before NOW. */
async function visit(
  id: string,
  status: string,
  workOrderId: string | null = "fsm-wo-1",
  windowEnd = "2026-09-20T06:00:00.000Z",
) {
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, fsm_work_order_id, person_id, type, status, fsm_status,
       window_start, window_end, fsm_modified_at, synced_at)
     VALUES (?1, ?2, ?3, ?4, 'service', ?5, 'Completed', '2026-09-20T04:30:00.000Z', ?7, ?6, ?6)`,
  )
    .bind(id, `fsm-${id}`, workOrderId, PERSON, status, NOW.toISOString(), windowEnd)
    .run();
}

const row = (id = VISIT) =>
  env.DB.prepare("SELECT fsm_invoice_id, invoice_checked_at, invoice_issued_at FROM appointments WHERE id = ?1")
    .bind(id)
    .first<{ fsm_invoice_id: string | null; invoice_checked_at: string | null; invoice_issued_at: string | null }>();

let logs: ReturnType<typeof captureLogs>;
beforeEach(async () => {
  logs = captureLogs();
  alerted = [];
  await env.DB.prepare(
    `INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810000001', 'Rohit Malhotra')`,
  )
    .bind(PERSON, NOW.toISOString())
    .run();
});

describe("the invoice a finished job gets", () => {
  it("bills a completed visit, marks it sent, and keeps Books' ID, which is what the client app reads", async () => {
    await visit(VISIT, "completed");

    const { fsm, books, done } = pass();
    expect(await done).toEqual({ raised: 1, issued: 1 });
    expect(fsm.made.invoiced).toEqual(["fsm-wo-1"]);
    const billed = await row();
    expect(billed?.fsm_invoice_id).toMatch(/^stub-invoice-/);
    expect(books.made.issued).toEqual([billed?.fsm_invoice_id]);
    expect(billed?.invoice_issued_at).toBe(NOW.toISOString());
  });

  it("asks FSM once: a visit already billed is left alone by the next pass", async () => {
    await visit(VISIT, "completed");
    const fsm = billing("fsm-wo-1");
    const books = createStubBooks();

    await invoicePass(fsm, books, NOW);
    await invoicePass(fsm, books, later(RECHECK_AFTER_MS * 2));
    expect(fsm.made.invoiced).toEqual(["fsm-wo-1"]);
    expect(books.made.issued).toHaveLength(1);
  });

  it("leaves a visit FSM has not finished with alone, and one with no work order", async () => {
    await visit(VISIT, "in_progress");
    await visit("33333333-3333-4333-8333-333333333333", "completed", null);

    const { fsm, done } = pass();
    expect(await done).toEqual({ raised: 0, issued: 0 });
    expect(fsm.made.invoiced).toEqual([]);
  });

  it("waits an hour before offering a job FSM has nothing to bill for, such as a free consultation", async () => {
    await visit(VISIT, "completed");
    const fsm = createStubFsm(EMPTY_FSM); // its work order has nothing on it

    expect(await invoicePass(fsm, createStubBooks(), NOW)).toEqual({
      raised: 0,
      issued: 0,
    });
    expect((await row())?.invoice_checked_at).toBe(NOW.toISOString());

    // Within the hour it is not offered again; after it, it is.
    await invoicePass(fsm, createStubBooks(), later(RECHECK_AFTER_MS / 2));
    expect(fsm.made.invoiced).toEqual([]);
    const after = later(RECHECK_AFTER_MS * 2);
    await invoicePass(billing("fsm-wo-1"), createStubBooks(), after);
    expect((await row())?.fsm_invoice_id).toMatch(/^stub-invoice-/);
  });

  it("logs a refusal, tells ops once, and leaves the visit for the next hour, rather than failing the pass", async () => {
    await visit(VISIT, "completed");
    const fsm = {
      ...createStubFsm(EMPTY_FSM),
      invoiceWorkOrder: () => Promise.reject(new ZohoError(400, "2031", "One or more line items are already invoiced")),
    };

    expect(await invoicePass(fsm, createStubBooks(), NOW)).toEqual({
      raised: 0,
      issued: 0,
    });
    expect(logs.lines()).toContainEqual(expect.objectContaining({ event: "invoice_refused", code: "2031" }));
    expect(await row()).toEqual({
      fsm_invoice_id: null,
      invoice_checked_at: NOW.toISOString(),
      invoice_issued_at: null,
    });
    expect(alerted).toEqual([
      `FSM refused to invoice visit ${VISIT} (work order fsm-wo-1): 400 2031. Raise its invoice in FSM by hand. ${CLIENT_LINK}`,
    ]);
  });

  it("logs a broken FSM, leaves that visit an hour, and goes on to the next", async () => {
    const next = "33333333-3333-4333-8333-333333333333";
    await visit(VISIT, "completed");
    await visit(next, "completed", "fsm-wo-2");
    const fsm = billing("fsm-wo-1", "fsm-wo-2");
    fsm.failNext("invoiceWorkOrder", "FSM answered 500");

    expect(await invoicePass(fsm, createStubBooks(), NOW)).toEqual({ raised: 1, issued: 1 });
    const failed = [await row(), await row(next)].filter((each) => each?.invoice_issued_at === null);
    expect(failed).toEqual([{ fsm_invoice_id: null, invoice_checked_at: NOW.toISOString(), invoice_issued_at: null }]);
    expect(logs.lines()).toContainEqual(expect.objectContaining({ event: "invoice_failed" }));
    expect(alerted).toEqual([]);
  });

  it("tells ops once FSM has failed on a visit three times", async () => {
    await visit(VISIT, "completed");
    const fsm = {
      ...createStubFsm(EMPTY_FSM),
      invoiceWorkOrder: () => Promise.reject(new Error("FSM answered 500")),
    };
    for (const hours of [0, 1, 2]) await invoicePass(fsm, createStubBooks(), later(hours * (RECHECK_AFTER_MS + 1000)));
    expect(alerted).toEqual([
      `The invoice pass has failed 3 times on visit ${VISIT} (work order fsm-wo-1): FSM answered 500. ${CLIENT_LINK}`,
    ]);
  });

  it("bills only the visits the cron run's outside calls pay for", async () => {
    await visit(VISIT, "completed");
    await visit("33333333-3333-4333-8333-333333333333", "completed", "fsm-wo-2");

    const fsm = billing("fsm-wo-1", "fsm-wo-2");
    expect(await invoicePass(fsm, createStubBooks(), NOW, createCallBudget(CALLS_PER_VISIT))).toEqual({
      raised: 1,
      issued: 1,
    });
    expect(fsm.made.invoiced).toHaveLength(1);
  });
});

describe("issuing it", () => {
  /** FSM answers with an invoice the work order already had: what the backlog's drafts look like to the pass. */
  function alreadyInvoiced(): FsmProvider {
    const fsm = billing("fsm-wo-1");
    return {
      ...fsm,
      invoiceWorkOrder: async (workOrderId) => {
        const invoice = await fsm.invoiceWorkOrder(workOrderId);
        return invoice === null ? null : { ...invoice, created: false };
      },
    };
  }

  it("never sends an invoice that already existed, so a draft the owner can delete stays deletable", async () => {
    await visit(VISIT, "completed");
    const books = createStubBooks();

    // The pass holds the invoice, so a second one is never raised, but the client is shown nothing.
    expect(await invoicePass(alreadyInvoiced(), books, NOW)).toEqual({
      raised: 0,
      issued: 0,
    });
    expect(books.made.issued).toEqual([]);
    const held = await row();
    expect(held?.fsm_invoice_id).toMatch(/^stub-invoice-/);
    expect(held?.invoice_issued_at).toBeNull();
  });

  it("tells ops once of a draft still unsent an hour after the visit, and not before", async () => {
    await visit(VISIT, "completed", "fsm-wo-1", "2026-09-21T06:00:00.000Z");
    const fsm = alreadyInvoiced();
    const books = createStubBooks();

    await invoicePass(fsm, books, NOW);
    expect(alerted).toEqual([]);

    await invoicePass(fsm, books, later(RECHECK_AFTER_MS * 2));
    const invoice = (await row())?.fsm_invoice_id ?? "";
    expect(alerted).toEqual([
      `Invoice ${invoice} of visit ${VISIT} is still a draft in Books an hour after the visit, so the client ` +
        `cannot open it. Send it in Books: nothing here sends a draft that already exists. ${CLIENT_LINK}`,
    ]);

    await invoicePass(fsm, books, later(RECHECK_AFTER_MS * 4));
    expect(alerted).toHaveLength(1);
  });

  it("closes the draft's alert once the invoice is sent", async () => {
    await visit(VISIT, "completed");
    const fsm = alreadyInvoiced();
    const books = createStubBooks();
    await invoicePass(fsm, books, NOW);
    expect(alerted).toHaveLength(1);

    await books.issueInvoice((await row())?.fsm_invoice_id ?? "");
    await invoicePass(fsm, books, later(RECHECK_AFTER_MS * 2));
    const open = await env.DB.prepare("SELECT COUNT(*) AS n FROM alerts WHERE resolved_at IS NULL").first();
    expect(open).toEqual({ n: 0 });
  });

  it("shows one the owner has since sent in Books, whoever raised it", async () => {
    await visit(VISIT, "completed");
    const fsm = alreadyInvoiced();
    const books = createStubBooks();
    await invoicePass(fsm, books, NOW);

    // The owner presses Send in Books, and the next pass finds it is no longer a draft.
    await books.issueInvoice((await row())?.fsm_invoice_id ?? "");
    const after = later(RECHECK_AFTER_MS * 2);
    expect(await invoicePass(fsm, books, after)).toEqual({ raised: 0, issued: 1 });
    expect((await row())?.invoice_issued_at).toBe(after.toISOString());
  });

  it("shows nothing and alerts ops when Books will not send the invoice it has just raised", async () => {
    await visit(VISIT, "completed");
    const books = {
      ...createStubBooks(),
      issueInvoice: () => Promise.reject(new ZohoError(400, "4000", "customer has no billing address")),
    };

    expect(await invoicePass(billing("fsm-wo-1"), books, NOW)).toEqual({
      raised: 1,
      issued: 0,
    });
    const held = await row();
    expect(held?.fsm_invoice_id).toMatch(/^stub-invoice-/);
    expect(held?.invoice_issued_at).toBeNull();
    expect(logs.lines()).toContainEqual(expect.objectContaining({ event: "invoice_not_issued" }));
    expect(alerted).toHaveLength(1);
    expect(alerted[0]).toContain(VISIT);
  });

  it("does not try the failed send again, since by then the draft is one that already exists", async () => {
    await visit(VISIT, "completed");
    const fsm = billing("fsm-wo-1");
    let refusals = 0;
    const books = {
      ...createStubBooks(),
      issueInvoice: () => {
        refusals += 1;
        return Promise.reject(new ZohoError(400, "4000", "customer has no billing address"));
      },
    };

    await invoicePass(fsm, books, NOW);
    await invoicePass(fsm, books, later(RECHECK_AFTER_MS * 2));
    expect(refusals).toBe(1);
    expect((await row())?.invoice_issued_at).toBeNull();
    // The draft it left is the one ops were told of; they are not told again an hour later.
    expect(alerted).toHaveLength(1);
  });
});

describe("what the invoice totals, before it is issued", () => {
  /** A replacement on 20 September, paid for in the app: Rs. 15,000, the price book's figure. */
  const PAID = 1_500_000;

  async function paidReplacement(amount = PAID): Promise<void> {
    await env.DB.prepare(
      `INSERT INTO appointments (id, fsm_id, fsm_work_order_id, person_id, type, status, fsm_status,
         window_start, window_end, fsm_modified_at, synced_at)
       VALUES (?1, 'fsm-visit', 'fsm-wo-1', ?2, 'replacement', 'completed', 'Completed',
         '2026-09-20T04:30:00.000Z', '2026-09-20T06:45:00.000Z', ?3, ?3)`,
    )
      .bind(VISIT, PERSON, NOW.toISOString())
      .run();
    await env.DB.prepare(
      `INSERT INTO payments (id, person_id, appointment_id, razorpay_payment_id, amount, currency, status, kind,
         captured_at, created_at, updated_at)
       VALUES ('payment-1', ?1, ?2, 'pay_test_1', ?3, 'INR', 'captured', 'visit', ?4, ?4, ?4)`,
    )
      .bind(PERSON, VISIT, amount, NOW.toISOString())
      .run();
  }

  const fsmBilling = (total: number) => createStubFsm(world({ totals: { "fsm-wo-1": total } }));

  it("issues an invoice that totals what the client paid for the visit", async () => {
    await paidReplacement();
    const { books, done } = pass(fsmBilling(PAID));
    expect(await done).toEqual({ raised: 1, issued: 1 });
    expect(books.made.issued).toHaveLength(1);
  });

  it("holds as a draft, and tells ops once, an invoice FSM priced above what the client paid", async () => {
    await paidReplacement();
    const fsm = fsmBilling(2 * PAID);
    const books = createStubBooks();

    expect(await invoicePass(fsm, books, NOW)).toEqual({ raised: 1, issued: 0 });
    expect(books.made.issued).toEqual([]);
    const held = await row();
    expect(held?.invoice_issued_at).toBeNull();
    expect(alerted).toEqual([
      `Invoice ${held?.fsm_invoice_id ?? ""} of visit ${VISIT} is held as a draft in Books: FSM's work order totals ` +
        "Rs. 30,000, and the visit was sold for Rs. 15,000. Correct the draft in Books and send it there, and set " +
        `FSM's price right for the next one: nothing here sends it. ${CLIENT_LINK}`,
    ]);

    // Held, it is never sent from here, and ops are not told again.
    await invoicePass(fsm, books, later(RECHECK_AFTER_MS * 2));
    await invoicePass(fsm, books, later(RECHECK_AFTER_MS * 4));
    expect(books.made.issued).toEqual([]);
    expect(alerted).toHaveLength(1);

    // The Tasks board's Draft invoice group lists it until it is sent.
    const { tasks } = await outstandingTasks(env.DB, NOW, TASK_SLA_HOURS);
    expect(tasks).toContainEqual(
      expect.objectContaining({ group: "draft_invoice", id: VISIT, detail: held?.fsm_invoice_id }),
    );
  });

  it("checks a visit with no payment against the price book on the day it happened", async () => {
    await visit(VISIT, "completed");
    const { books, done } = pass(fsmBilling(200_000)); // Rs. 2,000 without the 5% the book had that day
    expect(await done).toEqual({ raised: 1, issued: 0 });
    expect(books.made.issued).toEqual([]);
    expect(alerted[0]).toContain("the visit was sold for Rs. 2,100");
  });

  it("never issues the invoice of a visit a referral credit paid for, until the CA rules how", async () => {
    await visit(VISIT, "completed");
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

    const { books, done } = pass(fsmBilling(SERVICE));
    expect(await done).toEqual({ raised: 1, issued: 0 });
    expect(books.made.issued).toEqual([]);
    expect(alerted[0]).toContain("was paid with a referral credit");
    expect(alerted[0]).toContain("open point 14");
  });
});
