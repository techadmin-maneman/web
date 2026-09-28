// The outbox sending what the phone holds (apps/tech/src/store/outbox.ts), on
// an IndexedDB that runs in Node and an API faked at fetch. The ordering rules
// themselves are test/node/tech-outbox.test.ts; this is the store and the
// sending around them.

import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { onSessionEnded } from "../../apps/tech/src/api.ts";
import { wipe } from "../../apps/tech/src/store/db.ts";
import { keptArrival } from "../../apps/tech/src/store/jobs.ts";
import {
  correct,
  events,
  frames,
  keepFrame,
  queue,
  refusedAsEarly,
  replay,
  unsentJobs,
} from "../../apps/tech/src/store/outbox.ts";

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
 * every call is recorded in order. A thrown TypeError is how fetch says there
 * is no signal.
 */
function api(answer: (method: string, url: string) => { status: number; json?: unknown } | "offline") {
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
    const given = answer(method, url);
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
    const checklist = await queue("checklist", "a", { items: [] });
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

  it("drops a no-show sent before the wait ran, and the countdown goes on", async () => {
    await queue("no_show", "a", null);
    api(() => ({ status: 425, json: { error: { code: "too_early_to_close", request_id: "t" } } }));
    await replay();
    expect(await events()).toEqual([]);
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

  it("stops a job whose photographs' links are refused as no longer this technician's, as moved", async () => {
    await keepFrame("a", "front", "before", new Blob(["front"]));
    await queue("before_photos", "a", { phase: "before" });
    api(() => ({ status: 404, json: { error: { code: "not_found", request_id: "t" } } }));

    expect(await replay()).toMatchObject({ superseded: 1, refused: 0 });
    expect(await events()).toMatchObject([{ state: "superseded", note: "not_found" }]);
    // The photograph stays until the technician has read what changed and said to delete it.
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
});

describe("a no-show the API says is early", () => {
  it("is dropped, and the card can tell it was refused rather than sent, until one lands", async () => {
    await queue("no_show", "a", null);
    api(() => ({ status: 425, json: { error: { code: "too_early_to_close", request_id: "t" } } }));
    await replay();
    expect(await events()).toEqual([]);
    expect(refusedAsEarly("a")).toBe(true);

    await queue("no_show", "a", null);
    api(() => ({ status: 200, json: { closed: true, wait_ends_at: "t", case_id: null, accepted: null } }));
    await replay();
    expect(refusedAsEarly("a")).toBe(false);
  });
});

describe("the jobs with work still on the phone", () => {
  it("names each job with a queued write or a photograph not yet up", async () => {
    await queue("start", "a", null);
    await keepFrame("b", "front", "before", new Blob(["front"]));
    expect(await unsentJobs()).toEqual(new Set(["a", "b"]));
  });
});
