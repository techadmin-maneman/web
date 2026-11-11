// What a push shows on a technician's lock screen (apps/tech/sw/notice.ts): the newest alert not yet read, in words
// that name no client, with Navigate where there is somewhere to go, and a tap that opens the job, its day or the
// inbox. And the worker, built as one classic file, imports nothing the app imports, which would split it into chunks
// a classic worker cannot load.

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { noticeOf, WORDS, type PushedAlert } from "../../../../apps/tech/sw/notice.ts";

const JOB = "a0000000-0000-4000-8000-000000000001";
const MAPS = "https://www.google.com/maps/dir/?api=1&destination=28.4%2C77.07";

const alert = (fields: Partial<PushedAlert>): PushedAlert => ({
  id: "al1",
  kind: "time_to_leave",
  read: false,
  job_id: JOB,
  date: null,
  type: "service",
  sector: "Sector 65",
  starts_at: "2026-11-11T06:00:00Z",
  was_starts_at: null,
  drive_minutes: 18,
  finish_by: null,
  jobs: null,
  navigate: MAPS,
  ...fields,
});

describe("a push on the lock screen", () => {
  it("says when to leave for the next job, with no client's name, and offers Navigate and the job", () => {
    expect(noticeOf([alert({})])).toEqual({
      title: "Leave in 10 min",
      body: "11:30 am service visit · Sector 65",
      tag: "al1",
      open: `/jobs/${JOB}`,
      navigate: MAPS,
    });
  });

  it("shows the newest alert not yet read", () => {
    const read = alert({ id: "al2", read: true, kind: "running_over", finish_by: "2026-11-11T05:40:00Z" });
    expect(noticeOf([read, alert({ id: "al1" })]).tag).toBe("al1");
  });

  it("says a job moved and when it was, and opens it", () => {
    const moved = alert({
      kind: "job_moved",
      starts_at: "2026-11-11T10:45:00Z",
      was_starts_at: "2026-11-11T08:30:00Z",
    });
    expect(noticeOf([moved])).toMatchObject({
      title: "A job moved to 4:15 pm",
      body: "Sector 65 · was 2 pm",
      open: `/jobs/${JOB}`,
    });
  });

  it("opens the inbox for a job that is no longer the technician's", () => {
    expect(noticeOf([alert({ kind: "job_cancelled", navigate: null })])).toMatchObject({
      title: "A job was cancelled",
      body: "11:30 am service visit",
      open: "/alerts",
      navigate: null,
    });
    expect(noticeOf([alert({ kind: "job_reassigned", navigate: null })]).open).toBe("/alerts");
  });

  it("says how many jobs tomorrow holds and from when, and opens that day", () => {
    const ahead = alert({
      kind: "day_ahead",
      job_id: null,
      date: "2026-11-12",
      jobs: 4,
      starts_at: "2026-11-12T04:00:00Z",
      navigate: null,
    });
    expect(noticeOf([ahead])).toMatchObject({
      title: "Tomorrow: 4 jobs from 9:30 am",
      body: "First in Sector 65",
      open: "/week/2026-11-12",
    });
  });

  it("says a visit runs over, by when to finish, for which job", () => {
    const over = alert({ kind: "running_over", finish_by: "2026-11-11T05:40:00Z" });
    expect(noticeOf([over])).toMatchObject({
      title: "Running over · finish by 11:10 am",
      body: "for the 11:30 am service visit · Sector 65",
    });
  });

  it("still shows one when the alerts could not be read, or none is new, as the phones require", () => {
    const fallback = { ...WORDS.unread, tag: "alerts", open: "/alerts", navigate: null };
    expect(noticeOf(null)).toEqual(fallback);
    expect(noticeOf([alert({ read: true })])).toEqual(fallback);
  });
});

describe("the worker's own modules", () => {
  it("import only each other and the workers' shared parts, never a module the app imports", () => {
    const folder = "apps/tech/sw";
    const imports = readdirSync(folder)
      .filter((file) => file.endsWith(".ts"))
      .flatMap((file) =>
        [...readFileSync(`${folder}/${file}`, "utf8").matchAll(/from "([^"]+)"/g)].map((match) => match[1]),
      );
    expect(
      imports.filter(
        (path) => !/^\.\/[\w-]+\.ts$|^\.\.\/\.\.\/\.\.\/packages\/web-kit\/sw-[\w-]+\.ts$/.test(path ?? ""),
      ),
    ).toEqual([]);
  });
});
