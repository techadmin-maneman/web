// The outbox sending what the phone holds (apps/tech/src/store/outbox.ts), on
// an IndexedDB that runs in Node and an API faked at fetch. The ordering rules
// themselves are test/node/dom/tech-outbox.test.ts; this is the store and the
// sending around them.

import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { onSessionEnded, type JobSummary } from "../../../apps/tech/src/api.ts";
import { wipe } from "../../../apps/tech/src/store/db.ts";
import {
  keepArrival,
  keepClosed,
  keepDay,
  keptArrival,
  keptClosed,
  keptDay,
  keptJob,
} from "../../../apps/tech/src/store/jobs.ts";
import {
  checkInRefusedAsEarly,
  correct,
  events,
  forget,
  frames,
  held,
  keepFrame,
  queue,
  refusedAsEarly,
  replay,
  unsentJobs,
} from "../../../apps/tech/src/store/outbox.ts";

afterEach(async () => {
  vi.unstubAllGlobals();
  await wipe();
});

interface Sent {
  readonly method: string;
  readonly url: string;
  readonly eventId: string | null;
  readonly startsAt: string | null;
}

/**
 * The API at fetch: `answer` says what each call gets, by method and path, and
 * by what was sent where it needs to, and every call is recorded in order. A
 * thrown TypeError is how fetch says there is no signal.
 */
function api(answer: (method: string, url: string, body: unknown) => { status: number; json?: unknown } | "offline") {
  const sent: Sent[] = [];
  vi.stubGlobal("fetch", (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const headers = new Headers(init.headers);
    sent.push({
      method,
      url,
      eventId: headers.get("X-Client-Event-Id"),
      startsAt: headers.get("X-Job-Starts-At"),
    });
    const given = answer(method, url, init.body);
    if (given === "offline") return Promise.reject(new TypeError("Failed to fetch"));
    const body = given.json === undefined ? null : JSON.stringify(given.json);
    return Promise.resolve(
      new Response(body, { status: given.status, headers: { "Content-Type": "application/json" } }),
    );
  });
  return sent;
}

const accepted = { status: 202, json: { event_id: "e", replayed: false, fsm_write_state: "pending", progress: {} } };

type Answer = ReturnType<Parameters<typeof api>[0]>;

/** The take the fake API names for every photograph. */
const TAKE = "0192a8e4-0000-7000-8000-00000000a0a0";

/** The photographs' calls answered as the API does, and each thumbnail as `small` says. */
const answerPhotos =
  (small: () => Answer) =>
  (method: string, url: string): Answer => {
    if (url.endsWith("/upload-url")) {
      const links = { upload_url: "/api/tech/photos/t", small_upload_url: "/api/tech/photos/t/small", expires_at: "" };
      return { status: 201, json: links };
    }
    if (method !== "PUT") return accepted;
    return url.includes("/small") ? small() : { status: 200, json: { take: TAKE } };
  };

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

  // BK-43: the card read again is what says where the job went once it has locked again.
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
    await keepFrame("a", "front", "before", new Blob(["front"]));
    await keepFrame("a", "top", "before", new Blob(["top"]));
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
    await keepFrame("a", "front", "before", new Blob(["front"]), new Blob(["small"]));
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
    await keepFrame("a", "front", "before", new Blob(["front"]), new Blob(["small"]));
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
    await keepFrame("a", "front", "before", new Blob(["front"]), new Blob(["not small"]));
    await queue("before_photos", "a", { phase: "before" });
    api(answerPhotos(() => ({ status: 422, json: { error: { code: "photo_invalid_file", request_id: "t" } } })));

    expect(await replay()).toMatchObject({ sent: 1, refused: 0, stopped: null });
    expect(await frames()).toEqual([]);
  });

  it("sends a frame kept before the phone made thumbnails without one", async () => {
    await keepFrame("a", "front", "before", new Blob(["front"]));
    await queue("before_photos", "a", { phase: "before" });
    const sent = api(answerPhotos(() => ({ status: 204 })));
    await replay();
    expect(sent.filter((call) => call.url.includes("/small"))).toEqual([]);
  });

  it("sends no thumbnail when the photograph's answer names no take, as an API from before thumbnails answers", async () => {
    await keepFrame("a", "front", "before", new Blob(["front"]), new Blob(["small"]));
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
    await keepFrame("a", "front", "before", new Blob(["front"]));
    await queue("before_photos", "a", { phase: "before" });
    api(() => ({ status: 404, json: { error: { code: "not_found", request_id: "t" } } }));

    expect(await replay()).toMatchObject({ superseded: 1, refused: 0 });
    expect(await events()).toMatchObject([{ state: "superseded", note: "not_found" }]);
    // The photograph stays until the technician has read what changed and said to delete it.
    expect(await frames()).toHaveLength(1);
  });

  // Open point 92: the link's refusal names whom the job went to, and when, as a refused write's does.
  it("stops a job whose photographs' links say it went to another technician, keeping whom and when", async () => {
    await keepFrame("a", "front", "before", new Blob(["front"]));
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

describe("one tap, one write", () => {
  it("queues a step once, however many times it is tapped", async () => {
    const first = await queue("start", "a", null);
    const second = await queue("start", "a", null);
    expect(second.id).toBe(first.id);
    expect(await events()).toHaveLength(1);
  });

  it("keeps one frame for each angle: a second of the same angle replaces the first", async () => {
    await keepFrame("a", "front", "before", new Blob(["one"]));
    await keepFrame("a", "front", "before", new Blob(["two"]));
    await keepFrame("a", "front", "after", new Blob(["after"]));
    expect((await frames()).map((frame) => `${frame.phase}-${frame.angle}`).sort()).toEqual([
      "after-front",
      "before-front",
    ]);
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

  // PLAT-43: without the report, nobody but the technician would know the write never landed.
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

// FLD-15: a refused set had no way back but deleting the job's work.
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
    await keepFrame("a", "front", "before", new Blob(["front"]));
    await keepFrame("a", "top", "before", new Blob([]));
    await keepFrame("a", "left", "before", new Blob(["left"]));
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
    await keepFrame("a", "front", "before", new Blob(["front"]));
    await keepFrame("a", "top", "before", new Blob([]));
    await queue("before_photos", "a", { phase: "before" });
    await queue("checklist", "a", { done: [] });
    refusingEmptyFiles();
    await replay();

    await keepFrame("a", "top", "before", new Blob(["top"]));
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
    await keepFrame("a", "front", "before", new Blob(["front"]));
    await queue("before_photos", "a", { phase: "before" });
    api(() => ({ status: 400, json: { error: { code: "invalid_request", request_id: "t", fields: ["phase"] } } }));

    expect(await replay()).toMatchObject({ refused: 1 });
    expect(await frames()).toEqual([expect.not.objectContaining({ refused: true })]);
  });
});

describe("a step the API says is early", () => {
  // FLD-46: the card's warning was held in memory, and went with a reload.
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

describe("queuing a step", () => {
  // FLD-46: two screens queuing at once both found nothing waiting, and both added one.
  it("keeps one when two screens queue the same step at once", async () => {
    await Promise.all([queue("start", "a", null), queue("start", "a", null)]);
    expect(await events()).toEqual([expect.objectContaining({ kind: "start", state: "waiting" })]);
  });
});

describe("the jobs with work still on the phone", () => {
  it("names each job with a queued write or a photograph not yet up", async () => {
    await queue("start", "a", null);
    await keepFrame("b", "front", "before", new Blob(["front"]));
    expect(await unsentJobs()).toEqual(new Set(["a", "b"]));
  });
});

/** Job "a" on the day the phone holds, as the list said it before anything of it landed. */
const kept = (): JobSummary =>
  ({ id: "a", date: "2030-09-19", progress: { started_at: null, outcome: null } }) as JobSummary;

describe("where a job stands, once a write of its lands", () => {
  // FLD-36: with no signal, the row of a job started since the list was kept lost its "In progress".
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

// FLD-36: after "Got it" deleted a job's work, Today still read "Closed out" from the phone's own close-out mark.
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
