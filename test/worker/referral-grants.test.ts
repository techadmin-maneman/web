// The referral grant, its fraud holds and ops' review, credit expiry and clawback (src/domain/referral-grants.ts,
// src/domain/credits.ts). NOW is Monday 21 September 2026, 12 noon in India. Every name and number is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { renderMessage } from "../../src/config/message-templates.ts";
import { creditBalance, expireCredits, grantCredits } from "../../src/domain/credits.ts";
import {
  clawBackRefunded,
  composeFriendCredited,
  composeFriendFitted,
  composeReferralRejected,
  settleReferrals,
} from "../../src/domain/referral-grants.ts";
import { erasePerson } from "../../src/domain/erasure.ts";
import { openSession } from "../../src/domain/sessions.ts";
import { createLogger } from "../../src/log.ts";
import { appFor, captureLogs, fakeDependencies, fakeQueue, markDatabase, NOW, request } from "./helpers.ts";

const REFERRER = "11111111-1111-4111-8111-111111111111";
const FRIEND = "22222222-2222-4222-8222-222222222222";
const FIT = "33333333-3333-4333-8333-333333333333";
const ATTRIBUTION = "44444444-4444-4444-8444-444444444444";
const CODE = "RM7K2Q";
const DAY = 86_400_000;

async function person(id: string, name: string, mobile: string) {
  await env.DB.prepare("INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, ?3, ?4)")
    .bind(id, NOW.toISOString(), mobile, name)
    .run();
}

async function firstFit(
  id: string,
  personId: string,
  outcome: "done" | "partial" = "done",
  start = "2026-09-20T03:30:00.000Z",
) {
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, window_end,
       fsm_modified_at, synced_at)
     VALUES (?1, ?2, ?3, 'first_fit', 'completed', 'Completed', ?4, ?4, ?5, ?5)`,
  )
    .bind(id, `fsm-${id}`, personId, start, NOW.toISOString())
    .run();
  await env.DB.prepare("INSERT INTO visits (id, appointment_id, outcome, updated_at) VALUES (?1, ?2, ?3, ?4)")
    .bind(crypto.randomUUID(), id, outcome, NOW.toISOString())
    .run();
}

async function attribution(id: string, personId: string, via = "consultation", pincode: string | null = null) {
  await env.DB.prepare(
    `INSERT INTO referral_attributions (id, code, referred_person_id, first_touch_at, via, pincode, created_at,
       updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?4, ?4)`,
  )
    .bind(id, CODE, personId, "2026-09-01T06:30:00.000Z", via, pincode)
    .run();
}

const openClientSession = (personId: string) =>
  openSession(env.DB, { kind: "client", subjectId: personId, deviceLabel: null, now: NOW });

const state = async (id = ATTRIBUTION) =>
  (await env.DB.prepare("SELECT grant_state, fraud_signals FROM referral_attributions WHERE id = ?1")
    .bind(id)
    .first<{ grant_state: string; fraud_signals: string | null }>()) ?? null;

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

const messagesWritten = async () =>
  (await env.DB.prepare("SELECT person_id, kind, subject_id FROM outbound_messages ORDER BY kind, person_id").all())
    .results;

describe("the grant", () => {
  // The referrer was told and the friend, whose credits they also were, never was (LIFE-10).
  it("gives both sides 3 service visits once the friend's first fit is done, and tells them both", async () => {
    expect(await settleReferrals(env.DB, NOW)).toMatchObject({ granted: 0 });
    await firstFit(FIT, FRIEND);
    const settled = await settleReferrals(env.DB, NOW);
    expect(settled).toMatchObject({ granted: 1, held: 0, expired: 0 });
    expect(settled.messageIds).toHaveLength(2);
    expect(await state()).toEqual({ grant_state: "granted", fraud_signals: null });
    // 365 days on, to the end of that day in India: the date the referrer is told (BIZ-14).
    const expiry = "2027-09-21T18:29:59.999Z";
    expect(await creditBalance(env.DB, FRIEND, NOW)).toEqual({ visits: 3, earliestExpiry: expiry });
    expect(await creditBalance(env.DB, REFERRER, NOW)).toEqual({ visits: 3, earliestExpiry: expiry });

    expect(await messagesWritten()).toEqual([
      { person_id: FRIEND, kind: "friend_credited", subject_id: ATTRIBUTION },
      { person_id: REFERRER, kind: "friend_fitted", subject_id: ATTRIBUTION },
    ]);
    const composed = await composeFriendFitted(env.DB, ATTRIBUTION, REFERRER);
    expect("skip" in composed ? composed : renderMessage(composed.template, composed.params)).toBe(
      "Hello Rohit, Karan has been fitted. You each have 3 service visits free, until 21 Sep 2027. " +
        "Thank you for the introduction.",
    );

    expect(await settleReferrals(env.DB, NOW)).toMatchObject({ granted: 0 });
    expect((await creditBalance(env.DB, FRIEND, NOW)).visits).toBe(3);
  });

  it("waits while the first fit is only partly done", async () => {
    await firstFit(FIT, FRIEND, "partial");
    expect(await settleReferrals(env.DB, NOW)).toMatchObject({ granted: 0, held: 0 });
    expect((await state())?.grant_state).toBe("pending");
  });

  it("credits and tells only the friend when the referrer has since been erased", async () => {
    await firstFit(FIT, FRIEND);
    await env.DB.prepare("UPDATE people SET erased_at = ?1 WHERE id = ?2").bind(NOW.toISOString(), REFERRER).run();
    const settled = await settleReferrals(env.DB, NOW);
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
    expect(await settleReferrals(env.DB, NOW)).toMatchObject({ granted: 0, expired: 1 });
    expect((await state())?.grant_state).toBe("expired");
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
    expect(await settleReferrals(env.DB, NOW)).toMatchObject({ granted: 0, held: 1, messageIds: [] });
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
    expect(await settleReferrals(env.DB, NOW)).toMatchObject({ granted: 5, held: 0 });
    await env.DB.prepare("UPDATE referral_attributions SET grant_state = 'pending' WHERE id = ?1")
      .bind(ATTRIBUTION)
      .run();
    await firstFit(FIT, FRIEND);
    expect(await settleReferrals(env.DB, NOW)).toMatchObject({ granted: 0, held: 1 });
    expect(await state()).toEqual({ grant_state: "held", fraud_signals: '["monthly_cap"]' });
  });

  // BIZ-13 of the audit, 24 September 2026: numbers are unique, so they can only match through a change of number.
  it("holds a pair where the friend's number is one the referrer changed to before", async () => {
    await env.DB.prepare(
      `INSERT INTO number_change_requests (id, person_id, created_at, new_mobile_e164, state, decided_at)
       VALUES ('change-1', ?1, ?2, '+919810000002', 'confirmed', ?2)`,
    )
      .bind(REFERRER, NOW.toISOString())
      .run();
    await firstFit(FIT, FRIEND);
    expect(await settleReferrals(env.DB, NOW)).toMatchObject({ held: 1 });
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
    expect(await settleReferrals(env.DB, NOW)).toMatchObject({ held: 1 });
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
    expect(await settleReferrals(env.DB, NOW)).toMatchObject({ granted: 1, held: 0 });
  });
});

describe("a friend with two first fits done (BIZ-13)", () => {
  it("settles the referral once, and tells each of them once", async () => {
    await firstFit(FIT, FRIEND);
    await firstFit("fit-second-0000-4000-8000-000000000000", FRIEND, "done", "2026-09-21T03:30:00.000Z");
    const settled = await settleReferrals(env.DB, NOW);
    expect(settled).toMatchObject({ granted: 1 });
    expect(settled.messageIds).toHaveLength(2);
    const told = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM outbound_messages WHERE kind = 'friend_fitted'",
    ).first();
    expect(told).toEqual({ n: 1 });
  });
});

describe("ops' review", () => {
  async function held() {
    await firstFit(FIT, FRIEND);
    await env.DB.prepare(
      "UPDATE referral_attributions SET grant_state = 'held', fraud_signals = '[\"shared_address\"]', first_fit_appointment_id = ?2 WHERE id = ?1",
    )
      .bind(ATTRIBUTION, FIT)
      .run();
  }
  const ops = () => appFor("local", fakeDependencies(), {}, "ops");
  const decide = (body: object, queue = fakeQueue()) =>
    request(
      ops(),
      `/api/referrals/${ATTRIBUTION}/decision`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://maneman.test" },
        body: JSON.stringify(body),
      },
      { MESSAGE_QUEUE: queue },
    );

  it("lists held grants with the rules they met, and an approval grants and tells them both", async () => {
    await held();
    const list = await (await request(ops(), "/api/referrals/held")).json();
    expect(list).toEqual({
      held: [
        {
          id: ATTRIBUTION,
          referrer: { person_id: REFERRER, name: "Rohit Malhotra" },
          referred: { person_id: FRIEND, name: "Karan Bhatia" },
          fitted_on: "2026-09-20",
          signals: ["shared_address"],
          // Held when its row was last written, and due two days on (src/policy/tasks.ts).
          held_since: "2026-09-01T06:30:00.000Z",
          due: "2026-09-03T06:30:00.000Z",
        },
      ],
    });
    const queue = fakeQueue();
    const answer = await decide({ decision: "approve", reason: "Father and son, two households" }, queue);
    expect(await answer.json()).toEqual({ state: "approved" });
    expect((await creditBalance(env.DB, REFERRER, NOW)).visits).toBe(3);
    expect(queue.sent).toHaveLength(2);
    const audit = await env.DB.prepare(
      "SELECT action, subject_id FROM audit_log WHERE action = 'referral.decide'",
    ).first();
    expect(audit).toEqual({ action: "referral.decide", subject_id: ATTRIBUTION });
    // The console asks for a reason on either decision (board C1); an approval keeps it too.
    const reviewed = await env.DB.prepare("SELECT review_reason FROM referral_attributions WHERE id = ?1")
      .bind(ATTRIBUTION)
      .first<{ review_reason: string | null }>();
    expect(reviewed?.review_reason).toBe("Father and son, two households");
    // The reason is kept with the decision; the log names the decision and stays free of what ops wrote (ADR 0031).
    const detail = await env.DB.prepare("SELECT detail FROM audit_log WHERE action = 'referral.decide'").first();
    expect(detail).toEqual({ detail: JSON.stringify({ decision: "approve" }) });
    expect((await decide({ decision: "approve", reason: "Again" })).status).toBe(404);
  });

  // "Both require a reason" (board C1): until now only the browser asked, so credits could be granted with none.
  it("approves only with a reason, and grants nothing without one", async () => {
    await held();
    for (const reason of [null, "", "   "]) {
      const answer = await decide({ decision: "approve", reason });
      expect(answer.status, JSON.stringify(reason)).toBe(400);
      expect(await answer.json()).toMatchObject({ error: { code: "invalid_request", fields: ["reason"] } });
    }
    expect((await state())?.grant_state).toBe("held");
    expect((await creditBalance(env.DB, REFERRER, NOW)).visits).toBe(0);
  });

  it("rejects only with a reason, and grants nothing", async () => {
    await held();
    expect((await decide({ decision: "reject", reason: null })).status).toBe(400);
    expect(await (await decide({ decision: "reject", reason: "Same household" })).json()).toEqual({
      state: "rejected",
    });
    expect((await state())?.grant_state).toBe("rejected");
    expect((await creditBalance(env.DB, FRIEND, NOW)).visits).toBe(0);
  });

  // A rejected grant reached neither of them (LIFE-10).
  it("tells them both of a rejection, and never the reason ops gave", async () => {
    await held();
    const queue = fakeQueue();
    await decide({ decision: "reject", reason: "Same household" }, queue);

    expect(await messagesWritten()).toEqual([
      { person_id: REFERRER, kind: "referral_rejected", subject_id: ATTRIBUTION },
      { person_id: FRIEND, kind: "referral_rejected", subject_id: ATTRIBUTION },
    ]);
    expect(queue.sent).toHaveLength(2);
    await visitsConsent(FRIEND);
    expect(await told("referral_rejected", REFERRER)).toBe(
      "Hello Rohit, we could not give the service visits for Karan's first fit. Message us if you would like to know why.",
    );
    expect(await told("referral_rejected", FRIEND)).toBe(
      "Hello Karan, we could not give the service visits from your invite. Message us if you would like to know why.",
    );
  });
});

async function visitsConsent(personId: string, granted = true) {
  await env.DB.prepare(
    `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at)
     VALUES (?1, ?2, 'whatsapp_visits', 'referral-consultation-v1', ?3, ?4)`,
  )
    .bind(crypto.randomUUID(), personId, granted ? 1 : 0, NOW.toISOString())
    .run();
}

/** What the person's message of this kind about the referral says, or why it is not sent. */
async function told(kind: "friend_credited" | "referral_rejected", personId: string) {
  const composed =
    kind === "friend_credited"
      ? await composeFriendCredited(env.DB, ATTRIBUTION, personId)
      : await composeReferralRejected(env.DB, ATTRIBUTION, personId);
  return "skip" in composed ? composed : renderMessage(composed.template, composed.params);
}

// The tracker read the friend's name from their record, so once they were erased it read "Erased · Sep 2026" and told
// the referrer something about the friend they had no business knowing (LIFE-13).
describe("the referrer's tracker, after the friend is erased", () => {
  const tracker = async () => {
    const client = appFor("local", fakeDependencies(), {}, "client");
    const cookie = `mm_app=${await openClientSession(REFERRER)}`;
    return (await (await request(client, "/api/refer", { headers: { Cookie: cookie } })).json<{ fitted: unknown }>())
      .fitted;
  };

  it("names the friend until they are erased, then nobody, rather than writing Erased", async () => {
    await firstFit(FIT, FRIEND);
    await settleReferrals(env.DB, NOW);
    expect(await tracker()).toEqual([{ first_name: "Karan", month: "2026-09" }]);

    await erasePerson(env, FRIEND, NOW, createLogger());

    // An erasure keeps no name of theirs, not even on another client's page (open point 63, for counsel).
    expect(await tracker()).toEqual([{ first_name: null, month: "2026-09" }]);
  });

  it("names nobody for a friend erased before names were kept, rather than writing Erased", async () => {
    await firstFit(FIT, FRIEND);
    await settleReferrals(env.DB, NOW);
    await env.DB.prepare("UPDATE referral_attributions SET friend_first_name = NULL").run();
    await erasePerson(env, FRIEND, NOW, createLogger());

    expect(await tracker()).toEqual([{ first_name: null, month: "2026-09" }]);
  });
});

describe("what the friend is told (LIFE-10)", () => {
  it("that the invite's credits are theirs, without naming who invited them", async () => {
    await firstFit(FIT, FRIEND);
    await settleReferrals(env.DB, NOW);
    await visitsConsent(FRIEND);
    expect(await told("friend_credited", FRIEND)).toBe(
      "Hello Karan, your first fit is done, so the invite you came with gives you 3 service visits free, until " +
        "21 Sep 2027. They are in the app.",
    );
  });

  // The landing's consultation line is consent to WhatsApp about visits; the credits are service visits.
  it("nothing, without their consent to WhatsApp about visits", async () => {
    await firstFit(FIT, FRIEND);
    await settleReferrals(env.DB, NOW);
    expect(await told("friend_credited", FRIEND)).toEqual({ skip: "no consent to WhatsApp about visits" });
    await visitsConsent(FRIEND);
    await env.DB.prepare("UPDATE referral_attributions SET grant_state = 'rejected'").run();
    expect(await told("friend_credited", FRIEND)).toEqual({ skip: "no grant for the friend" });
  });

  it("while it is held, the app says the credits are being checked, and once rejected, that they were not given", async () => {
    const client = appFor("local", fakeDependencies(), {}, "client");
    const cookie = `mm_app=${await openClientSession(FRIEND)}`;
    const invite = async () =>
      (await (await request(client, "/api/refer", { headers: { Cookie: cookie } })).json<{ invite_credits: unknown }>())
        .invite_credits;

    expect(await invite()).toBeNull();
    await firstFit(FIT, FRIEND);
    await env.DB.prepare("UPDATE referral_attributions SET grant_state = 'held'").run();
    expect(await invite()).toBe("checking");
    await env.DB.prepare("UPDATE referral_attributions SET grant_state = 'rejected'").run();
    expect(await invite()).toBe("refused");
    await env.DB.prepare("UPDATE referral_attributions SET grant_state = 'approved'").run();
    expect(await invite()).toBeNull();
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
    await settleReferrals(env.DB, NOW);
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
