// What the client app says of a consultation and fit in one visit's money, and what ops do with its link: the price
// once fitted, after the visit's code, on Home and Visits; the payment owed once fitted, on Home and Payments; and
// the link copied from the Tasks board or texted again. MON-21, BK-15, UX-08, CP-01. NOW is Monday 21 September 2026,
// 12 noon in India; the visit is on Thursday the 24th. Every name, number and price is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { openSession } from "../../src/domain/sessions.ts";
import { outstandingTasks } from "../../src/domain/tasks.ts";
import { TASK_SLA_HOURS } from "../../src/policy/tasks.ts";
import { createStubPayments, type PaymentsProvider, type StubPayments } from "../../src/providers/payments.ts";
import { ProviderError } from "../../src/providers/provider-error.ts";
import { appFor, captureLogs, fakeDependencies, markDatabase, NOW, PROVIDERS_FOR, request } from "./helpers.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const VISIT = "22222222-2222-4222-8222-222222222222";
const LINK = "44444444-4444-4444-8444-444444444444";

/** The first fit staging's book holds from 22 September, at Rs. 30,000 with no GST. */
const STANDARD = 3_000_000;
/** A second hair system ops offer, at Rs. 45,000 with no GST. */
const NATURAL = { tier: "natural", name: "Mane Man Natural", amount: 4_500_000 };

beforeEach(async () => {
  captureLogs();
  await markDatabase();
  await env.DB.prepare(
    `INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810000001', 'Rohit Malhotra')`,
  )
    .bind(PERSON, NOW.toISOString())
    .run();
});

/** Rohit's visit on Thursday, 10 am to 1 pm in India, as our own database books it. */
async function visit(shape: { oneVisit?: string | null; status?: string; tier?: string } = {}) {
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, tier, status, window_start, window_end, synced_at,
       service_city, one_visit)
     VALUES (?1, ?1, ?2, 'first_fit', ?3, ?4, '2026-09-24T04:30:00.000Z', '2026-09-24T07:30:00.000Z', ?5, 'Gurgaon',
       ?6)`,
  )
    .bind(
      VISIT,
      PERSON,
      shape.tier ?? "standard",
      shape.status ?? "scheduled",
      NOW.toISOString(),
      shape.oneVisit ?? null,
    )
    .run();
}

async function offerNatural() {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO services (kind, tier, name, minutes, sort, updated_by, updated_at)
       VALUES ('first_fit', ?1, ?2, 180, 1, 'ops@localhost', ?3)`,
    ).bind(NATURAL.tier, NATURAL.name, NOW.toISOString()),
    env.DB.prepare(
      `INSERT INTO price_book (item, tier, amount_ex_gst, gst_percent, valid_from)
       VALUES ('first_fit', ?1, ?2, 0, '2026-09-01')`,
    ).bind(NATURAL.tier, NATURAL.amount),
  ]);
}

/** A tenth off first fits, entered on the visit, its amount not fixed until the link. */
async function tenPerCentOff() {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO discount_codes (id, code, kind, value, covers_first_fit, covers_service, covers_replacement,
         once_per_client, created_by, created_at)
       VALUES ('code-1', 'TENPC', 'percent', 10, 1, 0, 0, 1, 'ops@localhost', ?1)`,
    ).bind(NOW.toISOString()),
    env.DB.prepare(
      `INSERT INTO discount_code_uses (id, code_id, person_id, appointment_id, given_by, given_by_id, created_at)
       VALUES ('use-1', 'code-1', ?1, ?2, 'client', ?1, ?3)`,
    ).bind(PERSON, VISIT, NOW.toISOString()),
  ]);
}

/** The visit closed with Rohit fitted with the Natural, its link as the close left it. */
async function fittedWithLink(link: { sent?: boolean; refused?: boolean; paid?: boolean } = {}) {
  await visit({ oneVisit: "fitted", status: "completed", tier: NATURAL.tier });
  const at = NOW.toISOString();
  await env.DB.prepare(
    `INSERT INTO payment_links (id, appointment_id, tier, amount, amount_ex_gst, gst_percent, razorpay_link_id,
       short_url, sent_at, refused_at, paid_at, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?4, 0, ?5, ?6, ?7, ?8, ?9, ?10, ?10)`,
  )
    .bind(
      LINK,
      VISIT,
      NATURAL.tier,
      NATURAL.amount,
      link.sent === false ? null : "plink_made",
      link.sent === false ? null : "https://rzp.io/i/made",
      link.sent === false ? null : at,
      link.refused === true ? at : null,
      link.paid === true ? at : null,
      at,
    )
    .run();
}

async function clientGet<Body>(path: string): Promise<Body> {
  const cookie = `mm_app=${await openSession(env.DB, { kind: "client", subjectId: PERSON, deviceLabel: null, now: NOW })}`;
  const app = appFor("local", fakeDependencies(), {}, "client", PROVIDERS_FOR.ours);
  const answer = await request(app, path, { headers: { Cookie: cookie } });
  expect(answer.status).toBe(200);
  return answer.json<Body>();
}

interface Me {
  next_visit: { type: string; length_minutes: number; one_visit: unknown } | null;
  payment_owed: unknown;
}

describe("a one visit still to come", () => {
  it("says on Home what the hair system costs once fitted, only if the client goes ahead", async () => {
    await visit({ oneVisit: "booked" });
    const me = await clientGet<Me>("/api/me");
    expect(me.next_visit).toMatchObject({
      type: "first_fit",
      length_minutes: 180,
      one_visit: { amount: STANDARD, from: false, code: null },
    });
    expect(me.payment_owed).toBeNull();
  });

  it("says where the prices start when the hair systems offered differ", async () => {
    await offerNatural();
    await visit({ oneVisit: "booked" });
    const me = await clientGet<Me>("/api/me");
    expect(me.next_visit?.one_visit).toEqual({ amount: STANDARD, from: true, code: null });
  });

  it("takes the visit's code off before GST, as its link will, and names the code", async () => {
    await visit({ oneVisit: "booked" });
    await tenPerCentOff();
    const me = await clientGet<Me>("/api/me");
    expect(me.next_visit?.one_visit).toEqual({ amount: 2_700_000, from: false, code: "TENPC" });
  });

  it("lists it on Visits with its price, and any other visit with none", async () => {
    await visit({ oneVisit: "booked" });
    const visits = await clientGet<{ upcoming: { id: string; one_visit: unknown }[] }>("/api/visits");
    expect(visits.upcoming).toEqual([
      expect.objectContaining({ id: VISIT, one_visit: { amount: STANDARD, from: false, code: null } }),
    ]);
  });

  it("is no one visit on a first fit booked as itself", async () => {
    await visit();
    const me = await clientGet<Me>("/api/me");
    expect(me.next_visit?.one_visit).toBeNull();
  });

  it("is said to be paid by link even before ops price any hair system for its day", async () => {
    await env.DB.prepare("DELETE FROM price_book WHERE item = 'first_fit'").run();
    await visit({ oneVisit: "booked" });
    const me = await clientGet<Me>("/api/me");
    expect(me.next_visit?.one_visit).toEqual({ amount: null, from: false, code: null });
  });
});

describe("a one visit the client was fitted at", () => {
  it("is owed on Home and on Payments, with the link Razorpay texted", async () => {
    await offerNatural();
    await fittedWithLink();
    const owed = {
      visit_id: VISIT,
      date: "2026-09-24",
      amount: NATURAL.amount,
      product: "Mane Man Natural hair system",
      url: "https://rzp.io/i/made",
    };
    expect((await clientGet<Me>("/api/me")).payment_owed).toEqual(owed);
    expect((await clientGet<{ owed: unknown[] }>("/api/payments")).owed).toEqual([owed]);
  });

  it("is owed with no link while Razorpay has still to make one", async () => {
    await offerNatural();
    await fittedWithLink({ sent: false });
    expect((await clientGet<Me>("/api/me")).payment_owed).toMatchObject({ url: null, amount: NATURAL.amount });
  });

  it("is owed no more once paid", async () => {
    await offerNatural();
    await fittedWithLink({ paid: true });
    expect((await clientGet<Me>("/api/me")).payment_owed).toBeNull();
    expect((await clientGet<{ owed: unknown[] }>("/api/payments")).owed).toEqual([]);
  });
});

describe("the Payment owed task", () => {
  const detail = async () => {
    const { tasks } = await outstandingTasks(env.DB, NOW, TASK_SLA_HOURS);
    return tasks.find((task) => task.group === "payment_owed")?.detail;
  };

  it("names the link's state, amount, address and product, for ops to copy or send again", async () => {
    await offerNatural();
    await fittedWithLink();
    expect(await detail()).toBe("sent 4500000 https://rzp.io/i/made Mane Man Natural");
  });

  it("has no address while the link is unmade, and says when Razorpay refused it", async () => {
    await offerNatural();
    await fittedWithLink({ sent: false });
    expect(await detail()).toBe("unsent 4500000 - Mane Man Natural");
    await env.DB.prepare("UPDATE payment_links SET refused_at = ?1").bind(NOW.toISOString()).run();
    expect(await detail()).toBe("refused 4500000 - Mane Man Natural");
  });
});

describe("POST /api/payment-links/:id/resend", () => {
  function resend(payments: PaymentsProvider = createStubPayments(), id = LINK) {
    const app = appFor("local", fakeDependencies({ payments }), {}, "ops", PROVIDERS_FOR.ours);
    return request(app, `/api/payment-links/${id}/resend`, {
      method: "POST",
      headers: { Origin: "https://maneman.test" },
    });
  }

  it("has Razorpay text the link it made again", async () => {
    await offerNatural();
    await fittedWithLink();
    const payments = createStubPayments();
    const answer = await resend(payments);
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ outcome: "resent" });
    expect(payments.made.resent).toEqual(["plink_made"]);
  });

  it("makes now a link the close could not have made, and keeps its address", async () => {
    await offerNatural();
    await fittedWithLink({ sent: false });
    const payments: StubPayments = createStubPayments();
    expect(await (await resend(payments)).json()).toEqual({ outcome: "sent" });
    expect(payments.made.links).toHaveLength(1);
    const kept = await env.DB.prepare("SELECT short_url, sent_at FROM payment_links WHERE id = ?1")
      .bind(LINK)
      .first<{ short_url: string | null; sent_at: string | null }>();
    expect(kept?.short_url).toMatch(/^https:\/\/rzp\.io\/i\//);
    expect(kept?.sent_at).not.toBeNull();
  });

  it("sends nothing for a link already paid, or one Razorpay refused", async () => {
    await offerNatural();
    await fittedWithLink({ paid: true });
    const payments = createStubPayments();
    expect(await (await resend(payments)).json()).toEqual({ outcome: "paid" });
    await env.DB.prepare("UPDATE payment_links SET paid_at = NULL, refused_at = ?1").bind(NOW.toISOString()).run();
    expect(await (await resend(payments)).json()).toEqual({ outcome: "refused" });
    expect(payments.made.resent).toEqual([]);
  });

  it("answers 503 when Razorpay does not answer, and 404 for a link of nobody's", async () => {
    await offerNatural();
    await fittedWithLink();
    const down: PaymentsProvider = {
      ...createStubPayments(),
      resendPaymentLink: () => Promise.reject(new ProviderError(503, "SERVER_ERROR", "down")),
    };
    expect((await resend(down)).status).toBe(503);
    expect((await resend(createStubPayments(), "55555555-5555-4555-8555-555555555555")).status).toBe(404);
  });
});
