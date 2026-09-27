// Board C3: the areas people wait for, and a launch's preview and confirmation.

import type { OpsReply } from "../answer.ts";

export const AREAS = {
  areas: [
    {
      pincode: "400050",
      area: "Bandra W",
      city: "Mumbai",
      served: false,
      launched_at: null,
      waiting: 117,
      oldest: "2027-02-04T06:00:00.000Z",
      referred: 31,
      alerts: 84,
    },
    {
      pincode: "400026",
      area: "Cumballa",
      city: "Mumbai",
      served: false,
      launched_at: null,
      waiting: 64,
      oldest: "2027-03-19T06:00:00.000Z",
      referred: 12,
      alerts: 41,
    },
    {
      pincode: "122018",
      area: "Sector 65",
      city: "Gurgaon",
      served: true,
      launched_at: "2026-11-01T06:00:00.000Z",
      waiting: 4,
      oldest: "2027-05-11T06:00:00.000Z",
      referred: 1,
      alerts: 2,
    },
  ],
  more: false,
} satisfies OpsReply<"/api/waitlist">;

export const PREVIEW = { pincode: "400050", waiting: 117, alerts: 84, launched: false } satisfies OpsReply<
  "/api/pincodes/{pin}/launch",
  "post"
>;

export const LAUNCHED = { pincode: "400050", waiting: 117, alerts: 84, launched: true } satisfies OpsReply<
  "/api/pincodes/{pin}/launch",
  "post"
>;
