// Each alert as its inbox row says it (apps/tech/src/alerts/lines.ts): when it came, its words, the client where the
// phone may name them and the job's time and kind where not, the day of a job on another day, and where the row goes:
// its job, the day ahead's day, or nowhere for a job no longer the technician's. NOW is 11 November 2026, 10:50 am in
// India. Every name here is made up.

import { describe, expect, it } from "vitest";
import type { components } from "../../../../../apps/tech/src/api-schema.ts";
import { linesOf } from "../../../../../apps/tech/src/alerts/lines.ts";

type Alert = components["schemas"]["TechnicianAlert"];

const JOB = "a0000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-11-11T05:20:00Z");

const alert = (fields: Partial<Alert>): Alert => ({
  id: "al1",
  kind: "time_to_leave",
  read: false,
  sent_at: "2026-11-11T05:17:00Z",
  job_id: JOB,
  date: "2026-11-11",
  type: "service",
  sector: "Sector 65",
  client_name: "Rohit M.",
  starts_at: "2026-11-11T06:00:00Z",
  was_starts_at: null,
  leave_by: "2026-11-11T05:25:00Z",
  drive_minutes: 18,
  finish_by: null,
  jobs: null,
  navigate: null,
  ...fields,
});

const lineOf = (fields: Partial<Alert>) => linesOf([alert(fields)], NOW)[0];

describe("an alert's row", () => {
  it("says when to leave, by the minutes left when it was sent, for the client, and opens the job", () => {
    expect(lineOf({})).toEqual({
      id: "al1",
      when: "10:47 am",
      title: "Leave in 8 min for Rohit M.",
      body: "18 min drive to Sector 65",
      to: `/jobs/${JOB}`,
    });
  });

  it("names a job by its time and kind where the phone may not name the client", () => {
    expect(lineOf({ client_name: null })?.title).toBe("Leave in 8 min for the 11:30 am service visit");
  });

  it("says a job moved, with its kind, area and old time, naming the day where it is not today", () => {
    expect(
      lineOf({ kind: "job_moved", starts_at: "2026-11-12T10:45:00Z", was_starts_at: "2026-11-11T08:30:00Z" }),
    ).toMatchObject({ title: "Rohit M. moved to tomorrow 4:15 pm", body: "Service visit · Sector 65 · was 2 pm" });
    expect(
      lineOf({
        kind: "job_moved",
        client_name: null,
        starts_at: "2026-11-11T10:45:00Z",
        was_starts_at: "2026-11-13T08:30:00Z",
      })?.title,
    ).toBe("The Fri 13 Nov, 2 pm service visit moved to 4:15 pm");
  });

  it("says a job was called off or given to another, and opens nothing, the job no longer the technician's", () => {
    expect(lineOf({ kind: "job_cancelled" })).toMatchObject({
      title: "Rohit M.’s visit was cancelled",
      body: "Service visit · 11:30 am",
      to: null,
    });
    expect(lineOf({ kind: "job_reassigned", client_name: null, type: null, sector: null })).toMatchObject({
      title: "The 11:30 am job went to another technician",
      body: "11:30 am",
      to: null,
    });
  });

  it("says a visit runs over, by when to finish, for which job", () => {
    expect(lineOf({ kind: "running_over", finish_by: "2026-11-11T05:40:00Z" })).toMatchObject({
      title: "Running over · finish by 11:10 am",
      body: "for the 11:30 am job, Sector 65",
      to: `/jobs/${JOB}`,
    });
  });

  it("says how many jobs tomorrow holds and the first, and opens that day", () => {
    expect(
      lineOf({
        kind: "day_ahead",
        sent_at: "2026-11-10T14:30:00Z",
        date: "2026-11-12",
        jobs: 4,
        starts_at: "2026-11-12T04:00:00Z",
      }),
    ).toMatchObject({
      when: "Yesterday, 8 pm",
      title: "Tomorrow: 4 jobs from 9:30 am",
      body: "First: Rohit M., Sector 65",
      to: "/week/2026-11-12",
    });
  });
});
