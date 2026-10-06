// The referral grant, its fraud holds and ops' review, credit expiry and clawback (src/domain/referrals/referral-grants.ts,
// src/domain/money/credits.ts). NOW is Monday 21 September 2026, 12 noon in India. Every name and number is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { renderMessage } from "../../../src/config/message-templates.ts";
import { creditBalance } from "../../../src/domain/money/credits.ts";
import { settleReferrals } from "../../../src/domain/referrals/referral-grants.ts";
import { composeFriendFitted } from "../../../src/domain/referrals/referral-messages.ts";
import { REFERRAL_REWARD, type ReferralReward } from "../../../src/policy/referral-reward.ts";
import { appFor, captureLogs, fakeDependencies, fakeQueue, markDatabase, NOW, request } from "../helpers.ts";
import {
  REFERRER,
  FRIEND,
  FIT,
  ATTRIBUTION,
  CODE,
  person,
  firstFit,
  attribution,
  openClientSession,
  state,
  messagesWritten,
  rewardSet,
  referralsRun,
  visitsConsent,
  told,
} from "./referral-grants-fixtures.ts";

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

const grantsOf = async (personId: string) =>
  (
    await env.DB.prepare(
      "SELECT visits, expires_at FROM credit_ledger WHERE person_id = ?1 AND kind = 'grant' ORDER BY created_at",
    )
      .bind(personId)
      .all()
  ).results;

const toldReferrer = async () => {
  const composed = await composeFriendFitted(env.DB, ATTRIBUTION, REFERRER);
  return "skip" in composed ? composed : renderMessage(composed.template, composed.params);
};

// Ops set each side's visits and how long they last
// (docs/decisions/0107-referral-rewards-in-the-console.md).
describe("what a referral earns, as ops set it", () => {
  it("gives each side what is set when the friend is fitted, for as long as is set, and says so", async () => {
    // The invite was booked under the committed reward; what counts is what is set when the friend is fitted.
    await rewardSet({ referrer_visits: 2, friend_visits: 4, valid_days: 90 });
    await firstFit(FIT, FRIEND);
    expect(await referralsRun()).toHaveLength(2);
    // 90 days on, to the end of that day in India.
    const expiry = "2026-12-20T18:29:59.999Z";
    expect(await grantsOf(REFERRER)).toEqual([{ visits: 2, expires_at: expiry }]);
    expect(await grantsOf(FRIEND)).toEqual([{ visits: 4, expires_at: expiry }]);
    expect(await toldReferrer()).toBe(
      "Hi Rohit, Karan has been fitted. You get 2 service visits free, to use by 20 Dec 2026, and Karan gets 4 service visits. Thanks for sending them our way.",
    );
    await visitsConsent(FRIEND);
    expect(await told("friend_credited", FRIEND)).toBe(
      "Hi Karan, welcome to Mane Man. Your invite gives you 4 service visits free, to use by 20 Dec 2026. You'll find them in the app.",
    );
  });

  it("leaves what was given as it was when ops change it, and gives the next friend the new figures", async () => {
    await firstFit(FIT, FRIEND);
    await referralsRun();
    await rewardSet({ referrer_visits: 1, friend_visits: 1, valid_days: 30 });
    expect(await grantsOf(FRIEND)).toEqual([{ visits: 3, expires_at: "2027-09-21T18:29:59.999Z" }]);
    expect(await toldReferrer()).toBe(
      "Hi Rohit, Karan has been fitted. You each get 3 service visits free, to use by 21 Sep 2027. Thanks for sending them our way.",
    );

    const next = "55555555-5555-4555-8555-555555555555";
    await person(next, "Vikram Sethi", "+919810000003");
    await attribution("66666666-6666-4666-8666-666666666666", next);
    await firstFit("77777777-7777-4777-8777-777777777777", next);
    await referralsRun();
    expect(await grantsOf(next)).toEqual([{ visits: 1, expires_at: "2026-10-21T18:29:59.999Z" }]);
    expect((await creditBalance(env.DB, REFERRER, NOW)).visits).toBe(4);
  });

  it("gives a side set to nothing no credits, and tells the friend nothing they were not given", async () => {
    await rewardSet({ referrer_visits: 3, friend_visits: 0, valid_days: 365 });
    await firstFit(FIT, FRIEND);
    await referralsRun();
    expect(await grantsOf(FRIEND)).toEqual([]);
    expect(await messagesWritten()).toEqual([{ person_id: REFERRER, kind: "friend_fitted", subject_id: ATTRIBUTION }]);
    expect(await toldReferrer()).toBe(
      "Hi Rohit, Karan has been fitted. You get 3 service visits free, to use by 21 Sep 2027. Thanks for sending them our way.",
    );
  });

  it("still thanks a referrer set to nothing, as the referrer is always told of the fit", async () => {
    await rewardSet({ referrer_visits: 0, friend_visits: 1, valid_days: 365 });
    await firstFit(FIT, FRIEND);
    await referralsRun();
    expect(await grantsOf(REFERRER)).toEqual([]);
    expect(await grantsOf(FRIEND)).toEqual([{ visits: 1, expires_at: "2027-09-21T18:29:59.999Z" }]);
    expect(await toldReferrer()).toBe("Hi Rohit, Karan has been fitted. Thanks for sending them our way.");
    await visitsConsent(FRIEND);
    expect(await told("friend_credited", FRIEND)).toBe(
      "Hi Karan, welcome to Mane Man. Your invite gives you 1 service visit free, to use by 21 Sep 2027. You'll find them in the app.",
    );
  });

  describe("a grant held for review", () => {
    const ops = () => appFor("local", fakeDependencies(), {}, "ops");
    const decide = (decision: "approve" | "reject", queue: Queue = fakeQueue()) =>
      request(
        ops(),
        `/api/referrals/${ATTRIBUTION}/decision`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: "https://maneman.test" },
          body: JSON.stringify({ decision, reason: "Checked with both" }),
        },
        { MESSAGE_QUEUE: queue },
      );

    async function heldUnder(reward: ReferralReward) {
      await rewardSet(reward);
      // The referrer once changed to the friend's number: the same-mobile rule holds the grant.
      await env.DB.prepare(
        `INSERT INTO number_change_requests (id, person_id, created_at, new_mobile_e164, state, decided_at)
         VALUES ('change-1', ?1, ?2, '+919810000002', 'confirmed', ?2)`,
      )
        .bind(REFERRER, NOW.toISOString())
        .run();
      await firstFit(FIT, FRIEND);
      await referralsRun();
      expect((await state())?.grant_state).toBe("held");
    }

    // A refused send answered 500 for a ruling already made, and ops ruled again.
    it("is approved, and answers so, when the queue refuses the messages, which the sweeper then sends", async () => {
      await heldUnder({ referrer_visits: 2, friend_visits: 1, valid_days: 60 });
      const down = { ...fakeQueue(), send: () => Promise.reject(new Error("queue unavailable")) };

      expect((await decide("approve", down)).status).toBe(200);
      expect(await grantsOf(REFERRER)).toEqual([{ visits: 2, expires_at: "2026-11-20T18:29:59.999Z" }]);
      // In the outbox, still queued: what the sweeper sends.
      const unsent = await env.DB.prepare("SELECT kind, state FROM outbound_messages ORDER BY kind").all();
      expect(unsent.results).toEqual([
        { kind: "friend_credited", state: "queued" },
        { kind: "friend_fitted", state: "queued" },
      ]);
    });

    it("is given what was set when the friend was fitted, not what is set when ops approve it", async () => {
      await heldUnder({ referrer_visits: 2, friend_visits: 5, valid_days: 60 });
      await rewardSet({ referrer_visits: 6, friend_visits: 6, valid_days: 365 });
      expect((await decide("approve")).status).toBe(200);
      expect(await grantsOf(REFERRER)).toEqual([{ visits: 2, expires_at: "2026-11-20T18:29:59.999Z" }]);
      expect(await grantsOf(FRIEND)).toEqual([{ visits: 5, expires_at: "2026-11-20T18:29:59.999Z" }]);
    });

    // A grant held before migration 0062 kept no reward; so does an invite ops attach after the fit, held as it is made.
    it("is given the reward in force when ops approve it, where it kept none", async () => {
      await heldUnder({ referrer_visits: 2, friend_visits: 2, valid_days: 60 });
      await env.DB.prepare(
        "UPDATE referral_attributions SET referrer_visits = NULL, friend_visits = NULL, credit_valid_days = NULL",
      ).run();
      await rewardSet({ referrer_visits: 4, friend_visits: 1, valid_days: 30 });
      expect((await decide("approve")).status).toBe(200);
      expect(await grantsOf(REFERRER)).toEqual([{ visits: 4, expires_at: "2026-10-21T18:29:59.999Z" }]);
      expect(await grantsOf(FRIEND)).toEqual([{ visits: 1, expires_at: "2026-10-21T18:29:59.999Z" }]);
    });

    it("tells a friend it gives nothing neither that it is being checked nor that it was refused", async () => {
      await heldUnder({ referrer_visits: 3, friend_visits: 0, valid_days: 365 });
      const client = appFor("local", fakeDependencies(), {}, "client");
      const cookie = `mm_app=${await openClientSession(FRIEND)}`;
      const inviteCredits = async () =>
        (
          await (
            await request(client, "/api/refer", { headers: { Cookie: cookie } })
          ).json<{
            invite_credits: unknown;
          }>()
        ).invite_credits;
      expect(await inviteCredits()).toBeNull();
      expect((await decide("reject")).status).toBe(200);
      expect(await inviteCredits()).toBeNull();
    });

    it("is refused to only a side it would have given visits", async () => {
      await heldUnder({ referrer_visits: 0, friend_visits: 3, valid_days: 365 });
      expect((await decide("reject")).status).toBe(200);
      expect(await messagesWritten()).toEqual([
        { person_id: FRIEND, kind: "referral_rejected", subject_id: ATTRIBUTION },
      ]);
    });
  });
});

describe("fraud holds", () => {
  it("holds a pair who share an address or a UPI handle", async () => {
    for (const personId of [REFERRER, FRIEND]) {
      await env.DB.prepare(
        `INSERT INTO addresses (id, person_id, created_at, line1, locality, city, pincode)
         VALUES (?1, ?2, ?3, ?4, 'Sector 65', 'Gurgaon', '122018')`,
      )
        .bind(crypto.randomUUID(), personId, NOW.toISOString(), personId === REFERRER ? "House 7" : " house 7 ")
        .run();
      await env.DB.prepare(
        `INSERT INTO payments (id, person_id, razorpay_payment_id, amount, currency, vpa_hash, status, created_at,
           updated_at)
         VALUES (?1, ?2, ?3, 100, 'INR', 'same-handle', 'captured', ?4, ?4)`,
      )
        .bind(crypto.randomUUID(), personId, `pay_${personId}`, NOW.toISOString())
        .run();
    }
    await firstFit(FIT, FRIEND);
    expect(await settleReferrals(env.DB, NOW, REFERRAL_REWARD)).toMatchObject({ granted: 0, held: 1, messageIds: [] });
    expect(await state()).toEqual({ grant_state: "held", fraud_signals: '["shared_address","shared_upi"]' });
    expect((await creditBalance(env.DB, FRIEND, NOW)).visits).toBe(0);
  });

  it("holds a referrer's sixth fit in a calendar month in India, but not the fifth", async () => {
    for (let n = 0; n < 5; n += 1) {
      const friend = `f000000${String(n)}-0000-4000-8000-000000000000`;
      const fit = `a000000${String(n)}-0000-4000-8000-000000000000`;
      await person(friend, `Friend ${String(n)}`, `+91981000010${String(n)}`);
      await attribution(`b000000${String(n)}-0000-4000-8000-000000000000`, friend);
      await firstFit(fit, friend, "done", `2026-09-0${String(n + 1)}T03:30:00.000Z`);
    }
    // Five fits this month: all granted, since none passes the cap of 5 (the friend's own is still waiting).
    await env.DB.prepare("UPDATE referral_attributions SET grant_state = 'held' WHERE id = ?1").bind(ATTRIBUTION).run();
    expect(await settleReferrals(env.DB, NOW, REFERRAL_REWARD)).toMatchObject({ granted: 5, held: 0 });
    await env.DB.prepare("UPDATE referral_attributions SET grant_state = 'pending' WHERE id = ?1")
      .bind(ATTRIBUTION)
      .run();
    await firstFit(FIT, FRIEND);
    expect(await settleReferrals(env.DB, NOW, REFERRAL_REWARD)).toMatchObject({ granted: 0, held: 1 });
    expect(await state()).toEqual({ grant_state: "held", fraud_signals: '["monthly_cap"]' });
  });

  // Numbers are unique, so they can only match through a change of number.
  it("holds a pair where the friend's number is one the referrer changed to before", async () => {
    await env.DB.prepare(
      `INSERT INTO number_change_requests (id, person_id, created_at, new_mobile_e164, state, decided_at)
       VALUES ('change-1', ?1, ?2, '+919810000002', 'confirmed', ?2)`,
    )
      .bind(REFERRER, NOW.toISOString())
      .run();
    await firstFit(FIT, FRIEND);
    expect(await settleReferrals(env.DB, NOW, REFERRAL_REWARD)).toMatchObject({ held: 1 });
    expect(await state()).toEqual({ grant_state: "held", fraud_signals: '["same_mobile"]' });
  });

  // The gap ADR 0068 left: the number a confirmed change replaced is kept now, and compared.
  it("holds a pair where the friend's number is the one the referrer changed from", async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO number_change_requests (id, person_id, created_at, new_mobile_e164, replaced_mobile_e164, state,
           decided_at)
         VALUES ('change-1', ?1, ?2, '+919810000001', '+919810000009', 'confirmed', ?2)`,
      ).bind(REFERRER, NOW.toISOString()),
      env.DB.prepare("UPDATE people SET mobile_e164 = '+919810000009' WHERE id = ?1").bind(FRIEND),
    ]);
    await firstFit(FIT, FRIEND);
    expect(await settleReferrals(env.DB, NOW, REFERRAL_REWARD)).toMatchObject({ held: 1 });
    expect(await state()).toEqual({ grant_state: "held", fraud_signals: '["same_mobile"]' });
  });

  it("does not count a change the client withdrew, or ops rejected, as a number either held", async () => {
    for (const [id, state] of [
      ["change-1", "withdrawn"],
      ["change-2", "rejected"],
    ]) {
      await env.DB.prepare(
        `INSERT INTO number_change_requests (id, person_id, created_at, new_mobile_e164, state, decided_at)
         VALUES (?1, ?2, ?3, '+919810000002', ?4, ?3)`,
      )
        .bind(id, REFERRER, NOW.toISOString(), state)
        .run();
    }
    await firstFit(FIT, FRIEND);
    expect(await settleReferrals(env.DB, NOW, REFERRAL_REWARD)).toMatchObject({ granted: 1, held: 0 });
  });
});
