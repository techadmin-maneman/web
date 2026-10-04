// Board C3: the areas people wait for, a launch's preview and confirmation, and a pincode added to the service area.

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
  cities: ["Gurgaon", "Delhi", "Mumbai", "Bengaluru"],
} satisfies OpsReply<"/api/waitlist">;

/** A pincode people wait in that the service area does not hold: it has no area and no city until it is added. */
export const UNHELD = {
  pincode: "560001",
  area: null,
  city: null,
  served: false,
  launched_at: null,
  waiting: 3,
  oldest: "2027-04-02T06:00:00.000Z",
  referred: 0,
  alerts: 2,
} satisfies OpsReply<"/api/waitlist">["areas"][number];

/** That pincode, once added. */
export const ADDED = {
  pincode: "560001",
  area: "MG Road",
  city: "Bengaluru",
  served: false,
  launch_on: null,
  waiting: 3,
  to_alert: 2,
} satisfies OpsReply<"/api/pincodes", "post", 201>;

export const PREVIEW = { pincode: "400050", waiting: 117, alerts: 84, launched: false } satisfies OpsReply<
  "/api/pincodes/{pin}/launch",
  "post"
>;

export const LAUNCHED = { pincode: "400050", waiting: 117, alerts: 84, launched: true } satisfies OpsReply<
  "/api/pincodes/{pin}/launch",
  "post"
>;
