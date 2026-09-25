// The outbox sending what the phone holds (apps/tech/src/store/outbox.ts), on
// an IndexedDB that runs in Node and an API faked at fetch. The ordering rules
// themselves are test/node/tech-outbox.test.ts; this is the store and the
// sending around them.

import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { onSessionEnded } from "../../apps/tech/src/api.ts";
import { wipe } from "../../apps/tech/src/store/db.ts";
import { keptArrival } from "../../apps/tech/src/store/jobs.ts";
import { events, frames, keepFrame, queue, replay, unsentJobs } from "../../apps/tech/src/store/outbox.ts";

afterEach(async () => {
  vi.unstubAllGlobals();
  await wipe();
});

interface Sent {
  readonly method: string;
  readonly url: string;
  readonly eventId: string | null;
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
    sent.push({ method, url, eventId: headers.get("X-Client-Event-Id") });
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

describe("the jobs with work still on the phone", () => {
  it("names each job with a queued write or a photograph not yet up", async () => {
    await queue("start", "a", null);
    await keepFrame("b", "front", "before", new Blob(["front"]));
    expect(await unsentJobs()).toEqual(new Set(["a", "b"]));
  });
});
