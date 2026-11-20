// What attribution keeps up each hour (src/domain/attribution/backfill.ts; ADR 0288): a lead from before touches given
// one from what it was saved with, and its client's attribution with it, Care's old "How they found us" becoming their
// answer; and what retention lets go: a touch's address and browser after 90 days, and a visitor no number named,
// with their touches, 13 months after their last. NOW is Monday 21 September 2026. Every name here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { letAttributionGo, touchOldLeads } from "../../../src/domain/attribution/backfill.ts";
import { markDatabase, NOW } from "../helpers.ts";
import { aPerson } from "../fixtures/index.ts";
import { writeRow } from "../fixtures/rows.ts";

const rows = async (sql: string) => (await env.DB.prepare(sql).all()).results;

const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

beforeEach(async () => {
  await markDatabase();
});

describe("an old lead", () => {
  it("is given a touch from what it was saved with, its client the channel, and Care's answer kept", async () => {
    const { id } = await aPerson();
    await writeRow(
      "leads",
      { id: "old-lead", request_id: "r" },
      {
        person_id: id,
        created_at: "2026-08-01T06:00:00.000Z",
        utm_source: "google",
        utm_medium: "cpc",
        gclid: "Cj0KCQ_old",
        found_us: "partner",
      },
    );

    expect(await touchOldLeads(env.DB)).toBe(1);
    expect(await rows("SELECT at, via, channel, gclid FROM touches")).toEqual([
      { at: "2026-08-01T06:00:00.000Z", via: "site", channel: "google_ads", gclid: "Cj0KCQ_old" },
    ]);
    expect(await rows("SELECT touch_id IS NOT NULL AS touched FROM leads")).toEqual([{ touched: 1 }]);
    expect(await rows("SELECT attributed_channel, heard_from, heard_from_by FROM person_attribution")).toEqual([
      { attributed_channel: "google_ads", heard_from: "salon_partner", heard_from_by: "care" },
    ]);
    expect(await touchOldLeads(env.DB)).toBe(0);
  });
});

describe("retention", () => {
  it("lets a touch's address and browser go after 90 days, an unnamed visitor after 13 months, a stranger's chat after 12", async () => {
    const { id } = await aPerson();
    await writeRow(
      "visitors",
      {},
      { id: "named", ref: "AAAAA", person_id: id, created_at: daysAgo(500), seen_at: daysAgo(500) },
    );
    await writeRow("visitors", {}, { id: "unnamed", ref: "BBBBB", created_at: daysAgo(500), seen_at: daysAgo(400) });
    await writeRow("visitors", {}, { id: "recent", ref: "CCCCC", created_at: daysAgo(30), seen_at: daysAgo(30) });
    const touch = (touchId: string, visitor: string, at: string, personId: string | null) =>
      writeRow(
        "touches",
        {},
        {
          id: touchId,
          at,
          via: "site",
          visitor_id: visitor,
          person_id: personId,
          channel: "direct",
          campaign_signal: 0,
          user_agent: "Mozilla/5.0",
          client_ip: "203.0.113.7",
        },
      );
    await touch("old-named", "named", daysAgo(100), id ?? null);
    await touch("old-unnamed", "unnamed", daysAgo(400), null);
    await touch("fresh", "recent", daysAgo(30), null);
    await writeRow(
      "touches",
      {},
      {
        id: "old-chat",
        at: daysAgo(370),
        via: "whatsapp",
        mobile_e164: "+919811112222",
        channel: "whatsapp",
        campaign_signal: 0,
      },
    );
    await writeRow(
      "touches",
      {},
      {
        id: "new-chat",
        at: daysAgo(30),
        via: "whatsapp",
        mobile_e164: "+919811113333",
        channel: "whatsapp",
        campaign_signal: 0,
      },
    );

    await letAttributionGo(env.DB, NOW);

    expect(await rows("SELECT id FROM visitors ORDER BY id")).toEqual([{ id: "named" }, { id: "recent" }]);
    expect(await rows("SELECT id, user_agent, client_ip FROM touches ORDER BY id")).toEqual([
      { id: "fresh", user_agent: "Mozilla/5.0", client_ip: "203.0.113.7" },
      { id: "new-chat", user_agent: null, client_ip: null },
      { id: "old-named", user_agent: null, client_ip: null },
    ]);
  });
});
