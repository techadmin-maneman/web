// A consultation's Options on the technician's phone (src/routes/tech/options.ts): each package on sale with what it
// costs the client, from the price book, and the client's try-on looks, each opened through the job. NOW is Monday 21
// September 2026, 12 noon in India. Every name here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { markDatabase } from "../helpers.ts";
import { aPackage } from "../fixtures/index.ts";
import { JOB, PERSON, working } from "../job-fixtures.ts";
import { insertJob, insertPerson, syntheticPng } from "../tryon-fixtures.ts";

interface Options {
  packages: {
    code: string;
    name: string;
    first_fit: { amount_ex_gst: number };
    service: { amount_ex_gst: number } | null;
    service_every_days: number;
    replacement: { amount_ex_gst: number } | null;
    replace_after_months: number;
  }[];
  looks: { id: string; made_on: string; url: string }[];
}

const THEIRS = "44444444-4444-4444-8444-444444444441";
const SOMEONE_ELSES = "44444444-4444-4444-8444-444444444442";
const OTHER = "55555555-5555-4555-8555-555555555551";

/** A look made yesterday from a photograph the client proved their number for, held until its day. */
async function madeLook(id: string, personId: string) {
  await insertJob({
    id,
    person_id: personId,
    created_at: "2026-09-20T06:00:00.000Z",
    uploaded_at: "2026-09-20T06:00:00.000Z",
    state: "ready",
    result_key: `results/${id}.png`,
    expires_at: "2026-10-04T06:00:00.000Z",
    number_proved_at: "2026-09-20T06:00:00.000Z",
  });
  await env.RESULTS.put(`results/${id}.png`, syntheticPng(4, 4), { httpMetadata: { contentType: "image/png" } });
}

beforeEach(async () => {
  await markDatabase();
});

describe("a consultation's options", () => {
  it("lists each package on sale with what it costs, and opens the client's looks through the job", async () => {
    const job = await working("consultation");
    await aPackage({
      code: "essential",
      name: "Mane Man Essential",
      firstFit: 3_200_000,
      everyDays: 30,
      afterMonths: 6,
    });
    await madeLook(THEIRS, PERSON);

    const response = await job.get(`/api/tech/jobs/${JOB}/options`);
    expect(response.status).toBe(200);
    const options = await response.json<Options>();
    expect(options.packages.find((each) => each.code === "essential")).toMatchObject({
      name: "Mane Man Essential",
      first_fit: { amount_ex_gst: 3_200_000 },
      service: { amount_ex_gst: 200_000 },
      service_every_days: 30,
      replacement: { amount_ex_gst: 1_500_000 },
      replace_after_months: 6,
    });
    expect(options.looks).toEqual([
      { id: THEIRS, made_on: "2026-09-20", url: `/api/tech/jobs/${JOB}/looks/${THEIRS}` },
    ]);

    const look = await job.get(`/api/tech/jobs/${JOB}/looks/${THEIRS}`);
    expect(look.status).toBe(200);
    expect(look.headers.get("Content-Type")).toBe("image/png");
    expect(look.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("opens no other client's look through the job", async () => {
    const job = await working("consultation");
    await insertPerson(OTHER, "+919810000003", "Someone Else");
    await madeLook(SOMEONE_ELSES, OTHER);
    expect((await (await job.get(`/api/tech/jobs/${JOB}/options`)).json<Options>()).looks).toEqual([]);
    expect((await job.get(`/api/tech/jobs/${JOB}/looks/${SOMEONE_ELSES}`)).status).toBe(404);
  });

  it("is a consultation's alone", async () => {
    const job = await working("service");
    await madeLook(THEIRS, PERSON);
    expect((await job.get(`/api/tech/jobs/${JOB}/options`)).status).toBe(404);
    expect((await job.get(`/api/tech/jobs/${JOB}/looks/${THEIRS}`)).status).toBe(404);
  });
});
