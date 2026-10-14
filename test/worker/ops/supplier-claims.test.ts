// Claims on suppliers and returned pieces (src/routes/ops/purchasing.claims.ts, src/domain/purchasing/supplier-claims.ts,
// src/domain/inventory/returned-pieces.ts; docs/decisions/0169-supplier-claims.md). NOW is Monday 21 September 2026, 12
// noon in India, when the order arrives.
//
// What these hold: what arrives damaged or fails its check is claimed with its receipt, at the order's price; a claim
// is sent, then settled as a credit, a replacement or a refusal, or withdrawn before it is sent, each step once and
// audited only when it lands; a returned piece inside its supplier's warranty is claimed once, and its unit written
// off; and one out of warranty, or none of ours, is written off with why instead.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { jpegOf } from "../cards.ts";
import { A_NUMBER, markDatabase, NOW, request } from "../helpers.ts";
import { working, type Working } from "../job-fixtures.ts";

interface Claims {
  claims: {
    id: string;
    number: number;
    reason: string;
    quantity: number;
    unit_price: number;
    currency: string;
    order_number: number;
    piece_code: string | null;
    state: string;
    outcome: string | null;
    credit_amount: number | null;
  }[];
  returns: { id: string; piece_code: string; in_warranty: boolean; warranty_ends_on: string | null }[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

let job: Working;
let hair: string;

const claims = async () => (await request(job.ops, "/api/supplier-claims")).json<Claims>();
const codeOf = async (res: Response) => (await res.json<{ error: { code: string; fields?: string[] } }>()).error;

/** A USD supplier with a 90-day warranty, sent an order for two hair systems and ten of solvent, which arrives. */
async function received(): Promise<void> {
  const added = await job.opsPost("/api/suppliers", {
    name: "Lumina Hair Co",
    gstin: null,
    country: "CN",
    currency: "USD",
    contact_name: null,
    contact_phone: null,
    contact_email: null,
    payment_terms_days: 30,
    warranty_days: 90,
  });
  const supplier = (await added.json<{ suppliers: { id: string }[] }>()).suppliers[0]?.id ?? "";
  for (const [code, price] of [
    [hair, 12_000],
    ["solvent", 250],
  ] as const) {
    await job.opsPost(`/api/suppliers/${supplier}/items`, {
      consumable_code: code,
      their_code: null,
      unit_price: price,
      pack_size: 1,
      minimum_order: 1,
      lead_time_days: 14,
    });
  }
  const drafted = await job.opsPost("/api/purchase-orders", {
    supplier_id: supplier,
    lines: [
      { consumable_code: hair, quantity: 2 },
      { consumable_code: "solvent", quantity: 10 },
    ],
    expected_on: null,
    note: null,
  });
  const order = (await drafted.json<{ orders: { id: string; lines: { id: string }[] }[] }>()).orders[0];
  await env.DB.prepare("UPDATE purchase_orders SET state = 'sent', sent_at = ?2 WHERE id = ?1")
    .bind(order?.id ?? "", new Date(NOW.getTime() - 10 * DAY_MS).toISOString())
    .run();
  const [hairLine, solventLine] = order?.lines ?? [];
  const line = (id: string | undefined, counts: { received: number; damaged?: number; qc_failed?: number }) => ({
    po_line_id: id ?? "",
    damaged: 0,
    qc_failed: 0,
    lot_code: null,
    expires_on: null,
    ...counts,
  });
  const answer = await job.opsPost(`/api/purchase-orders/${order?.id ?? ""}/receipts`, {
    lines: [line(hairLine?.id, { received: 2 }), line(solventLine?.id, { received: 8, damaged: 1, qc_failed: 1 })],
    supplier_invoice: "LUM-2209",
    rupee_rate: 8325,
    freight_paise: 0,
    duty_paise: 0,
    clearing_paise: 0,
    note: null,
  });
  expect(answer.status).toBe(200);
}

/** A piece returned `days` after the order arrived and handed in at the warehouse: one of ours, or another label. */
async function returned(days: number, label?: string): Promise<{ id: string; label: string }> {
  const unit = await env.DB.prepare(
    "SELECT id, code FROM stock_units WHERE consumable_code = ?1 AND state = 'held' ORDER BY serial LIMIT 1",
  )
    .bind(hair)
    .first<{ id: string; code: string }>();
  const code = label ?? unit?.code ?? "";
  if (label === undefined) {
    await env.DB.prepare("UPDATE stock_units SET state = 'returned', place = 'central' WHERE id = ?1")
      .bind(unit?.id ?? "")
      .run();
  }
  const at = new Date(NOW.getTime() + days * DAY_MS).toISOString();
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO piece_returns (id, piece_code, appointment_id, technician_id, reason, returned_at, handed_in_at,
       handed_in_to)
     VALUES (?1, ?2, ?3, 't-1', 'Lifting at the front', ?4, ?4, 'central')`,
  )
    .bind(id, code, `visit-${id}`, at)
    .run();
  return { id, label: code };
}

/** A photograph stored as the console sends one; its ID. */
async function photographed(): Promise<string> {
  const stored = await request(job.ops, "/api/stock-photos", {
    method: "POST",
    headers: { Origin: "https://maneman.test", "Content-Type": "image/jpeg" },
    body: jpegOf(64, 48),
  });
  expect(stored.status).toBe(201);
  return (await stored.json<{ photo_id: string }>()).photo_id;
}

const unitState = (code: string) =>
  env.DB.prepare("SELECT state FROM stock_units WHERE code = ?1").bind(code).first<string>("state");

beforeEach(async () => {
  await markDatabase();
  job = await working();
  await job.opsPost("/api/consumables", { name: "Solvent", unit: "ml", unit_cost: 50 });
  await env.DB.prepare(
    `INSERT INTO services (kind, tier, name, minutes, sort, updated_by, updated_at)
     VALUES ('first_fit', 'essential', 'Mane Man Essential', 120, 1, 'test', ?1)`,
  )
    .bind(NOW.toISOString())
    .run();
  const added = await job.opsPost("/api/hair-systems", {
    product: "essential",
    base_width_in: 8,
    base_length_in: 10,
    colour: "1B",
    grey_percent: 20,
    density_percent: 100,
    unit_cost: 1_200_000,
  });
  hair = (await added.json<{ code: string }>()).code;
  await received();
});

describe("a claim on a supplier", () => {
  it("is drafted with its receipt for what arrived damaged and what failed its check, at the order's price", async () => {
    expect((await claims()).claims).toEqual([
      expect.objectContaining({ number: A_NUMBER, reason: "qc_failed", quantity: 1, unit_price: 250, currency: "USD" }),
      expect.objectContaining({
        number: A_NUMBER,
        reason: "damaged",
        quantity: 1,
        order_number: A_NUMBER,
        state: "drafted",
      }),
    ]);
  });

  it("is sent, then settled by the supplier's answer, or withdrawn before it is sent, each step once", async () => {
    const [failed, damaged] = (await claims()).claims;
    const sent = await job.opsPost(`/api/supplier-claims/${damaged?.id ?? ""}/send`, {
      note: "Photos emailed.",
      photo_id: null,
    });
    expect(sent.status).toBe(200);
    const again = await job.opsPost(`/api/supplier-claims/${damaged?.id ?? ""}/send`, { note: null, photo_id: null });
    expect([again.status, (await codeOf(again)).code]).toEqual([409, "claim_state"]);

    const unpriced = await job.opsPost(`/api/supplier-claims/${damaged?.id ?? ""}/decide`, {
      outcome: "credit",
      credit_amount: null,
      note: null,
    });
    expect((await codeOf(unpriced)).fields).toEqual(["credit_amount"]);
    const credited = await job.opsPost(`/api/supplier-claims/${damaged?.id ?? ""}/decide`, {
      outcome: "credit",
      credit_amount: 250,
      note: null,
    });
    expect((await credited.json<Claims>()).claims.find((each) => each.id === damaged?.id)).toMatchObject({
      state: "accepted",
      outcome: "credit",
      credit_amount: 250,
    });

    const early = await job.opsPost(`/api/supplier-claims/${failed?.id ?? ""}/decide`, {
      outcome: "rejected",
      credit_amount: null,
      note: null,
    });
    expect(early.status).toBe(409);
    await job.opsPost(`/api/supplier-claims/${failed?.id ?? ""}/withdraw`, { note: "Under a dollar." });
    expect((await claims()).claims.find((each) => each.id === failed?.id)?.state).toBe("withdrawn");

    const { results } = await env.DB.prepare(
      "SELECT action FROM audit_log WHERE subject_kind = 'supplier_claim' ORDER BY id",
    ).all<{ action: string }>();
    expect(results.map((row) => row.action)).toEqual([
      "supplier_claim.send",
      "supplier_claim.decide",
      "supplier_claim.withdraw",
    ]);
  });
});

describe("a returned piece", () => {
  it("inside its supplier's warranty is claimed on the supplier once, and its unit written off", async () => {
    const piece = await returned(30);
    expect((await claims()).returns).toEqual([
      expect.objectContaining({ id: piece.id, in_warranty: true, warranty_ends_on: "2026-12-20" }),
    ]);

    const claimed = await job.opsPost(`/api/returned-pieces/${piece.id}/claim`);
    const answer = await claimed.json<Claims>();
    expect(answer.returns).toEqual([]);
    expect(answer.claims[0]).toMatchObject({
      number: A_NUMBER,
      reason: "warranty",
      piece_code: piece.label,
      quantity: 1,
      unit_price: 12_000,
    });
    expect(await unitState(piece.label)).toBe("written_off");

    const again = await job.opsPost(`/api/returned-pieces/${piece.id}/claim`);
    expect([again.status, (await codeOf(again)).code]).toEqual([409, "return_settled"]);
  });

  it("out of warranty, or none of ours, is written off with why, never claimed", async () => {
    const late = await returned(100);
    const other = await returned(5, "OLD-0042");
    expect((await claims()).returns.map((each) => [each.piece_code, each.in_warranty])).toEqual([
      ["OLD-0042", false],
      [late.label, false],
    ]);

    const refused = await job.opsPost(`/api/returned-pieces/${late.id}/claim`);
    expect([refused.status, (await codeOf(refused)).code]).toEqual([409, "out_of_warranty"]);
    const unphotographed = await job.opsPost(`/api/returned-pieces/${late.id}/write-off`, {
      reason: "Torn base.",
      photo_id: crypto.randomUUID(),
    });
    expect((await codeOf(unphotographed)).fields).toEqual(["photo_id"]);
    for (const piece of [late, other]) {
      const body = { reason: "Torn base.", photo_id: await photographed() };
      const written = await job.opsPost(`/api/returned-pieces/${piece.id}/write-off`, body);
      expect(written.status).toBe(200);
    }
    expect((await claims()).returns).toEqual([]);
    expect(await unitState(late.label)).toBe("written_off");
    const reasons = await env.DB.prepare(
      "SELECT write_off_reason, photo_id IS NOT NULL AS photographed FROM piece_returns ORDER BY returned_at",
    ).all();
    expect(reasons.results).toEqual([
      { write_off_reason: "Torn base.", photographed: 1 },
      { write_off_reason: "Torn base.", photographed: 1 },
    ]);
  });
});

describe("a photograph of stock", () => {
  it("is stored as a JPEG or PNG and read back, never cached, and goes with a claim when it is sent", async () => {
    const id = await photographed();
    const read = await request(job.ops, `/api/stock-photos/${id}`);
    expect([read.status, read.headers.get("Content-Type"), read.headers.get("Cache-Control")]).toEqual([
      200,
      "image/jpeg",
      "private, no-store",
    ]);

    const notAPicture = await request(job.ops, "/api/stock-photos", {
      method: "POST",
      headers: { Origin: "https://maneman.test", "Content-Type": "image/jpeg" },
      body: "plain words",
    });
    expect([notAPicture.status, (await codeOf(notAPicture)).code]).toEqual([422, "photo_invalid_file"]);
    expect((await request(job.ops, `/api/stock-photos/${crypto.randomUUID()}`)).status).toBe(404);

    const [, damaged] = (await claims()).claims;
    const sent = await job.opsPost(`/api/supplier-claims/${damaged?.id ?? ""}/send`, { note: null, photo_id: id });
    expect((await sent.json<Claims & { claims: { photo_id: string | null }[] }>()).claims[1]?.photo_id).toBe(id);
  });
});

describe("the supplier scorecard", () => {
  it("reads the year's orders, what arrived damaged or failed its check, and the claims credited", async () => {
    const [, damaged] = (await claims()).claims;
    await job.opsPost(`/api/supplier-claims/${damaged?.id ?? ""}/send`, { note: null, photo_id: null });
    await job.opsPost(`/api/supplier-claims/${damaged?.id ?? ""}/decide`, {
      outcome: "credit",
      credit_amount: 250,
      note: null,
    });
    const read = await request(job.ops, "/api/supplier-scorecard");
    expect((await read.json<{ suppliers: unknown[] }>()).suppliers).toEqual([
      {
        supplier_id: expect.any(String) as string,
        name: "Lumina Hair Co",
        currency: "USD",
        orders: 1,
        on_time_in_full_percent: null,
        lead_days: 10,
        promised_days: 14,
        failed_check_percent: 8,
        damaged_percent: 8,
        claims_settled: 1,
        claims_accepted: 1,
        credited: 250,
      },
    ]);
  });
});
