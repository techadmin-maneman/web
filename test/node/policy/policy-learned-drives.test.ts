// Drive times learned from our own drives (src/policy/learned-drives.ts): which drives are learned from, each slot's
// middle drive against its estimate, and the pace a day takes once a slot has the drives ops ask for. Pins sit due
// north of each other, and the estimate drives a kilometre a minute with nothing to park.

import { describe, expect, it } from "vitest";
import { dayDrive, minuteOf, type PlanDay } from "../../../src/policy/day-plan.ts";
import { atPace, DRIVE_ESTIMATE } from "../../../src/policy/drive-estimate.ts";
import { drivesOf, isClean, learn, paceOf, type DoneJob, type Observed } from "../../../src/policy/learned-drives.ts";
import { nextJobs } from "../../../src/policy/next-job.ts";
import { BOOKING_RULES } from "../../../src/policy/start-times.ts";

const ESTIMATE = { ...DRIVE_ESTIMATE, road_factor: 100, peak_kmh: 60, offpeak_kmh: 60, parking: 0, least: 10 };
const RULES = { booking: BOOKING_RULES, drive: ESTIMATE };
const north = (km: number) => ({ lat: 28.4 + km / 111.195, lng: 77.05 });
/** India's `time` on `date` as an instant. */
const at = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`).toISOString();

const drive = (took: number, rest: Partial<Observed> = {}): Observed => ({
  dayKind: "weekday",
  hour: 10,
  estimate: 20,
  took,
  overBreak: false,
  ...rest,
});

describe("a drive learned from", () => {
  it("is one up to three times its estimate", () => {
    expect([drive(60), drive(61), drive(0)].map((each) => isClean(each, 30))).toEqual([true, false, false]);
  });

  it("is not one across the day's break that took the break's length more than its estimate", () => {
    expect(isClean(drive(49, { overBreak: true }), 30)).toBe(true);
    expect(isClean(drive(50, { overBreak: true }), 30)).toBe(false);
    expect(isClean(drive(50), 30)).toBe(true);
  });
});

describe("a slot's pace", () => {
  it("is its middle drive's time as a per cent of its estimate, with how many drives stand behind it", () => {
    const learned = learn([drive(24), drive(28), drive(32), drive(90), drive(18, { dayKind: "weekend" })], 30);
    expect(learned).toEqual([
      { dayKind: "weekday", hour: 10, factorPct: 140, drives: 3 },
      { dayKind: "weekend", hour: 10, factorPct: 90, drives: 1 },
    ]);
    expect(learn([drive(24), drive(28)], 30)).toEqual([{ dayKind: "weekday", hour: 10, factorPct: 130, drives: 2 }]);
  });

  it("is the day's for each hour with the drives ops ask for, the estimate's for the rest", () => {
    const learned = [
      { dayKind: "weekday", hour: 10, factorPct: 140, drives: 20 },
      { dayKind: "weekday", hour: 11, factorPct: 120, drives: 19 },
      { dayKind: "weekend", hour: 10, factorPct: 90, drives: 25 },
    ] as const;
    const weekday = paceOf(learned, { dayKind: "weekday", minDrives: 20, use: "learned" });
    expect([weekday?.[9], weekday?.[10], weekday?.[11], weekday?.length]).toEqual([100, 140, 100, 24]);
    expect(paceOf(learned, { dayKind: "weekend", minDrives: 20, use: "learned" })?.[10]).toBe(90);
  });

  it("is none where no hour has the drives ops ask for, or ops use the estimate", () => {
    const learned = [{ dayKind: "weekday", hour: 10, factorPct: 140, drives: 20 }] as const;
    expect(paceOf(learned, { dayKind: "weekday", minDrives: 21, use: "learned" })).toBeNull();
    expect(paceOf(learned, { dayKind: "weekday", minDrives: 20, use: "estimate" })).toBeNull();
  });
});

describe("the drives of a day", () => {
  const job = (technicianId: string, date: string, times: readonly [string, string], km: number): DoneJob => ({
    technicianId,
    date,
    arrived: at(date, times[0]),
    closed: at(date, times[1]),
    pin: north(km),
  });
  const given = { estimate: ESTIMATE, booking: BOOKING_RULES, away: [] };
  // Wednesday 21 October: 25 km out at half past ten, 40 minutes taken; and 25 km more at half past one, over the break.
  const DAY = [
    job("imran", "2026-10-21", ["09:00", "10:30"], 0),
    job("imran", "2026-10-21", ["11:10", "13:30"], 25),
    job("imran", "2026-10-21", ["14:45", "16:00"], 50),
  ];

  it("run from each job's close to the next one's check-in, against the estimate at the hour they set off in", () => {
    expect(drivesOf(DAY, given)).toEqual([
      { dayKind: "weekday", hour: 10, estimate: 25, took: 40, overBreak: false },
      { dayKind: "weekday", hour: 13, estimate: 25, took: 75, overBreak: true },
    ]);
  });

  it("are none between technicians, or days, or where a job has no pin or no time, or the drive crosses leave", () => {
    const apart = [
      job("imran", "2026-10-21", ["09:00", "10:30"], 0),
      job("sameer", "2026-10-21", ["11:10", "13:30"], 25),
      job("sameer", "2026-10-22", ["11:10", "13:30"], 25),
      { ...job("sameer", "2026-10-22", ["15:00", "16:00"], 50), pin: null },
      job("sameer", "2026-10-22", ["17:00", "18:00"], 75),
      { ...job("sameer", "2026-10-22", ["19:00", "19:30"], 100), arrived: null, closed: null },
      job("sameer", "2026-10-22", ["20:00", "20:30"], 125),
    ];
    expect(drivesOf(apart, given)).toEqual([]);
    const away = [{ technicianId: "imran", date: "2026-10-21", from: minuteOf("10:45"), to: minuteOf("11:00") }];
    expect(drivesOf(DAY, { ...given, away }).map((each) => each.hour)).toEqual([13]);
  });
});

describe("a drive at its learned pace", () => {
  it("is the estimate's per cent, rounded up, never under the least drive", () => {
    expect([atPace(25, 110, ESTIMATE), atPace(7, 120, ESTIMATE), atPace(25, 100, ESTIMATE)]).toEqual([28, 10, 25]);
  });

  it("lengthens a day's drives in the hours learned slower", () => {
    const day: PlanDay = {
      opens: minuteOf("09:00"),
      closes: minuteOf("20:00"),
      home: north(0),
      stops: [
        { start: minuteOf("09:30"), end: minuteOf("12:30"), pin: north(25), fit: true },
        { start: minuteOf("13:30"), end: minuteOf("15:00"), pin: north(50), fit: false },
      ],
      away: [],
    };
    const pace = Array.from({ length: 24 }, (_, hour) => (hour === 12 ? 200 : 100));
    // 25 out, 25 on at twice the time from half past twelve, 50 home.
    expect([dayDrive(day, RULES), dayDrive({ ...day, pace }, RULES)]).toEqual([100, 125]);
  });

  it("tells the technician to finish sooner for the drive after", () => {
    const jobs = [
      { startsAt: at("2026-10-22", "10:00"), minutes: 90, status: "scheduled", pin: north(0) },
      { startsAt: at("2026-10-22", "13:00"), minutes: 90, status: "scheduled", pin: north(25) },
    ];
    const pace = Array.from({ length: 24 }, (_, hour) => (hour === 11 ? 200 : 100));
    const [first] = nextJobs(jobs, { ...RULES, pace });
    expect(first).toEqual({ drive_minutes: 50, finish_by: at("2026-10-22", "12:00") });
  });
});
