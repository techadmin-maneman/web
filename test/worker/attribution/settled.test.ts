// A client's channel settles when their first consultation is booked (ADR 0288): a code of ours that reaches us after
// it is kept, but never becomes their channel. Where their attribution was made only after the booking was recorded,
// as for a client whose history migration 0227 recorded, the booking's own time settles it. Every name is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { refreshAttribution } from "../../../src/domain/attribution/attribution.ts";
import { markDatabase, NOW } from "../helpers.ts";
import { aPerson } from "../fixtures/index.ts";
import { writeRow } from "../fixtures/rows.ts";

const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

beforeEach(async () => {
  await markDatabase();
});

describe("a client's channel", () => {
  it("stays their first touch's for a society's code after a booking recorded before their attribution", async () => {
    const { id } = await aPerson();
    const personId = id ?? "";
    await writeRow(
      "touches",
      {},
      { id: "first", at: daysAgo(40), via: "site", person_id: personId, channel: "google_ads", campaign_signal: 1 },
    );
    await writeRow(
      "conversions",
      {},
      {
        event_id: "booked-before",
        event: "consult_booked",
        subject_id: "a-visit",
        person_id: personId,
        occurred_at: daysAgo(30),
        attributed_channel: "direct",
        last_touch_channel: "direct",
        meta_state: "skipped",
        meta_error: "before_release",
        google_state: "skipped",
        google_error: "before_release",
        created_at: daysAgo(1),
      },
    );
    await writeRow(
      "touches",
      {},
      {
        id: "society-later",
        at: daysAgo(10),
        via: "site",
        person_id: personId,
        channel: "society",
        code_kind: "society",
        campaign_signal: 1,
      },
    );

    await refreshAttribution(env.DB, personId, NOW);

    expect(
      await env.DB.prepare("SELECT attributed_channel, last_touch_channel, settled_at FROM person_attribution").all(),
    ).toMatchObject({
      results: [{ attributed_channel: "google_ads", last_touch_channel: "society", settled_at: null }],
    });
  });
});
