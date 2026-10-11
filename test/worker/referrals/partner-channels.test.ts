// Partners who send us clients on their own code (src/domain/referrals/channels.ts, channel-grants.ts,
// src/routes/ops/referral-channels.ts; docs/decisions/0123-partner-referral-channels.md). NOW is Monday
// 21 September 2026, 12 noon in India. Every name and number is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { renderMessage } from "../../../src/config/message-templates.ts";
import type { App } from "../../../src/http/context.ts";
import { creditBalance } from "../../../src/domain/money/credits.ts";
import { attributeToPartner, partnerInviteOf, type PartnerInvite } from "../../../src/domain/referrals/channels.ts";
import { clawBackPartnerRefunded, settlePartnerReferrals } from "../../../src/domain/referrals/channel-grants.ts";
import { composeFriendCredited } from "../../../src/domain/referrals/referral-messages.ts";
import { attribute, inviteOf } from "../../../src/domain/referrals/referrals.ts";
import { appFor, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";
import { CODE, FIT, FRIEND, REFERRER, firstFit, person } from "./referral-grants-fixtures.ts";

let ops: App;
let site: App;

interface Channels {
  channels: { id: string; name: string; code: string; referred: number; fitted: number; earned: number }[];
}

const send = (method: string, path: string, body: unknown) =>
  request(ops, path, {
    method,
    headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const TERMS = { name: "Looks Salon, Sector 29", friend_visits: 2, valid_days: 180, commission: 150000 };

async function addPartner(terms = TERMS): Promise<PartnerInvite> {
  const answer = await send("POST", "/api/referral-channels", terms);
  expect(answer.status).toBe(200);
  const added = (await answer.json<Channels>()).channels.find((each) => each.name === terms.name);
  const invite = added === undefined ? null : await partnerInviteOf(env.DB, added.code);
  if (invite === null) throw new Error("the partner was not added");
  return invite;
}

const channels = async () => (await (await request(ops, "/api/referral-channels")).json<Channels>()).channels;

beforeEach(async () => {
  await markDatabase();
  ops = appFor("local", fakeDependencies(), {}, "ops");
  site = appFor("local", fakeDependencies(), {}, "public");
  await person(FRIEND, "Karan Bhatia", "+919810000002");
});

describe("a partner", () => {
  it("is added with a code no client has, changed, and refused a name another partner has", async () => {
    const partner = await addPartner();
    expect(partner.code).toMatch(/^LS[A-HJ-NP-Z2-9]{6}$/);
    expect((await send("POST", "/api/referral-channels", { ...TERMS, name: "looks salon, sector 29" })).status).toBe(
      409,
    );
    const changed = await send("PATCH", `/api/referral-channels/${partner.channelId}`, { ...TERMS, commission: 0 });
    expect(changed.status).toBe(200);
    expect((await partnerInviteOf(env.DB, partner.code))?.partnerName).toBe(TERMS.name);
  });

  it("opens the invite page under its name and its own reward for the friend, until it is paused", async () => {
    const partner = await addPartner();
    const opened = await (await request(site, `/api/r/${partner.code}`)).json();
    expect(opened).toEqual({
      state: "valid",
      referrer_first_name: null,
      partner: TERMS.name,
      friend_visits: 2,
      card: { state: "house", version: 1 },
    });
    await send("POST", `/api/referral-channels/${partner.channelId}/pause`, { paused: true });
    expect(await (await request(site, `/api/r/${partner.code}`)).json()).toMatchObject({ state: "unknown" });
  });
});

describe("who a person came through", () => {
  it("is the first invite they used: a client's then never claims a partner's friend, nor a partner a client's", async () => {
    const partner = await addPartner();
    const through = { personId: FRIEND, via: "consultation" as const, pincode: null, now: NOW };
    expect(await attributeToPartner(env.DB, { ...through, invite: partner })).toEqual({
      outcome: "attributed",
      credits: true,
      lapsed: false,
    });

    await person(REFERRER, "Rohit Malhotra", "+919810000001");
    await env.DB.prepare("INSERT INTO referral_codes (code, person_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)")
      .bind(CODE, REFERRER, NOW.toISOString())
      .run();
    const client = await inviteOf({ db: env.DB, code: CODE, nameOnInvite: false });
    if (client === null) throw new Error("the client's code is there");
    const second = await attribute(env.DB, { ...through, invite: client, toldNotice: null });
    expect(second).toEqual({ outcome: "already_attributed", code: partner.code, credits: false, lapsed: false });
  });
});

describe("the friend, fitted", () => {
  it("gets the partner's visits, earns the partner its commission, and is told, once", async () => {
    const partner = await addPartner();
    await attributeToPartner(env.DB, {
      invite: partner,
      personId: FRIEND,
      via: "consultation",
      pincode: null,
      now: NOW,
    });
    expect(await settlePartnerReferrals(env.DB, NOW)).toMatchObject({ granted: 0 });

    await firstFit(FIT, FRIEND);
    const settled = await settlePartnerReferrals(env.DB, NOW);
    expect(settled).toMatchObject({ granted: 1, expired: 0 });
    expect(settled.messageIds).toHaveLength(1);
    expect((await creditBalance(env.DB, FRIEND, NOW)).visits).toBe(2);
    expect(await channels()).toMatchObject([{ referred: 1, fitted: 1, earned: 150000 }]);

    const attribution = await env.DB.prepare("SELECT id FROM channel_attributions WHERE referred_person_id = ?1")
      .bind(FRIEND)
      .first<{ id: string }>();
    await env.DB.prepare(
      `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at)
       VALUES ('c1', ?1, 'whatsapp_visits', 'whatsapp-visits-v1', 1, ?2)`,
    )
      .bind(FRIEND, NOW.toISOString())
      .run();
    const composed = await composeFriendCredited(env.DB, attribution?.id ?? "", FRIEND);
    expect("skip" in composed ? composed : renderMessage(composed.template, composed.params)).toBe(
      "Hi Karan, welcome to Mane Man.\nYour invite gives you 2 service visits free, to use by 20 Mar 2027. They're in the app.",
    );

    expect(await settlePartnerReferrals(env.DB, NOW)).toMatchObject({ granted: 0 });
    expect((await creditBalance(env.DB, FRIEND, NOW)).visits).toBe(2);
  });

  it("earns the commission alone where the partner gives the friend no visits", async () => {
    const partner = await addPartner({ ...TERMS, friend_visits: 0 });
    await attributeToPartner(env.DB, {
      invite: partner,
      personId: FRIEND,
      via: "consultation",
      pincode: null,
      now: NOW,
    });
    await firstFit(FIT, FRIEND);
    expect((await settlePartnerReferrals(env.DB, NOW)).messageIds).toEqual([]);
    expect((await creditBalance(env.DB, FRIEND, NOW)).visits).toBe(0);
    expect(await channels()).toMatchObject([{ fitted: 1, earned: 150000 }]);
  });

  it("gives the visits and commission back when the first fit is refunded under the guarantee", async () => {
    const partner = await addPartner();
    await attributeToPartner(env.DB, {
      invite: partner,
      personId: FRIEND,
      via: "consultation",
      pincode: null,
      now: NOW,
    });
    await firstFit(FIT, FRIEND);
    await settlePartnerReferrals(env.DB, NOW);
    await env.DB.prepare(
      `INSERT INTO payments (id, person_id, appointment_id, razorpay_payment_id, amount, currency, status,
         refunded_amount, created_at, updated_at)
       VALUES ('p1', ?1, ?2, 'pay_1', 3000000, 'INR', 'refunded', 3000000, ?3, ?3)`,
    )
      .bind(FRIEND, FIT, NOW.toISOString())
      .run();
    expect(await clawBackPartnerRefunded(env.DB, NOW)).toBe(1);
    expect((await creditBalance(env.DB, FRIEND, NOW)).visits).toBe(0);
    expect(await channels()).toMatchObject([{ fitted: 0, earned: 0 }]);
    const taken = await env.DB.prepare("SELECT clawed_back_at FROM channel_attributions WHERE referred_person_id = ?1")
      .bind(FRIEND)
      .first();
    expect(taken).toEqual({ clawed_back_at: NOW.toISOString() });
  });
});
