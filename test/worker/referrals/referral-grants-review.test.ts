// The referral grant, its fraud holds and ops' review, credit expiry and clawback (src/domain/referrals/referral-grants.ts,
// src/domain/money/credits.ts). NOW is Monday 21 September 2026, 12 noon in India. Every name and number is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { creditBalance } from "../../../src/domain/money/credits.ts";
import { settleReferrals } from "../../../src/domain/referrals/referral-grants.ts";
import { erasePerson } from "../../../src/domain/privacy/erasure.ts";
import { createLogger } from "../../../src/log.ts";
import { REFERRAL_REWARD } from "../../../src/policy/referral-reward.ts";
import {
  appFor,
  captureLogs,
  fakeDependencies,
  fakeQueue,
  fittedAndPhotographed,
  markDatabase,
  NOW,
  request,
} from "../helpers.ts";
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
    // The console asks for a reason on either decision; an approval keeps it too.
    const reviewed = await env.DB.prepare("SELECT review_reason FROM referral_attributions WHERE id = ?1")
      .bind(ATTRIBUTION)
      .first<{ review_reason: string | null }>();
    expect(reviewed?.review_reason).toBe("Father and son, two households");
    // The reason is kept with the decision; the log names the decision and stays free of what ops wrote (ADR 0031).
    const detail = await env.DB.prepare("SELECT detail FROM audit_log WHERE action = 'referral.decide'").first();
    expect(detail).toEqual({ detail: JSON.stringify({ decision: "approve" }) });
    expect((await decide({ decision: "approve", reason: "Again" })).status).toBe(404);
  });

  // "Both require a reason": until now only the browser asked, so credits could be granted with none.
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

  // A grant held for a consultation and fit never paid answered 404 to either decision, and sat on Tasks for ever.
  it("rejects a held grant whose consultation and fit is not paid, and approves it only once it is", async () => {
    await held();
    await env.DB.prepare("UPDATE appointments SET one_visit = 'fitted' WHERE id = ?1").bind(FIT).run();

    const refused = await decide({ decision: "approve", reason: "Two households" });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: { code: "not_paid" } });
    expect((await state())?.grant_state).toBe("held");
    expect((await creditBalance(env.DB, REFERRER, NOW)).visits).toBe(0);

    expect(await (await decide({ decision: "reject", reason: "Never paid" })).json()).toEqual({ state: "rejected" });
  });

  // A rejected grant reached neither of them.
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
      "Hi Rohit, we couldn't add free service visits for Karan's fit. Message us if you'd like to know why.",
    );
    expect(await told("referral_rejected", FRIEND)).toBe(
      "Hi Karan, we couldn't add free service visits from your invite. Message us if you'd like to know why.",
    );
  });
});

// The tracker read the friend's name from their record, so once they were erased it read "Erased · Sep 2026" and told
// the referrer something about the friend they had no business knowing.
describe("the referrer's tracker, after the friend is erased", () => {
  // Refer, the tracker with it, is a fitted client's.
  beforeEach(async () => {
    await fittedAndPhotographed(REFERRER);
  });

  const tracker = async () => {
    const client = appFor("local", fakeDependencies(), {}, "client");
    const cookie = `mm_app=${await openClientSession(REFERRER)}`;
    return (await (await request(client, "/api/refer", { headers: { Cookie: cookie } })).json<{ fitted: unknown }>())
      .fitted;
  };

  it("names the friend until they are erased, then nobody, rather than writing Erased", async () => {
    await firstFit(FIT, FRIEND);
    await settleReferrals(env.DB, NOW, REFERRAL_REWARD);
    expect(await tracker()).toEqual([{ first_name: "Karan", month: "2026-09", visits: 3 }]);

    await erasePerson({ env, personId: FRIEND, now: NOW, log: createLogger() });

    // An erasure keeps no name of theirs, not even on another client's page (open point 63, for counsel).
    expect(await tracker()).toEqual([{ first_name: null, month: "2026-09", visits: 3 }]);
  });

  it("names nobody for a friend erased before names were kept, rather than writing Erased", async () => {
    await firstFit(FIT, FRIEND);
    await settleReferrals(env.DB, NOW, REFERRAL_REWARD);
    await env.DB.prepare("UPDATE referral_attributions SET friend_first_name = NULL").run();
    await erasePerson({ env, personId: FRIEND, now: NOW, log: createLogger() });

    expect(await tracker()).toEqual([{ first_name: null, month: "2026-09", visits: 3 }]);
  });

  // The tracker typed 3 beside every friend, whatever the grant gave (docs/decisions/0107-referral-rewards-in-the-console.md).
  it("says beside each friend what the referrer was given for them, and nothing where it gave none", async () => {
    await rewardSet({ referrer_visits: 2, friend_visits: 3, valid_days: 365 });
    await firstFit(FIT, FRIEND);
    await referralsRun();
    const next = "55555555-5555-4555-8555-555555555555";
    await person(next, "Vikram Sethi", "+919810000003");
    await attribution("66666666-6666-4666-8666-666666666666", next);
    await firstFit("77777777-7777-4777-8777-777777777777", next, "done", "2026-09-21T03:30:00.000Z");
    await rewardSet({ referrer_visits: 0, friend_visits: 3, valid_days: 365 });
    await referralsRun();
    expect(await tracker()).toEqual([
      { first_name: "Vikram", month: "2026-09", visits: 0 },
      { first_name: "Karan", month: "2026-09", visits: 2 },
    ]);
  });
});

describe("what the friend is told", () => {
  it("that the invite's credits are theirs, without naming who invited them", async () => {
    await firstFit(FIT, FRIEND);
    await settleReferrals(env.DB, NOW, REFERRAL_REWARD);
    await visitsConsent(FRIEND);
    expect(await told("friend_credited", FRIEND)).toBe(
      "Hi Karan, welcome to Mane Man. Your invite gives you 3 service visits free, to use by 21 Sep 2027. You'll find them in the app.",
    );
  });

  // The landing's consultation line is consent to WhatsApp about visits; the credits are service visits.
  it("nothing, without their consent to WhatsApp about visits", async () => {
    await firstFit(FIT, FRIEND);
    await settleReferrals(env.DB, NOW, REFERRAL_REWARD);
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

    // Refer is the fitted client's, so the friend reads it once their first fit is done.
    await firstFit(FIT, FRIEND);
    expect(await invite()).toBeNull();
    await env.DB.prepare("UPDATE referral_attributions SET grant_state = 'held'").run();
    expect(await invite()).toBe("checking");
    await env.DB.prepare("UPDATE referral_attributions SET grant_state = 'rejected'").run();
    expect(await invite()).toBe("refused");
    await env.DB.prepare("UPDATE referral_attributions SET grant_state = 'approved'").run();
    expect(await invite()).toBeNull();
  });
});
