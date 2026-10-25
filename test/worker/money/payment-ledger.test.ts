// Finance's Payments ledger (src/routes/ops/payments.ts): every payment over a period, newest first, with where Books
// stands with it, and the payment links still unpaid; each kept to the caller's cities. Every name here is made up.

import { beforeEach, describe, expect, it } from "vitest";
import { captureLogs, markDatabase, NOW, request } from "../helpers.ts";
import { aPayment, aPaymentLink, aPerson, aVisit } from "../fixtures/index.ts";
import { enforce, listStaff, opsAs, person } from "../ops/staff-fixtures.ts";

interface Ledger {
  from: string;
  to: string;
  payments: { reference: string | null; person: { name: string } | null; books: string; amount: number }[];
  unpaid_links: { person: { name: string } | null; amount: number }[];
}

const ledger = async (as: string, query = "") =>
  (await request(opsAs(person(as)), `/api/payments/ledger${query}`)).json<Ledger>();

const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

beforeEach(async () => {
  captureLogs();
  await markDatabase();
  const rohit = crypto.randomUUID();
  const meera = crypto.randomUUID();
  await aPerson({ id: rohit, name: "Rohit Malhotra" });
  await aPerson({ id: meera, name: "Meera Iyer" });
  const gurgaon = crypto.randomUUID();
  const delhi = crypto.randomUUID();
  await aVisit({ id: gurgaon, person_id: rohit, service_city: "Gurgaon" });
  await aVisit({ id: delhi, person_id: meera, service_city: "Delhi", service_pincode: "110017" });
  await aPayment({
    person_id: rohit,
    appointment_id: gurgaon,
    reference: "MM-R-1",
    created_at: daysAgo(2),
    books_applied_at: daysAgo(1),
  });
  await aPayment({ person_id: meera, appointment_id: delhi, reference: "MM-R-2", created_at: daysAgo(1) });
  await aPayment({ person_id: rohit, appointment_id: gurgaon, reference: "MM-R-0", created_at: daysAgo(60) });
  await aPaymentLink({ appointment_id: gurgaon, amount: 2_500_000 });
});

describe("the Payments ledger", () => {
  it("lists the last thirty days' payments, newest first, with where Books stands with each", async () => {
    const { payments, unpaid_links: links } = await ledger("owner@maneman.in");
    expect(payments.map((each) => [each.reference, each.person?.name, each.books])).toEqual([
      ["MM-R-2", "Meera Iyer", "waiting"],
      ["MM-R-1", "Rohit Malhotra", "applied"],
    ]);
    expect(links).toEqual([
      expect.objectContaining({
        person: { id: expect.any(String) as string, name: "Rohit Malhotra" },
        amount: 2_500_000,
      }),
    ]);
  });

  it("reads the period asked for, and refuses one that ends before it begins", async () => {
    const all = await ledger("owner@maneman.in", "?from=2026-07-01&to=2026-09-21");
    expect(all.payments.map((each) => each.reference)).toEqual(["MM-R-2", "MM-R-1", "MM-R-0"]);
    const backwards = await request(
      opsAs(person("owner@maneman.in")),
      "/api/payments/ledger?from=2026-09-21&to=2026-09-01",
    );
    expect(backwards.status).toBe(400);
  });

  it("keeps a city's Finance to their own city's payments and links", async () => {
    await listStaff("finance.gurgaon@maneman.in", ["finance:view:city:Gurgaon"]);
    await listStaff("owner@maneman.in", ["admin:manage:national"]);
    await enforce();
    const { payments, unpaid_links: links } = await ledger("finance.gurgaon@maneman.in");
    expect(payments.map((each) => each.reference)).toEqual(["MM-R-1"]);
    expect(links).toHaveLength(1);
  });
});
