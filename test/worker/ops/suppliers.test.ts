// Suppliers (src/routes/ops/suppliers.ts, src/domain/purchasing/suppliers.ts; docs/decisions/0165-suppliers.md). NOW is
// Monday 21 September 2026, 12 noon in India.
//
// What these hold: a supplier is added, changed and retired, never under another's name; what it supplies of a stock
// code is set afresh and taken off its list; a stock code nobody added is refused; and a consumable a supplier lists
// is not deleted.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { markDatabase, request } from "../helpers.ts";
import { working, type Working } from "../job-fixtures.ts";

let job: Working;

interface Suppliers {
  suppliers: {
    id: string;
    name: string;
    currency: string;
    warranty_days: number;
    retired_at: string | null;
    items: { consumable_code: string; unit_price: number; pack_size: number; lead_time_days: number }[];
  }[];
}

const SUPPLIER = {
  name: "Lumina Hair Co",
  gstin: null,
  country: "CN",
  currency: "USD",
  contact_name: "Wei Chen",
  contact_phone: "+8613800138000",
  contact_email: "orders@lumina.example",
  payment_terms_days: 30,
  warranty_days: 90,
};

const ITEM = {
  consumable_code: "solvent",
  their_code: "SV-500",
  unit_price: 1250,
  pack_size: 12,
  minimum_order: 24,
  lead_time_days: 21,
};

const fieldsOf = async (res: Response) => (await res.json<{ error: { fields?: string[] } }>()).error.fields;

beforeEach(async () => {
  await markDatabase();
  job = await working();
  await job.opsPost("/api/consumables", { name: "Solvent", unit: "ml", unit_cost: 50 });
});

describe("a supplier", () => {
  it("is added, changed and retired, never under another's name", async () => {
    const added = await job.opsPost("/api/suppliers", SUPPLIER);
    expect(added.status).toBe(200);
    const [supplier] = (await added.json<Suppliers>()).suppliers;
    expect(supplier).toMatchObject({ name: "Lumina Hair Co", currency: "USD", warranty_days: 90, retired_at: null });

    expect(await fieldsOf(await job.opsPost("/api/suppliers", { ...SUPPLIER, name: "lumina hair co" }))).toEqual([
      "name",
    ]);
    const bad = await job.opsPost("/api/suppliers", { ...SUPPLIER, name: "Other", gstin: "not-a-gstin" });
    expect(bad.status).toBe(400);

    const id = supplier?.id ?? "";
    const changed = await job.opsPost(`/api/suppliers/${id}`, { ...SUPPLIER, warranty_days: 180 });
    expect((await changed.json<Suppliers>()).suppliers[0]?.warranty_days).toBe(180);
    const retired = await job.opsPost(`/api/suppliers/${id}/retire`);
    expect((await retired.json<Suppliers>()).suppliers[0]?.retired_at).not.toBeNull();
    const restored = await job.opsPost(`/api/suppliers/${id}/restore`);
    expect((await restored.json<Suppliers>()).suppliers[0]?.retired_at).toBeNull();
    expect((await job.opsPost("/api/suppliers/nobody/retire")).status).toBe(404);
  });

  it("lists what it supplies, set afresh and taken off, and keeps a consumable it lists from deletion", async () => {
    const added = await job.opsPost("/api/suppliers", SUPPLIER);
    const id = (await added.json<Suppliers>()).suppliers[0]?.id ?? "";

    await job.opsPost(`/api/suppliers/${id}/items`, ITEM);
    const set = await job.opsPost(`/api/suppliers/${id}/items`, { ...ITEM, unit_price: 1300, lead_time_days: 14 });
    expect((await set.json<Suppliers>()).suppliers[0]?.items).toEqual([
      { ...ITEM, unit_price: 1300, lead_time_days: 14 },
    ]);
    const unknown = await job.opsPost(`/api/suppliers/${id}/items`, { ...ITEM, consumable_code: "glue" });
    expect(await fieldsOf(unknown)).toEqual(["consumable_code"]);

    const deleting = await job.opsPost("/api/consumables/solvent/delete");
    expect(deleting.status).toBe(409);

    const removed = await job.opsPost(`/api/suppliers/${id}/items/solvent/remove`);
    expect((await removed.json<Suppliers>()).suppliers[0]?.items).toEqual([]);
    const audit = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'supplier.%'",
    ).first<number>("n");
    expect(audit).toBe(4);
    expect((await request(job.ops, "/api/suppliers")).status).toBe(200);
  });
});
