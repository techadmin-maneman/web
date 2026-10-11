// The nightly reporting copy, written to the stub store: what a visit and a payment become, who is left out, and a
// second night that changes only what changed. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { clientKeys } from "../../../src/domain/analytics/client-key.ts";
import { copyTonight, nightlyDueOn } from "../../../src/domain/analytics/nightly.ts";
import { createStubWarehouse } from "../../../src/providers/warehouse/stub.ts";
import { client, IMRAN, technician } from "../clients.ts";
import { NOW } from "../helpers.ts";
import { visit } from "../visits.ts";

const SECRET = "a reporting key secret for the tests, long enough";
const night = { secret: SECRET, date: "2026-09-21", now: () => NOW };

async function payment(id: string, personId: string, appointmentId: string, refunded = 0): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO payments (id, person_id, appointment_id, razorpay_payment_id, amount, amount_ex_gst, gst_percent,
       currency, method, status, refunded_amount, captured_at, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, 1180000, 1000000, 18, 'INR', 'upi', 'captured', ?5, ?6, ?6, ?6)`,
  )
    .bind(id, personId, appointmentId, `pay_${id}`, refunded, "2026-09-20T05:00:00.000Z")
    .run();
}

beforeEach(async () => {
  await technician();
  await client("p-rohit", "+919810000001", "Rohit Malhotra");
  await client("p-erased", "+919810000002", "Arjun Bedi");
  await client("p-test", "+919810000003", "Karan Test");
  await env.DB.batch([
    env.DB.prepare("UPDATE people SET erased_at = ?1 WHERE id = 'p-erased'").bind(NOW.toISOString()),
    env.DB.prepare("UPDATE people SET test_record = 1 WHERE id = 'p-test'"),
  ]);
  await visit("v-rohit", {
    person: "p-rohit",
    technician: IMRAN,
    start: "2026-09-20T04:30:00.000Z",
    status: "completed",
  });
  await visit("v-erased", { person: "p-erased", technician: IMRAN, start: "2026-09-22T04:30:00.000Z" });
  await visit("v-test", { person: "p-test", technician: IMRAN, start: "2026-09-23T04:30:00.000Z" });
  await payment("y-rohit", "p-rohit", "v-rohit");
  await payment("y-test", "p-test", "v-test");
});

describe("the nightly reporting copy", () => {
  it("is due in the hour from 3 am in India and no other", () => {
    expect(nightlyDueOn(new Date("2026-09-20T21:45:00Z"))).toBe("2026-09-21");
    expect(nightlyDueOn(new Date("2026-09-20T22:30:00Z"))).toBeNull();
  });

  it("copies visits and payments under a client key, leaving test records out", async () => {
    const warehouse = createStubWarehouse();
    const run = await copyTonight(env.DB, warehouse, night);
    const [rohit] = (await clientKeys(SECRET, ["p-rohit"])).values();

    const visits = [...(warehouse.tables.get("fact_visit")?.values() ?? [])];
    expect(visits.map((row) => row.visit_key).sort()).toEqual(["v-erased", "v-rohit"]);
    expect(visits.find((row) => row.visit_key === "v-rohit")).toMatchObject({
      client_key: rohit,
      visit_date: "2026-09-20",
      technician_key: IMRAN,
      is_done: true,
      city: "Gurgaon",
    });
    expect(visits.find((row) => row.visit_key === "v-erased")?.client_key).toBeNull();
    expect(rohit).toMatch(/^[0-9a-f]{32}$/);

    const payments = [...(warehouse.tables.get("fact_payment")?.values() ?? [])];
    expect(payments).toEqual([
      expect.objectContaining({ payment_key: "y-rohit", amount: 10000, gst: 1800, refunded: 0, client_key: rohit }),
    ]);
    expect([...(warehouse.tables.get("dim_client")?.keys() ?? [])]).toEqual([rohit]);
    expect(warehouse.tables.get("dim_technician")?.get(IMRAN)).toMatchObject({ first_day: "2026-09-20" });
    expect(warehouse.tables.get("dim_date")?.get("2026-09-20")).toMatchObject({
      week_start: "2026-09-14",
      quarter: "Q2",
      financial_year: "2026-27",
      weekday_name: "Sunday",
    });

    expect(run).toMatchObject({ date: "2026-09-21", totalsChecked: true, rowsChanged: run.rowsWritten });
    expect(warehouse.runs).toHaveLength(1);
    expect(await warehouse.ranOn("2026-09-21")).toBe(true);
  });

  it("changes on a second night only the rows whose values changed", async () => {
    const warehouse = createStubWarehouse();
    await copyTonight(env.DB, warehouse, night);
    await env.DB.prepare("UPDATE payments SET refunded_amount = 500000 WHERE id = 'y-rohit'").run();

    const again = await copyTonight(env.DB, warehouse, night);

    expect(again.rowsChanged).toBe(1);
    expect(warehouse.tables.get("fact_payment")?.get("y-rohit")?.refunded).toBe(5000);
  });

  it("makes the same key for a client every night, and another under another secret", async () => {
    const tonight = await clientKeys(SECRET, ["p-rohit"]);
    const tomorrow = await clientKeys(SECRET, ["p-rohit"]);
    const elsewhere = await clientKeys(`${SECRET}, but another`, ["p-rohit"]);
    expect(tomorrow.get("p-rohit")).toBe(tonight.get("p-rohit"));
    expect(elsewhere.get("p-rohit")).not.toBe(tonight.get("p-rohit"));
  });
});
