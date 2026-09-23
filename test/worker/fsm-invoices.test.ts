// The invoice a finished job gets (ADR 0055). Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { raiseInvoices, RECHECK_AFTER_MS } from "../../src/domain/fsm-invoices.ts";
import { createLogger } from "../../src/log.ts";
import { createStubFsm, EMPTY_FSM, type StubFsmWorld } from "../../src/providers/fsm.ts";
import { ZohoError } from "../../src/providers/zoho-http.ts";
import { captureLogs, NOW } from "./helpers.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const VISIT = "22222222-2222-4222-8222-222222222222";

const later = (ms: number) => new Date(NOW.getTime() + ms);

function pass(fsm = createStubFsm(EMPTY_FSM), now = NOW) {
  return { fsm, done: raiseInvoices(env.DB, fsm, now, createLogger()) };
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
  env.DB.prepare("SELECT fsm_invoice_id, invoice_checked_at FROM appointments WHERE id = ?1")
    .bind(id)
    .first<{ fsm_invoice_id: string | null; invoice_checked_at: string | null }>();

let logs: ReturnType<typeof captureLogs>;
beforeEach(async () => {
  logs = captureLogs();
  await env.DB.prepare(
    `INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810000001', 'Rohit Malhotra')`,
  )
    .bind(PERSON, NOW.toISOString())
    .run();
});

describe("the invoice a finished job gets", () => {
  it("bills a completed visit and keeps Books' ID for it, which is what the client app reads", async () => {
    await visit(VISIT, "completed");

    const { fsm, done } = pass();
    expect(await done).toEqual({ invoiced: 1 });
    expect(fsm.made.invoiced).toEqual(["fsm-wo-1"]);
    const billed = await row();
    expect(billed?.fsm_invoice_id).toMatch(/^stub-invoice-/);
    expect(billed?.invoice_checked_at).toBe(NOW.toISOString());
  });

  it("asks FSM once: a visit already billed is left alone by the next pass", async () => {
    await visit(VISIT, "completed");
    const fsm = createStubFsm(EMPTY_FSM);

    await raiseInvoices(env.DB, fsm, NOW, createLogger());
    await raiseInvoices(env.DB, fsm, later(RECHECK_AFTER_MS * 2), createLogger());
    expect(fsm.made.invoiced).toEqual(["fsm-wo-1"]);
  });

  it("leaves a visit FSM has not finished with alone, and one with no work order", async () => {
    await visit(VISIT, "in_progress");
    await visit("33333333-3333-4333-8333-333333333333", "completed", null);

    const { fsm, done } = pass();
    expect(await done).toEqual({ invoiced: 0 });
    expect(fsm.made.invoiced).toEqual([]);
  });

  it("waits an hour before offering a job FSM has nothing to bill for, such as a free consultation", async () => {
    await visit(VISIT, "completed");
    const fsm = createStubFsm(world({ unbillable: ["fsm-wo-1"] }));

    expect(await raiseInvoices(env.DB, fsm, NOW, createLogger())).toEqual({ invoiced: 0 });
    expect((await row())?.invoice_checked_at).toBe(NOW.toISOString());

    // Within the hour it is not offered again; after it, it is.
    await raiseInvoices(env.DB, fsm, later(RECHECK_AFTER_MS / 2), createLogger());
    expect(fsm.made.invoiced).toEqual([]);
    await raiseInvoices(env.DB, createStubFsm(EMPTY_FSM), later(RECHECK_AFTER_MS * 2), createLogger());
    expect((await row())?.fsm_invoice_id).toMatch(/^stub-invoice-/);
  });

  it("logs a refusal for ops and leaves the visit for the next hour, rather than failing the pass", async () => {
    await visit(VISIT, "completed");
    const fsm = {
      ...createStubFsm(EMPTY_FSM),
      invoiceWorkOrder: () => Promise.reject(new ZohoError(400, "2031", "One or more line items are already invoiced")),
    };

    expect(await raiseInvoices(env.DB, fsm, NOW, createLogger())).toEqual({ invoiced: 0 });
    expect(logs.lines()).toContainEqual(expect.objectContaining({ event: "invoice_refused", code: "2031" }));
    expect(await row()).toEqual({ fsm_invoice_id: null, invoice_checked_at: NOW.toISOString() });
  });

  it("fails the pass loudly when FSM is the one that is broken, so the next run tries again", async () => {
    await visit(VISIT, "completed");
    const fsm = createStubFsm(EMPTY_FSM);
    fsm.failNext("invoiceWorkOrder", "FSM answered 500");

    await expect(raiseInvoices(env.DB, fsm, NOW, createLogger())).rejects.toThrow("FSM answered 500");
    expect((await row())?.invoice_checked_at).toBeNull();
  });
});
