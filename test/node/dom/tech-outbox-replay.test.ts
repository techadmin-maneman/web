// The outbox sending what the phone holds (apps/tech/src/store/outbox.ts), on
// an IndexedDB that runs in Node and an API faked at fetch. The ordering rules
// themselves are test/node/dom/tech-outbox.test.ts; this is the store and the
// sending around them.

import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { onSessionEnded } from "../../../apps/tech/src/api.ts";
import { wipe } from "../../../apps/tech/src/store/db.ts";
import { keptArrival, keptJob } from "../../../apps/tech/src/store/jobs.ts";
import { events, frames, held, keepFrame, queue, replay, unsentJobs } from "../../../apps/tech/src/store/outbox.ts";
import { api, accepted, TAKE, answerPhotos } from "./tech-outbox-replay-fixtures.ts";

afterEach(async () => {
  vi.unstubAllGlobals();
  await wipe();
});

describe("sending what the phone holds", () => {
  it("sends each write oldest first, with its own event ID, and lets it go once it lands", async () => {
    const start = await queue("start", "a", null);
    const checklist = await queue("checklist", "a", { done: [] });
    const sent = api(() => accepted);

    expect(await replay()).toMatchObject({ sent: 2, stopped: null });
    expect(sent.map((call) => call.url)).toEqual(["/api/tech/jobs/a/start", "/api/tech/jobs/a/checklist"]);
    expect(sent.map((call) => call.eventId)).toEqual([start.id, checklist.id]);
    expect(await events()).toEqual([]);
  });

  it("keeps everything when there is no signal, to send later", async () => {
    await queue("start", "a", null);
    api(() => "offline");
    expect(await replay()).toMatchObject({ sent: 0, stopped: "offline" });
    expect(await events()).toHaveLength(1);
  });

  it("stops a job that was superseded and says what changed, and sends the other jobs", async () => {
    await queue("start", "a", null);
    await queue("start", "b", null);
    api((_method, url) =>
      url.includes("/a/")
        ? { status: 409, json: { error: { code: "superseded", request_id: "t", fields: ["technician"] } } }
        : accepted,
    );

    expect(await replay()).toMatchObject({ sent: 1, superseded: 1 });
    expect(await events()).toMatchObject([{ job_id: "a", state: "superseded", fields: ["technician"] }]);
  });

  // Open point 92: the API names the technician the job went to, by first name, and when ops moved it there.
  it("keeps whom a superseded job went to, and when, as the API said", async () => {
    await queue("start", "a", null);
    const moved = { technician: "Sameer", at: "2027-01-14T05:10:00.000Z" };
    api(() => ({
      status: 409,
      json: { error: { code: "superseded", request_id: "t", fields: ["technician"], moved } },
    }));

    await replay();
    expect(await events()).toMatchObject([{ job_id: "a", state: "superseded", fields: ["technician"], moved }]);
  });

  // The card read again is what says where the job went once it has locked again.
  it("reads a job moved to another time again, so the phone holds its new start", async () => {
    await queue("start", "a", null, "2030-09-20T10:30:00.000Z");
    const card = { id: "a", starts_at: "2030-09-21T03:30:00.000Z", client: null, partial_reasons: [] };
    const sent = api((method) =>
      method === "GET"
        ? { status: 200, json: card }
        : { status: 409, json: { error: { code: "superseded", request_id: "t", fields: ["time"] } } },
    );

    await replay();
    expect(sent.map((call) => `${call.method} ${call.url}`)).toEqual([
      "POST /api/tech/jobs/a/start",
      "GET /api/tech/jobs/a",
    ]);
    expect(await keptJob("a")).toMatchObject({ starts_at: card.starts_at });
  });

  it("does not read again a job given to someone else", async () => {
    await queue("start", "a", null);
    const sent = api(() => ({
      status: 409,
      json: { error: { code: "superseded", request_id: "t", fields: ["technician"] } },
    }));
    await replay();
    expect(sent.map((call) => call.method)).toEqual(["POST"]);
  });

  it("keeps a no-show sent before the wait ran as early, sends it no more, and the countdown goes on", async () => {
    await queue("no_show", "a", null);
    const sent = api(() => ({ status: 425, json: { error: { code: "too_early_to_close", request_id: "t" } } }));
    await replay();
    await replay();

    expect(sent).toHaveLength(1);
    expect(await events()).toEqual([expect.objectContaining({ kind: "no_show", state: "early" })]);
    expect(await held()).toEqual([]);
    expect(await unsentJobs()).toEqual(new Set());
  });

  it("keeps what a check-in measured, which no later call gives back", async () => {
    await queue("check_in", "a", { lat: 28.39, lng: 77.07 });
    const measured = {
      passed: true,
      distance_m: 40,
      radius_m: 200,
      checked_in_at: "t",
      wait_ends_at: null,
      accepted: null,
    };
    api(() => ({ status: 200, json: measured }));
    await replay();
    expect(await keptArrival("a")).toEqual(measured);
  });

  it("puts each photograph up before the set, and lets each go as it lands", async () => {
    await keepFrame({ jobId: "a", angle: "front", phase: "before", frame: new Blob(["front"]) });
    await keepFrame({ jobId: "a", angle: "top", phase: "before", frame: new Blob(["top"]) });
    await queue("before_photos", "a", { phase: "before" });
    const sent = api((method, url) => {
      if (url.endsWith("/upload-url"))
        return { status: 201, json: { upload_url: "/api/tech/photos/t", expires_at: "" } };
      if (method === "PUT") return { status: 204 };
      return accepted;
    });

    expect(await replay()).toMatchObject({ sent: 1, stopped: null });
    expect(sent.map((call) => `${call.method} ${call.url}`)).toEqual([
      "POST /api/tech/jobs/a/photos/upload-url",
      "PUT /api/tech/photos/t",
      "POST /api/tech/jobs/a/photos/upload-url",
      "PUT /api/tech/photos/t",
      "POST /api/tech/jobs/a/photos",
    ]);
    expect(await frames()).toEqual([]);
  });

  it("puts each photograph's thumbnail up after the photograph, and lets the pair go together", async () => {
    await keepFrame({
      jobId: "a",
      angle: "front",
      phase: "before",
      frame: new Blob(["front"]),
      small: new Blob(["small"]),
    });
    await queue("before_photos", "a", { phase: "before" });
    const sent = api(answerPhotos(() => ({ status: 204 })));

    expect(await replay()).toMatchObject({ sent: 1, stopped: null });
    expect(sent.map((call) => `${call.method} ${call.url}`)).toEqual([
      "POST /api/tech/jobs/a/photos/upload-url",
      "PUT /api/tech/photos/t",
      `PUT /api/tech/photos/t/small?take=${TAKE}`,
      "POST /api/tech/jobs/a/photos",
    ]);
    expect(await frames()).toEqual([]);
  });

  it("sends only the thumbnail next time, when the signal went between the photograph and it", async () => {
    await keepFrame({
      jobId: "a",
      angle: "front",
      phase: "before",
      frame: new Blob(["front"]),
      small: new Blob(["small"]),
    });
    await queue("before_photos", "a", { phase: "before" });
    api(answerPhotos(() => "offline"));
    expect(await replay()).toMatchObject({ sent: 0, stopped: "offline" });
    expect(await frames()).toMatchObject([{ angle: "front", take: TAKE }]);

    const sent = api(answerPhotos(() => ({ status: 204 })));
    await replay();
    expect(sent.map((call) => `${call.method} ${call.url}`)).toEqual([
      "POST /api/tech/jobs/a/photos/upload-url",
      `PUT /api/tech/photos/t/small?take=${TAKE}`,
      "POST /api/tech/jobs/a/photos",
    ]);
  });

  it("lets a thumbnail the API refuses go, and the set lands: the client app shows the photograph itself", async () => {
    await keepFrame({
      jobId: "a",
      angle: "front",
      phase: "before",
      frame: new Blob(["front"]),
      small: new Blob(["not small"]),
    });
    await queue("before_photos", "a", { phase: "before" });
    api(answerPhotos(() => ({ status: 422, json: { error: { code: "photo_invalid_file", request_id: "t" } } })));

    expect(await replay()).toMatchObject({ sent: 1, refused: 0, stopped: null });
    expect(await frames()).toEqual([]);
  });

  it("sends a frame kept before the phone made thumbnails without one", async () => {
    await keepFrame({ jobId: "a", angle: "front", phase: "before", frame: new Blob(["front"]) });
    await queue("before_photos", "a", { phase: "before" });
    const sent = api(answerPhotos(() => ({ status: 204 })));
    await replay();
    expect(sent.filter((call) => call.url.includes("/small"))).toEqual([]);
  });

  it("sends no thumbnail when the photograph's answer names no take, as an API from before thumbnails answers", async () => {
    await keepFrame({
      jobId: "a",
      angle: "front",
      phase: "before",
      frame: new Blob(["front"]),
      small: new Blob(["small"]),
    });
    await queue("before_photos", "a", { phase: "before" });
    const sent = api((method, url) => {
      if (url.endsWith("/upload-url")) {
        return { status: 201, json: { upload_url: "/api/tech/photos/t", small_upload_url: "", expires_at: "" } };
      }
      return method === "PUT" ? { status: 204 } : accepted;
    });
    expect(await replay()).toMatchObject({ sent: 1, stopped: null });
    expect(sent.filter((call) => call.url.includes("/small"))).toEqual([]);
    expect(await frames()).toEqual([]);
  });

  it("stops at a 401, keeps the queue, and tells the app the session has ended", async () => {
    await queue("start", "a", null);
    const heard: string[] = [];
    const stop = onSessionEnded((code) => heard.push(code));
    api(() => ({ status: 401, json: { error: { code: "device_revoked", request_id: "t" } } }));

    expect(await replay()).toMatchObject({ sent: 0, stopped: "signed-out" });
    expect(heard).toEqual(["device_revoked"]);
    stop();
  });
});

describe("one tap, one write", () => {
  it("queues a step once, however many times it is tapped", async () => {
    const first = await queue("start", "a", null);
    const second = await queue("start", "a", null);
    expect(second.id).toBe(first.id);
    expect(await events()).toHaveLength(1);
  });

  it("keeps one frame for each angle: a second of the same angle replaces the first", async () => {
    await keepFrame({ jobId: "a", angle: "front", phase: "before", frame: new Blob(["one"]) });
    await keepFrame({ jobId: "a", angle: "front", phase: "before", frame: new Blob(["two"]) });
    await keepFrame({ jobId: "a", angle: "front", phase: "after", frame: new Blob(["after"]) });
    expect((await frames()).map((frame) => `${frame.phase}-${frame.angle}`).sort()).toEqual([
      "after-front",
      "before-front",
    ]);
  });
});

describe("queuing a step", () => {
  // Two screens queuing at once both found nothing waiting, and both added one.
  it("keeps one when two screens queue the same step at once", async () => {
    await Promise.all([queue("start", "a", null), queue("start", "a", null)]);
    expect(await events()).toEqual([expect.objectContaining({ kind: "start", state: "waiting" })]);
  });
});

describe("the jobs with work still on the phone", () => {
  it("names each job with a queued write or a photograph not yet up", async () => {
    await queue("start", "a", null);
    await keepFrame({ jobId: "b", angle: "front", phase: "before", frame: new Blob(["front"]) });
    expect(await unsentJobs()).toEqual(new Set(["a", "b"]));
  });
});
