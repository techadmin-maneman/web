// The acquisition figures for the console's Funnel page (src/domain/analytics/acquisition.ts, src/routes/ops/funnel.ts;
// ADR 0288): for a week or a month, by channel, first touch or last, each client's first lead, their consultation
// booked and done, their first fit paid and its revenue, the spend, what clients told ops against their channel, and
// first try-ons. A test record counts for nothing. NOW is Monday 21 September 2026, 12 noon in India; the week asked
// for is the one before, Monday 14 to Sunday 20 September.

import { beforeEach, describe, expect, it } from "vitest";
import { appFor, fakeDependencies, markDatabase, request } from "../helpers.ts";
import { aPerson } from "../fixtures/index.ts";
import { writeRow, type RowOf } from "../fixtures/rows.ts";
import { insertJob } from "../tryon-fixtures.ts";

const aLead = (row: RowOf<"leads">) => writeRow("leads", { id: crypto.randomUUID(), request_id: "request" }, row);

const aConversion = (row: RowOf<"conversions">) =>
  writeRow(
    "conversions",
    {
      event_id: crypto.randomUUID(),
      subject_id: crypto.randomUUID(),
      meta_state: "sent",
      google_state: "sent",
      created_at: "2026-09-20T00:00:00.000Z",
    },
    row,
  );

const aSpend = (row: RowOf<"spend_entries">) =>
  writeRow(
    "spend_entries",
    {
      id: crypto.randomUUID(),
      city: null,
      source: "manual",
      entered_by: "growth@maneman.test",
      entered_at: "2026-09-20T00:00:00.000Z",
    },
    row,
  );

/** A client by Google's ad, last touched by Meta's: a lead, a consultation booked and done, and a first fit paid. */
async function fromGoogle() {
  const { id } = await aPerson();
  const touch = "touch-meta";
  await writeRow(
    "touches",
    {},
    { id: touch, at: "2026-09-15T06:00:00.000Z", via: "site", person_id: id, channel: "meta_ads", campaign_signal: 1 },
  );
  await writeRow(
    "person_attribution",
    {},
    {
      person_id: id,
      first_touch_id: touch,
      last_touch_id: touch,
      attributed_channel: "google_ads",
      last_touch_channel: "meta_ads",
      heard_from: "google",
      updated_at: "2026-09-15T06:00:00.000Z",
    },
  );
  await aLead({ person_id: id, created_at: "2026-09-15T06:00:00.000Z", touch_id: touch });
  const channels = { person_id: id, attributed_channel: "google_ads", last_touch_channel: "meta_ads" } as const;
  await aConversion({ ...channels, event: "consult_booked", occurred_at: "2026-09-15T06:05:00.000Z" });
  await aConversion({ ...channels, event: "consult_done", occurred_at: "2026-09-17T05:00:00.000Z" });
  const payment = crypto.randomUUID();
  await writeRow(
    "payments",
    {},
    {
      id: payment,
      reference: "MM-TEST-0001",
      person_id: id,
      razorpay_payment_id: "pay_fit",
      amount: 3_540_000,
      amount_ex_gst: 3_000_000,
      currency: "INR",
      method: "upi",
      status: "captured",
      captured_at: "2026-09-18T08:00:00.000Z",
      created_at: "2026-09-18T08:00:00.000Z",
      updated_at: "2026-09-18T08:00:00.000Z",
    },
  );
  await aConversion({
    ...channels,
    event: "first_fit_paid",
    subject_id: payment,
    occurred_at: "2026-09-18T08:00:00.000Z",
    value_paise: 3_000_000,
  });
}

const figures = (by: "first" | "last") =>
  request(
    appFor("local", fakeDependencies(), {}, "ops"),
    `/api/growth/acquisition?period=week&starting=2026-09-14&by=${by}`,
  );

const NOTHING = { spend: 0, leads: 0, consults_booked: 0, consults_done: 0, first_fits: 0, first_fit_revenue: 0 };

beforeEach(async () => {
  await markDatabase();
  await fromGoogle();

  const direct = await aPerson();
  await aLead({ person_id: direct.id, created_at: "2026-09-16T06:00:00.000Z" });
  await aLead({ person_id: direct.id, created_at: "2026-09-16T07:00:00.000Z" });
  await aConversion({
    person_id: direct.id,
    event: "consult_booked",
    occurred_at: "2026-09-16T07:05:00.000Z",
    attributed_channel: "direct",
    last_touch_channel: "direct",
  });

  const before = await aPerson();
  await aLead({ person_id: before.id, created_at: "2026-07-01T06:00:00.000Z" });
  const tester = await aPerson({ test_record: 1 });
  await aLead({ person_id: tester.id, created_at: "2026-09-16T06:00:00.000Z" });

  await aSpend({ month: "2026-09", spent_date: "2026-09-15", channel: "google_ads", amount: 500_000 });
  await aSpend({ month: "2026-09", spent_date: "2026-09-10", channel: "meta_ads", amount: 900_000 });
  await aSpend({ month: "2026-09", spent_date: "2026-09-19", channel: "society", amount: 200_000 });

  await insertJob({ id: "look-1", created_at: "2026-09-16T06:00:00.000Z" });
  await insertJob({ id: "look-2", parent_job_id: "look-1", created_at: "2026-09-16T06:10:00.000Z" });
});

describe("the acquisition figures", () => {
  it("count each client once by their channel, with the week's spend, revenue before GST, and first try-ons", async () => {
    const answer = await figures("first");

    expect(answer.status).toBe(200);
    expect(await answer.json()).toMatchObject({
      period: "week",
      from: "2026-09-14",
      to: "2026-09-20",
      by: "first",
      rows: [
        {
          channel: "google_ads",
          spend: 500_000,
          leads: 1,
          consults_booked: 1,
          consults_done: 1,
          first_fits: 1,
          first_fit_revenue: 3_000_000,
        },
        { channel: "direct", ...NOTHING, leads: 1, consults_booked: 1 },
        { channel: "society", ...NOTHING, spend: 200_000 },
      ],
      totals: {
        spend: 700_000,
        leads: 2,
        consults_booked: 2,
        consults_done: 1,
        first_fits: 1,
        first_fit_revenue: 3_000_000,
      },
      cohorts: [{ channel: "google_ads", clients: 1, d30: 3_000_000, d90: 3_000_000, d180: 3_000_000 }],
      cohort_complete: { d30: false, d90: false, d180: false },
      heard: [{ heard_from: "google", channel: "google_ads", clients: 1 }],
      tryons: 1,
    });
  });

  it("put the same clients under their last touch's channel when asked", async () => {
    const { rows } = await (await figures("last")).json<{ rows: { channel: string; leads: number }[] }>();

    expect(rows.map((row) => [row.channel, row.leads])).toEqual([
      ["google_ads", 0],
      ["meta_ads", 1],
      ["direct", 1],
      ["society", 0],
    ]);
  });
});
