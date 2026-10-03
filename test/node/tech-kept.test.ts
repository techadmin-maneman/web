// What the technician's phone keeps of the API, and for how long
// (apps/tech/src/store/jobs.ts, apps/tech/src/lib/useDay.ts): today's and
// tomorrow's jobs and cards, and any job whose work has not reached us, and
// nothing a 401 has taken away. Also the device's own records
// (apps/tech/src/store/device.ts) and the promise to keep them
// (apps/tech/src/store/persist.ts).

import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CheckIn, Job, JobSummary, Me } from "../../apps/tech/src/api.ts";
import { keepCards, loadDay, loadJob } from "../../apps/tech/src/lib/useDay.ts";
import { dayAfter, todayInIndia } from "../../apps/tech/src/lib/when.ts";
import { all, wipe } from "../../apps/tech/src/store/db.ts";
import { deviceId, enrolled, enrolledAt, keepMe, keptMe } from "../../apps/tech/src/store/device.ts";
import {
  forgetOld,
  keepArrival,
  keepClosed,
  keepDay,
  keepJob,
  keptArrival,
  keptClosed,
  keptDay,
  keptJob,
  keptNames,
} from "../../apps/tech/src/store/jobs.ts";
import { queue } from "../../apps/tech/src/store/outbox.ts";
import { askToKeep } from "../../apps/tech/src/store/persist.ts";

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await wipe();
});

const TODAY = todayInIndia();
const TOMORROW = dayAfter(TODAY);
const LAST_WEEK = "2020-01-01";

const summary = (id: string, date: string) =>
  ({
    id,
    day: date === TODAY ? "today" : "tomorrow",
    date,
    starts_at: `${date}T04:00:00.000Z`,
    ends_at: null,
    window_label: "morning",
    type: "service",
    one_visit: false,
    product: null,
    sector: "Sector 65",
    status: "scheduled",
    badge: "prepaid",
    slots: 1,
    unlocked: true,
    unlocks_at: `${date}T00:00:00.000Z`,
  }) as JobSummary;

const card = (id: string, date: string) =>
  ({
    ...summary(id, date),
    address: {
      line1: "Tower C",
      line2: null,
      building: null,
      tower: null,
      floor: null,
      flat: null,
      landmark: null,
      locality: "Sector 65",
      city: "Gurgaon",
      pincode: "122018",
      lat: null,
      lng: null,
    },
    access_notes: "Gate code 4417",
    client: { name: `Client ${id}`, mobile: "+919810000000", note: null },
    progress: {
      checked_in_at: null,
      wait_ends_at: null,
      distance_m: null,
      started_at: null,
      steps_done: [],
      outcome: null,
    },
    no_show_wait_min: 15,
    pieces: [],
    last_visit: null,
    reminder: null,
    steps: ["before_photos", "checklist", "consumables", "after_photos", "outcome"],
    checklist: [],
    partial_reasons: [],
    consumables: [],
    products: [],
    payment_link: null,
    discount_code: null,
    profile: null,
  }) as Job;

const arrival = {
  passed: true,
  distance_m: 40,
  radius_m: 200,
  checked_in_at: "",
  wait_ends_at: null,
  accepted: null,
} as CheckIn;

/** The API, as fetch sees it: each path answers what the test says, and anything else as if there were no signal. */
function api(answers: Record<string, { status: number; json?: unknown }>) {
  const asked: string[] = [];
  vi.stubGlobal("fetch", (url: string) => {
    asked.push(url);
    const answer = answers[url];
    if (answer === undefined) return Promise.reject(new TypeError("Failed to fetch"));
    const body = answer.json === undefined ? null : JSON.stringify(answer.json);
    return Promise.resolve(
      new Response(body, { status: answer.status, headers: { "Content-Type": "application/json" } }),
    );
  });
  return asked;
}

const revoked = { status: 401, json: { error: { code: "device_revoked", request_id: "test" } } };

describe("what the phone lets go of", () => {
  it("keeps today's and tomorrow's lists, and the card, arrival and close-out of each job in them", async () => {
    await keepDay(TODAY, [summary("a", TODAY)]);
    await keepDay(TOMORROW, [summary("b", TOMORROW)]);
    await keepJob(card("a", TODAY));
    await keepJob(card("b", TOMORROW));
    await keepArrival("a", arrival);
    await keepClosed("a", 1);

    await forgetOld(TODAY, new Set());

    expect(await keptDay(TODAY)).toHaveLength(1);
    expect(await keptDay(TOMORROW)).toHaveLength(1);
    expect(await keptJob("a")).not.toBeNull();
    expect(await keptJob("b")).not.toBeNull();
    expect(await keptArrival("a")).not.toBeNull();
    expect(await keptClosed("a")).toBe(1);
  });

  it("lets go of an older day, and of every card no list names, with its arrival and close-out", async () => {
    await keepDay(LAST_WEEK, [summary("old", LAST_WEEK)]);
    await keepDay(TODAY, [summary("a", TODAY)]);
    await keepJob(card("old", LAST_WEEK));
    await keepArrival("old", arrival);
    await keepClosed("old", 1);

    await forgetOld(TODAY, new Set());

    expect(await keptDay(LAST_WEEK)).toBeNull();
    expect(await keptJob("old")).toBeNull();
    expect(await keptArrival("old")).toBeNull();
    expect(await keptClosed("old")).toBeNull();
    expect((await keptNames()).has("old")).toBe(false);
  });

  it("keeps a job whose work has not reached us, whatever day it was", async () => {
    await keepJob(card("old", LAST_WEEK));
    await keepArrival("old", arrival);

    await forgetOld(TODAY, new Set(["old"]));

    expect(await keptJob("old")).not.toBeNull();
    expect(await keptArrival("old")).not.toBeNull();
  });
});

describe("a day's jobs", () => {
  it("comes from the API when there is signal, and is kept for the next basement", async () => {
    api({ [`/api/tech/jobs?date=${TODAY}`]: { status: 200, json: { date: TODAY, jobs: [summary("a", TODAY)] } } });
    expect(await loadDay(TODAY)).toMatchObject({ state: "loaded", fromPhone: false });
    expect(await keptDay(TODAY)).toHaveLength(1);
  });

  it("lets go of what is older each time a day arrives fresh", async () => {
    await keepDay(LAST_WEEK, [summary("old", LAST_WEEK)]);
    await keepJob(card("old", LAST_WEEK));
    api({ [`/api/tech/jobs?date=${TODAY}`]: { status: 200, json: { date: TODAY, jobs: [summary("a", TODAY)] } } });

    await loadDay(TODAY);

    expect(await keptDay(LAST_WEEK)).toBeNull();
    expect(await keptJob("old")).toBeNull();
  });

  it("does not let go of a job whose work is still on the phone", async () => {
    await keepJob(card("old", LAST_WEEK));
    await queue("checklist", "old", { items: [] });
    api({ [`/api/tech/jobs?date=${TODAY}`]: { status: 200, json: { date: TODAY, jobs: [] } } });

    await loadDay(TODAY);

    expect(await keptJob("old")).not.toBeNull();
  });

  // FLD-42: the cards were fetched one after another, so the last of a day's came seconds after the list.
  it("asks for every unlocked card at once, and keeps each one", async () => {
    const asked: string[] = [];
    const askedByEachAnswer: number[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      asked.push(url);
      await new Promise((resolve) => setTimeout(resolve, 10));
      askedByEachAnswer.push(asked.length);
      const id = url.split("/").pop() ?? "";
      return new Response(JSON.stringify(card(id, TODAY)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const locked = { ...summary("c", TODAY), unlocked: false };

    await keepCards([summary("a", TODAY), summary("b", TODAY), locked]);

    expect(asked).toEqual(["/api/tech/jobs/a", "/api/tech/jobs/b"]);
    expect(askedByEachAnswer).toEqual([2, 2]);
    expect(await keptNames()).toEqual(
      new Map([
        ["a", "Client a"],
        ["b", "Client b"],
      ]),
    );
  });

  it("with no signal, is what the phone kept, and says so", async () => {
    await keepDay(TODAY, [summary("a", TODAY)]);
    api({});
    expect(await loadDay(TODAY)).toMatchObject({ state: "loaded", fromPhone: true });
  });

  it("with the API having a bad minute, is what the phone kept", async () => {
    await keepDay(TODAY, [summary("a", TODAY)]);
    api({ [`/api/tech/jobs?date=${TODAY}`]: { status: 503 } });
    expect(await loadDay(TODAY)).toMatchObject({ state: "loaded", fromPhone: true });
  });

  it("never shows what the phone kept once the API has ended the session", async () => {
    await keepDay(TODAY, [summary("a", TODAY)]);
    api({ [`/api/tech/jobs?date=${TODAY}`]: revoked });
    expect(await loadDay(TODAY)).toEqual({ state: "failed", requestId: "test" });
  });

  it("still shows a fresh day that a full phone could not keep", async () => {
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => {
      throw new DOMException("no room", "QuotaExceededError");
    });
    api({ [`/api/tech/jobs?date=${TODAY}`]: { status: 200, json: { date: TODAY, jobs: [summary("a", TODAY)] } } });
    expect(await loadDay(TODAY)).toMatchObject({ state: "loaded", fromPhone: false });
  });

  it("fails rather than wait for ever when the phone's store will not open", async () => {
    vi.spyOn(indexedDB, "open").mockImplementation(() => {
      throw new DOMException("gone", "InvalidStateError");
    });
    api({});
    expect(await loadDay(TODAY)).toEqual({ state: "failed", requestId: null });
  });
});

describe("a job's card", () => {
  it("with no signal, is the one the phone kept", async () => {
    await keepJob(card("a", TODAY));
    api({});
    expect(await loadJob("a")).toMatchObject({ state: "loaded", fromPhone: true });
  });

  it("is never read from the phone after a 401, which ends the session", async () => {
    await keepJob(card("a", TODAY));
    api({ "/api/tech/jobs/a": revoked });
    expect(await loadJob("a")).toEqual({ state: "failed", requestId: "test" });
  });

  it("is not read from the phone when the API says the job is not this technician's", async () => {
    await keepJob(card("a", TODAY));
    api({ "/api/tech/jobs/a": { status: 404, json: { error: { code: "not_found", request_id: "test" } } } });
    expect(await loadJob("a")).toEqual({ state: "failed", requestId: "test" });
  });

  // Kept by a build from before ops set the job sheet and the consumables (docs/decisions/0087-consumables-and-stock.md):
  // its reasons were ids alone and it carried no consumables. With no signal after the update, it still closes.
  it("kept by an earlier build, is read in today's shape: each reason worded, and no consumables", async () => {
    const { consumables: _none, ...earlier } = card("a", TODAY);
    await keepJob({ ...earlier, partial_reasons: ["piece_not_ready", "client_unwell"] } as unknown as Job);

    const kept = await keptJob("a");
    expect(kept?.partial_reasons).toEqual([
      { id: "piece_not_ready", label: "Piece not ready" },
      { id: "client_unwell", label: "Client unwell" },
    ]);
    expect(kept?.consumables).toEqual([]);
  });

  it("kept before a one visit's code was on the card, reads as having none, so the outcome asks", async () => {
    const { discount_code: _none, ...earlier } = card("a", TODAY);
    await keepJob(earlier as unknown as Job);
    expect((await keptJob("a"))?.discount_code).toBeNull();
  });
});

describe("the device", () => {
  const me = {
    name: "Imran Qureshi",
    first_name: "Imran",
    initials: "IQ",
    device: { device_id: "x", label: null, enrolled_at: "" },
  } as Me;

  it("makes its ID once, and keeps it", async () => {
    const first = await deviceId();
    expect(await deviceId()).toBe(first);
  });

  it("enrols a new ID after a wipe, so a revoked phone never revives its old one", async () => {
    const first = await deviceId();
    await wipe();
    expect(await deviceId()).not.toBe(first);
  });

  it("records when the backend accepted it, and who is signed in", async () => {
    await deviceId();
    expect(await enrolledAt()).toBeNull();
    await enrolled(1234);
    await keepMe(me);
    expect(await enrolledAt()).toBe(1234);
    expect(await keptMe()).toEqual(me);
    expect((await all("device")).length).toBe(2);
  });
});

describe("the promise to keep the store", () => {
  it("is asked once and remembered when the phone grants it", async () => {
    const persist = vi.fn(() => Promise.resolve(true));
    vi.stubGlobal("navigator", { storage: { persist } });
    expect(await askToKeep()).toBe("granted");
    expect(await askToKeep()).toBe("granted");
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("is asked again on the next start when the phone refused, since a refusal can turn", async () => {
    const persist = vi.fn(() => Promise.resolve(false));
    vi.stubGlobal("navigator", { storage: { persist } });
    expect(await askToKeep()).toBe("refused");
    expect(await askToKeep()).toBe("refused");
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it("is unknown on a browser with nothing to ask", async () => {
    vi.stubGlobal("navigator", {});
    expect(await askToKeep()).toBe("unknown");
  });
});
