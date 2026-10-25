// The growth funnel for the console's Funnel page (src/routes/ops/funnel.ts): Growth had no funnel and no channel split.
// NOW is Monday 21 September 2026, 12 noon in India.

import { beforeEach, describe, expect, it } from "vitest";
import { appFor, fakeDependencies, markDatabase, request } from "../helpers.ts";
import { aPerson, aVisit } from "../fixtures/index.ts";
import { writeRow, type RowOf } from "../fixtures/rows.ts";
import { insertJob } from "../tryon-fixtures.ts";

interface Steps {
  leads: number;
  booked: number;
  consulted: number;
  fitted: number;
}

interface Funnel {
  from: string;
  to: string;
  tryons: number;
  steps: Steps;
  channels: ({ channel: string } & Steps)[];
}

/** A lead as the site's form writes one, its request named. */
const aLead = (row: RowOf<"leads">) => writeRow("leads", { request_id: "request" }, row);

beforeEach(async () => {
  await markDatabase();
});

describe("the growth funnel", () => {
  it("counts first try-ons, and each client's first lead in the period by what they went on to do and its channel", async () => {
    const google = await aPerson();
    await aLead({
      id: "lead-google",
      person_id: google.id,
      created_at: "2026-09-15T06:00:00.000Z",
      utm_source: "google",
      utm_medium: "cpc",
    });
    await aVisit({ person_id: google.id, type: "first_fit", status: "completed" });

    const direct = await aPerson();
    await aLead({ id: "lead-direct", person_id: direct.id, created_at: "2026-09-20T06:00:00.000Z" });
    await aLead({ id: "lead-direct-again", person_id: direct.id, created_at: "2026-09-20T07:00:00.000Z" });
    await aVisit({ person_id: direct.id, type: "consultation", status: "scheduled" });

    const before = await aPerson();
    await aLead({ id: "lead-before", person_id: before.id, created_at: "2026-07-01T06:00:00.000Z" });

    await insertJob({ id: "look-1" });
    await insertJob({ id: "look-2", parent_job_id: "look-1" });

    const answer = await request(appFor("local", fakeDependencies(), {}, "ops"), "/api/growth/funnel?days=30");
    expect(answer.status).toBe(200);
    const funnel = await answer.json<Funnel>();
    expect(funnel).toMatchObject({ from: "2026-08-23", to: "2026-09-21", tryons: 1 });
    expect(funnel.steps).toEqual({ leads: 2, booked: 2, consulted: 1, fitted: 1 });
    expect(funnel.channels.filter((each) => each.leads > 0)).toEqual([
      { channel: "Google Ads", leads: 1, booked: 1, consulted: 1, fitted: 1 },
      { channel: "Direct", leads: 1, booked: 1, consulted: 0, fitted: 0 },
    ]);
  });
});
