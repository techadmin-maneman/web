// The referral grant, its fraud holds and ops' review, credit expiry and clawback (src/domain/referrals/referral-grants.ts,
// src/domain/money/credits.ts). NOW is Monday 21 September 2026, 12 noon in India. Every name and number is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { renderMessage } from "../../../src/config/message-templates.ts";
import { creditBalance, expireCredits, grantCredits } from "../../../src/domain/money/credits.ts";
import {
  clawBackRefunded,
  decideHeldReferral,
  settleReferrals,
} from "../../../src/domain/referrals/referral-grants.ts";
import { composeFriendFitted } from "../../../src/domain/referrals/referral-messages.ts";
import { REFERRAL_REWARD } from "../../../src/policy/referral-reward.ts";
import { captureLogs, markDatabase, NOW } from "../helpers.ts";
import {
  REFERRER,
  FRIEND,
  FIT,
  ATTRIBUTION,
  CODE,
  person,
  firstFit,
  attribution,
  state,
  messagesWritten,
} from "./referral-grants-fixtures.ts";

const DAY = 86_400_000;

beforeEach(async () => {
  await markDatabase();
  captureLogs();
  await person(REFERRER, "Rohit Malhotra", "+919810000001");
  await person(FRIEND, "Karan Bhatia", "+919810000002");
  await env.DB.prepare("INSERT INTO referral_codes (code, person_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)")
    .bind(CODE, REFERRER, NOW.toISOString())
    .run();
  await attribution(ATTRIBUTION, FRIEND);
});

/** env.DB, with `before` run ahead of each batch: another request's write landing between a read and its batch. */
function racedBy(before: () => Promise<void>): D1Database {
  return new Proxy(env.DB, {
    get(target, key) {
      if (key === "batch") {
        return async (statements: D1PreparedStatement[]) => {
          await before();
          return target.batch(statements);
        };
      }
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

describe("the grant", () => {
  // The referrer was told and the friend, whose credits they also were, never was.
  it("gives both sides 3 service visits once the friend's first fit is done, and tells them both", async () => {
    expect(await settleReferrals(env.DB, NOW, REFERRAL_REWARD)).toMatchObject({ granted: 0 });
    await firstFit(FIT, FRIEND);
    const settled = await settleReferrals(env.DB, NOW, REFERRAL_REWARD);
    expect(settled).toMatchObject({ granted: 1, held: 0, expired: 0 });
    expect(settled.messageIds).toHaveLength(2);
    expect(await state()).toEqual({ grant_state: "granted", fraud_signals: null });
    // 365 days on, to the end of that day in India: the date the referrer is told.
    const expiry = "2027-09-21T18:29:59.999Z";
    expect(await creditBalance(env.DB, FRIEND, NOW)).toEqual({ visits: 3, earliestExpiry: expiry, expiringFirst: 3 });
    expect(await creditBalance(env.DB, REFERRER, NOW)).toEqual({ visits: 3, earliestExpiry: expiry, expiringFirst: 3 });

    expect(await messagesWritten()).toEqual([
      { person_id: FRIEND, kind: "friend_credited", subject_id: ATTRIBUTION },
      { person_id: REFERRER, kind: "friend_fitted", subject_id: ATTRIBUTION },
    ]);
    const composed = await composeFriendFitted(env.DB, ATTRIBUTION, REFERRER);
    expect("skip" in composed ? composed : renderMessage(composed.template, composed.params)).toBe(
      "Hi Rohit, Karan has been fitted. You each get 3 service visits free, to use by 21 Sep 2027. Thanks for sending them our way.",
    );

    expect(await settleReferrals(env.DB, NOW, REFERRAL_REWARD)).toMatchObject({ granted: 0 });
    expect((await creditBalance(env.DB, FRIEND, NOW)).visits).toBe(3);
  });

  // A consultation and fit in one visit is paid for after it, by a link (ADR 0025, item 93;
  // docs/decisions/0105-a-consultation-and-fit-in-one-visit.md): nothing was sold until the payment is in.
  it("waits for a one visit's payment, and grants on the pass after it is in", async () => {
    await firstFit(FIT, FRIEND);
    await env.DB.prepare("UPDATE appointments SET one_visit = 'fitted' WHERE id = ?1").bind(FIT).run();
    expect(await settleReferrals(env.DB, NOW, REFERRAL_REWARD)).toMatchObject({ granted: 0, held: 0 });
    expect((await state())?.grant_state).toBe("pending");
    expect((await creditBalance(env.DB, FRIEND, NOW)).visits).toBe(0);

    await env.DB.prepare(
      `INSERT INTO payments (id, person_id, appointment_id, razorpay_payment_id, amount, currency, status, captured_at,
         created_at, updated_at)
       VALUES ('payment-link-1', ?1, ?2, 'pay_link_1', 4500000, 'INR', 'captured', ?3, ?3, ?3)`,
    )
      .bind(FRIEND, FIT, NOW.toISOString())
      .run();
    expect(await settleReferrals(env.DB, NOW, REFERRAL_REWARD)).toMatchObject({ granted: 1 });
    expect((await creditBalance(env.DB, FRIEND, NOW)).visits).toBe(3);
  });

  // "Yes, once fitted": with nothing owed, the fit itself settles the referral.
  it("grants on the pass after a one visit a discount code left nothing to pay, with no payment", async () => {
    await firstFit(FIT, FRIEND);
    await env.DB.prepare("UPDATE appointments SET one_visit = 'fitted' WHERE id = ?1").bind(FIT).run();
    expect(await settleReferrals(env.DB, NOW, REFERRAL_REWARD)).toMatchObject({ granted: 0 });

    await env.DB.prepare("UPDATE appointments SET nothing_owed_at = ?2 WHERE id = ?1")
      .bind(FIT, NOW.toISOString())
      .run();
    expect(await settleReferrals(env.DB, NOW, REFERRAL_REWARD)).toMatchObject({ granted: 1, held: 0 });
    expect((await creditBalance(env.DB, FRIEND, NOW)).visits).toBe(3);
    expect((await creditBalance(env.DB, REFERRER, NOW)).visits).toBe(3);
  });

  it("waits while the first fit is only partly done", async () => {
    await firstFit(FIT, FRIEND, "partial");
    expect(await settleReferrals(env.DB, NOW, REFERRAL_REWARD)).toMatchObject({ granted: 0, held: 0 });
    expect((await state())?.grant_state).toBe("pending");
  });

  it("credits and tells only the friend when the referrer has since been erased", async () => {
    await firstFit(FIT, FRIEND);
    await env.DB.prepare("UPDATE people SET erased_at = ?1 WHERE id = ?2").bind(NOW.toISOString(), REFERRER).run();
    const settled = await settleReferrals(env.DB, NOW, REFERRAL_REWARD);
    expect(settled).toMatchObject({ granted: 1 });
    expect(settled.messageIds).toHaveLength(1);
    expect(await messagesWritten()).toEqual([{ person_id: FRIEND, kind: "friend_credited", subject_id: ATTRIBUTION }]);
    expect((await creditBalance(env.DB, FRIEND, NOW)).visits).toBe(3);
    expect((await creditBalance(env.DB, REFERRER, NOW)).visits).toBe(0);
  });

  it("lets a waitlist invite lapse 12 months after its area launched", async () => {
    await env.DB.prepare("DELETE FROM referral_attributions").run();
    await env.DB.prepare(
      "INSERT INTO serviceable_pincodes (pincode, area, city, served, launched_at) VALUES ('400050', 'Bandra', 'Mumbai', 1, '2025-06-01T00:00:00.000Z')",
    ).run();
    await attribution(ATTRIBUTION, FRIEND, "waitlist", "400050");
    await firstFit(FIT, FRIEND);
    expect(await settleReferrals(env.DB, NOW, REFERRAL_REWARD)).toMatchObject({ granted: 0, expired: 1 });
    expect((await state())?.grant_state).toBe("expired");
  });
});

describe("a friend with two first fits done", () => {
  it("settles the referral once, and tells each of them once", async () => {
    await firstFit(FIT, FRIEND);
    await firstFit("fit-second-0000-4000-8000-000000000000", FRIEND, "done", "2026-09-21T03:30:00.000Z");
    const settled = await settleReferrals(env.DB, NOW, REFERRAL_REWARD);
    expect(settled).toMatchObject({ granted: 1 });
    expect(settled.messageIds).toHaveLength(2);
    const told = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM outbound_messages WHERE kind = 'friend_fitted'",
    ).first();
    expect(told).toEqual({ n: 1 });
  });
});

// The grant's state was written without asking what it was, so a second pass, or a second decision, wrote
// its credits and messages again over the first.
describe("a grant settled twice at once", () => {
  it("settles once when two passes of the cron take the same referral, telling each side once", async () => {
    await firstFit(FIT, FRIEND);
    let raced = false;
    const racing = racedBy(async () => {
      if (raced) return;
      raced = true;
      await settleReferrals(env.DB, new Date(NOW.getTime() + 1000), REFERRAL_REWARD);
    });

    expect(await settleReferrals(racing, NOW, REFERRAL_REWARD)).toMatchObject({ granted: 0, messageIds: [] });

    expect(await messagesWritten()).toEqual([
      { person_id: FRIEND, kind: "friend_credited", subject_id: ATTRIBUTION },
      { person_id: REFERRER, kind: "friend_fitted", subject_id: ATTRIBUTION },
    ]);
    expect((await creditBalance(env.DB, REFERRER, NOW)).visits).toBe(3);
  });

  it("writes nothing for an approval another member of staff rejected between its read and its write", async () => {
    await firstFit(FIT, FRIEND);
    await env.DB.prepare("UPDATE referral_attributions SET grant_state = 'held', first_fit_appointment_id = ?1")
      .bind(FIT)
      .run();
    const racing = racedBy(async () => {
      await env.DB.prepare(
        "UPDATE referral_attributions SET grant_state = 'rejected', updated_at = '2026-09-21T06:00:00.000Z'",
      ).run();
    });

    const decided = await decideHeldReferral(racing, {
      id: ATTRIBUTION,
      decision: "approve",
      staff: "ops@localhost",
      reason: "Two households",
      audit: {
        surface: "ops",
        actor: { kind: "staff", id: "ops@localhost" },
        action: "referral.decide",
        subject: { kind: "referral", id: ATTRIBUTION },
        requestId: "r",
      },
      rewardNow: REFERRAL_REWARD,
      now: NOW,
    });

    expect(decided).toBeNull();
    expect((await state())?.grant_state).toBe("rejected");
    expect((await creditBalance(env.DB, REFERRER, NOW)).visits).toBe(0);
    expect(await messagesWritten()).toEqual([]);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log").first()).toEqual({ n: 0 });
  });
});

describe("credits after the grant", () => {
  it("expire once, keeping the ledger's record", async () => {
    await grantCredits(env.DB, {
      personId: FRIEND,
      visits: 3,
      source: "ops",
      sourceId: "o1",
      now: NOW,
      expiresAt: new Date(NOW.getTime() - DAY),
    }).run();
    expect(await expireCredits(env.DB, NOW)).toBe(1);
    expect(await expireCredits(env.DB, NOW)).toBe(0);
    const entry = await env.DB.prepare("SELECT visits FROM credit_ledger WHERE kind = 'expire'").first();
    expect(entry).toEqual({ visits: -3 });
  });

  it("are taken back when the friend's first fit is refunded in full under the guarantee", async () => {
    await firstFit(FIT, FRIEND);
    await settleReferrals(env.DB, NOW, REFERRAL_REWARD);
    await env.DB.prepare(
      `INSERT INTO payments (id, person_id, appointment_id, razorpay_payment_id, amount, currency, status,
         refunded_amount, created_at, updated_at)
       VALUES ('p1', ?1, ?2, 'pay_fit', 3000000, 'INR', 'refunded', 3000000, ?3, ?3)`,
    )
      .bind(FRIEND, FIT, NOW.toISOString())
      .run();
    expect(await clawBackRefunded(env.DB, NOW)).toBe(1);
    expect((await state())?.grant_state).toBe("clawed_back");
    expect((await creditBalance(env.DB, FRIEND, NOW)).visits).toBe(0);
    expect((await creditBalance(env.DB, REFERRER, NOW)).visits).toBe(0);
  });
});
