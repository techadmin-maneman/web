// A discount code entered on a booking (docs/decisions/0108-discount-codes.md): by the client at the app's pay step,
// on the site's form for a consultation and fit in one visit, and by the technician before the visit's payment link.
// Each takes the code off before GST, and the order, the link and the payment carry what is left. NOW is Monday 21
// September 2026, 12 noon in India; staging's book has a service visit at Rs. 2,000 and a first fit at Rs. 30,000,
// with no GST, from the 22nd. Every name, number and code here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { paymentEntries, paymentEntry } from "../../../src/domain/money/client-payments.ts";
import { codeOnHold } from "../../../src/domain/money/discount-code-holds.ts";
import { priceAfterCode } from "../../../src/domain/money/discount-code-uses.ts";
import { offeredProducts } from "../../../src/domain/booking/services.ts";
import { outstandingTasks } from "../../../src/domain/ops/tasks.ts";
import { TASK_SLA_HOURS } from "../../../src/policy/tasks.ts";
import {
  appFor,
  captureLogs,
  fakeDependencies,
  fakeQueue,
  markDatabase,
  NOW,
  provedNumberCode,
  request,
} from "../helpers.ts";
import { asClient, signedIn, technician } from "../clients.ts";
import { at, make, cookies, uses } from "./discount-code-entries-fixtures.ts";

/** The client's page in the console, as ops read it behind Access. */
async function clientRecord(personId: string) {
  const answer = await request(appFor("local", fakeDependencies(), {}, "ops"), `/api/clients/${personId}`);
  expect(answer.status).toBe(200);
  return answer.json<{ visits: { upcoming: unknown[] } }>();
}

beforeEach(async () => {
  await markDatabase();
  captureLogs();
  cookies.clear();
});

describe("the site's form, for a consultation and fit in one visit", () => {
  const ADDRESS = {
    flat: "Flat 402",
    floor: "4",
    tower: "Tower C",
    line1: "Palm Grove Society",
    line2: null,
    landmark: "Opposite the park",
    locality: "Sector 65",
    city: "Gurgaon",
    pincode: "122018",
    access_notes: null,
  };
  /** The one visit, booked at once with its number proved by a code. */
  const book = async (body: { mobile?: string; [field: string]: unknown }, settings = {}) => {
    const mobile = body.mobile ?? "9810000002";
    return request(
      appFor("local", fakeDependencies(), settings, "public"),
      "/api/consultation",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Karan Bhatia",
          mobile,
          loss_extent: "crown",
          turnstile_token: "token",
          pincode: "122018",
          date: "2026-09-23",
          window: "morning",
          consent: true,
          address: ADDRESS,
          one_visit: true,
          number_code_id: await provedNumberCode(`+91${mobile}`),
          ...body,
        }),
      },
      { CRM_QUEUE: fakeQueue() },
    );
  };

  beforeEach(async () => {
    await technician();
    await env.DB.prepare(
      "INSERT INTO serviceable_pincodes (pincode, area, city, served, launched_at) VALUES ('122018', 'Sector 65', 'Gurgaon', 1, ?1)",
    )
      .bind(NOW.toISOString())
      .run();
  });

  /** TEN_OFF as the site's confirmation reads it. */
  const TENPC_STANDS = { code: "TENPC", kind: "percent", value: 10, cap: null };

  /** The site's one visit, booked with a code: the visit, and whose it is. */
  async function bookedWithCode(code: string) {
    await book({ discount_code: code });
    const hold = await env.DB.prepare("SELECT id, person_id FROM slot_holds").first<{
      id: string;
      person_id: string;
    }>();
    const visit = await env.DB.prepare("SELECT id FROM appointments").first<{ id: string }>();
    return { visitId: visit?.id ?? "", personId: hold?.person_id ?? "" };
  }

  /** A captured payment of the visit's: its price, or a late fee. */
  const paid = (id: string, booked: { visitId: string; personId: string }, kind: "visit" | "late_fee") =>
    env.DB.prepare(
      `INSERT INTO payments (id, person_id, appointment_id, razorpay_payment_id, amount, currency, status, kind,
         captured_at, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, 2700000, 'INR', 'captured', ?5, ?6, ?6, ?6)`,
    )
      .bind(id, booked.personId, booked.visitId, `pay_${id}`, kind, NOW.toISOString())
      .run();

  // The confirmation said nothing of a code the booking took.
  it("answers what an amount code takes off, for the confirmation to say", async () => {
    await make({ code: "AUDTEST", kind: "amount", value: 100_000, covers: ["first_fit"] });
    const answer = await book({ discount_code: "audtest" });
    expect(await answer.json()).toMatchObject({
      discount_code: { code: "AUDTEST", kind: "amount", value: 100_000, cap: null },
    });
  });

  // After paying, neither the app's entry nor ops' Payments said the code was taken.
  it("carries the code onto the payment its link took, and not onto a late fee", async () => {
    await make();
    const booked = await bookedWithCode("TENPC");
    const listed = { amount_ex_gst: 3_000_000, amount: 3_000_000, gst_percent: 0 };
    await env.DB.batch((await priceAfterCode(env.DB, booked.visitId, listed)).fix);
    await paid("pay-fit", booked, "visit");
    await paid("pay-fee", booked, "late_fee");

    const entries = await paymentEntries(env.DB, booked.personId, NOW);
    const codeOf = (id: string) => entries.find((entry) => entry.id === id);
    expect(codeOf("pay-fit")).toMatchObject({ discount_code: { code: "TENPC", amount_off: 300_000 } });
    expect(codeOf("pay-fee")).toMatchObject({ discount_code: null });
    expect(await paymentEntry(env.DB, booked.personId, "pay-fit", NOW)).toMatchObject({
      discount_code: { code: "TENPC", amount_off: 300_000 },
    });
  });

  // A number we know that books nothing hears what a new number would, its code included.
  it("answers a number we know, which books nothing, with the code as a new number hears it", async () => {
    await make();
    expect((await book({})).status).toBe(201);
    const again = await book({ discount_code: "tenpc", date: "2026-09-24" });
    expect(again.status).toBe(201);
    expect(await again.json()).toMatchObject({ state: "booked", one_visit: true, discount_code: TENPC_STANDS });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM slot_holds").first("n")).toBe(1);
    expect((await uses()).results).toEqual([]);
  });

  it("keeps the code on the booking, to come off the product's price at the link", async () => {
    await make();
    const answer = await book({ discount_code: "tenpc" });
    expect(answer.status).toBe(201);
    expect(await answer.json()).toMatchObject({ state: "booked", one_visit: true, discount_code: TENPC_STANDS });
    expect((await uses()).results).toEqual([
      { hold_id: expect.any(String) as string, appointment_id: null, amount_off: null, given_by: "client", removed: 0 },
    ]);
  });

  /** GET /api/me as the person the site's booking made. */
  async function homeOfBooker() {
    const person = await env.DB.prepare("SELECT id FROM people").first<string>("id");
    const answer = await asClient(await signedIn(person ?? ""), "/api/me");
    return answer.json<{
      consultation: { one_visit: unknown } | null;
      being_booked: { one_visit: unknown } | null;
      next_visit: { one_visit: unknown } | null;
    }>();
  }

  // Home said "We are booking your visit", with no price, while the site had said it was booked, and
  // every Home logged consultation_window_unknown.
  it("shows Home the one visit booked as itself, priced after the code it was booked with", async () => {
    await make();
    await book({ discount_code: "TENPC" });
    const logs = captureLogs();
    const me = await homeOfBooker();
    expect(me.being_booked).toBeNull();
    expect(me.next_visit?.one_visit).toEqual({ amount: 2_700_000, from: false, code: "TENPC" });
    expect(me.consultation).toBeNull();
    expect(logs.lines().filter((line) => line.event === "consultation_window_unknown")).toEqual([]);
  });

  it("shows Home the one visit asked for while booking is off, priced after the code typed", async () => {
    await make();
    await book({ discount_code: "TENPC" }, { selfServeBooking: false });
    const me = await homeOfBooker();
    expect(me.consultation?.one_visit).toEqual({ amount: 2_700_000, from: false, code: "TENPC" });
    expect(me.being_booked).toBeNull();
  });

  it("refuses the booking for a code that does not apply, naming the box, and writes nothing", async () => {
    await make({ code: "SVC25", covers: ["service"] });
    for (const body of [
      { discount_code: "SVC25" },
      { discount_code: "NOSUCH" },
      { one_visit: false, discount_code: "TENPC" },
    ]) {
      const answer = await book(body);
      expect(answer.status).toBe(422);
      expect(await answer.json()).toMatchObject({ error: { code: "code_not_applicable", fields: ["discount_code"] } });
    }
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM slot_holds").first("n")).toBe(0);
  });

  it("keeps the code on the request while booking is off, and the Tasks board names it", async () => {
    await make();
    const answer = await book({ discount_code: "TENPC" }, { selfServeBooking: false });
    expect(await answer.json()).toMatchObject({ state: "requested", discount_code: TENPC_STANDS });
    const asked = await env.DB.prepare("SELECT one_visit, discount_code FROM consultation_requests").first();
    expect(asked).toEqual({ one_visit: 1, discount_code: "TENPC" });
    expect((await uses()).results).toEqual([]);
    const { tasks } = await outstandingTasks(env.DB, NOW, TASK_SLA_HOURS);
    expect(tasks.filter((task) => task.group === "consultation_request")).toMatchObject([
      { detail: "2026-09-23 morning one_visit TENPC" },
    ]);
  });

  describe("a code kept on the request while booking is off, which ops book the one visit from", () => {
    const TOMORROW = at(24 * 60);

    /** Ops book the one visit the request asked for, from the console, with the code they typed. */
    const opsBook = async (personId: string, code: string | undefined) => {
      const deps = fakeDependencies({ now: () => TOMORROW });
      const [product] = await offeredProducts(env.DB, "2026-09-23");
      return request(
        appFor("local", deps, {}, "ops"),
        "/api/visits",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: "https://maneman.test" },
          body: JSON.stringify({
            client: personId,
            kind: "first_fit",
            tier: product?.tier,
            one_visit: true,
            date: "2026-09-23",
            window: "morning",
            ...(code === undefined ? {} : { code }),
          }),
        },
        { MESSAGE_QUEUE: fakeQueue() },
      );
    };

    /** The client's one visit, asked for on /book with the code while booking is off. */
    async function requested(code: string, mobile = "9810000002") {
      const answer = await book({ mobile, discount_code: code }, { selfServeBooking: false });
      expect(await answer.json()).toMatchObject({ state: "requested" });
      const personId = await env.DB.prepare("SELECT id FROM people WHERE mobile_e164 = ?1")
        .bind(`+91${mobile}`)
        .first<string>("id");
      return personId ?? "";
    }

    const auditDetail = async () =>
      JSON.parse(
        (await env.DB.prepare("SELECT detail FROM audit_log WHERE action = 'visit.book'").first<string>("detail")) ??
          "{}",
      ) as Record<string, string>;

    // The code was judged again when ops booked the visit, and refused once it had expired meanwhile.
    it("books it with the code though its last day has passed since the client typed it", async () => {
      await make({ expiresOn: "2026-09-21" });
      const personId = await requested("TENPC");

      const answer = await opsBook(personId, "tenpc");
      expect(answer.status).toBe(201);
      expect(await answer.json()).toMatchObject({ outcome: "booked" });
      const record = await clientRecord(personId);
      expect(record.visits.upcoming).toMatchObject([{ discount_code: { code: "TENPC", given_by: "ops" } }]);
      expect(await auditDetail()).toMatchObject({ code: "TENPC", code_typed_at: NOW.toISOString() });
    });

    it("books it with the code though ops switched the code off since", async () => {
      await make();
      const personId = await requested("TENPC");
      await env.DB.prepare("UPDATE discount_codes SET switched_off_at = ?1, switched_off_by = 'ops@localhost'")
        .bind(at(60).toISOString())
        .run();

      const answer = await opsBook(personId, "TENPC");
      expect(answer.status).toBe(201);
      const { hold_id: holdId } = await answer.json<{ hold_id: string }>();
      expect(await codeOnHold(env.DB, holdId)).toMatchObject({ code: "TENPC", amountOff: null });
    });

    it("judges a code the client did not give on /book as it stands now", async () => {
      await make();
      await make({ code: "OLDPC", expiresOn: "2026-09-21" });
      const personId = await requested("TENPC");

      const answer = await opsBook(personId, "OLDPC");
      expect(answer.status).toBe(422);
      expect(await answer.json()).toMatchObject({ error: { code: "code_not_applicable" } });
    });

    // Typing it kept no use, so a code whose last use went to another booking meanwhile has none left for this one.
    it("tells ops the code no longer applies once another booking took its last use, and holds nothing", async () => {
      await make({ code: "UNQ5", maxUses: 1, oncePerClient: false });
      const personId = await requested("UNQ5");
      expect((await book({ mobile: "9810000003", discount_code: "UNQ5" })).status).toBe(201);

      const answer = await opsBook(personId, "UNQ5");
      expect(answer.status).toBe(422);
      expect(await answer.json()).toMatchObject({ error: { code: "code_not_applicable" } });
      const held = await env.DB.prepare("SELECT COUNT(*) AS n FROM slot_holds WHERE person_id = ?1 AND state = 'held'")
        .bind(personId)
        .first("n");
      expect(held).toBe(0);
    });

    it("shows ops the code on the visit booked without it, and takes it there as it stood when typed", async () => {
      await make({ expiresOn: "2026-09-21" });
      const personId = await requested("TENPC");
      const booked = await (await opsBook(personId, undefined)).json<{ visit_id: string }>();

      const record = await clientRecord(personId);
      expect(record.visits.upcoming).toMatchObject([{ discount_code: null, requested_code: "TENPC" }]);
      const entered = await request(
        appFor("local", fakeDependencies({ now: () => TOMORROW }), {}, "ops"),
        `/api/visits/${booked.visit_id}/discount-code`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: "https://maneman.test" },
          body: JSON.stringify({ code: "TENPC" }),
        },
      );
      expect(entered.status).toBe(200);
      expect(await entered.json()).toMatchObject({ code: "TENPC", amount_off: null, given_by: "ops" });
    });
  });

  it("refuses a single-use code another client's booking already stands on", async () => {
    await make({ code: "UNQ5", maxUses: 1, oncePerClient: false });
    const theirs = await book({ discount_code: "UNQ5" });
    expect(await theirs.json()).toMatchObject({ discount_code: { code: "UNQ5" } });
    const mine = await book({ mobile: "9810000003", discount_code: "UNQ5" });
    expect(mine.status).toBe(422);
  });

  it("names the code on the visit ops see once it is booked", async () => {
    await make();
    expect((await book({ discount_code: "tenpc" })).status).toBe(201);
    const personId = await env.DB.prepare("SELECT person_id FROM slot_holds").first<string>("person_id");
    const record = await clientRecord(personId ?? "");
    expect(record.visits.upcoming).toMatchObject([
      { type: "first_fit", discount_code: { code: "TENPC", amount_off: null, given_by: "client" } },
    ]);
  });

  it("stays the visit's code once the visit is booked, and comes off the product's price there", async () => {
    await make();
    const { visitId } = await bookedWithCode("TENPC");
    const listed = { amount_ex_gst: 3_000_000, amount: 3_000_000, gst_percent: 0 };
    const after = await priceAfterCode(env.DB, visitId, listed);
    expect(after).toMatchObject({ off: 300_000, price: { amount: 2_700_000 } });
  });
});
