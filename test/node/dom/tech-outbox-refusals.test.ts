// The outbox sending what the phone holds (apps/tech/src/store/outbox.ts), on
// an IndexedDB that runs in Node and an API faked at fetch. The ordering rules
// themselves are test/node/dom/tech-outbox.test.ts; this is the store and the
// sending around them.

import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type JobSummary } from "../../../apps/tech/src/api.ts";
import { wipe } from "../../../apps/tech/src/store/db.ts";
import {
  keepArrival,
  keepClosed,
  keepDay,
  keptArrival,
  keptClosed,
  keptDay,
} from "../../../apps/tech/src/store/jobs.ts";
import {
  checkInRefusedAsEarly,
  correct,
  events,
  forget,
  frames,
  keepFrame,
  queue,
  refusedAsEarly,
  replay,
} from "../../../apps/tech/src/store/outbox.ts";
import { api, accepted, answerPhotos } from "./tech-outbox-replay-fixtures.ts";

afterEach(async () => {
  vi.unstubAllGlobals();
  await wipe();
});

/** Job "a" on the day the phone holds, as the list said it before anything of it landed. */
const kept = (): JobSummary =>
  ({ id: "a", date: "2030-09-19", progress: { started_at: null, outcome: null } }) as JobSummary;

describe("a write the job has moved under", () => {
  it("carries the job's start as the phone held it when it was queued", async () => {
    await queue("start", "a", null, "2030-09-19T04:00:00.000Z");
    const sent = api(() => accepted);
    await replay();
    expect(sent.map((call) => call.startsAt)).toEqual(["2030-09-19T04:00:00.000Z"]);
  });

  // A card read again after ops moved the visit would otherwise carry the new start, and the move go unnoticed.
  it("carries the start seen at check-in on every later step, however the card reads since", async () => {
    const sent = api(() => accepted);
    await queue("check_in", "a", { lat: 28.39, lng: 77.07 }, "2030-09-19T04:00:00.000Z");
    await replay();
    await queue("start", "a", null, "2030-09-20T03:30:00.000Z");
    await queue("checklist", "a", { done: [] }, "2030-09-20T03:30:00.000Z");
    await replay();
    expect(sent.map((call) => call.startsAt)).toEqual([
      "2030-09-19T04:00:00.000Z",
      "2030-09-19T04:00:00.000Z",
      "2030-09-19T04:00:00.000Z",
    ]);
  });

  it("takes the card's start again once the technician has let go of the job's work and checks in afresh", async () => {
    const sent = api(() => accepted);
    await queue("check_in", "a", { lat: 28.39, lng: 77.07 }, "2030-09-19T04:00:00.000Z");
    await replay();
    await forget("a");
    await queue("check_in", "a", { lat: 28.39, lng: 77.07 }, "2030-09-20T03:30:00.000Z");
    await queue("start", "a", null, "2030-09-20T03:30:00.000Z");
    await replay();
    expect(sent.map((call) => call.startsAt)).toEqual([
      "2030-09-19T04:00:00.000Z",
      "2030-09-20T03:30:00.000Z",
      "2030-09-20T03:30:00.000Z",
    ]);
  });

  it("stops a job whose photographs' links are refused as no longer this technician's, as moved", async () => {
    await keepFrame({ jobId: "a", angle: "front", phase: "before", frame: new Blob(["front"]) });
    await queue("before_photos", "a", { phase: "before" });
    api(() => ({ status: 404, json: { error: { code: "not_found", request_id: "t" } } }));

    expect(await replay()).toMatchObject({ superseded: 1, refused: 0 });
    expect(await events()).toMatchObject([{ state: "superseded", note: "not_found" }]);
    // The photograph stays until the technician has read what changed and said to delete it.
    expect(await frames()).toHaveLength(1);
  });

  // Open point 92: the link's refusal names whom the job went to, and when, as a refused write's does.
  it("stops a job whose photographs' links say it went to another technician, keeping whom and when", async () => {
    await keepFrame({ jobId: "a", angle: "front", phase: "before", frame: new Blob(["front"]) });
    await queue("before_photos", "a", { phase: "before" });
    const moved = { technician: "Sameer", at: "2027-01-14T05:10:00.000Z" };
    api(() => ({
      status: 409,
      json: { error: { code: "superseded", request_id: "t", fields: ["technician"], moved } },
    }));

    expect(await replay()).toMatchObject({ superseded: 1, refused: 0 });
    expect(await events()).toMatchObject([{ state: "superseded", note: "superseded", fields: ["technician"], moved }]);
    expect(await frames()).toHaveLength(1);
  });

  it("stops a write the API answers 404 the same way", async () => {
    await queue("checklist", "a", { done: [] });
    api(() => ({ status: 404, json: { error: { code: "not_found", request_id: "t" } } }));
    await replay();
    expect(await events()).toMatchObject([{ state: "superseded", note: "not_found" }]);
  });
});

describe("a step the API refused", () => {
  it("goes again with what was corrected, in its place, and what waited behind it follows", async () => {
    await queue("piece", "a", { piece_code: "MM-STD-7193 C" });
    await queue("outcome", "a", { outcome: "done" });
    api((_method, url) =>
      url.endsWith("/piece")
        ? { status: 400, json: { error: { code: "invalid_request", request_id: "t", fields: ["piece_code"] } } }
        : accepted,
    );
    await replay();
    const [refused] = await events();
    expect(refused).toMatchObject({ kind: "piece", state: "refused", fields: ["piece_code"] });

    await correct(refused?.seq ?? 0, { piece_code: "MM-STD-7193-C" });
    const sent = api(() => accepted);
    await replay();
    expect(sent.map((call) => call.url)).toEqual(["/api/tech/jobs/a/piece", "/api/tech/jobs/a/outcome"]);
    expect(await events()).toEqual([]);
  });

  // Without the report, nobody but the technician would know the write never landed.
  it("keeps the refusal's request ID for the waiting screen, and reports the give-up", async () => {
    await queue("piece", "a", { piece_code: "MM-STD-0000-A" });
    const refusal = { error: { code: "piece_code", request_id: "0192a8e4-0000-7000-8000-0000000000aa" } };
    const reports: unknown[] = [];
    vi.stubGlobal("window", { location: { pathname: "/jobs/a/piece" } });
    vi.stubGlobal("fetch", (url: string, init: RequestInit = {}) => {
      if (url === "/api/client-errors") reports.push(JSON.parse(init.body as string));
      const body = JSON.stringify(refusal);
      return Promise.resolve(new Response(body, { status: 422, headers: { "Content-Type": "application/json" } }));
    });

    expect(await replay()).toMatchObject({ refused: 1 });
    expect(await events()).toMatchObject([
      { state: "refused", note: "piece_code", request_id: refusal.error.request_id },
    ]);
    expect(reports).toEqual([
      {
        kind: "outbox_gave_up",
        message: "piece refused: piece_code",
        step: "piece",
        code: "piece_code",
        status: 422,
        request_id: refusal.error.request_id,
        path: "/jobs/a/piece",
      },
    ]);
  });
});

// A refused set had no way back but deleting the job's work.
describe("a photograph the API refuses", () => {
  /** The photographs' calls answered as the API does, which refuses an empty file, as a frame evicted from the phone. */
  function refusingEmptyFiles() {
    return api((method, url, body) => {
      if (body instanceof Blob && body.size === 0) {
        return { status: 422, json: { error: { code: "photo_invalid_file", request_id: "t" } } };
      }
      return answerPhotos(() => ({ status: 204 }))(method, url);
    });
  }

  it("is marked, the others still go up, and the set stops for it to be taken again", async () => {
    await keepFrame({ jobId: "a", angle: "front", phase: "before", frame: new Blob(["front"]) });
    await keepFrame({ jobId: "a", angle: "top", phase: "before", frame: new Blob([]) });
    await keepFrame({ jobId: "a", angle: "left", phase: "before", frame: new Blob(["left"]) });
    await queue("before_photos", "a", { phase: "before" });
    await queue("checklist", "a", { done: [] });
    const sent = refusingEmptyFiles();

    expect(await replay()).toMatchObject({ sent: 0, refused: 1 });
    expect(sent.filter((call) => call.method === "PUT")).toHaveLength(3);
    expect(sent.filter((call) => call.url === "/api/tech/jobs/a/photos")).toEqual([]);
    expect(await frames()).toMatchObject([{ angle: "top", refused: true }]);
    expect(await events()).toMatchObject([
      { kind: "before_photos", state: "refused", note: "photo_rejected" },
      { kind: "checklist", state: "waiting" },
    ]);
  });

  it("taken again, goes up alone, and the set and what waited behind it follow", async () => {
    await keepFrame({ jobId: "a", angle: "front", phase: "before", frame: new Blob(["front"]) });
    await keepFrame({ jobId: "a", angle: "top", phase: "before", frame: new Blob([]) });
    await queue("before_photos", "a", { phase: "before" });
    await queue("checklist", "a", { done: [] });
    refusingEmptyFiles();
    await replay();

    await keepFrame({ jobId: "a", angle: "top", phase: "before", frame: new Blob(["top"]) });
    expect(await frames()).toEqual([expect.not.objectContaining({ refused: true })]);
    const [set] = await events();
    await correct(set?.seq ?? 0, { phase: "before" });
    const sent = api(answerPhotos(() => ({ status: 204 })));

    expect(await replay()).toMatchObject({ sent: 2, refused: 0 });
    expect(sent.map((call) => `${call.method} ${call.url}`)).toEqual([
      "POST /api/tech/jobs/a/photos/upload-url",
      "PUT /api/tech/photos/t",
      "POST /api/tech/jobs/a/photos",
      "POST /api/tech/jobs/a/checklist",
    ]);
    expect(await frames()).toEqual([]);
    expect(await events()).toEqual([]);
  });

  it("is not marked when the set's link is refused rather than the file", async () => {
    await keepFrame({ jobId: "a", angle: "front", phase: "before", frame: new Blob(["front"]) });
    await queue("before_photos", "a", { phase: "before" });
    api(() => ({ status: 400, json: { error: { code: "invalid_request", request_id: "t", fields: ["phase"] } } }));

    expect(await replay()).toMatchObject({ refused: 1 });
    expect(await frames()).toEqual([expect.not.objectContaining({ refused: true })]);
  });
});

describe("a step the API says is early", () => {
  // The card's warning was held in memory, and went with a reload.
  it("is kept, so the card can tell a no-show was refused rather than sent, until one lands", async () => {
    await queue("no_show", "a", null);
    api(() => ({ status: 425, json: { error: { code: "too_early_to_close", request_id: "t" } } }));
    await replay();
    expect(refusedAsEarly(await events(), "a")).toBe(true);

    await queue("no_show", "a", null);
    expect(refusedAsEarly(await events(), "a")).toBe(true);
    api(() => ({ status: 200, json: { closed: true, wait_ends_at: "t", case_id: null, accepted: null } }));
    await replay();
    expect(refusedAsEarly(await events(), "a")).toBe(false);
    expect(await events()).toEqual([]);
  });

  it("keeps one early refusal a job's step at a time", async () => {
    const early = () => ({ status: 425, json: { error: { code: "too_early_to_arrive", request_id: "t" } } });
    await queue("check_in", "a", { lat: 28.39, lng: 77.07 });
    api(early);
    await replay();
    await queue("check_in", "a", { lat: 28.39, lng: 77.07 });
    await replay();

    expect(await events()).toEqual([expect.objectContaining({ kind: "check_in", state: "early" })]);
    expect(checkInRefusedAsEarly(await events(), "a")).toBe(true);
  });
});

describe("where a job stands, once a write of its lands", () => {
  // With no signal, the row of a job started since the list was kept lost its "In progress".
  it("is kept in the day the phone holds, from the write's answer", async () => {
    await keepDay("2030-09-19", [kept()]);
    await queue("start", "a", null);
    const progress = { started_at: "2030-09-19T04:05:00.000Z", outcome: null };
    api(() => ({ status: 202, json: { ...accepted.json, progress } }));

    await replay();

    expect((await keptDay("2030-09-19"))?.[0]?.progress).toEqual({
      started_at: "2030-09-19T04:05:00.000Z",
      outcome: null,
    });
  });

  it("is kept from a no-show's answer, which carries the step it recorded", async () => {
    await keepDay("2030-09-19", [kept()]);
    await queue("no_show", "a", null);
    const recorded = { ...accepted.json, progress: { started_at: null, outcome: "no_show" } };
    api(() => ({ status: 200, json: { closed: true, wait_ends_at: "t", case_id: null, accepted: recorded } }));

    await replay();

    expect((await keptDay("2030-09-19"))?.[0]?.progress).toEqual({ started_at: null, outcome: "no_show" });
  });
});

// After "Got it" deleted a job's work, Today still read "Closed out" from the phone's own close-out mark.
describe("letting go of a job's stopped work", () => {
  it("lets go of its arrival and close-out too, since only what landed speaks for the job", async () => {
    await keepArrival("a", {
      passed: true,
      distance_m: 40,
      radius_m: 200,
      checked_in_at: "t",
      wait_ends_at: null,
      accepted: null,
    });
    await keepClosed("a", 1);
    await keepClosed("b", 2);
    await queue("outcome", "a", { outcome: "done" });
    api(() => ({ status: 409, json: { error: { code: "superseded", request_id: "t", fields: ["time"] } } }));
    await replay();

    await forget("a");

    expect(await events()).toEqual([]);
    expect(await keptArrival("a")).toBeNull();
    expect(await keptClosed("a")).toBeNull();
    expect(await keptClosed("b")).toBe(2);
  });
});
