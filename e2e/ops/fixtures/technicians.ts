// Board D3: the roster, the phones the board does not draw, leave, and what
// each technician has finished.

import type { OpsReply } from "../answer.ts";

type Roster = OpsReply<"/api/technicians">;
type Technician = Roster["technicians"][number];

const technician = (
  n: number,
  name: string,
  initials: string,
  zone: string | null,
  devices: Technician["devices"],
  leave: Technician["leave"] = [],
): Technician => ({ id: `88000000-0000-4000-8000-00000000000${String(n)}`, name, initials, zone, devices, leave });

export const TECHNICIANS = {
  technicians: [
    technician(1, "Imran Qureshi", "IQ", "Sec 40–65", [
      {
        device_id: "a41c09e27f3b",
        label: "Chrome on Android",
        last_seen_at: "2027-09-22T05:00:00.000Z",
        revoked_at: null,
      },
      {
        device_id: "5d20be8c61a9",
        label: "Safari on iPhone",
        last_seen_at: "2027-08-04T05:00:00.000Z",
        revoked_at: "2027-08-05T05:00:00.000Z",
      },
    ]),
    technician(
      2,
      "Sandeep Yadav",
      "SY",
      "Sec 1–39",
      [{ device_id: "c7e4f1a8902d", label: null, last_seen_at: "2027-09-21T05:00:00.000Z", revoked_at: null }],
      // Leave ops recorded here, which the dispatch board reads from the same rows (ADR 0062).
      [{ id: "89000000-0000-4000-8000-000000000001", from: "2027-10-02", to: "2027-10-06", note: "Family wedding" }],
    ),
    technician(3, "Faizan Ali", "FA", null, []),
  ],
} satisfies Roster;

export const LEAVE_RECORDED = { id: "89000000-0000-4000-8000-000000000002" } satisfies OpsReply<
  "/api/technicians/{id}/leave",
  "post"
>;

export const LEAVE_CANCELLED = { cancelled: true } satisfies OpsReply<
  "/api/technicians/{id}/leave/{leave}/cancel",
  "post"
>;

/**
 * What each of them has finished, over the quarter the route counts by default.
 * Faizan's is the board's own line, "18 minutes over on services", against the
 * 90 minutes a service visit is planned for; Sandeep's average is of fewer jobs
 * than he finished, because the phone timed only thirty of them.
 */
export const TECHNICIAN_WORK = {
  from: "2027-06-24",
  to: "2027-09-23",
  technicians: [
    {
      technician_id: "88000000-0000-4000-8000-000000000001",
      jobs: 48,
      timed_jobs: 48,
      average_minutes: 84,
      average_planned_minutes: 90,
      skill: null,
    },
    {
      technician_id: "88000000-0000-4000-8000-000000000002",
      jobs: 34,
      timed_jobs: 30,
      average_minutes: 91,
      average_planned_minutes: 90,
      skill: null,
    },
    {
      technician_id: "88000000-0000-4000-8000-000000000003",
      jobs: 29,
      timed_jobs: 29,
      average_minutes: 108,
      average_planned_minutes: 90,
      skill: null,
    },
  ],
} satisfies OpsReply<"/api/technicians/work">;
