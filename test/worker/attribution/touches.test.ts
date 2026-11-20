// Where a client came from (ADR 0288): a page's landing kept as its visitor's touch, the first and any a campaign put
// something in; /book's first step making the visitor's touches the person's, with the lead's own touch, its address
// and browser, the notice it showed and its event for Meta; a number we hold keeping its first touch; and a society's
// link, a friend's code and Meta's click ID read by the channel rule. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { AD_NOTICE } from "../../../src/config/notices.ts";
import { addCampaignLink } from "../../../src/domain/growth/campaign-links.ts";
import { aPerson } from "../fixtures/index.ts";
import { fakeQueue, markDatabase, request } from "../helpers.ts";
import { site } from "../site/consultations-fixtures.ts";

const VISITOR = "0f8c2b1e-1111-4111-8111-111111111111";
const OTHER_VISITOR = "0f8c2b1e-2222-4222-8222-222222222222";
const EVENT_ID = "6c1f2b8e-3333-4333-8333-333333333333";

const headers = (visitor: string | null) => ({
  "Content-Type": "application/json",
  "User-Agent": "Mozilla/5.0 (iPhone) Test",
  "CF-Connecting-IP": "203.0.113.7",
  ...(visitor === null ? {} : { Cookie: `mm_vid_local=${visitor}` }),
});

const visit = (touch: object, visitor: string | null = VISITOR) =>
  request(site(), "/api/landings", { method: "POST", headers: headers(visitor), body: JSON.stringify(touch) });

const LEAD = { name: "Karan Bhatia", mobile: "9810000002", consent: true, terms: true, turnstile_token: "token" };

const leave = (body: object, visitor: string | null = VISITOR) =>
  request(
    site(),
    "/api/lead",
    { method: "POST", headers: headers(visitor), body: JSON.stringify({ ...LEAD, ...body }) },
    { CRM_QUEUE: fakeQueue(), MESSAGE_QUEUE: fakeQueue() },
  );

const rows = async (sql: string) => (await env.DB.prepare(sql).all()).results;

const attribution = () =>
  env.DB.prepare(
    `SELECT a.attributed_channel, a.last_touch_channel, f.gclid AS first_gclid, l.utm_source AS last_source
     FROM person_attribution a JOIN touches f ON f.id = a.first_touch_id JOIN touches l ON l.id = a.last_touch_id`,
  ).first();

beforeEach(async () => {
  await markDatabase();
});

describe("a page's landing", () => {
  it("is its visitor's first touch, with the reference their WhatsApp message ends with", async () => {
    const answer = await visit({ landing_path: "/try", gclid: "Cj0KCQ_test", utm_source: "google", utm_medium: "cpc" });

    expect(answer.status).toBe(200);
    const { ref } = await answer.json<{ ref: string }>();
    expect(ref).toMatch(/^[2-9A-HJ-NP-Z]{5}$/);
    expect(
      await rows("SELECT via, channel, campaign_signal, gclid, person_id, user_agent, client_ip FROM touches"),
    ).toEqual([
      {
        via: "site",
        channel: "google_ads",
        campaign_signal: 1,
        gclid: "Cj0KCQ_test",
        person_id: null,
        user_agent: null,
        client_ip: null,
      },
    ]);
  });

  it("records nothing more for a plain visit later, and a touch for a campaign's, the same reference each time", async () => {
    const first = await (await visit({ landing_path: "/" })).json<{ ref: string }>();
    const plain = await (await visit({ landing_path: "/book", referrer: "https://www.google.com/" })).json();
    const tagged = await (await visit({ landing_path: "/", fbclid: "IwAR_test" })).json();

    expect(plain).toEqual(first);
    expect(tagged).toEqual(first);
    expect(await rows("SELECT channel FROM touches ORDER BY rowid")).toEqual([
      { channel: "direct" },
      { channel: "organic_social" },
    ]);
  });

  it("keeps nothing for a browser the site gave no visitor cookie", async () => {
    expect(await (await visit({ landing_path: "/", gclid: "x" }, null)).json()).toEqual({ ref: null });
    expect(await rows("SELECT id FROM touches")).toEqual([]);
  });
});

describe("/book's first step", () => {
  it("makes the visitor's touches the person's, the first their channel, the lead's own the last", async () => {
    await visit({ landing_path: "/try", gclid: "Cj0KCQ_test", utm_source: "google", utm_medium: "cpc" });
    const answer = await leave({
      attribution: { landing_path: "/book", utm_source: "meta", utm_medium: "paid_social", fbclid: "IwAR_test" },
      event_id: EVENT_ID,
      ad_notice: AD_NOTICE.version,
    });

    expect(answer.status).toBe(201);
    expect(await attribution()).toEqual({
      attributed_channel: "google_ads",
      last_touch_channel: "meta_ads",
      first_gclid: "Cj0KCQ_test",
      last_source: "meta",
    });
    expect(await rows("SELECT COUNT(*) AS n FROM touches WHERE person_id IS NULL")).toEqual([{ n: 0 }]);
    const [lead] = await rows(
      `SELECT l.ad_notice, t.user_agent, t.client_ip, t.fbc FROM leads l JOIN touches t ON t.id = l.touch_id`,
    );
    expect(lead).toEqual({
      ad_notice: AD_NOTICE.version,
      user_agent: "Mozilla/5.0 (iPhone) Test",
      client_ip: "203.0.113.7",
      fbc: expect.stringMatching(/^fb\.1\.\d{13}\.IwAR_test$/) as string,
    });
    expect(await rows("SELECT event_id, event, meta_state, google_state, google_error FROM conversions")).toEqual([
      {
        event_id: EVENT_ID,
        event: "lead_submit",
        meta_state: "pending",
        google_state: "skipped",
        google_error: "browser_only",
      },
    ]);
  });

  it("keeps neither Meta's cookies nor the address and browser of a visitor who declined the cookie bar", async () => {
    await leave({
      attribution: {
        landing_path: "/book",
        fbclid: "IwAR_test",
        fbp: "fb.1.1795156200000.123456789",
        ad_consent: "denied",
      },
    });

    expect(await rows("SELECT ad_consent, fbc, fbp, user_agent, client_ip, fbclid FROM touches")).toEqual([
      { ad_consent: "denied", fbc: null, fbp: null, user_agent: null, client_ip: null, fbclid: "IwAR_test" },
    ]);
  });

  it("keeps a number's first touch when it comes again from another source, and adds the new one", async () => {
    await visit({ landing_path: "/", gclid: "Cj0KCQ_first" });
    await leave({ attribution: { landing_path: "/book", gclid: "Cj0KCQ_first" } });
    await visit({ landing_path: "/", utm_source: "meta", utm_medium: "paid_social" }, OTHER_VISITOR);
    await leave(
      { attribution: { landing_path: "/book", utm_source: "meta", utm_medium: "paid_social" } },
      OTHER_VISITOR,
    );

    expect(await rows("SELECT COUNT(*) AS leads FROM leads")).toEqual([{ leads: 1 }]);
    expect(await rows("SELECT COUNT(*) AS touches FROM touches WHERE person_id IS NOT NULL")).toEqual([{ touches: 4 }]);
    expect(await attribution()).toEqual({
      attributed_channel: "google_ads",
      last_touch_channel: "meta_ads",
      first_gclid: "Cj0KCQ_first",
      last_source: "meta",
    });
  });
});

describe("our codes", () => {
  it("send a society's link to /book with its tags and code, and its touch is the society's", async () => {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO serviceable_pincodes (pincode, area, city, served) VALUES ('122002', 'DLF Phase 1', 'Gurgaon', 1)",
    ).run();
    const made = await addCampaignLink(env.DB, {
      actor: { kind: "staff", id: "growth@maneman.in" },
      requestId: "r",
      now: new Date("2026-09-21T06:30:00Z"),
      link: {
        kind: "society",
        name: "Green Valley Towers",
        pincode: "122002",
        heldDate: "2026-09-26",
        costs: [{ line: "stall", amount: 500_000, note: null }],
        discountCodeId: null,
      },
    });
    if (typeof made === "string") throw new Error(made);

    const landing = await request(site(), `/api/links/s/${made.slug}`);
    const { landing: path } = await landing.json<{ landing: string }>();
    expect(path).toBe(
      `/book?utm_source=society&utm_medium=offline&utm_campaign=green-valley-towers-20260926&soc=${made.code}`,
    );
    await visit({ landing_path: "/book", utm_source: "society", utm_medium: "offline", soc: made.code });

    expect(await rows("SELECT channel, code_kind, link_id FROM touches")).toEqual([
      { channel: "society", code_kind: "society", link_id: made.id },
    ]);
    expect(
      await rows("SELECT spent_date, channel, campaign, amount, source, cost_line, city FROM spend_entries"),
    ).toEqual([
      {
        spent_date: "2026-09-26",
        channel: "society",
        campaign: "green-valley-towers-20260926",
        amount: 500_000,
        source: "link",
        cost_line: "stall",
        city: "Gurgaon",
      },
    ]);
    expect((await request(site(), "/api/links/s/no-such-society")).status).toBe(404);
  });

  it("read a friend's invite in ?ref as a referral, over the ad that brought them", async () => {
    await aPerson({ id: "friend", mobile_e164: "+919810000099", name: "Asha Rao" });
    await env.DB.prepare(
      "INSERT INTO referral_codes (code, person_id, created_at, updated_at) VALUES ('ASHA42', 'friend', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')",
    ).run();
    await visit({ landing_path: "/", ref: "asha42", gclid: "Cj0KCQ_test" });

    expect(await rows("SELECT channel, code_kind, invite_code FROM touches")).toEqual([
      { channel: "referral", code_kind: "friend", invite_code: "ASHA42" },
    ]);
  });
});
