// The invoice a finished job gets, and its issuing (ADRs 0055 and 0056). Every
// name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { raiseInvoices, RECHECK_AFTER_MS } from "../../src/domain/fsm-invoices.ts";
import { createLogger } from "../../src/log.ts";
import { createStubBooks, type StubBooks } from "../../src/providers/books.ts";
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

const later = (ms: number) => new Date(NOW.getTime() + ms);

/** What the pass told ops, so a failure that leaves a job unbilled is never silent. */
let alerted: string[];
const alert = (message: string) => {
  alerted.push(message);
  return Promise.resolve();
};

function pass(fsm: StubFsm = createStubFsm(EMPTY_FSM), books: StubBooks = createStubBooks(), now = NOW) {
  return { fsm, books, done: raiseInvoices(env.DB, fsm, books, now, createLogger(), alert) };
}

const world = (overrides: Partial<StubFsmWorld>): StubFsmWorld => ({ ...EMPTY_FSM, ...overrides });

/** A visit as the mirror writes it, with the status FSM gave the appointment. */
async function visit(id: string, status: string, workOrderId: string | null = "fsm-wo-1") {
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, fsm_work_order_id, person_id, type, status, fsm_status,
       window_start, window_end, fsm_modified_at, synced_at)
     VALUES (?1, ?2, ?3, ?4, 'service', ?5, 'Completed', '2026-09-20T04:30:00.000Z',
       '2026-09-20T06:00:00.000Z', ?6, ?6)`,
  )
    .bind(id, `fsm-${id}`, workOrderId, PERSON, status, NOW.toISOString())
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
    const fsm = createStubFsm(EMPTY_FSM);
    const books = createStubBooks();

    await raiseInvoices(env.DB, fsm, books, NOW, createLogger(), alert);
    await raiseInvoices(env.DB, fsm, books, later(RECHECK_AFTER_MS * 2), createLogger(), alert);
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
    const fsm = createStubFsm(world({ unbillable: ["fsm-wo-1"] }));

    expect(await raiseInvoices(env.DB, fsm, createStubBooks(), NOW, createLogger(), alert)).toEqual({
      raised: 0,
      issued: 0,
    });
    expect((await row())?.invoice_checked_at).toBe(NOW.toISOString());

    // Within the hour it is not offered again; after it, it is.
    await raiseInvoices(env.DB, fsm, createStubBooks(), later(RECHECK_AFTER_MS / 2), createLogger(), alert);
    expect(fsm.made.invoiced).toEqual([]);
    const after = later(RECHECK_AFTER_MS * 2);
    await raiseInvoices(env.DB, createStubFsm(EMPTY_FSM), createStubBooks(), after, createLogger(), alert);
    expect((await row())?.fsm_invoice_id).toMatch(/^stub-invoice-/);
  });

  it("logs a refusal for ops and leaves the visit for the next hour, rather than failing the pass", async () => {
    await visit(VISIT, "completed");
    const fsm = {
      ...createStubFsm(EMPTY_FSM),
      invoiceWorkOrder: () => Promise.reject(new ZohoError(400, "2031", "One or more line items are already invoiced")),
    };

    expect(await raiseInvoices(env.DB, fsm, createStubBooks(), NOW, createLogger(), alert)).toEqual({
      raised: 0,
      issued: 0,
    });
    expect(logs.lines()).toContainEqual(expect.objectContaining({ event: "invoice_refused", code: "2031" }));
    expect(await row()).toEqual({
      fsm_invoice_id: null,
      invoice_checked_at: NOW.toISOString(),
      invoice_issued_at: null,
    });
  });

  it("fails the pass loudly when FSM is the one that is broken, so the next run tries again", async () => {
    await visit(VISIT, "completed");
    const fsm = createStubFsm(EMPTY_FSM);
    fsm.failNext("invoiceWorkOrder", "FSM answered 500");

    await expect(raiseInvoices(env.DB, fsm, createStubBooks(), NOW, createLogger(), alert)).rejects.toThrow(
      "FSM answered 500",
    );
    expect((await row())?.invoice_checked_at).toBeNull();
  });
});

describe("issuing it", () => {
  /** FSM answers with an invoice the work order already had: what the backlog's drafts look like to the pass. */
  function alreadyInvoiced(): FsmProvider {
    const fsm = createStubFsm(EMPTY_FSM);
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
    expect(await raiseInvoices(env.DB, alreadyInvoiced(), books, NOW, createLogger(), alert)).toEqual({
      raised: 0,
      issued: 0,
    });
    expect(books.made.issued).toEqual([]);
    const held = await row();
    expect(held?.fsm_invoice_id).toMatch(/^stub-invoice-/);
    expect(held?.invoice_issued_at).toBeNull();
  });

  it("shows one the owner has since sent in Books, whoever raised it", async () => {
    await visit(VISIT, "completed");
    const fsm = alreadyInvoiced();
    const books = createStubBooks();
    await raiseInvoices(env.DB, fsm, books, NOW, createLogger(), alert);

    // The owner presses Send in Books, and the next pass finds it is no longer a draft.
    await books.issueInvoice((await row())?.fsm_invoice_id ?? "");
    const after = later(RECHECK_AFTER_MS * 2);
    expect(await raiseInvoices(env.DB, fsm, books, after, createLogger(), alert)).toEqual({ raised: 0, issued: 1 });
    expect((await row())?.invoice_issued_at).toBe(after.toISOString());
  });

  it("shows nothing and alerts ops when Books will not send the invoice it has just raised", async () => {
    await visit(VISIT, "completed");
    const books = {
      ...createStubBooks(),
      issueInvoice: () => Promise.reject(new ZohoError(400, "4000", "customer has no billing address")),
    };

    expect(await raiseInvoices(env.DB, createStubFsm(EMPTY_FSM), books, NOW, createLogger(), alert)).toEqual({
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
    const fsm = createStubFsm(EMPTY_FSM);
    let refusals = 0;
    const books = {
      ...createStubBooks(),
      issueInvoice: () => {
        refusals += 1;
        return Promise.reject(new ZohoError(400, "4000", "customer has no billing address"));
      },
    };

    await raiseInvoices(env.DB, fsm, books, NOW, createLogger(), alert);
    await raiseInvoices(env.DB, fsm, books, later(RECHECK_AFTER_MS * 2), createLogger(), alert);
    expect(refusals).toBe(1);
    expect((await row())?.invoice_issued_at).toBeNull();
  });
});
