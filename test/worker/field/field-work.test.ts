// A technician's day: each step, piece and move is written in the request that makes it. NOW is Monday 21 September
// 2026, 12 noon in India; today's job is at 13:00. Every name, number and label here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { openTechnicianSession } from "../../../src/domain/dispatch/technicians.ts";
import { appFor, fakeDependencies, fakeQueue, markDatabase, NOW, request, type TestDependencies } from "../helpers.ts";
import { syntheticJpeg } from "../tryon-fixtures.ts";
import {
  PERSON,
  NEIGHBOUR,
  TODAY_JOB,
  IMRAN,
  SAMEER,
  AT_THE_DOOR,
  TODAY_START,
  minutesAfterStart,
  uuidv7At,
  booked,
} from "./field-work-fixtures.ts";

let messageQueue: ReturnType<typeof fakeQueue>;

let cookie: string;

const bindings = () => ({ MESSAGE_QUEUE: messageQueue }) as unknown as Partial<Env>;

/** A write from the technician's phone that reaches the API at `at`, as a phone replaying its outbox does. */
const postAt = (at: Date, path: string, body: unknown, eventId: string) =>
  request(
    appFor("local", fakeDependencies({ now: () => at }), {}, "tech"),
    path,
    {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: "https://maneman.test",
        "Content-Type": "application/json",
        "X-Client-Event-Id": eventId,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    bindings(),
  );

/** A write from the console. */
const opsPost = (path: string, body: unknown, deps: TestDependencies = fakeDependencies()) =>
  request(
    appFor("local", deps, {}, "ops"),
    path,
    {
      method: "POST",
      headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    bindings(),
  );

/** Each step, its body, and the minute after the start the phone took it, sent together at `sentAt`. */
async function work(sentAt: Date, jobId: string, steps: readonly (readonly [string, unknown, number])[]) {
  for (const [step, body, minute] of steps) {
    const answer = await postAt(sentAt, `/api/tech/jobs/${jobId}/${step}`, body, uuidv7At(minute));
    expect(answer.status, `${step} at minute ${String(minute)}`).toBeLessThan(300);
  }
}

/** A service visit from the check-in to the after photographs, worked from 13:02. */
const UP_TO_THE_OUTCOME = [
  ["checkin", AT_THE_DOOR, 2],
  ["start", undefined, 5],
  ["photos", { phase: "before" }, 10],
  ["checklist", { done: ["piece_removed"] }, 40],
  ["consumables", { items: [] }, 45],
  ["photos", { phase: "after" }, 75],
] as const;

const statusOf = async (id: string) =>
  (await env.DB.prepare("SELECT status FROM appointments WHERE id = ?1").bind(id).first<{ status: string }>())?.status;

const visitRowOf = (id: string) =>
  env.DB.prepare(
    "SELECT started_at, ended_at, duration_minutes, outcome, partial_reason FROM visits WHERE appointment_id = ?1",
  )
    .bind(id)
    .first();

const writeStatesOf = async (id: string) =>
  (
    await env.DB.prepare(
      "SELECT DISTINCT fsm_write_state AS state FROM job_events WHERE appointment_id = ?1 ORDER BY state",
    )
      .bind(id)
      .all<{ state: string }>()
  ).results.map((row) => row.state);

beforeEach(async () => {
  await markDatabase();
  messageQueue = fakeQueue();
  const at = NOW.toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO technicians (id, fsm_id, name, initials, active, zone, mobile_e164, hand_written, updated_at)
       VALUES (?1, ?1, 'Imran Qureshi', 'IQ', 1, 'Gurgaon', '+919810000009', 1, ?3),
              (?2, ?2, 'Sameer Bhatt', 'SB', 1, 'Gurgaon', '+919810000008', 1, ?3)`,
    ).bind(IMRAN, SAMEER, at),
    env.DB.prepare(
      `INSERT INTO people (id, created_at, mobile_e164, name)
       VALUES (?1, ?3, '+919810000001', 'Rohit Malhotra'), (?2, ?3, '+919810000002', 'Vikram Sethi')`,
    ).bind(PERSON, NEIGHBOUR, at),
    env.DB.prepare(
      `INSERT INTO addresses (id, person_id, created_at, line1, locality, city, pincode, lat, lng, geocoded_at)
       VALUES ('addr-1', ?1, ?2, 'House 7', 'Sector 65', 'Gurgaon', '122018', 28.398, 77.07, ?2)`,
    ).bind(PERSON, at),
  ]);
  await booked(TODAY_JOB, { start: TODAY_START.toISOString() });
  cookie = `mm_tech=${await openTechnicianSession(env.DB, {
    technicianId: IMRAN,
    deviceId: "phone-abc-123",
    label: "Chrome on Android",
    now: NOW,
  })}`;
});

describe("a technician's steps", () => {
  it("move the visit on as each lands, and close it completed with the duration the phone measured", async () => {
    // Worked from 13:02 with no signal, and sent at 14:30 in one go.
    const sentAt = minutesAfterStart(90);
    await work(sentAt, TODAY_JOB, [["checkin", AT_THE_DOOR, 2]]);
    expect(await statusOf(TODAY_JOB)).toBe("dispatched");
    await work(sentAt, TODAY_JOB, [["start", undefined, 5]]);
    expect(await statusOf(TODAY_JOB)).toBe("in_progress");

    await work(sentAt, TODAY_JOB, UP_TO_THE_OUTCOME.slice(2));
    const closed = await postAt(sentAt, `/api/tech/jobs/${TODAY_JOB}/outcome`, { outcome: "done" }, uuidv7At(80));

    expect(closed.status).toBe(202);
    expect(await closed.json()).toMatchObject({ replayed: false, fsm_write_state: "written" });
    expect(await statusOf(TODAY_JOB)).toBe("completed");
    expect(await visitRowOf(TODAY_JOB)).toEqual({
      started_at: minutesAfterStart(5).toISOString(),
      ended_at: minutesAfterStart(80).toISOString(),
      duration_minutes: 75,
      outcome: "done",
      partial_reason: null,
    });
    expect(await writeStatesOf(TODAY_JOB)).toEqual(["written"]);
  });

  it("close a partial job as terminated, with the technician's reason", async () => {
    const sentAt = minutesAfterStart(90);
    await work(sentAt, TODAY_JOB, UP_TO_THE_OUTCOME);

    const closed = await postAt(
      sentAt,
      `/api/tech/jobs/${TODAY_JOB}/outcome`,
      { outcome: "partial", reason: "client_stopped_it" },
      uuidv7At(60),
    );

    expect(closed.status).toBe(202);
    expect(await statusOf(TODAY_JOB)).toBe("terminated");
    expect(await visitRowOf(TODAY_JOB)).toMatchObject({
      duration_minutes: 55,
      outcome: "partial",
      partial_reason: "client_stopped_it",
    });
  });

  it("close a no-show as terminated, never started", async () => {
    await work(NOW, TODAY_JOB, [["checkin", AT_THE_DOOR, -30]]);

    // Sixteen minutes after the booked start, the wait has run.
    const closed = await postAt(minutesAfterStart(16), `/api/tech/jobs/${TODAY_JOB}/no-show`, undefined, "event-ns-01");

    expect(closed.status).toBe(200);
    expect(await statusOf(TODAY_JOB)).toBe("terminated");
    expect(await visitRowOf(TODAY_JOB)).toEqual({
      started_at: null,
      ended_at: minutesAfterStart(16).toISOString(),
      duration_minutes: null,
      outcome: "no_show",
      partial_reason: null,
    });
  });

  it("change nothing twice when the phone replays its outbox", async () => {
    const sentAt = minutesAfterStart(90);
    await work(sentAt, TODAY_JOB, UP_TO_THE_OUTCOME);
    const eventId = uuidv7At(80);
    await postAt(sentAt, `/api/tech/jobs/${TODAY_JOB}/outcome`, { outcome: "done" }, eventId);

    const replayed = await postAt(
      minutesAfterStart(120),
      `/api/tech/jobs/${TODAY_JOB}/outcome`,
      { outcome: "done" },
      eventId,
    );

    expect(await replayed.json()).toMatchObject({ replayed: true, fsm_write_state: "written" });
    const visits = await env.DB.prepare("SELECT COUNT(*) AS n FROM visits WHERE appointment_id = ?1")
      .bind(TODAY_JOB)
      .first<{ n: number }>();
    expect(visits?.n).toBe(1);
    expect(await visitRowOf(TODAY_JOB)).toMatchObject({ ended_at: minutesAfterStart(80).toISOString() });
  });

  it("write each step as it lands, the photographs' among them", async () => {
    const sentAt = minutesAfterStart(30);
    await work(sentAt, TODAY_JOB, UP_TO_THE_OUTCOME.slice(0, 3));

    expect(await writeStatesOf(TODAY_JOB)).toEqual(["written"]);
  });
});

// The job closes as done at 14:30; anything sent after it would contradict the close.
describe("a closed job", () => {
  const CLOSED_AT = minutesAfterStart(90);
  const minutesAfterClose = (minutes: number) => new Date(CLOSED_AT.getTime() + minutes * 60_000);
  const stepPath = (step: string) => `/api/tech/jobs/${TODAY_JOB}/${step}`;

  const techAppAt = (at: Date) => appFor("local", fakeDependencies({ now: () => at }), {}, "tech");

  const askForUploadLinkAt = (at: Date) =>
    request(
      techAppAt(at),
      stepPath("photos/upload-url"),
      {
        method: "POST",
        headers: { Cookie: cookie, Origin: "https://maneman.test", "Content-Type": "application/json" },
        body: JSON.stringify({ phase: "after", angle: "front" }),
      },
      bindings(),
    );

  const putPhotoAt = (at: Date, link: string, body: Uint8Array) =>
    request(
      techAppAt(at),
      link,
      {
        method: "PUT",
        headers: { Cookie: cookie, Origin: "https://maneman.test", "Content-Type": "image/jpeg" },
        body,
      },
      bindings(),
    );

  const refusedAsClosed = async (answer: Response) => {
    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "already_closed" } });
  };

  const eventKinds = async () =>
    (
      await env.DB.prepare("SELECT kind FROM job_events WHERE appointment_id = ?1 ORDER BY received_at, rowid")
        .bind(TODAY_JOB)
        .all<{ kind: string }>()
    ).results.map((row) => row.kind);

  /** The after set's front photograph as it is held: which take, and its small copy. */
  const afterFront = () =>
    env.DB.prepare(
      `SELECT p.r2_key, p.thumbnail_key FROM photos p JOIN photo_sets s ON s.id = p.photo_set_id
       WHERE s.appointment_id = ?1 AND s.phase = 'after' AND p.angle = 'front'`,
    )
      .bind(TODAY_JOB)
      .first();

  async function closedAsDone() {
    await work(CLOSED_AT, TODAY_JOB, [...UP_TO_THE_OUTCOME, ["outcome", { outcome: "done" }, 80]]);
  }

  it("refuses a second outcome, and the visit stays closed as the first said", async () => {
    await closedAsDone();

    const partial = { outcome: "partial", reason: "client_stopped_it" };
    await refusedAsClosed(await postAt(minutesAfterClose(5), stepPath("outcome"), partial, uuidv7At(95)));

    expect(await statusOf(TODAY_JOB)).toBe("completed");
    expect(await visitRowOf(TODAY_JOB)).toMatchObject({ outcome: "done", partial_reason: null });
    expect((await eventKinds()).filter((kind) => kind === "outcome")).toHaveLength(1);
  });

  it("refuses a check-in and a no-show after the close", async () => {
    await closedAsDone();
    const landed = await eventKinds();

    await refusedAsClosed(await postAt(minutesAfterClose(5), stepPath("checkin"), AT_THE_DOOR, uuidv7At(95)));
    await refusedAsClosed(await postAt(minutesAfterClose(5), stepPath("no-show"), undefined, uuidv7At(96)));

    expect(await eventKinds()).toEqual(landed);
    expect(await statusOf(TODAY_JOB)).toBe("completed");
  });

  it("gives no upload link, and takes no photograph or small copy on a link given before the close", async () => {
    await work(CLOSED_AT, TODAY_JOB, UP_TO_THE_OUTCOME);
    const link = await (await askForUploadLinkAt(CLOSED_AT)).json<{ upload_url: string; small_upload_url: string }>();
    const taken = await putPhotoAt(CLOSED_AT, link.upload_url, syntheticJpeg(1200, 1600, "first"));
    const { take } = await taken.json<{ take: string }>();
    const kept = await afterFront();
    await work(CLOSED_AT, TODAY_JOB, [["outcome", { outcome: "done" }, 80]]);

    await refusedAsClosed(await askForUploadLinkAt(minutesAfterClose(1)));
    const retake = await putPhotoAt(minutesAfterClose(1), link.upload_url, syntheticJpeg(1200, 1600, "retake"));
    await refusedAsClosed(retake);
    const small = `${link.small_upload_url}?take=${take}`;
    await refusedAsClosed(await putPhotoAt(minutesAfterClose(1), small, syntheticJpeg(300, 400)));

    expect(await afterFront()).toEqual(kept);
  });

  it("takes a corrected checklist and count of what was used for an hour after the close, and nothing after", async () => {
    await closedAsDone();

    const withinTheHour = minutesAfterClose(59);
    expect((await postAt(withinTheHour, stepPath("checklist"), { done: [] }, uuidv7At(140))).status).toBe(202);
    expect((await postAt(withinTheHour, stepPath("consumables"), { items: [] }, uuidv7At(141))).status).toBe(202);

    const pastTheHour = minutesAfterClose(61);
    await refusedAsClosed(await postAt(pastTheHour, stepPath("checklist"), { done: [] }, uuidv7At(150)));
    await refusedAsClosed(await postAt(pastTheHour, stepPath("consumables"), { items: [] }, uuidv7At(151)));
  });

  it("refuses the phone's steps on a job ops closed by hand", async () => {
    await work(minutesAfterStart(10), TODAY_JOB, UP_TO_THE_OUTCOME.slice(0, 2));
    const byHand = {
      outcome: "done",
      started_at: minutesAfterStart(5).toISOString(),
      ended_at: minutesAfterStart(80).toISOString(),
      reason: "Imran's phone was lost; the client confirmed the visit by phone",
    };
    const closed = await opsPost(`/api/visits/${TODAY_JOB}/close`, byHand, fakeDependencies({ now: () => CLOSED_AT }));
    expect(closed.status).toBe(200);

    await refusedAsClosed(await postAt(minutesAfterClose(30), stepPath("photos"), { phase: "before" }, uuidv7At(10)));
    expect(await eventKinds()).toEqual(["check_in", "start"]);
  });
});
