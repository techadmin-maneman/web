// The edges of a one visit's payment link (src/domain/money/payment-links.ts) that the visit's own flow seldom reaches: a
// product ops no longer offer, a link Razorpay refused, a code that frees the visit twice, the cron out of calls, a
// link paid that names no visit of ours, and a receipt with nothing to say yet. NOW is Monday 21 September 2026,
// 12 noon in India; every name, number and price is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  composeLinkPaid,
  hairSystemName,
  linkPaid,
  resendLink,
  sendPaymentLink,
  sendUnsentLinks,
  type FittedVisit,
  type LinkDeps,
} from "../../../src/domain/money/payment-links.ts";
import { createCallBudget } from "../../../src/lib/call-budget.ts";
import { createLogger } from "../../../src/log.ts";
import { captureLogs, fakeDependencies, LOCAL_SETTINGS, markDatabase, NOW, type TestDependencies } from "../helpers.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const VISIT = "22222222-2222-4222-8222-222222222222";
const LINK = "44444444-4444-4444-8444-444444444444";
const FITTED: FittedVisit = { appointmentId: VISIT, personId: PERSON, tier: "standard", day: "2026-09-24" };

let deps: TestDependencies;

function linkDeps(allowlist: readonly string[] = []): LinkDeps {
  return { ...deps, log: createLogger(), messagingSettings: { ...LOCAL_SETTINGS.messaging, allowlist } };
}

beforeEach(async () => {
  captureLogs();
  await markDatabase();
  deps = fakeDependencies();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810000001', 'Rohit Malhotra')",
    ).bind(PERSON, NOW.toISOString()),
    env.DB.prepare(
      `INSERT INTO appointments (id, fsm_id, person_id, type, tier, status, window_start, window_end, synced_at,
         service_city, one_visit)
       VALUES (?1, ?1, ?2, 'first_fit', 'standard', 'completed', '2026-09-24T04:30:00.000Z', '2026-09-24T07:30:00.000Z',
         ?3, 'Gurgaon', 'fitted')`,
    ).bind(VISIT, PERSON, NOW.toISOString()),
  ]);
});

/** The visit's link as the close wrote it: Rs. 30,000, with what Razorpay has done with it so far. */
async function link(state: { refusedAt?: string; sentAt?: string; razorpayLinkId?: string; tier?: string } = {}) {
  await env.DB.prepare(
    `INSERT INTO payment_links (id, appointment_id, tier, amount, amount_ex_gst, gst_percent, razorpay_link_id, sent_at,
       refused_at, created_at, updated_at)
     VALUES (?1, ?2, ?3, 3000000, 3000000, 0, ?4, ?5, ?6, ?7, ?7)`,
  )
    .bind(
      LINK,
      VISIT,
      state.tier ?? "standard",
      state.razorpayLinkId ?? null,
      state.sentAt ?? null,
      state.refusedAt ?? null,
      NOW.toISOString(),
    )
    .run();
}

describe("the hair system a link names", () => {
  it("is a hair system when the product has no name, and is not named twice", () => {
    expect(hairSystemName(undefined)).toBe("Hair system");
    expect(hairSystemName("Mane Man Natural hair system")).toBe("Mane Man Natural hair system");
    expect(hairSystemName("Mane Man Natural")).toBe("Mane Man Natural hair system");
  });
});

describe("a link at the visit's close", () => {
  it("is not made for a product the book has no price for, and ops are told by the product's code", async () => {
    const sent = await sendPaymentLink(env.DB, linkDeps(), { ...FITTED, tier: "retired_system" }, NOW);

    expect(sent).toBe("unpriced");
    expect(deps.alerts).toEqual([expect.stringContaining("fitted with retired_system, which the price book has no")]);
  });

  it("is not asked for again once Razorpay refused it", async () => {
    await link({ refusedAt: NOW.toISOString() });

    expect(await sendPaymentLink(env.DB, linkDeps(), FITTED, NOW)).toBe("refused");
  });

  it("tells the client once that nothing is owed, however often a code that frees the visit is closed", async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO discount_codes (id, code, kind, value, covers_first_fit, covers_service, covers_replacement,
           once_per_client, created_by, created_at)
         VALUES ('code-1', 'ONTHEHOUSE', 'percent', 100, 1, 0, 0, 1, 'ops@localhost', ?1)`,
      ).bind(NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO discount_code_uses (id, code_id, person_id, appointment_id, given_by, given_by_id, created_at)
         VALUES ('use-1', 'code-1', ?1, ?2, 'client', ?1, ?3)`,
      ).bind(PERSON, VISIT, NOW.toISOString()),
    ]);

    expect(await sendPaymentLink(env.DB, linkDeps(), FITTED, NOW)).toBe("free");
    expect(await sendPaymentLink(env.DB, linkDeps(), FITTED, NOW)).toBe("free");
    const told = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM outbound_messages WHERE subject_id = ?1 AND kind = 'nothing_to_pay'",
    )
      .bind(VISIT)
      .first<{ n: number }>();
    expect(told?.n).toBe(1);
  });
});

describe("the cron's links the close could not make", () => {
  it("asks for none once the run's calls are spent", async () => {
    await link();

    expect(await sendUnsentLinks(env.DB, linkDeps(), NOW, createCallBudget(0))).toBe(0);
    const row = await env.DB.prepare("SELECT sent_at FROM payment_links WHERE id = ?1").bind(LINK).first();
    expect(row).toEqual({ sent_at: null });
  });

  it("passes over a link whose visit has no client", async () => {
    await link();
    await env.DB.prepare("UPDATE appointments SET person_id = NULL WHERE id = ?1").bind(VISIT).run();

    expect(await sendUnsentLinks(env.DB, linkDeps(), NOW, createCallBudget(40))).toBe(0);
  });
});

describe("ops sending a link again", () => {
  it("does not have Razorpay text a number messaging may not text", async () => {
    await link({ razorpayLinkId: "plink_1", sentAt: NOW.toISOString() });

    expect(await resendLink(env.DB, linkDeps(["+919810000002"]), LINK, NOW)).toBe("not_texted");
  });
});

describe("a paid link", () => {
  const payment = {
    id: "pay_1",
    amount: 3000000,
    currency: "INR",
    status: "captured",
    method: "upi",
    created_at: Math.floor(NOW.getTime() / 1000),
  };

  it("that names no visit of ours is recorded nowhere", async () => {
    const paid = { link: { id: "plink_unknown", status: "paid" }, payment };

    expect(await linkPaid(env.DB, paid, LOCAL_SETTINGS.ipHashSalt, NOW)).toBeNull();
    expect(await env.DB.prepare("SELECT id FROM payments").first()).toBeNull();
  });

  it("for a visit with no client is recorded against the visit alone", async () => {
    await link({ razorpayLinkId: "plink_1", sentAt: NOW.toISOString() });
    await env.DB.prepare("UPDATE appointments SET person_id = NULL WHERE id = ?1").bind(VISIT).run();
    const paid = { link: { id: "plink_1", status: "paid", reference_id: null }, payment };

    expect(await linkPaid(env.DB, paid, LOCAL_SETTINGS.ipHashSalt, NOW)).toMatchObject({ personId: null });
    const row = await env.DB.prepare(
      "SELECT appointment_id, person_id FROM payments WHERE razorpay_payment_id = 'pay_1'",
    ).first();
    expect(row).toEqual({ appointment_id: VISIT, person_id: null });
  });
});

describe("the receipt for a paid link", () => {
  /** The link's payment, captured, with its reference given or not yet. */
  async function paidBy(reference: string | null, tier = "standard") {
    await link({ razorpayLinkId: "plink_1", sentAt: NOW.toISOString(), tier });
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO payments (id, razorpay_payment_id, amount, currency, status, person_id, reference, created_at,
           updated_at)
         VALUES ('payment-1', 'pay_1', 3000000, 'INR', 'captured', ?1, ?2, ?3, ?3)`,
      ).bind(PERSON, reference, NOW.toISOString()),
      env.DB.prepare("UPDATE payment_links SET razorpay_payment_id = 'pay_1' WHERE id = ?1").bind(LINK),
    ]);
  }

  it("waits while there is no captured payment, or the payment has no reference yet", async () => {
    expect(await composeLinkPaid(env.DB, VISIT, PERSON)).toEqual({ skip: "no captured payment for the link" });
    await paidBy(null);
    expect(await composeLinkPaid(env.DB, VISIT, PERSON)).toEqual({ skip: "the payment has no reference yet" });
  });

  it("names a hair system ops no longer offer as a hair system", async () => {
    await paidBy("MM-2026-0001", "retired_system");

    expect(await composeLinkPaid(env.DB, VISIT, PERSON)).toMatchObject({
      template: "link_paid_v1",
      params: ["Rohit", "hair system", "", "", "", "Rs. 30,000", "MM-2026-0001"],
    });
  });
});
