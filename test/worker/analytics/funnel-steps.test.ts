// The steps from lead to fitted on the console's Funnel page (src/domain/analytics/funnel-steps.ts,
// src/routes/ops/funnel.ts; docs/decisions/0324-the-weekly-dashboard.md): for the week of Monday 14 to Sunday
// 20 September 2026 in India, by channel, the clients fitted and their tiers, the consultations closed as a no-show,
// the middle first reply in Care hours to the week's new clients and how many of them were fitted since, and why the
// week's lost leads were lost. A test record counts for nothing. Every name here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { appFor, fakeDependencies, markDatabase, request } from "../helpers.ts";
import { aNoShow, aPerson, aTechnician, aVisit } from "../fixtures/index.ts";
import { writeRow } from "../fixtures/rows.ts";

async function client(channel: string, row: { test_record?: number } = {}): Promise<string> {
  const id = (await aPerson(row)).id ?? "";
  await writeRow(
    "person_attribution",
    {},
    { person_id: id, attributed_channel: channel, last_touch_channel: channel, updated_at: "2026-09-14T00:00:00.000Z" },
  );
  return id;
}

const aLead = (personId: string, at: string) =>
  writeRow(
    "leads",
    { id: crypto.randomUUID(), request_id: "request" },
    { person_id: personId, created_at: at, source: "form" },
  );

/** The client's first message at `wroteAt`, where they wrote, and a written reply from a Care person at `at`. */
async function replied(personId: string, wroteAt: string | null, at: string) {
  const chat = crypto.randomUUID();
  await writeRow(
    "conversations",
    {},
    {
      id: chat,
      person_id: personId,
      mobile_e164: `+9198${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
      state: "open",
      opened_at: at,
      last_message_at: at,
      created_at: at,
      updated_at: at,
    },
  );
  if (wroteAt !== null) {
    await writeRow(
      "chat_messages",
      {},
      {
        id: crypto.randomUUID(),
        conversation_id: chat,
        direction: "in",
        author: "client",
        text: "Is the consultation free?",
        sent_at: wroteAt,
        created_at: wroteAt,
      },
    );
  }
  await writeRow(
    "chat_messages",
    {},
    {
      id: crypto.randomUUID(),
      conversation_id: chat,
      direction: "out",
      author: "asha@maneman.test",
      text: "Hello from Mane Man.",
      sent_at: at,
      created_at: at,
      delivery: "sent",
    },
  );
}

const fitted = (personId: string, at: string, tier: string) =>
  aVisit({ person_id: personId, type: "first_fit", status: "completed", window_start: at, tier });

const steps = async (by: "first" | "last" = "first") => {
  const answer = await request(
    appFor("local", fakeDependencies(), {}, "ops"),
    `/api/growth/acquisition?period=week&starting=2026-09-14&by=${by}`,
  );
  expect(answer.status).toBe(200);
  return answer.json<{ rows: { channel: string; steps: unknown }[]; totals: { steps: unknown } }>();
};

beforeEach(async () => {
  await markDatabase();
  // Two Google clients the week brought: one who wrote 20 minutes after their lead, answered 10 minutes after writing
  // and fitted on premium, and one answered 30 minutes after writing and lost on price.
  const arjun = await client("google_ads");
  await aLead(arjun, "2026-09-15T06:00:00.000Z");
  await replied(arjun, "2026-09-15T06:20:00.000Z", "2026-09-15T06:30:00.000Z");
  await fitted(arjun, "2026-09-18T06:00:00.000Z", "premium");
  const kabir = await client("google_ads");
  await aLead(kabir, "2026-09-16T06:00:00.000Z");
  await replied(kabir, "2026-09-16T06:00:00.000Z", "2026-09-16T06:30:00.000Z");
  await env.DB.prepare(
    "UPDATE person_attribution SET lost_reason = 'price', lost_at = '2026-09-17T06:00:00.000Z' WHERE person_id = ?1",
  )
    .bind(kabir)
    .run();
  // A Google client who never wrote, whom Care wrote to first: no first reply to time.
  const meera = await client("google_ads");
  await aLead(meera, "2026-09-16T08:00:00.000Z");
  await replied(meera, null, "2026-09-16T08:15:00.000Z");
  // A Meta client whose consultation nobody was home for.
  const dev = await client("meta_ads");
  const technician = await aTechnician();
  const missed = await aVisit({
    person_id: dev,
    type: "consultation",
    status: "completed",
    window_start: "2026-09-17T05:00:00.000Z",
  });
  await aNoShow({ id: missed.id ?? "", technicianId: technician.id ?? "" });
  // Fitted the week before, and a test record fitted in the week: neither counts.
  const earlier = await client("google_ads");
  await fitted(earlier, "2026-09-10T06:00:00.000Z", "standard");
  const tester = await client("google_ads", { test_record: 1 });
  await fitted(tester, "2026-09-18T06:00:00.000Z", "standard");
});

describe("the steps to fitted", () => {
  it("count each channel's fitted, tiers, no-shows, first replies, new clients fitted and lost reasons", async () => {
    const { rows, totals } = await steps();
    expect(rows.find((row) => row.channel === "google_ads")?.steps).toEqual({
      fitted: 1,
      no_shows: 0,
      leads_fitted: 1,
      first_reply_minutes: 20,
      tiers: [{ tier: "premium", clients: 1 }],
      lost: [{ reason: "The price", clients: 1 }],
    });
    expect(rows.find((row) => row.channel === "meta_ads")?.steps).toMatchObject({ no_shows: 1, fitted: 0 });
    expect(totals.steps).toMatchObject({ fitted: 1, no_shows: 1, leads_fitted: 1, first_reply_minutes: 20 });
  });
});
