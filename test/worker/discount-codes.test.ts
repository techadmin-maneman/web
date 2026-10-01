// Discount codes in the console (src/routes/ops-discount-codes.ts; docs/decisions/0108-discount-codes.md): ops make
// one or a batch, switch one off, and enter one on a client's visit or take it off before it is paid for or invoiced;
// and the invoice, which shows the price, the discount and the total. NOW is Monday 21 September 2026, 12 noon in
// India. Every name, number and code here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createAlertOnce, createResolveAlert } from "../../src/domain/alerts.ts";
import { enterOnVisit } from "../../src/domain/discount-code-uses.ts";
import { makeCodes, type NewCodes } from "../../src/domain/discount-codes.ts";
import { raiseInvoices } from "../../src/domain/fsm-invoices.ts";
import { createCallBudget } from "../../src/lib/call-budget.ts";
import { createLogger } from "../../src/log.ts";
import { CODE_ALPHABET } from "../../src/policy/discount-codes.ts";
import { createStubBooks, type BooksProvider } from "../../src/providers/books.ts";
import { createStubFsm, EMPTY_FSM } from "../../src/providers/fsm.ts";
import type { App } from "../../src/http/context.ts";
import { appFor, captureLogs, fakeDependencies, markDatabase, NOW, request } from "./helpers.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const VISIT = "22222222-2222-4222-8222-222222222222";

let ops: App;

const post = (path: string, body?: unknown) =>
  request(ops, path, {
    method: "POST",
    headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

interface Listed {
  id: string;
  code: string;
  max_uses: number | null;
  batch_id: string | null;
  switched_off: { by: string } | null;
  uses: number;
  given: number;
}

const listed = async (query = "") =>
  (await (await request(ops, `/api/discount-codes${query}`)).json<{ codes: Listed[] }>()).codes;

const audited = (action: string) =>
  env.DB.prepare("SELECT actor, subject_kind, subject_id, detail FROM audit_log WHERE action = ?1")
    .bind(action)
    .all<{ actor: string; subject_kind: string; subject_id: string; detail: string }>();

/** Ten per cent off service visits, made in the console. */
const TEN_OFF = {
  code: "TENPC",
  kind: "percent",
  value: 10,
  covers: ["service"],
  once_per_client: true,
};

const make = (code: Partial<NewCodes> = {}) =>
  makeCodes(
    env.DB,
    {
      code: "TENPC",
      count: 1,
      kind: "percent",
      value: 10,
      cap: null,
      covers: ["service"],
      expiresOn: null,
      maxUses: null,
      oncePerClient: true,
      ...code,
    },
    { actor: { kind: "staff", id: "ops@localhost" }, requestId: "r", now: NOW },
  );

/** Rohit's service visit on Wednesday 23 September, as the mirror holds it, not yet paid for. */
async function clientWithVisit(status = "scheduled") {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810000001', 'Rohit Malhotra')",
    ).bind(PERSON, NOW.toISOString()),
    env.DB.prepare(
      `INSERT INTO appointments (id, fsm_id, fsm_work_order_id, person_id, type, tier, status, fsm_status,
         window_start, window_end, fsm_modified_at, synced_at)
       VALUES (?1, 'fsm-1', 'fsm-wo-1', ?2, 'service', 'standard', ?3, ?3, '2026-09-23T04:30:00.000Z',
         '2026-09-23T06:00:00.000Z', ?4, ?4)`,
    ).bind(VISIT, PERSON, status, NOW.toISOString()),
  ]);
}

beforeEach(async () => {
  await markDatabase();
  captureLogs();
  ops = appFor("local", fakeDependencies(), {}, "ops");
});

describe("Settings · Discount codes", () => {
  it("makes a code ops typed, in capitals, and audits it with IDs and codes only", async () => {
    const made = await post("/api/discount-codes", { ...TEN_OFF, code: "tenpc", expires_on: "2026-12-31" });
    expect(made.status).toBe(201);
    expect(await made.json()).toEqual({ codes: ["TENPC"] });
    expect(await listed()).toMatchObject([
      { code: "TENPC", max_uses: null, batch_id: null, switched_off: null, uses: 0, given: 0 },
    ]);
    const [entry] = (await audited("discount_code.make")).results;
    expect(entry).toMatchObject({ actor: "ops@localhost", subject_kind: "discount_code" });
    expect(JSON.parse(entry?.detail ?? "{}")).toEqual({ count: 1, codes: "TENPC" });
  });

  it("generates a batch of single-use codes, of letters and digits no one misreads", async () => {
    const made = await post("/api/discount-codes", { ...TEN_OFF, code: undefined, count: 5, max_uses: 1 });
    const { codes } = await made.json<{ codes: string[] }>();
    expect(codes).toHaveLength(5);
    for (const code of codes) expect(code).toMatch(new RegExp(`^[${CODE_ALPHABET}]{8}$`));
    const batch = await listed();
    expect(new Set(batch.map((code) => code.batch_id)).size).toBe(1);
    expect(batch.every((code) => code.max_uses === 1)).toBe(true);
    expect((await audited("discount_code.make")).results).toHaveLength(1);
  });

  it("refuses what a code cannot be, naming the box", async () => {
    for (const [body, field] of [
      [{ ...TEN_OFF, code: "WEDDING25" }, "code"],
      [{ ...TEN_OFF, count: 2 }, "count"],
      [{ ...TEN_OFF, value: 101 }, "value"],
      [{ ...TEN_OFF, kind: "amount", value: 50_000, cap: 10_000 }, "cap"],
      [{ ...TEN_OFF, covers: ["service", "service"] }, "covers"],
      [{ ...TEN_OFF, expires_on: "2026-09-20" }, "expires_on"],
      [{ ...TEN_OFF, code: undefined, count: 3, max_uses: 2 }, "max_uses"],
    ] as const) {
      const answer = await post("/api/discount-codes", body);
      expect(answer.status, field).toBe(400);
      expect((await answer.json<{ error: { fields: string[] } }>()).error.fields).toEqual([field]);
    }
    expect(await listed()).toEqual([]);
  });

  it("refuses a code that exists already, whatever its case", async () => {
    await post("/api/discount-codes", TEN_OFF);
    const again = await post("/api/discount-codes", { ...TEN_OFF, code: "tenPc" });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: { code: "code_exists" } });
  });

  it("switches a code off, after which it does not apply, and keeps its uses", async () => {
    await clientWithVisit();
    await make();
    await enterOnVisit(env.DB, { visitId: VISIT, text: "TENPC", by: { kind: "ops", id: "ops@localhost" } }, NOW);
    const [code] = await listed();
    expect((await post(`/api/discount-codes/${code?.id ?? ""}/off`)).status).toBe(204);
    expect((await post(`/api/discount-codes/${code?.id ?? ""}/off`)).status).toBe(204);
    expect(await listed()).toMatchObject([{ switched_off: { by: "ops@localhost" }, uses: 1, given: 20_000 }]);
    expect((await audited("discount_code.switch_off")).results).toHaveLength(1);

    await post(`/api/visits/${VISIT}/discount-code/remove`);
    const again = await post(`/api/visits/${VISIT}/discount-code`, { code: "TENPC" });
    expect(again.status).toBe(422);
  });

  it("finds one code by its text, however old", async () => {
    await make();
    await make({ code: "FVEPC", value: 5 });
    expect((await listed("?code=fvepc")).map((code) => code.code)).toEqual(["FVEPC"]);
  });
});

describe("a code on a client's visit, in the console", () => {
  beforeEach(async () => {
    await clientWithVisit();
    await make();
  });

  const clientVisit = async () => {
    const record = await (
      await request(ops, `/api/clients/${PERSON}`)
    ).json<{
      visits: { upcoming: { id: string; discount_code: unknown; price_open: boolean }[] };
    }>();
    return record.visits.upcoming.find((visit) => visit.id === VISIT);
  };

  it("enters one on a visit not yet paid for, which the client's page then shows, and audits it", async () => {
    expect(await clientVisit()).toMatchObject({ discount_code: null, price_open: true });
    const entered = await post(`/api/visits/${VISIT}/discount-code`, { code: "tenpc" });
    expect(entered.status).toBe(200);
    expect(await entered.json()).toEqual({ code: "TENPC", amount_off: 20_000, given_by: "ops" });
    expect(await clientVisit()).toMatchObject({
      discount_code: { code: "TENPC", amount_off: 20_000, given_by: "ops" },
      price_open: true,
    });
    const [entry] = (await audited("discount_code.apply")).results;
    expect(entry).toMatchObject({ actor: "ops@localhost", subject_kind: "appointment", subject_id: VISIT });
    expect(JSON.parse(entry?.detail ?? "{}")).toEqual({ code: "TENPC" });
  });

  it("takes it off again, audited, and the use stays on record, marked removed", async () => {
    await post(`/api/visits/${VISIT}/discount-code`, { code: "TENPC" });
    expect((await post(`/api/visits/${VISIT}/discount-code/remove`)).status).toBe(204);
    expect(await clientVisit()).toMatchObject({ discount_code: null });
    const use = await env.DB.prepare("SELECT removed_by, removed_by_id FROM discount_code_uses").first();
    expect(use).toEqual({ removed_by: "ops", removed_by_id: "ops@localhost" });
    expect((await audited("discount_code.remove")).results).toHaveLength(1);
    expect((await post(`/api/visits/${VISIT}/discount-code/remove`)).status).toBe(404);
  });

  it("takes neither once the visit is paid for, nor once it is invoiced", async () => {
    await env.DB.prepare(
      `INSERT INTO payments (id, person_id, appointment_id, razorpay_payment_id, amount, currency, status, captured_at,
         created_at, updated_at)
       VALUES ('pay-1', ?1, ?2, 'pay_1', 200000, 'INR', 'captured', ?3, ?3, ?3)`,
    )
      .bind(PERSON, VISIT, NOW.toISOString())
      .run();
    const paid = await post(`/api/visits/${VISIT}/discount-code`, { code: "TENPC" });
    expect(paid.status).toBe(409);
    expect(await paid.json()).toMatchObject({ error: { code: "price_settled" } });
    expect(await clientVisit()).toMatchObject({ price_open: false });

    await env.DB.batch([
      env.DB.prepare("DELETE FROM payments"),
      env.DB.prepare("UPDATE appointments SET fsm_invoice_id = 'inv-1' WHERE id = ?1").bind(VISIT),
    ]);
    expect((await post(`/api/visits/${VISIT}/discount-code`, { code: "TENPC" })).status).toBe(409);
  });

  it("takes one code a visit", async () => {
    await make({ code: "FVEPC", value: 5 });
    await post(`/api/visits/${VISIT}/discount-code`, { code: "TENPC" });
    const second = await post(`/api/visits/${VISIT}/discount-code`, { code: "FVEPC" });
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ error: { code: "already_discounted" } });
  });
});

describe("the invoice of a visit a code was entered on", () => {
  /** After the visit, on Wednesday 23 September, when staging's book has no GST. */
  const AFTER = new Date("2026-09-23T08:00:00.000Z");
  let alerted: string[];

  function invoicePass(books: BooksProvider) {
    alerted = [];
    const alert = (message: string) => {
      alerted.push(message);
      return Promise.resolve();
    };
    const alertOnce = createAlertOnce({
      db: env.DB,
      alert,
      now: () => AFTER,
      environment: "local",
      log: createLogger(),
    });
    const resolveAlert = createResolveAlert({ db: env.DB, now: () => AFTER });
    const fsm = createStubFsm({ ...EMPTY_FSM, totals: { "fsm-wo-1": 200_000 } });
    return raiseInvoices(env.DB, { fsm, books, alertOnce, resolveAlert }, AFTER, createLogger(), createCallBudget(40));
  }

  beforeEach(async () => {
    await clientWithVisit();
    await make();
    await enterOnVisit(env.DB, { visitId: VISIT, text: "TENPC", by: { kind: "ops", id: "ops@localhost" } }, NOW);
    await env.DB.prepare("UPDATE appointments SET status = 'completed' WHERE id = ?1").bind(VISIT).run();
  });

  it("takes the code off the visit's line in Books before GST, then sends it: price, discount and total", async () => {
    const books = createStubBooks({ draftTotal: 200_000 });
    expect(await invoicePass(books)).toEqual({ raised: 1, issued: 1 });
    expect(books.made.discounts).toEqual([
      { invoiceId: expect.stringMatching(/^stub-invoice-/) as string, amountOff: 20_000 },
    ]);
    expect(books.made.issued).toHaveLength(1);
  });

  it("sends the invoice of a visit paid at the discounted price", async () => {
    await env.DB.prepare(
      `INSERT INTO payments (id, person_id, appointment_id, razorpay_payment_id, amount, currency, status, captured_at,
         created_at, updated_at)
       VALUES ('pay-1', ?1, ?2, 'pay_1', 180000, 'INR', 'captured', ?3, ?3, ?3)`,
    )
      .bind(PERSON, VISIT, NOW.toISOString())
      .run();
    const books = createStubBooks({ draftTotal: 200_000 });
    expect(await invoicePass(books)).toEqual({ raised: 1, issued: 1 });
  });

  it("holds the draft and tells ops what to set when Books will not take the discount", async () => {
    const books: BooksProvider = {
      ...createStubBooks({ draftTotal: 200_000 }),
      discountInvoice: () => Promise.reject(new Error("timeout")),
    };
    expect(await invoicePass(books)).toEqual({ raised: 1, issued: 0 });
    expect(alerted).toHaveLength(1);
    expect(alerted[0]).toContain("TENPC");
    expect(alerted[0]).toContain("nothing here sends it");
  });

  it("holds the draft when what Books leaves is not what the client was sold the visit for", async () => {
    const books = createStubBooks({ draftTotal: 250_000 });
    expect(await invoicePass(books)).toEqual({ raised: 1, issued: 0 });
    expect(books.made.issued).toEqual([]);
  });
});
