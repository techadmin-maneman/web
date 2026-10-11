// How many round trips to D1 each of a technician's writes waits on in turn. Each is a trip to the database's region
// and back, and the phone's outbox sends them one after another, so a step that waited on 13 took most of a second
// before the reads that need nothing from each other went together. NOW is Monday 21 September 2026, 12 noon in India.

import { describe, expect, it } from "vitest";
import { d1TripsOf, request } from "../helpers.ts";
import { syntheticJpeg } from "../tryon-fixtures.ts";
import { AT_THE_DOOR, bindings, cookie, post, tech, TODAY_JOB, useFieldDay } from "./field-fixtures.ts";

useFieldDay();

/** The most trips each may wait on, the first of a run of steps that day. */
const MOST = { checkin: 10, start: 6, uploadUrl: 4, photograph: 6, smallCopy: 6, photoSet: 7, checklist: 7 };

const put = (link: string, body: Uint8Array) =>
  request(
    tech,
    link,
    { method: "PUT", headers: { Cookie: cookie, Origin: "https://maneman.test", "Content-Type": "image/jpeg" }, body },
    bindings(),
  );

describe("a technician's writes", () => {
  it("each wait on few round trips to D1", async () => {
    const trips: Record<string, number> = {};
    const noted = async (name: keyof typeof MOST, sent: Promise<Response>) => {
      const answer = await sent;
      expect(answer.status, name).toBeLessThan(300);
      trips[name] = d1TripsOf(answer);
      return answer;
    };

    await noted("checkin", post(`/api/tech/jobs/${TODAY_JOB}/checkin`, AT_THE_DOOR, "event-checkin-01"));
    await noted("start", post(`/api/tech/jobs/${TODAY_JOB}/start`, undefined, "event-start-01"));
    const links = await noted(
      "uploadUrl",
      post(`/api/tech/jobs/${TODAY_JOB}/photos/upload-url`, { phase: "before", angle: "front" }, "event-link-01"),
    );
    const { upload_url: full, small_upload_url: small } = await links.json<{
      upload_url: string;
      small_upload_url: string;
    }>();
    const took = await noted("photograph", put(full, syntheticJpeg(1200, 1600, "front")));
    const { take } = await took.json<{ take: string }>();
    await noted("smallCopy", put(`${small}?take=${take}`, syntheticJpeg(300, 400, "front, small")));
    await noted("photoSet", post(`/api/tech/jobs/${TODAY_JOB}/photos`, { phase: "before" }, "event-photos-01"));
    await noted("checklist", post(`/api/tech/jobs/${TODAY_JOB}/checklist`, { done: [] }, "event-checklist-01"));

    for (const [name, most] of Object.entries(MOST)) expect(trips[name], name).toBeLessThanOrEqual(most);
  });
});
