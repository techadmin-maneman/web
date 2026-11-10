// Between a technician's jobs (src/policy/next-job.ts): the drive to the next job still to do, and when this one must
// be done to reach it. Pins sit due north of each other, and the estimate drives a kilometre a minute with nothing to
// park, so each drive is as long as the distance.

import { describe, expect, it } from "vitest";
import { drivesTo, nextJobs } from "../../../src/policy/next-job.ts";
import { DRIVE_ESTIMATE } from "../../../src/policy/drive-estimate.ts";
import { BOOKING_RULES } from "../../../src/policy/start-times.ts";

const RULES = {
  booking: BOOKING_RULES,
  drive: { ...DRIVE_ESTIMATE, road_factor: 100, peak_kmh: 60, offpeak_kmh: 60, parking: 0, least: 10 },
};
const north = (km: number) => ({ lat: 28.4 + km / 111.195, lng: 77.05 });

/** A 90-minute job at `time` on 22 October, India's clock. */
const job = (time: string, km: number | null, status = "scheduled") => ({
  startsAt: new Date(`2026-10-22T${time}:00+05:30`).toISOString(),
  minutes: 90,
  status,
  pin: km === null ? null : north(km),
});

describe("the next job", () => {
  it("is driven to by the estimate, and this job finishes in time for its wrap-up and that drive", () => {
    const [first, second] = nextJobs([job("10:00", 0), job("13:00", 25)], RULES);
    expect(first?.drive_minutes).toBe(25);
    // 1 pm, less the 25-minute drive and the 10-minute wrap-up.
    expect(first?.finish_by).toBe(new Date("2026-10-22T12:25:00+05:30").toISOString());
    expect(second).toBeNull();
  });

  it("skips a job done, and is reached in the shortest drive where a pin is missing", () => {
    const [first] = nextJobs([job("10:00", 0), job("12:00", 5, "completed"), job("15:00", null)], RULES);
    expect(first?.drive_minutes).toBe(RULES.drive.least);
    expect(first?.finish_by).toBe(new Date("2026-10-22T14:40:00+05:30").toISOString());
  });

  it("is nothing for a job already closed", () => {
    expect(nextJobs([job("10:00", 0, "completed"), job("13:00", 25)], RULES)[0]).toBeNull();
  });
});

describe("the drive to each job", () => {
  const at = (time: string) => new Date(`2026-10-22T${time}:00+05:30`).toISOString();

  it("is from home to the day's first, and from the job before to each after it, and says when to leave", () => {
    const [first, second] = drivesTo([job("10:00", 20), job("13:00", 45)], north(0), RULES);
    expect(first).toEqual({ drive_minutes: 20, leave_by: at("09:40") });
    expect(second).toEqual({ drive_minutes: 25, leave_by: at("12:35") });
  });

  it("is from a job done as from any other, never less than the shortest drive, and that where a pin is missing", () => {
    const [, second, third] = drivesTo(
      [job("10:00", 0, "completed"), job("13:00", 5), job("16:00", null)],
      null,
      RULES,
    );
    // Five kilometres is less than the shortest drive, ten minutes.
    expect(second).toEqual({ drive_minutes: 10, leave_by: at("12:50") });
    expect(third).toEqual({ drive_minutes: 10, leave_by: at("15:50") });
  });

  it("is nothing for a job already closed, and the shortest drive from a home with no pin", () => {
    const [first, second] = drivesTo([job("10:00", 0, "completed"), job("13:00", 25)], null, RULES);
    expect(first).toBeNull();
    expect(second?.drive_minutes).toBe(25);
    expect(drivesTo([job("10:00", 0)], null, RULES)[0]).toEqual({ drive_minutes: 10, leave_by: at("09:50") });
  });
});
