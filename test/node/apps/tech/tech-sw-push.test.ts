// What a push shows on a technician's lock screen (apps/tech/sw/notice.ts): each alert not yet read and not shown
// before, a notification each, in words that name no client, the minutes to leave as the notice is shown, and the day
// of a job on another day; Navigate where there is somewhere to go, and a tap that opens the job, its day or the inbox.
// And the worker, built as one classic file, imports nothing the app imports, which would split it into chunks a
// classic worker cannot load. NOW is 11 November 2026, 10:50 am in India.

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { noticesOf, WORDS, type PushedAlert } from "../../../../apps/tech/sw/notice.ts";

const JOB = "a0000000-0000-4000-8000-000000000001";
const MAPS = "https://www.google.com/maps/dir/?api=1&destination=28.4%2C77.07";
const NOW = Date.parse("2026-11-11T05:20:00Z");
const NONE = new Set<string>();

const alert = (fields: Partial<PushedAlert>): PushedAlert => ({
  id: "al1",
  kind: "time_to_leave",
  read: false,
  sent_at: "2026-11-11T05:17:00Z",
  job_id: JOB,
  date: "2026-11-11",
  type: "service",
  sector: "Sector 65",
  starts_at: "2026-11-11T06:00:00Z",
  was_starts_at: null,
  leave_by: "2026-11-11T05:27:00Z",
  drive_minutes: 18,
  finish_by: null,
  jobs: null,
  navigate: MAPS,
  ...fields,
});

describe("a push on the lock screen", () => {
  it("says how long is left to leave as it is shown, with no client's name, and offers Navigate and the job", () => {
    expect(noticesOf([alert({})], NONE, NOW)).toEqual([
      {
        title: "Leave in 7 min",
        body: "11:30 am service visit · Sector 65",
        tag: "al1",
        open: `/jobs/${JOB}`,
        navigate: MAPS,
      },
    ]);
    expect(noticesOf([alert({})], NONE, NOW + 9 * 60_000)[0]?.title).toBe("Time to leave");
  });

  it("shows each alert not yet shown, a notification each, and none already shown or read", () => {
    const cancelled = alert({ id: "al2", kind: "job_cancelled", navigate: null });
    const moved = alert({ id: "al3", kind: "job_moved", read: true });
    expect(noticesOf([cancelled, alert({})], NONE, NOW).map((notice) => notice.tag)).toEqual(["al2", "al1"]);
    expect(noticesOf([cancelled, alert({}), moved], new Set(["al2"]), NOW).map((notice) => notice.tag)).toEqual([
      "al1",
    ]);
  });

  it("says a job moved, naming the day where it is not today, and opens it", () => {
    const moved = alert({
      kind: "job_moved",
      starts_at: "2026-11-12T10:45:00Z",
      was_starts_at: "2026-11-11T08:30:00Z",
    });
    expect(noticesOf([moved], NONE, NOW)[0]).toMatchObject({
      title: "A job moved to tomorrow 4:15 pm",
      body: "Sector 65 · was 2 pm",
      open: `/jobs/${JOB}`,
    });
    const later = alert({
      kind: "job_moved",
      starts_at: "2026-11-13T10:45:00Z",
      was_starts_at: "2026-11-11T08:30:00Z",
    });
    expect(noticesOf([later], NONE, NOW)[0]?.title).toBe("A job moved to Fri 13 Nov, 4:15 pm");
  });

  it("opens the inbox for a job that is no longer the technician's", () => {
    expect(noticesOf([alert({ kind: "job_cancelled", navigate: null })], NONE, NOW)[0]).toMatchObject({
      title: "A job was cancelled",
      body: "11:30 am service visit",
      open: "/alerts",
      navigate: null,
    });
    expect(noticesOf([alert({ kind: "job_reassigned", navigate: null })], NONE, NOW)[0]?.open).toBe("/alerts");
  });

  it("says how many jobs tomorrow holds and from when, and opens that day", () => {
    const ahead = alert({
      kind: "day_ahead",
      date: "2026-11-12",
      jobs: 4,
      starts_at: "2026-11-12T04:00:00Z",
      navigate: null,
    });
    expect(noticesOf([ahead], NONE, NOW)[0]).toMatchObject({
      title: "Tomorrow: 4 jobs from 9:30 am",
      body: "First in Sector 65",
      open: "/week/2026-11-12",
    });
  });

  it("says a visit runs over, by when to finish, for which job", () => {
    const over = alert({ kind: "running_over", finish_by: "2026-11-11T05:40:00Z" });
    expect(noticesOf([over], NONE, NOW)[0]).toMatchObject({
      title: "Running over · finish by 11:10 am",
      body: "for the 11:30 am service visit · Sector 65",
    });
  });

  it("still shows one when none is new, or the alerts could not be read, as the phones require", () => {
    expect(noticesOf([alert({})], new Set(["al1"]), NOW).map((notice) => notice.tag)).toEqual(["al1"]);
    const fallback = { ...WORDS.unread, tag: "alerts", open: "/alerts", navigate: null };
    expect(noticesOf(null, NONE, NOW)).toEqual([fallback]);
    expect(noticesOf([alert({ read: true })], NONE, NOW)).toEqual([fallback]);
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
