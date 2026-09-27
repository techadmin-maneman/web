// Where a technician's job stands (apps/tech/src/lib/progress.ts): read from
// what the API says has landed and what the phone still holds, it decides what
// the card offers, so a started job never offers a no-show and a job ops moved
// offers nothing to press on with.

import { describe, expect, it } from "vitest";
import type { CheckIn, Job } from "../../apps/tech/src/api.ts";
import { closed, done, nextStep, stageOf, theWait } from "../../apps/tech/src/lib/progress.ts";
import type { Queued } from "../../apps/tech/src/store/replay.ts";

const TODAY = "2030-09-19";

const job = (over: Partial<Job> = {}, progress: Partial<Job["progress"]> = {}): Job => ({
  id: "a",
  day: "today",
  date: TODAY,
  starts_at: "2030-09-19T04:00:00.000Z",
  ends_at: null,
  window_label: "morning",
  type: "service",
  sector: "Sector 65",
  status: "scheduled",
  badge: "prepaid",
  slots: 1,
  unlocked: true,
  unlocks_at: "2030-09-18T12:30:00.000Z",
  address: null,
  access_notes: null,
  client: null,
  progress: {
    checked_in_at: null,
    wait_ends_at: null,
    distance_m: null,
    started_at: null,
    steps_done: [],
    outcome: null,
    ...progress,
  },
  no_show_wait_min: 15,
  pieces: [],
  last_visit: null,
  reminder: null,
  steps: ["before_photos", "checklist", "consumables", "after_photos", "outcome"],
  checklist: [],
  partial_reasons: [],
  consumables: [],
  ...over,
});

let seq = 0;
const queued = (kind: Queued["kind"], over: Partial<Queued> = {}): Queued => {
  seq += 1;
  return {
    seq,
    id: `event-${String(seq)}`,
    job_id: "a",
    kind,
    path: `/tech/jobs/a/${kind}`,
    body: null,
    queued_at: Date.parse("2030-09-19T04:05:00.000Z"),
    state: "waiting",
    note: null,
    fields: [],
    ...over,
  };
};

describe("what the job has done", () => {
  it("counts what landed and what the phone is still holding, and not what the API stopped", () => {
    const landed = job({}, { checked_in_at: "t", started_at: "t", steps_done: ["before_photos"] });
    const holding = [queued("checklist"), queued("consumables", { state: "refused" })];

    expect([...done(landed, holding)].sort()).toEqual(["before_photos", "check_in", "checklist", "start"]);
    expect(nextStep(landed, holding)).toBe("consumables");
  });

  it("is closed by an outcome that landed, or one waiting on the phone, and not by one the API refused", () => {
    expect(closed(job({}, { outcome: "done" }), [])).toBe(true);
    expect(closed(job(), [queued("no_show")])).toBe(true);
    expect(closed(job(), [queued("no_show", { state: "refused" })])).toBe(false);
  });
});

describe("the stage a card is at", () => {
  it("is locked before the day before", () => {
    expect(stageOf(job({ unlocked: false }), [], TODAY)).toBe("locked");
  });

  it("is changed once ops moved it under the phone, whatever else it has done", () => {
    const moved = [queued("start", { state: "superseded", fields: ["technician"] })];
    expect(stageOf(job({}, { checked_in_at: "t" }), moved, TODAY)).toBe("changed");
  });

  it("is started once the job starts, so the door's no-show and Start job are gone", () => {
    expect(stageOf(job({}, { checked_in_at: "t", started_at: "t" }), [], TODAY)).toBe("started");
    expect(stageOf(job({}, { checked_in_at: "t" }), [queued("start")], TODAY)).toBe("started");
  });

  it("is closed once there is an outcome", () => {
    expect(stageOf(job({}, { started_at: "t", outcome: "partial" }), [], TODAY)).toBe("closed");
  });

  it("is not today for tomorrow's unlocked job, which cannot be checked in to yet", () => {
    expect(stageOf(job({ date: "2030-09-20" }), [], TODAY)).toBe("not_today");
  });

  it("is at the door otherwise", () => {
    expect(stageOf(job(), [], TODAY)).toBe("door");
    expect(stageOf(job({}, { checked_in_at: "t" }), [], TODAY)).toBe("door");
  });
});

describe("the no-show wait", () => {
  const answered: CheckIn = {
    passed: true,
    distance_m: 40,
    radius_m: 200,
    checked_in_at: "2030-09-19T04:05:00.000Z",
    wait_ends_at: "2030-09-19T04:20:00.000Z",
    accepted: null,
  };

  it("runs to the end the check-in's answer gave, which the API holds too", () => {
    expect(theWait(job(), [], answered)).toEqual({ endsAt: Date.parse("2030-09-19T04:20:00.000Z"), confirmed: true });
  });

  it("runs to the end the card gives when the phone lost its own copy", () => {
    const card = job({}, { checked_in_at: "t", wait_ends_at: "2030-09-19T04:21:00.000Z" });
    expect(theWait(card, [], null)).toEqual({ endsAt: Date.parse("2030-09-19T04:21:00.000Z"), confirmed: true });
  });

  it("counts from the tap when the check-in is still on the phone, and is not ours to close on yet", () => {
    const tapped = queued("check_in");
    expect(theWait(job(), [tapped], null)).toEqual({ endsAt: tapped.queued_at + 15 * 60_000, confirmed: false });
  });

  it("has no end before any check-in, and none from one that failed", () => {
    expect(theWait(job(), [], null)).toEqual({ endsAt: null, confirmed: false });
    expect(theWait(job(), [], { ...answered, passed: false, wait_ends_at: null })).toEqual({
      endsAt: null,
      confirmed: false,
    });
  });
});
